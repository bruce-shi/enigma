use std::{
    error::Error,
    fmt::{Debug, Display},
    sync::mpsc::{SyncSender, sync_channel},
    time::Duration,
};

use enigma_embedded_bridge_protocol::{MAX_PAIRING_RECORD_BYTES, decode_pairing_bundle};
use enigma_embedded_core::Location;
use esp_idf_svc::{
    mdns::EspMdns,
    nvs::{EspKeyValueStorage, EspNvs, NvsCustom},
    sys::{self, EspError},
};
use idevice::{
    IdeviceService, RsdService,
    dvt::{location_simulation::LocationSimulationClient, remote_server::RemoteServerClient},
    pairing_file::PairingFile,
    provider::TcpProvider,
    remote_pairing::{
        RemotePairingClient, RpPairingFile, RpPairingSocket, connect_tls_psk_tunnel_native,
    },
    rsd::RsdHandshake,
    services::simulate_location::LocationSimulationService,
};
use tokio::sync::mpsc;

use crate::{persistent_storage::PersistentNvsPartition, wifi_access};

const PAIRING_KEY: &str = "pair_record";
const REMOTE_PAIRING_KEY: &str = "rp_record";
const REMOTE_PAIRING_HOST: &str = "enigma-lichuang-esp32s3";
const COMMAND_TIMEOUT: Duration = Duration::from_secs(30);
// The pure-Rust TLS-PSK and tunneled TCP stacks use 16 KiB record buffers and
// deeply nested async futures. Keep this worker off scarce internal RAM and
// leave enough headroom for the complete CoreDevice session.
const SESSION_STACK_BYTES: usize = 256 * 1024;
pub type PairingStorage = EspKeyValueStorage<NvsCustom>;

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
    partition: PersistentNvsPartition,
) -> Result<PairingStorage, Box<dyn Error>> {
    let nvs = EspNvs::new(partition, "idevice", true)?;
    Ok(EspKeyValueStorage::new(nvs))
}

pub fn clear_pairing(storage: &PairingStorage) -> Result<(), Box<dyn Error>> {
    let _ = storage.remove(PAIRING_KEY)?;
    let _ = storage.remove(REMOTE_PAIRING_KEY)?;
    log::info!("stored iPhone pairing identities cleared");
    Ok(())
}

pub fn has_pairing_record(storage: &PairingStorage) -> Result<bool, Box<dyn Error>> {
    Ok(load_pairing_file(storage)?.is_some() && load_remote_pairing_file(storage)?.is_some())
}

pub fn import_pairing_record(storage: &PairingStorage, bytes: &[u8]) -> Result<(), Box<dyn Error>> {
    if bytes.len() > MAX_PAIRING_RECORD_BYTES {
        return Err("pairing record exceeds board storage limit".into());
    }
    let bundle = decode_pairing_bundle(bytes).map_err(|error| error.to_string())?;
    PairingFile::from_bytes(bundle.lockdown)?;
    let remote = bundle
        .remote
        .ok_or("legacy pairing record has no modern Wi-Fi identity; provision the board again")?;
    RpPairingFile::from_bytes(remote)?;
    storage.set_raw(REMOTE_PAIRING_KEY, remote)?;
    storage.set_raw(PAIRING_KEY, bundle.lockdown)?;
    log::info!("desktop-provisioned iPhone pairing identities saved to flash");
    Ok(())
}

impl IphoneController {
    pub fn connect(storage: &PairingStorage) -> Result<Self, Box<dyn Error>> {
        let pairing_file = load_pairing_file(storage)?.ok_or(
            "iPhone pairing is missing; connect the board and iPhone to the Mac and use Provision board",
        )?;
        let remote_pairing_file = load_remote_pairing_file(storage)?.ok_or(
            "modern Wi-Fi pairing is missing; connect by USB and provision the board again",
        )?;
        let address = wifi_access::iphone_address()?;
        let provider = TcpProvider {
            addr: address,
            scope_id: None,
            pairing_file,
            label: "Enigma ESP32-S3 Wi-Fi".into(),
        };
        let (commands, receiver) = mpsc::channel(4);
        spawn_worker(move || run_worker(provider, remote_pairing_file, receiver))?;
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

fn spawn_worker(worker: impl FnOnce() + Send + 'static) -> Result<(), Box<dyn Error>> {
    let mut previous = sys::esp_pthread_cfg_t::default();
    let previous_result = unsafe { sys::esp_pthread_get_cfg(&mut previous) };
    if previous_result == sys::ESP_ERR_NOT_FOUND {
        previous = unsafe { sys::esp_pthread_get_default_config() };
    } else {
        EspError::convert(previous_result)?;
    }

    let mut worker_config = unsafe { sys::esp_pthread_get_default_config() };
    worker_config.stack_size = SESSION_STACK_BYTES as _;
    worker_config.stack_alloc_caps = sys::MALLOC_CAP_8BIT | sys::MALLOC_CAP_SPIRAM;
    EspError::convert(unsafe { sys::esp_pthread_set_cfg(&worker_config) })?;

    let spawned = std::thread::Builder::new()
        .name("enigma-iphone".into())
        .stack_size(SESSION_STACK_BYTES)
        .spawn(worker);

    if let Err(error) = EspError::convert(unsafe { sys::esp_pthread_set_cfg(&previous) }) {
        log::warn!("could not restore default thread configuration: {error}");
    }

    spawned?;
    log::info!("iPhone worker allocated {SESSION_STACK_BYTES} bytes in PSRAM");
    Ok(())
}

fn run_worker(
    provider: TcpProvider,
    remote_pairing_file: RpPairingFile,
    mut receiver: mpsc::Receiver<LocationCommand>,
) {
    let runtime = match tokio::runtime::Builder::new_current_thread()
        .enable_all()
        .build()
    {
        Ok(runtime) => {
            log::info!("iPhone async runtime ready");
            log_worker_stack("async runtime initialization");
            runtime
        }
        Err(error) => {
            log::error!("could not start iPhone runtime: {error}");
            fail_commands(
                &mut receiver,
                "iPhone runtime unavailable; restart board".into(),
            );
            return;
        }
    };

    if let Err(error) = runtime.block_on(run_location_session(
        &provider,
        remote_pairing_file,
        &mut receiver,
    )) {
        log::error!("iPhone Wi-Fi session failed: {error}");
        fail_commands(&mut receiver, error);
    }
}

async fn run_location_session(
    provider: &TcpProvider,
    remote_pairing_file: RpPairingFile,
    receiver: &mut mpsc::Receiver<LocationCommand>,
) -> Result<(), String> {
    let address = provider.addr;
    match run_remote_session(address, remote_pairing_file, receiver).await {
        Ok(()) => Ok(()),
        Err(modern_error) => {
            log::warn!("modern iPhone Wi-Fi tunnel failed ({modern_error}); trying legacy service");
            run_legacy_session(provider, receiver)
                .await
                .map_err(|legacy_error| {
                    format!("modern Wi-Fi failed: {modern_error}; legacy failed: {legacy_error}")
                })
        }
    }
}

async fn run_remote_session(
    address: std::net::IpAddr,
    mut pairing_file: RpPairingFile,
    receiver: &mut mpsc::Receiver<LocationCommand>,
) -> Result<(), String> {
    log::info!("discovering iPhone `_remotepairing._tcp` service over board Wi-Fi");
    let pairing_port = discover_remote_pairing_port()?;
    log::info!("iPhone remote pairing service found at {address}:{pairing_port}");
    let stream = tokio::net::TcpStream::connect((address, pairing_port))
        .await
        .map_err(|error| stage_error("connect to remote pairing service", error))?;
    let socket = RpPairingSocket::new(stream);
    let mut pairing = RemotePairingClient::new(socket, REMOTE_PAIRING_HOST);
    pairing
        .attempt_pair_verify()
        .await
        .map_err(|error| stage_error("start remote pairing verification", error))?;
    pairing
        .validate_pairing(&mut pairing_file)
        .await
        .map_err(|error| stage_error("verify provisioned remote identity", error))?;
    let tunnel_port = pairing
        .create_tcp_listener()
        .await
        .map_err(|error| stage_error("request CoreDevice tunnel listener", error))?;
    log::info!("iPhone CoreDevice TLS-PSK tunnel announced port {tunnel_port}");
    let tunnel_stream = tokio::net::TcpStream::connect((address, tunnel_port))
        .await
        .map_err(|error| stage_error("connect to CoreDevice tunnel", error))?;
    log_worker_stack("TLS-PSK handshake");
    let tunnel = connect_tls_psk_tunnel_native(tunnel_stream, pairing.encryption_key())
        .await
        .map_err(|error| stage_error("secure CoreDevice tunnel", error))?;
    log_worker_stack("completed TLS-PSK tunnel");
    let rsd_port = tunnel.info.server_rsd_port;
    let our_ip = tunnel
        .info
        .client_address
        .parse::<std::net::IpAddr>()
        .map_err(|error| stage_error("parse CoreDevice client address", error))?;
    let their_ip = tunnel
        .info
        .server_address
        .parse::<std::net::IpAddr>()
        .map_err(|error| stage_error("parse CoreDevice server address", error))?;
    let mtu = tunnel.info.mtu as usize;
    let stream = tunnel.into_inner();
    let mut adapter = idevice::tcp::adapter::Adapter::new(Box::new(stream), our_ip, their_ip);
    adapter.set_mss(mtu.saturating_sub(60));
    let mut adapter = adapter.to_async_handle();
    let stream = adapter
        .connect(rsd_port)
        .await
        .map_err(|error| stage_error("connect to tunneled RSD", error))?;
    let mut handshake = RsdHandshake::new(stream)
        .await
        .map_err(|error| stage_error("perform tunneled RSD handshake", error))?;
    let mut server: RemoteServerClient<Box<dyn idevice::ReadWrite>> =
        RemoteServerClient::connect_rsd(&mut adapter, &mut handshake)
            .await
            .map_err(|error| stage_error("connect remote developer service", error))?;
    server
        .read_message(0)
        .await
        .map_err(|error| stage_error("start remote developer service", error))?;
    let mut location = LocationSimulationClient::new(&mut server)
        .await
        .map_err(|error| stage_error("open location simulation channel", error))?;
    log::info!("iPhone modern location service ready over Wi-Fi");

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

fn log_worker_stack(stage: &str) {
    let minimum_free = unsafe { sys::uxTaskGetStackHighWaterMark2(core::ptr::null_mut()) };
    log::info!("iPhone worker minimum free stack at {stage}: {minimum_free} bytes");
}

fn discover_remote_pairing_port() -> Result<u16, String> {
    let _mdns = EspMdns::take().map_err(|error| stage_error("start mDNS discovery", error))?;
    let mut results = core::ptr::null_mut();
    let result = unsafe {
        sys::mdns_query_ptr(
            c"_remotepairing".as_ptr(),
            c"_tcp".as_ptr(),
            5_000,
            4,
            &mut results,
        )
    };
    if let Some(error) = EspError::from(result) {
        return Err(stage_error("discover iPhone remote pairing service", error));
    }

    // Read only the SRV port from ESP-IDF's linked list. The high-level
    // esp-idf-svc conversion assumes default interface-description strings and
    // panics for valid custom AP descriptions, which would reboot the board.
    let mut current = results;
    let mut port = None;
    while !current.is_null() {
        let candidate = unsafe { (*current).port };
        if candidate != 0 {
            port = Some(candidate);
            break;
        }
        current = unsafe { (*current).next };
    }
    unsafe { sys::mdns_query_results_free(results) };
    port.ok_or_else(|| "iPhone remote pairing service not found; keep phone unlocked".to_string())
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

fn load_remote_pairing_file(
    storage: &PairingStorage,
) -> Result<Option<RpPairingFile>, Box<dyn Error>> {
    let mut buffer = vec![0; MAX_PAIRING_RECORD_BYTES];
    storage
        .get_raw(REMOTE_PAIRING_KEY, &mut buffer)?
        .map(RpPairingFile::from_bytes)
        .transpose()
        .map_err(Into::into)
}

fn classify_error(error: impl Display + Debug) -> String {
    format!("{error} ({error:?})")
}

fn stage_error(stage: &str, error: impl Display + Debug) -> String {
    format!("{stage}: {}", classify_error(error))
}
