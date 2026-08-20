//! Native ESP-IDF ST7789 driver and embedded-graphics framebuffer.

use core::{convert::Infallible, ffi::c_void, ptr::NonNull};
use std::{
    error::Error,
    io,
    sync::atomic::{AtomicBool, Ordering},
};

use embedded_graphics::{
    Pixel,
    pixelcolor::Rgb565,
    prelude::{DrawTarget, IntoStorage, OriginDimensions, RgbColor, Size},
};
use esp_idf_svc::{
    hal::{
        delay::FreeRtos,
        gpio::{Gpio39, Gpio40, Gpio41},
        spi::SPI3,
    },
    sys::{self, esp},
};

use super::display;

const SPI_CLOCK_HZ: u32 = 80_000_000;
const FRAME_PIXELS: usize = display::WIDTH as usize * display::HEIGHT as usize;
const FRAME_BYTES: usize = FRAME_PIXELS * 2;

static COLOR_TRANSFER_DONE: AtomicBool = AtomicBool::new(true);

/// A complete framebuffer backed by ESP-IDF's known-good ST7789 panel driver.
pub(super) struct LcdDisplay {
    panel: sys::esp_lcd_panel_handle_t,
    io: sys::esp_lcd_panel_io_handle_t,
    framebuffer: Vec<Rgb565>,
    dma_buffer: NonNull<u8>,
    transfer_in_flight: bool,
    // Retain the HAL ownership tokens while the raw ESP-IDF driver owns SPI3.
    _spi: SPI3<'static>,
    _sclk: Gpio41<'static>,
    _mosi: Gpio40<'static>,
    _dc: Gpio39<'static>,
}

impl LcdDisplay {
    pub(super) fn new<F>(
        spi: SPI3<'static>,
        sclk: Gpio41<'static>,
        mosi: Gpio40<'static>,
        dc: Gpio39<'static>,
        select_lcd: F,
    ) -> Result<Self, Box<dyn Error>>
    where
        F: FnOnce() -> Result<(), Box<dyn Error>>,
    {
        let mut bus_config: sys::spi_bus_config_t = unsafe { core::mem::zeroed() };
        bus_config.__bindgen_anon_1.mosi_io_num = 40;
        bus_config.__bindgen_anon_2.miso_io_num = -1;
        bus_config.sclk_io_num = 41;
        bus_config.__bindgen_anon_3.quadwp_io_num = -1;
        bus_config.__bindgen_anon_4.quadhd_io_num = -1;
        bus_config.data4_io_num = -1;
        bus_config.data5_io_num = -1;
        bus_config.data6_io_num = -1;
        bus_config.data7_io_num = -1;
        bus_config.max_transfer_sz = FRAME_BYTES as i32;
        esp!(unsafe {
            sys::spi_bus_initialize(
                sys::spi_host_device_t_SPI3_HOST,
                &bus_config,
                sys::spi_common_dma_t_SPI_DMA_CH_AUTO,
            )
        })?;

        let mut io_config: sys::esp_lcd_panel_io_spi_config_t = unsafe { core::mem::zeroed() };
        io_config.cs_gpio_num = -1;
        io_config.dc_gpio_num = 39;
        io_config.spi_mode = 2;
        io_config.pclk_hz = SPI_CLOCK_HZ;
        io_config.trans_queue_depth = 10;
        io_config.on_color_trans_done = Some(color_transfer_done);
        io_config.lcd_cmd_bits = 8;
        io_config.lcd_param_bits = 8;

        let mut io_handle: sys::esp_lcd_panel_io_handle_t = core::ptr::null_mut();
        esp!(unsafe {
            sys::esp_lcd_new_panel_io_spi(
                sys::spi_host_device_t_SPI3_HOST as sys::esp_lcd_spi_bus_handle_t,
                &io_config,
                &mut io_handle,
            )
        })?;

        let panel_config = sys::esp_lcd_panel_dev_config_t {
            reset_gpio_num: -1,
            __bindgen_anon_1: sys::esp_lcd_panel_dev_config_t__bindgen_ty_1 {
                rgb_ele_order: sys::lcd_rgb_element_order_t_LCD_RGB_ELEMENT_ORDER_RGB,
            },
            data_endian: sys::lcd_rgb_data_endian_t_LCD_RGB_DATA_ENDIAN_BIG,
            bits_per_pixel: 16,
            ..Default::default()
        };

        let mut panel: sys::esp_lcd_panel_handle_t = core::ptr::null_mut();
        esp!(unsafe { sys::esp_lcd_new_panel_st7789(io_handle, &panel_config, &mut panel) })?;

        // Match xiaozhi's working Lichuang sequence. The board's LCD reset is
        // shared with the global RESET net; PCA9557 IO0 is actually LCD_CS.
        esp!(unsafe { sys::esp_lcd_panel_reset(panel) })?;
        select_lcd()?;
        esp!(unsafe { sys::esp_lcd_panel_init(panel) })?;
        esp!(unsafe { sys::esp_lcd_panel_invert_color(panel, true) })?;
        esp!(unsafe { sys::esp_lcd_panel_swap_xy(panel, true) })?;
        esp!(unsafe { sys::esp_lcd_panel_mirror(panel, true, false) })?;
        esp!(unsafe { sys::esp_lcd_panel_disp_on_off(panel, true) })?;

        let mut framebuffer = Vec::new();
        framebuffer
            .try_reserve_exact(FRAME_PIXELS)
            .map_err(|error| {
                io::Error::other(format!("LCD framebuffer allocation failed: {error}"))
            })?;
        framebuffer.resize(FRAME_PIXELS, Rgb565::BLACK);

        let dma_buffer = NonNull::new(unsafe {
            sys::spi_bus_dma_memory_alloc(sys::spi_host_device_t_SPI3_HOST, FRAME_BYTES, 0)
                .cast::<u8>()
        })
        .ok_or_else(|| io::Error::other("LCD DMA framebuffer allocation failed"))?;

        Ok(Self {
            panel,
            io: io_handle,
            framebuffer,
            dma_buffer,
            transfer_in_flight: false,
            _spi: spi,
            _sclk: sclk,
            _mosi: mosi,
            _dc: dc,
        })
    }

    /// Flushes the full 320x240 framebuffer as RGB565 big-endian pixel data.
    pub(super) fn flush(&mut self) -> Result<(), Box<dyn Error>> {
        self.wait_for_transfer();
        let bytes =
            unsafe { core::slice::from_raw_parts_mut(self.dma_buffer.as_ptr(), FRAME_BYTES) };
        for (color, output) in self.framebuffer.iter().zip(bytes.chunks_exact_mut(2)) {
            let raw = color.into_storage();
            output[0] = (raw >> 8) as u8;
            output[1] = raw as u8;
        }

        COLOR_TRANSFER_DONE.store(false, Ordering::Release);
        let result = esp!(unsafe {
            sys::esp_lcd_panel_draw_bitmap(
                self.panel,
                0,
                0,
                i32::from(display::WIDTH),
                i32::from(display::HEIGHT),
                self.dma_buffer.as_ptr().cast::<c_void>(),
            )
        });
        match result {
            Ok(()) => {
                self.transfer_in_flight = true;
                Ok(())
            }
            Err(error) => {
                COLOR_TRANSFER_DONE.store(true, Ordering::Release);
                Err(error.into())
            }
        }
    }

    fn wait_for_transfer(&mut self) {
        if !self.transfer_in_flight {
            return;
        }
        while !COLOR_TRANSFER_DONE.load(Ordering::Acquire) {
            FreeRtos::delay_ms(1);
        }
        self.transfer_in_flight = false;
    }
}

impl OriginDimensions for LcdDisplay {
    fn size(&self) -> Size {
        Size::new(u32::from(display::WIDTH), u32::from(display::HEIGHT))
    }
}

impl DrawTarget for LcdDisplay {
    type Color = Rgb565;
    type Error = Infallible;

    fn draw_iter<I>(&mut self, pixels: I) -> Result<(), Self::Error>
    where
        I: IntoIterator<Item = Pixel<Self::Color>>,
    {
        for Pixel(point, color) in pixels {
            if point.x >= 0
                && point.y >= 0
                && point.x < i32::from(display::WIDTH)
                && point.y < i32::from(display::HEIGHT)
            {
                let index = point.y as usize * display::WIDTH as usize + point.x as usize;
                self.framebuffer[index] = color;
            }
        }
        Ok(())
    }

    fn clear(&mut self, color: Self::Color) -> Result<(), Self::Error> {
        self.framebuffer.fill(color);
        Ok(())
    }
}

impl Drop for LcdDisplay {
    fn drop(&mut self) {
        self.wait_for_transfer();
        unsafe {
            let _ = sys::esp_lcd_panel_del(self.panel);
            let _ = sys::esp_lcd_panel_io_del(self.io);
            sys::heap_caps_free(self.dma_buffer.as_ptr().cast::<c_void>());
            let _ = sys::spi_bus_free(sys::spi_host_device_t_SPI3_HOST);
        }
    }
}

unsafe extern "C" fn color_transfer_done(
    _panel_io: sys::esp_lcd_panel_io_handle_t,
    _event: *mut sys::esp_lcd_panel_io_event_data_t,
    _context: *mut c_void,
) -> bool {
    COLOR_TRANSFER_DONE.store(true, Ordering::Release);
    false
}
