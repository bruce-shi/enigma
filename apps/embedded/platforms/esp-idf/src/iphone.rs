use std::error::Error;

use enigma_embedded_core::Location;
use esp_idf_svc::{
    nvs::{EspDefaultNvsPartition, EspKeyValueStorage, EspNvs, NvsDefault},
    sys,
};
use idevice::{
    IdeviceError, IdeviceService, lockdown::LockdownClient, pairing_file::PairingFile,
    services::simulate_location::LocationSimulationService,
};

use crate::{apple_mux::UsbMuxProvider, usb_host::UsbBulk};

const PAIRING_KEY: &str = "pair_record";
const MAX_PAIRING_RECORD_BYTES: usize = 24 * 1024;

pub type PairingStorage = EspKeyValueStorage<NvsDefault>;

pub struct IphoneController {
    runtime: tokio::runtime::Runtime,
    _provider: UsbMuxProvider,
    location_service: LocationSimulationService,
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

impl IphoneController {
    pub fn connect(storage: &PairingStorage) -> Result<Self, Box<dyn Error>> {
        let usb = UsbBulk::wait_for_iphone()?;
        let provider = UsbMuxProvider::new(usb)?;
        let runtime = tokio::runtime::Builder::new_current_thread()
            .enable_time()
            .build()?;

        let pairing_file = match load_pairing_file(storage)? {
            Some(pairing_file) => {
                log::info!("loaded stored iPhone pairing record");
                pairing_file
            }
            None => pair_iphone(&runtime, &provider, storage)?,
        };
        provider.set_pairing_file(pairing_file);

        let location_service =
            runtime.block_on(async { LocationSimulationService::connect(&provider).await })?;
        log::info!("iPhone location service connected");
        Ok(Self {
            runtime,
            _provider: provider,
            location_service,
        })
    }

    pub fn set(&mut self, location: &Location) -> Result<(), IdeviceError> {
        self.runtime.block_on(
            self.location_service
                .set(&location.latitude, &location.longitude),
        )?;
        log::info!(
            "location set successfully: {} ({}, {})",
            location.name,
            location.latitude,
            location.longitude
        );
        Ok(())
    }

    pub fn restore(&mut self) -> Result<(), IdeviceError> {
        self.runtime.block_on(self.location_service.clear())?;
        log::info!("location simulation cleared; real location restored");
        Ok(())
    }
}

fn pair_iphone(
    runtime: &tokio::runtime::Runtime,
    provider: &UsbMuxProvider,
    storage: &PairingStorage,
) -> Result<PairingFile, Box<dyn Error>> {
    let host_id = random_uuid();
    let system_buid = random_uuid();
    log::info!("no pairing record; unlock the iPhone and tap Trust");

    let pairing_file = runtime.block_on(async {
        let mut lockdown = LockdownClient::connect(provider).await?;
        lockdown
            .pair(&host_id, &system_buid, Some("Enigma Embedded"))
            .await
    })?;
    let serialized = pairing_file.clone().serialize()?;
    storage.set_raw(PAIRING_KEY, &serialized)?;
    log::info!("iPhone trusted; pairing record saved to flash");
    Ok(pairing_file)
}

fn load_pairing_file(storage: &PairingStorage) -> Result<Option<PairingFile>, Box<dyn Error>> {
    let mut buffer = vec![0; MAX_PAIRING_RECORD_BYTES];
    storage
        .get_raw(PAIRING_KEY, &mut buffer)?
        .map(PairingFile::from_bytes)
        .transpose()
        .map_err(Into::into)
}

fn random_uuid() -> String {
    let mut bytes = [0u8; 16];
    unsafe { sys::esp_fill_random(bytes.as_mut_ptr().cast(), bytes.len()) };
    bytes[6] = (bytes[6] & 0x0f) | 0x40;
    bytes[8] = (bytes[8] & 0x3f) | 0x80;
    format!(
        "{:02X}{:02X}{:02X}{:02X}-{:02X}{:02X}-{:02X}{:02X}-{:02X}{:02X}-{:02X}{:02X}{:02X}{:02X}{:02X}{:02X}",
        bytes[0],
        bytes[1],
        bytes[2],
        bytes[3],
        bytes[4],
        bytes[5],
        bytes[6],
        bytes[7],
        bytes[8],
        bytes[9],
        bytes[10],
        bytes[11],
        bytes[12],
        bytes[13],
        bytes[14],
        bytes[15]
    )
}
