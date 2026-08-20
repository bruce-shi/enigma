use std::{
    error::Error,
    sync::mpsc::{SyncSender, sync_channel},
    time::Duration,
};

use enigma_embedded_bridge_protocol::MAX_PAIRING_RECORD_BYTES;
use enigma_embedded_core::Location;
use esp_idf_svc::nvs::{EspDefaultNvsPartition, EspKeyValueStorage, EspNvs, NvsDefault};
use idevice::{
    IdeviceService, RsdService,
    core_device_proxy::CoreDeviceProxy,
    dvt::{location_simulation::LocationSimulationClient, remote_server::RemoteServerClient},
    pairing_file::PairingFile,
    provider::TcpProvider,
    rsd::RsdHandshake,
    services::simulate_location::LocationSimulationService,
};
use tokio::sync::mpsc;

use crate::wifi_access;

const PAIRING_KEY: &str = "pair_record";
const COMMAND_TIMEOUT: Duration = Duration::from_secs(30);
const SESSION_STACK_BYTES: usize = 64 * 1024;
pub type PairingStorage = EspKeyValueStorage<NvsDefault>;

enum LocationCommand {
    Set {
        latitude: f64,
        longitude: f64,
        reply: SyncSender<Result<(), String>>,
    },
    Clear {
        reply: SyncSender<Result<(), String>>,
    },
}

impl LocationCommand {
    fn fail(self, message: &str) {
        let result = Err(message.to_string());
        match self {
            Self::Set { reply, .. } | Self::Clear { reply } => {
                let _ = reply.send(result);
            }
        }
    }
}

pub struct IphoneController {
    commands: mpsc::Sender<LocationCommand>,
}

pub fn pairing_storage(
    partition: EspDefaultNvsPartition,
) -> Result<PairingStorage, Box<dyn Error>> {
    let nvs = EspNvs::new(partition, "idevice", true)?;
    Ok(EspKeyValueStorage::new(nvs))
}

pub fn clear_pairing(storage: &PairingStorage) -> Result<(), Box<dyn Error>> {
    let _ = storage.remove(PAIRING_KEY)?;
    log::info!("stored iPhone pairing record cleared");
    Ok(())
}

pub fn has_pairing_record(storage: &PairingStorage) -> Result<bool, Box<dyn Error>> {
    Ok(load_pairing_file(storage)?.is_some())
}

pub fn import_pairing_record(storage: &PairingStorage, bytes: &[u8]) -> Result<(), Box<dyn Error>> {
    if bytes.len() > MAX_PAIRING_RECORD_BYTES {
        return Err("pairing record exceeds board storage limit".into());
    }
    PairingFile::from_bytes(bytes)?;
    storage.set_raw(PAIRING_KEY, bytes)?;
    log::info!("desktop-provisioned iPhone pairing record saved to flash");
    Ok(())
}

impl IphoneController {
    pub fn connect(storage: &PairingStorage) -> Result<Self, Box<dyn Error>> {
        let pairing_file = load_pairing_file(storage)?.ok_or(
            "iPhone pairing is missing; connect the board and iPhone to the Mac and use Provision board",
        )?;
        let address = wifi_access::iphone_address()?;
        let provider = TcpProvider {
            addr: address,
            scope_id: None,
            pairing_file,
            label: "Enigma ESP32-S3 Wi-Fi".into(),
        };
        let (commands, receiver) = mpsc::channel(4);
        std::thread::Builder::new()
            .name("enigma-iphone".into())
            .stack_size(SESSION_STACK_BYTES)
            .spawn(move || run_worker(provider, receiver))?;
        log::info!("iPhone Wi-Fi session starting at {address}:62078");
        Ok(Self { commands })
    }

    pub fn set(&mut self, location: &Location) -> Result<(), Box<dyn Error>> {
        let latitude = location.latitude.parse::<f64>()?;
        let longitude = location.longitude.parse::<f64>()?;
        self.request(|reply| LocationCommand::Set {
            latitude,
            longitude,
            reply,
        })?;
        log::info!(
            "location set successfully: {} ({}, {})",
            location.name,
            location.latitude,
            location.longitude
        );
        Ok(())
    }

    pub fn restore(&mut self) -> Result<(), Box<dyn Error>> {
        self.request(|reply| LocationCommand::Clear { reply })?;
        log::info!("location simulation cleared; real location restored");
        Ok(())
    }

    fn request(
        &self,
        command: impl FnOnce(SyncSender<Result<(), String>>) -> LocationCommand,
    ) -> Result<(), Box<dyn Error>> {
        let (reply, response) = sync_channel(1);
        self.commands
            .blocking_send(command(reply))
            .map_err(|_| "iPhone Wi-Fi session stopped; tap again to reconnect")?;
        response
            .recv_timeout(COMMAND_TIMEOUT)
            .map_err(|_| "iPhone Wi-Fi session timed out; keep the phone unlocked and joined")?
            .map_err(Into::into)
    }
}

fn run_worker(provider: TcpProvider, mut receiver: mpsc::Receiver<LocationCommand>) {
    let runtime = match tokio::runtime::Builder::new_current_thread()
        .enable_all()
        .build()
    {
        Ok(runtime) => runtime,
        Err(error) => {
            fail_commands(
                &mut receiver,
                format!("could not start iPhone runtime: {error}"),
            );
            return;
        }
    };

    if let Err(error) = runtime.block_on(run_location_session(&provider, &mut receiver)) {
        log::error!("iPhone Wi-Fi session failed: {error}");
        fail_commands(&mut receiver, error);
    }
}

async fn run_location_session(
    provider: &TcpProvider,
    receiver: &mut mpsc::Receiver<LocationCommand>,
) -> Result<(), String> {
    match CoreDeviceProxy::connect(provider).await {
        Ok(proxy) => {
            log::info!("iPhone modern CoreDeviceProxy connected over Wi-Fi");
            run_modern_session(proxy, receiver).await
        }
        Err(modern_error) => {
            log::warn!(
                "modern iPhone service unavailable ({modern_error}); trying legacy location service"
            );
            run_legacy_session(provider, receiver)
                .await
                .map_err(|legacy_error| {
                    format!(
                        "modern service failed: {modern_error}; legacy service failed: {legacy_error}"
                    )
                })
        }
    }
}

async fn run_modern_session(
    proxy: CoreDeviceProxy,
    receiver: &mut mpsc::Receiver<LocationCommand>,
) -> Result<(), String> {
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
    log::info!("iPhone modern location service ready");

    while let Some(command) = receiver.recv().await {
        match command {
            LocationCommand::Set {
                latitude,
                longitude,
                reply,
            } => {
                let result = location
                    .set(latitude, longitude)
                    .await
                    .map_err(classify_error);
                let _ = reply.send(result);
            }
            LocationCommand::Clear { reply } => {
                let result = location.clear().await.map_err(classify_error);
                let _ = reply.send(result);
            }
        }
    }
    Ok(())
}

async fn run_legacy_session(
    provider: &TcpProvider,
    receiver: &mut mpsc::Receiver<LocationCommand>,
) -> Result<(), String> {
    let mut location = LocationSimulationService::connect(provider)
        .await
        .map_err(classify_error)?;
    log::info!("iPhone legacy location service ready");
    while let Some(command) = receiver.recv().await {
        match command {
            LocationCommand::Set {
                latitude,
                longitude,
                reply,
            } => {
                let latitude = latitude.to_string();
                let longitude = longitude.to_string();
                let result = location
                    .set(&latitude, &longitude)
                    .await
                    .map_err(classify_error);
                let _ = reply.send(result);
            }
            LocationCommand::Clear { reply } => {
                let result = location.clear().await.map_err(classify_error);
                let _ = reply.send(result);
            }
        }
    }
    Ok(())
}

fn fail_commands(receiver: &mut mpsc::Receiver<LocationCommand>, error: String) {
    while let Some(command) = receiver.blocking_recv() {
        command.fail(&error);
    }
}

fn load_pairing_file(storage: &PairingStorage) -> Result<Option<PairingFile>, Box<dyn Error>> {
    let mut buffer = vec![0; MAX_PAIRING_RECORD_BYTES];
    storage
        .get_raw(PAIRING_KEY, &mut buffer)?
        .map(PairingFile::from_bytes)
        .transpose()
        .map_err(Into::into)
}

fn classify_error(error: impl std::fmt::Display) -> String {
    error.to_string()
}
