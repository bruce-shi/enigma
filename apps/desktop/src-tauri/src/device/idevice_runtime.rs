use std::{collections::HashMap, sync::Arc, time::Duration};

use async_trait::async_trait;
use idevice::{
    IdeviceService, RemoteXpcClient, RsdService,
    core_device_proxy::CoreDeviceProxy,
    dvt::{location_simulation::LocationSimulationClient, remote_server::RemoteServerClient},
    provider::IdeviceProvider,
    remote_pairing::{RemotePairingClient, RpPairingFile},
    rsd::RsdHandshake,
    services::{lockdown::LockdownClient, simulate_location::LocationSimulationService},
    usbmuxd::{Connection, UsbmuxdAddr, UsbmuxdConnection, UsbmuxdDevice},
};
use tokio::sync::{Mutex, RwLock, mpsc, oneshot};
use uuid::Uuid;

use crate::{
    device::DeviceAdapter,
    model::{Coordinate, DeviceState, DeviceSummary, DeviceTransport},
};

#[derive(Debug, Clone)]
struct Descriptor {
    raw: UsbmuxdDevice,
    summary: DeviceSummary,
}

enum LocationCommand {
    Set(Coordinate, oneshot::Sender<Result<(), String>>),
    Clear(oneshot::Sender<Result<(), String>>),
}

#[derive(Default)]
pub struct DeviceRuntime {
    descriptors: RwLock<HashMap<String, Descriptor>>,
    ids_by_udid: RwLock<HashMap<String, String>>,
    selected_id: RwLock<Option<String>>,
    location_tx: Mutex<Option<mpsc::Sender<LocationCommand>>>,
}

impl DeviceRuntime {
    pub fn new() -> Arc<Self> {
        Arc::new(Self::default())
    }

    async fn selected_descriptor(&self) -> Result<Descriptor, String> {
        let id = self
            .selected_id
            .read()
            .await
            .clone()
            .ok_or_else(|| "select an iPhone first".to_string())?;
        self.descriptors
            .read()
            .await
            .get(&id)
            .cloned()
            .ok_or_else(|| "the selected iPhone is no longer available".to_string())
    }

    async fn command_sender(&self) -> Result<mpsc::Sender<LocationCommand>, String> {
        let mut current = self.location_tx.lock().await;
        if let Some(sender) = current.as_ref()
            && !sender.is_closed()
        {
            return Ok(sender.clone());
        }

        let descriptor = self.selected_descriptor().await?;
        let provider = descriptor.raw.to_provider(UsbmuxdAddr::default(), "Enigma");
        let (sender, receiver) = mpsc::channel(8);
        std::thread::Builder::new()
            .name("enigma-device-session".into())
            .spawn(move || {
                let runtime = tokio::runtime::Builder::new_current_thread()
                    .enable_all()
                    .build()
                    .expect("device session runtime must start");
                runtime.block_on(async move {
                    if let Err(modern_error) = run_modern_session(provider, receiver).await {
                        tracing::warn!(error = %modern_error, "location service unavailable");
                    }
                });
            })
            .map_err(|error| format!("could not start the device session: {error}"))?;
        *current = Some(sender.clone());
        Ok(sender)
    }

    async fn inspect_device(raw: &UsbmuxdDevice, id: String) -> DeviceSummary {
        let transport = match raw.connection_type {
            Connection::Usb => DeviceTransport::Usb,
            Connection::Network(_) => DeviceTransport::Network,
            Connection::Unknown(_) => DeviceTransport::Network,
        };
        let provider = raw.to_provider(UsbmuxdAddr::default(), "Enigma inspect");
        let paired = provider.get_pairing_file().await.is_ok();
        let mut summary = DeviceSummary {
            id,
            name: "iPhone".into(),
            model: None,
            os_version: None,
            os_build: None,
            transport,
            state: if paired {
                DeviceState::Ready
            } else {
                DeviceState::NeedsTrust
            },
            diagnostic_code: (!paired).then(|| "DEVICE_NOT_TRUSTED".into()),
        };

        if let Ok(mut lockdown) = LockdownClient::connect(&provider).await {
            summary.name = lockdown
                .get_value(Some("DeviceName"), None)
                .await
                .ok()
                .and_then(|value| value.into_string())
                .unwrap_or(summary.name);
            summary.model = lockdown
                .get_value(Some("ProductType"), None)
                .await
                .ok()
                .and_then(|value| value.into_string());
            summary.os_version = lockdown
                .get_value(Some("ProductVersion"), None)
                .await
                .ok()
                .and_then(|value| value.into_string());
            summary.os_build = lockdown
                .get_value(Some("BuildVersion"), None)
                .await
                .ok()
                .and_then(|value| value.into_string());
        }
        summary
    }

    async fn send_and_wait(
        &self,
        make_command: impl FnOnce(oneshot::Sender<Result<(), String>>) -> LocationCommand,
    ) -> Result<(), String> {
        let sender = self.command_sender().await?;
        let (reply, response) = oneshot::channel();
        sender
            .send(make_command(reply))
            .await
            .map_err(|_| "location service stopped before receiving the command".to_string())?;
        tokio::time::timeout(Duration::from_secs(25), response)
            .await
            .map_err(|_| "location service timed out".to_string())?
            .map_err(|_| "location service stopped before replying".to_string())?
    }

    pub async fn pairing_record_for(&self, device_id: &str) -> Result<Vec<u8>, String> {
        let descriptor = self
            .descriptors
            .read()
            .await
            .get(device_id)
            .cloned()
            .ok_or_else(|| "USB iPhone not found; scan again".to_string())?;
        if descriptor.raw.connection_type != Connection::Usb {
            return Err("select the USB-connected iPhone for board provisioning".into());
        }
        let provider = descriptor
            .raw
            .to_provider(UsbmuxdAddr::default(), "Enigma board provisioning");
        enable_wifi_debugging(&provider).await?;
        let pairing_file = provider.get_pairing_file().await.map_err(classify_error)?;
        let lockdown_record = pairing_file.serialize().map_err(classify_error)?;
        let remote_record = tokio::time::timeout(
            Duration::from_secs(90),
            create_remote_pairing_record(&provider),
        )
        .await
        .map_err(|_| {
            "REMOTE_PAIRING_TIMEOUT: unlock the iPhone, approve the Apple pairing prompt, and retry"
                .to_string()
        })??;
        enigma_embedded_bridge_protocol::encode_pairing_bundle(&lockdown_record, &remote_record)
            .map_err(|error| error.to_string())
    }

    pub async fn enable_desktop_wifi(&self, device_id: &str) -> Result<(), String> {
        let descriptor = self
            .descriptors
            .read()
            .await
            .get(device_id)
            .cloned()
            .ok_or_else(|| "USB iPhone not found; scan again".to_string())?;
        if descriptor.raw.connection_type != Connection::Usb {
            return Err("select the USB-connected iPhone to enable desktop Wi-Fi".into());
        }
        let provider = descriptor
            .raw
            .to_provider(UsbmuxdAddr::default(), "Enigma desktop Wi-Fi setup");
        enable_wifi_debugging(&provider).await
    }
}

async fn enable_wifi_debugging(provider: &dyn IdeviceProvider) -> Result<(), String> {
    let pairing_file = provider.get_pairing_file().await.map_err(classify_error)?;
    let mut lockdown = LockdownClient::connect(provider)
        .await
        .map_err(classify_error)?;
    lockdown
        .start_session(&pairing_file)
        .await
        .map_err(classify_error)?;
    lockdown
        .set_value(
            "EnableWifiDebugging",
            true.into(),
            Some("com.apple.mobile.wireless_lockdown"),
        )
        .await
        .map_err(classify_error)
}

async fn create_remote_pairing_record(provider: &dyn IdeviceProvider) -> Result<Vec<u8>, String> {
    let proxy = CoreDeviceProxy::connect(provider)
        .await
        .map_err(classify_error)?;
    let rsd_port = proxy.tunnel_info().server_rsd_port;
    let adapter = proxy.create_software_tunnel().map_err(classify_error)?;
    let mut adapter = adapter.to_async_handle();
    let rsd_stream = adapter.connect(rsd_port).await.map_err(classify_error)?;
    let handshake = RsdHandshake::new(rsd_stream)
        .await
        .map_err(classify_error)?;
    let tunnel_service = handshake
        .services
        .get("com.apple.internal.dt.coredevice.untrusted.tunnelservice")
        .ok_or_else(|| {
            "DEVELOPER_SERVICE_UNAVAILABLE: remote pairing service missing".to_string()
        })?;
    let tunnel_stream = adapter
        .connect(tunnel_service.port)
        .await
        .map_err(classify_error)?;
    let mut connection = RemoteXpcClient::new(tunnel_stream)
        .await
        .map_err(classify_error)?;
    connection.do_handshake().await.map_err(classify_error)?;
    connection.recv_root().await.map_err(classify_error)?;

    let host = "enigma-lichuang-esp32s3";
    let mut pairing_file = RpPairingFile::generate(host);
    let mut pairing = RemotePairingClient::new(connection, host);
    pairing
        .connect(&mut pairing_file, async || "000000".to_string())
        .await
        .map_err(classify_error)?;
    Ok(pairing_file.to_bytes())
}

#[async_trait]
impl DeviceAdapter for DeviceRuntime {
    async fn list_devices(&self) -> Result<Vec<DeviceSummary>, String> {
        let mut connection = UsbmuxdConnection::default().await.map_err(classify_error)?;
        let devices = connection.get_devices().await.map_err(classify_error)?;
        let mut descriptors = HashMap::new();
        let mut known_ids = self.ids_by_udid.write().await;

        for raw in devices {
            let id = known_ids
                .entry(raw.udid.clone())
                .or_insert_with(|| Uuid::new_v4().to_string())
                .clone();
            if descriptors.get(&id).is_some_and(|current: &Descriptor| {
                current.raw.connection_type == Connection::Usb
                    && raw.connection_type != Connection::Usb
            }) {
                continue;
            }
            let summary = Self::inspect_device(&raw, id.clone()).await;
            descriptors.insert(id, Descriptor { raw, summary });
        }
        let mut summaries = descriptors
            .values()
            .map(|descriptor| descriptor.summary.clone())
            .collect::<Vec<_>>();
        summaries.sort_by(|left, right| left.name.cmp(&right.name));
        *self.descriptors.write().await = descriptors;
        Ok(summaries)
    }

    async fn connect_device(&self, device_id: &str) -> Result<DeviceSummary, String> {
        let descriptor = self
            .descriptors
            .read()
            .await
            .get(device_id)
            .cloned()
            .ok_or_else(|| "device not found; scan again".to_string())?;
        if descriptor.summary.state == DeviceState::NeedsTrust {
            return Err("unlock the iPhone and approve Trust This Computer".into());
        }
        if !descriptor.summary.is_same_lan_wifi_candidate() {
            return Err(
                "connect to the iPhone over the same Wi-Fi network; USB operation remains deferred"
                    .into(),
            );
        }
        self.disconnect_device().await?;
        *self.selected_id.write().await = Some(device_id.to_string());
        Ok(descriptor.summary)
    }

    async fn disconnect_device(&self) -> Result<(), String> {
        if let Some(sender) = self.location_tx.lock().await.take() {
            let (reply, response) = oneshot::channel();
            let _ = sender.send(LocationCommand::Clear(reply)).await;
            let _ = tokio::time::timeout(Duration::from_secs(5), response).await;
        }
        *self.selected_id.write().await = None;
        Ok(())
    }

    async fn set_location(&self, point: Coordinate) -> Result<(), String> {
        let point = point.validate()?;
        self.send_and_wait(|reply| LocationCommand::Set(point, reply))
            .await
    }

    async fn clear_location(&self) -> Result<(), String> {
        let result = self.send_and_wait(LocationCommand::Clear).await;
        self.location_tx.lock().await.take();
        result
    }
}

async fn run_modern_session(
    provider: idevice::provider::UsbmuxdProvider,
    mut receiver: mpsc::Receiver<LocationCommand>,
) -> Result<(), String> {
    match CoreDeviceProxy::connect(&provider).await {
        Ok(proxy) => {
            let rsd_port = proxy.tunnel_info().server_rsd_port;
            let adapter = proxy.create_software_tunnel().map_err(classify_error)?;
            let mut adapter = adapter.to_async_handle();
            let stream = adapter.connect(rsd_port).await.map_err(classify_error)?;
            let mut handshake = RsdHandshake::new(stream).await.map_err(classify_error)?;
            let mut server: RemoteServerClient<Box<dyn idevice::ReadWrite>> =
                RemoteServerClient::connect_rsd(&mut adapter, &mut handshake)
                    .await
                    .map_err(classify_error)?;
            server.read_message(0).await.map_err(classify_error)?;
            let mut location = LocationSimulationClient::new(&mut server)
                .await
                .map_err(classify_error)?;
            while let Some(command) = receiver.recv().await {
                let should_close = matches!(command, LocationCommand::Clear(_));
                match command {
                    LocationCommand::Set(point, reply) => {
                        let result = location
                            .set(point.latitude, point.longitude)
                            .await
                            .map_err(classify_error);
                        let _ = reply.send(result);
                    }
                    LocationCommand::Clear(reply) => {
                        let result = location.clear().await.map_err(classify_error);
                        let _ = reply.send(result);
                    }
                }
                if should_close {
                    break;
                }
            }
            Ok(())
        }
        Err(modern_error) => {
            tracing::info!(error = %modern_error, "falling back to legacy location service");
            let mut location = LocationSimulationService::connect(&provider)
                .await
                .map_err(|legacy_error| {
                    format!(
                        "modern service failed: {}; legacy service failed: {}",
                        classify_error(modern_error),
                        classify_error(legacy_error)
                    )
                })?;
            while let Some(command) = receiver.recv().await {
                let should_close = matches!(command, LocationCommand::Clear(_));
                match command {
                    LocationCommand::Set(point, reply) => {
                        let latitude = point.latitude.to_string();
                        let longitude = point.longitude.to_string();
                        let result = location
                            .set(&latitude, &longitude)
                            .await
                            .map_err(classify_error);
                        let _ = reply.send(result);
                    }
                    LocationCommand::Clear(reply) => {
                        let result = location.clear().await.map_err(classify_error);
                        let _ = reply.send(result);
                    }
                }
                if should_close {
                    break;
                }
            }
            Ok(())
        }
    }
}

fn classify_error(error: impl std::fmt::Display) -> String {
    let message = error.to_string();
    let lower = message.to_ascii_lowercase();
    if lower.contains("pair") || lower.contains("trust") {
        format!("DEVICE_NOT_TRUSTED: {message}")
    } else if lower.contains("developer") || lower.contains("coredevice") {
        format!("DEVELOPER_SERVICE_UNAVAILABLE: {message}")
    } else if lower.contains("connection refused") || lower.contains("usbmux") {
        format!("APPLE_DRIVER_MISSING_OR_UNAVAILABLE: {message}")
    } else {
        format!("DEVICE_ERROR: {message}")
    }
}
