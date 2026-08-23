//! Lichuang ESP32-S3 board implementation.
//!
//! Pins are transcribed from `main/boards/lckfb/szpi-esp32s3/config.h` in
//! xiaozhi-esp32. All board-specific initialization stays in this module.

mod lcd;
mod ui;

use std::error::Error;

use enigma_embedded_core::{Action, Location, Outcome};
use esp_idf_svc::hal::{
    gpio::{AnyIOPin, Gpio1, Gpio2, Gpio39, Gpio40, Gpio41, Gpio42, Input, PinDriver, Pull},
    i2c::I2C1,
    modem::Modem,
    peripherals::Peripherals,
    spi::SPI3,
    uart::{UartDriver, config::Config as UartConfig},
};

use crate::{board::EspIdfBoard, iphone, serial_provision};

pub struct LichuangEsp32S3;

pub(crate) struct Hardware {
    uart: Option<UartDriver<'static>>,
    modem: Modem<'static>,
    spi: SPI3<'static>,
    i2c: I2C1<'static>,
    sclk: Gpio41<'static>,
    mosi: Gpio40<'static>,
    dc: Gpio39<'static>,
    backlight: Gpio42<'static>,
    sda: Gpio1<'static>,
    scl: Gpio2<'static>,
    boot_button: PinDriver<'static, Input>,
}

impl EspIdfBoard for LichuangEsp32S3 {
    type Hardware = Hardware;

    const NAME: &'static str = "Lichuang ESP32-S3 N16R8";
    const FLASH_MIB: usize = 16;
    const PSRAM_MIB: usize = 8;

    fn take_hardware(peripherals: Peripherals) -> Result<(Self::Hardware, bool), Box<dyn Error>> {
        let pins = peripherals.pins;
        let boot_button = PinDriver::input(pins.gpio0, Pull::Up)?;
        let clear_pairing = boot_button.is_low();
        let uart = UartDriver::new(
            peripherals.uart0,
            pins.gpio43,
            pins.gpio44,
            Option::<AnyIOPin>::None,
            Option::<AnyIOPin>::None,
            &UartConfig::default(),
        )?;

        Ok((
            Hardware {
                uart: Some(uart),
                modem: peripherals.modem,
                spi: peripherals.spi3,
                i2c: peripherals.i2c1,
                sclk: pins.gpio41,
                mosi: pins.gpio40,
                dc: pins.gpio39,
                backlight: pins.gpio42,
                sda: pins.gpio1,
                scl: pins.gpio2,
                boot_button,
            },
            clear_pairing,
        ))
    }

    fn start_pairing_listener(
        hardware: &mut Self::Hardware,
        storage: iphone::PairingStorage,
    ) -> Result<(), Box<dyn Error>> {
        let uart = hardware
            .uart
            .take()
            .ok_or("CH340K pairing listener already started")?;
        serial_provision::start(uart, storage).map_err(|error| error.into())
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
