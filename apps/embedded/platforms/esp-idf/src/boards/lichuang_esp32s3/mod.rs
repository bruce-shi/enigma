//! Lichuang ESP32-S3 board implementation.
//!
//! Pins are transcribed from `main/boards/lckfb/szpi-esp32s3/config.h` in
//! xiaozhi-esp32. All board-specific initialization stays in this module.

mod lcd;
mod ui;

use std::error::Error;

use enigma_embedded_core::{Action, Location, Outcome};
use esp_idf_svc::hal::{
    gpio::{Gpio1, Gpio2, Gpio39, Gpio40, Gpio41, Gpio42, PinDriver, Pull},
    i2c::I2C1,
    peripherals::Peripherals,
    spi::SPI3,
};

use crate::board::EspIdfBoard;

pub struct LichuangEsp32S3;

pub(crate) struct Hardware {
    spi: SPI3<'static>,
    i2c: I2C1<'static>,
    sclk: Gpio41<'static>,
    mosi: Gpio40<'static>,
    dc: Gpio39<'static>,
    backlight: Gpio42<'static>,
    sda: Gpio1<'static>,
    scl: Gpio2<'static>,
}

impl EspIdfBoard for LichuangEsp32S3 {
    type Hardware = Hardware;

    const NAME: &'static str = "Lichuang ESP32-S3 N16R8";
    const FLASH_MIB: usize = 16;
    const PSRAM_MIB: usize = 8;
    const USB_MAX_CONTROL_TRANSFER_BYTES: usize = 1536;

    fn take_hardware(peripherals: Peripherals) -> Result<(Self::Hardware, bool), Box<dyn Error>> {
        let pins = peripherals.pins;
        let boot_button = PinDriver::input(pins.gpio0, Pull::Up)?;
        let clear_pairing = boot_button.is_low();
        drop(boot_button);

        Ok((
            Hardware {
                spi: peripherals.spi3,
                i2c: peripherals.i2c1,
                sclk: pins.gpio41,
                mosi: pins.gpio40,
                dc: pins.gpio39,
                backlight: pins.gpio42,
                sda: pins.gpio1,
                scl: pins.gpio2,
            },
            clear_pairing,
        ))
    }

    fn run_ui<F>(
        hardware: Self::Hardware,
        catalog: Vec<Location>,
        handle: F,
    ) -> Result<(), Box<dyn Error>>
    where
        F: FnMut(Action) -> Outcome,
    {
        ui::run(hardware, catalog, handle)
    }
}

pub(super) mod display {
    pub const WIDTH: u16 = 320;
    pub const HEIGHT: u16 = 240;
}

pub(super) mod shared_i2c {
    pub const PCA9557_ADDRESS: u8 = 0x19;
    pub const FT5X06_ADDRESS: u8 = 0x38;
}
