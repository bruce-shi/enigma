//! ESP-IDF entry point shared by all supported board implementations.

use std::error::Error;
use std::time::Duration;

use enigma_embedded_bridge_protocol::{ERROR_PREFIX, success_line};
use enigma_embedded_core::{Action, Application, Location, Outcome};
use esp_idf_svc::{hal::peripherals::Peripherals, nvs::EspDefaultNvsPartition};
use log::info;

use crate::{backend::EspIdfBackend, idevice_bridge};

pub(crate) trait EspIdfBoard {
    type Hardware;

    const NAME: &'static str;
    const FLASH_MIB: usize;
    const PSRAM_MIB: usize;

    /// Takes the board-specific peripherals and samples any startup controls.
    fn take_hardware(peripherals: Peripherals) -> Result<(Self::Hardware, bool), Box<dyn Error>>;

    /// Receives a one-time pairing record through the board provisioning link.
    fn receive_pairing(
        hardware: &Self::Hardware,
        timeout: Duration,
    ) -> Result<Option<Vec<u8>>, Box<dyn Error>>;

    /// Runs the board's input/output loop and forwards user actions to the app.
    fn run_ui<F>(
        hardware: Self::Hardware,
        catalog: Vec<Location>,
        handle: F,
    ) -> Result<(), Box<dyn Error>>
    where
        F: FnMut(Action) -> Outcome;
}

pub fn run<B: EspIdfBoard>() -> Result<(), Box<dyn Error>> {
    esp_idf_svc::sys::link_patches();
    esp_idf_svc::log::EspLogger::initialize_default();

    let (hardware, clear_pairing) = B::take_hardware(Peripherals::take()?)?;
    info!(
        "Enigma firmware booted: {} ({} MiB flash, {} MiB PSRAM)",
        B::NAME,
        B::FLASH_MIB,
        B::PSRAM_MIB
    );
    info!(
        "idevice {} linked: {}",
        idevice_bridge::IDEVICE_REVISION,
        idevice_bridge::linked_protocol()
    );
    info!("transport target: board Wi-Fi with imported Apple pairing identity");
    if clear_pairing {
        info!("startup control active: stored iPhone pairing will be cleared");
    }

    info!("initializing location and pairing storage");
    let backend = EspIdfBackend::new(EspDefaultNvsPartition::take()?, clear_pairing)?;
    let has_pairing = backend.has_pairing_record()?;
    let provisioning_timeout = if has_pairing {
        Duration::from_secs(3)
    } else {
        info!("no pairing record stored; opening desktop provisioning window");
        Duration::from_secs(5)
    };
    match B::receive_pairing(&hardware, provisioning_timeout) {
        Ok(Some(pairing_record)) => match backend.import_pairing_record(&pairing_record) {
            Ok(()) => info!("{}", success_line(&pairing_record)),
            Err(error) => log::error!("{ERROR_PREFIX} invalid pairing record: {error}"),
        },
        Ok(None) => {}
        Err(error) => log::error!("{ERROR_PREFIX} {error}"),
    }
    let catalog = backend.catalog()?;
    info!("storage ready; loaded {} location choices", catalog.len());
    let mut application = Application::new(backend);

    info!("starting board display and touch UI");
    B::run_ui(hardware, catalog, move |action| {
        let outcome = application.handle(action);
        if !outcome.success {
            log::error!("iPhone location action failed: {}", outcome.message);
        }
        outcome
    })
}
