//! ESP-IDF entry point shared by all supported board implementations.

use std::error::Error;

use enigma_embedded_core::{Action, Application, Location, Outcome};
use esp_idf_svc::{hal::peripherals::Peripherals, nvs::EspDefaultNvsPartition};
use log::info;

use crate::{backend::EspIdfBackend, idevice_bridge, usb_host};

pub(crate) trait EspIdfBoard {
    type Hardware;

    const NAME: &'static str;
    const FLASH_MIB: usize;
    const PSRAM_MIB: usize;
    const USB_MAX_CONTROL_TRANSFER_BYTES: usize;

    /// Takes the board-specific peripherals and samples any startup controls.
    fn take_hardware(peripherals: Peripherals) -> Result<(Self::Hardware, bool), Box<dyn Error>>;

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
    info!(
        "USB transport target: Apple VID 0x{:04x}, max control transfer {} bytes",
        usb_host::APPLE_VENDOR_ID,
        B::USB_MAX_CONTROL_TRANSFER_BYTES
    );
    if clear_pairing {
        info!("startup control active: stored iPhone pairing will be cleared");
    }

    info!("initializing encrypted location and pairing storage");
    let backend = EspIdfBackend::new(EspDefaultNvsPartition::take()?, clear_pairing)?;
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
