//! ESP-IDF entry point shared by all supported board implementations.

use enigma_embedded_core::{Action, Application, Location, Outcome};
use esp_idf_svc::{
    hal::peripherals::Peripherals, io::vfs::MountedEventfs, nvs::EspDefaultNvsPartition,
};
use log::info;
use std::error::Error;

use crate::{backend::EspIdfBackend, idevice_bridge, iphone};

pub(crate) trait EspIdfBoard {
    type Hardware;

    const NAME: &'static str;
    const FLASH_MIB: usize;
    const PSRAM_MIB: usize;

    /// Takes the board-specific peripherals and samples any startup controls.
    fn take_hardware(peripherals: Peripherals) -> Result<(Self::Hardware, bool), Box<dyn Error>>;

    /// Starts the always-available local pairing listener and transfers its
    /// UART ownership into a background worker.
    fn start_pairing_listener(
        hardware: &mut Self::Hardware,
        storage: iphone::PairingStorage,
    ) -> Result<(), Box<dyn Error>>;

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

    // Mio/Tokio use eventfd to wake their async I/O poller. ESP-IDF does not
    // register that VFS automatically, so keep it mounted for every iPhone
    // session created during the lifetime of the board application.
    let _eventfs = MountedEventfs::mount(5)?;
    info!("async I/O eventfd VFS ready");

    let (mut hardware, clear_pairing) = B::take_hardware(Peripherals::take()?)?;
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
    info!("transport target: board Wi-Fi with imported Apple pairing identities");
    if clear_pairing {
        info!("startup control active: stored iPhone pairing will be cleared");
    }

    info!("initializing location and pairing storage");
    let partition = EspDefaultNvsPartition::take()?;
    let backend = EspIdfBackend::new(partition.clone(), clear_pairing)?;
    if backend.has_pairing_record()? {
        info!("stored iPhone Lockdown and remote-pairing identities are available");
    } else {
        info!("pairing identities incomplete; desktop provisioning remains available over CH340K");
    }
    B::start_pairing_listener(&mut hardware, iphone::pairing_storage(partition)?)?;
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
