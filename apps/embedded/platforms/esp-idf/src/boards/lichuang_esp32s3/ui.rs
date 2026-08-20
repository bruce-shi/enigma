//! On-board ST7789/FT5x06 touch UI for location selection and restore.

use std::{error::Error, io};

use embedded_graphics::{
    Drawable,
    mono_font::{
        MonoTextStyle,
        ascii::{FONT_6X10, FONT_8X13_BOLD},
    },
    pixelcolor::Rgb565,
    prelude::{DrawTarget, Point, Primitive, RgbColor, Size},
    primitives::{PrimitiveStyleBuilder, Rectangle},
    text::Text,
};
use enigma_embedded_core::{Action, Location, Outcome, promote};
use esp_idf_svc::hal::{
    delay::{BLOCK, FreeRtos},
    gpio::PinDriver,
    i2c::{I2cConfig, I2cDriver},
    units::FromValueType,
};

use super::{Hardware, display, lcd::LcdDisplay, shared_i2c};

const ROW_COUNT: usize = 4;
const ROW_TOP: i32 = 31;
const ROW_HEIGHT: i32 = 35;
const LIST_WIDTH: u32 = 257;
const ACTION_TOP: i32 = 190;
const UI_POLL_MS: u32 = 25;
const UI_HEARTBEAT_TICKS: u32 = 400;
const LCD_SELF_TEST_MS: u32 = 500;

pub fn run<F>(
    hardware: Hardware,
    mut catalog: Vec<Location>,
    mut handle: F,
) -> Result<(), Box<dyn Error>>
where
    F: FnMut(Action) -> Outcome,
{
    if catalog.is_empty() {
        return Err("location catalog is empty".into());
    }

    let Hardware {
        spi,
        i2c,
        sclk,
        mosi,
        dc,
        backlight,
        sda,
        scl,
    } = hardware;
    log::info!("display: initializing I2C1 at 400 kHz");
    let mut i2c = I2cDriver::new(i2c, sda, scl, &I2cConfig::new().baudrate(400.kHz().into()))
        .map_err(|error| io::Error::other(format!("display I2C init failed: {error}")))?;
    initialize_pca9557(&mut i2c)
        .map_err(|error| io::Error::other(format!("PCA9557 init failed: {error}")))?;
    log::info!("display: PCA9557 configured; LCD chip-select remains deasserted");

    let mut backlight = PinDriver::output(backlight)
        .map_err(|error| io::Error::other(format!("backlight GPIO init failed: {error}")))?;
    // GPIO42 is active-low on this board. Keep it dark until a complete first
    // frame has been drawn, so a lit blank panel cannot look like a ready UI.
    backlight
        .set_high()
        .map_err(|error| io::Error::other(format!("backlight disable failed: {error}")))?;
    log::info!("display: initializing native ESP-IDF ST7789 on SPI3 mode 2 at 80 MHz");
    let mut display = LcdDisplay::new(spi, sclk, mosi, dc, || {
        select_lcd(&mut i2c)
            .map_err(|error| io::Error::other(format!("LCD chip-select failed: {error}")).into())
    })?;
    log::info!("display: LCD chip-select asserted; native ST7789 initialized");

    let mut selected = 0usize;
    let mut scroll = 0usize;
    let mut status = String::from("Select a location");
    let mut status_ok = true;

    backlight
        .set_low()
        .map_err(|error| io::Error::other(format!("backlight enable failed: {error}")))?;
    log::info!("display: active-low GPIO42 backlight enabled");
    for (name, color) in [
        ("white", Rgb565::WHITE),
        ("red", Rgb565::RED),
        ("green", Rgb565::GREEN),
        ("blue", Rgb565::BLUE),
    ] {
        display
            .clear(color)
            .map_err(|_| io::Error::other("display self-test clear failed"))?;
        display.flush()?;
        log::info!("display: showing {name} LCD self-test for {LCD_SELF_TEST_MS} ms");
        FreeRtos::delay_ms(LCD_SELF_TEST_MS);
    }
    render(&mut display, &catalog, selected, scroll, &status, status_ok)?;
    log::info!("display: first frame drawn; touch UI ready");

    let mut touch_was_down = false;
    let mut idle_ticks = 0u32;
    let mut touch_error_count = 0u32;
    loop {
        let touch = match read_touch(&mut i2c) {
            Ok(touch) => {
                if touch_error_count > 0 {
                    log::info!(
                        "touch: FT5x06 communication recovered after {} failed polls",
                        touch_error_count
                    );
                    touch_error_count = 0;
                }
                touch
            }
            Err(error) => {
                touch_error_count = touch_error_count.saturating_add(1);
                if touch_error_count == 1 || touch_error_count.is_multiple_of(UI_HEARTBEAT_TICKS) {
                    log::warn!(
                        "touch: FT5x06 read failed (attempt {}): {}",
                        touch_error_count,
                        error
                    );
                }
                FreeRtos::delay_ms(UI_POLL_MS);
                continue;
            }
        };
        if touch.is_none() {
            touch_was_down = false;
            idle_ticks += 1;
            if idle_ticks >= UI_HEARTBEAT_TICKS {
                log::info!("touch UI alive; waiting for input");
                idle_ticks = 0;
            }
            FreeRtos::delay_ms(UI_POLL_MS);
            continue;
        }
        if touch_was_down {
            FreeRtos::delay_ms(UI_POLL_MS);
            continue;
        }
        touch_was_down = true;
        idle_ticks = 0;

        let (x, y) = touch.expect("checked above");
        log::info!("touch: press at ({x}, {y})");
        let mut redraw = false;
        if i32::from(y) >= ACTION_TOP {
            let action = if x < 198 {
                log::info!("touch action: set location `{}`", catalog[selected].name);
                status = String::from("Connect, unlock, and Trust...");
                status_ok = true;
                render(&mut display, &catalog, selected, scroll, &status, status_ok)?;
                Action::Set(catalog[selected].clone())
            } else {
                log::info!("touch action: restore real location");
                status = String::from("Connecting to restore GPS...");
                status_ok = true;
                render(&mut display, &catalog, selected, scroll, &status, status_ok)?;
                Action::Restore
            };
            let applied = matches!(action, Action::Set(_));
            let selected_location = match &action {
                Action::Set(location) => Some(location.clone()),
                Action::Restore => None,
            };
            let outcome = handle(action);
            if outcome.success && applied {
                promote(
                    &mut catalog,
                    selected_location
                        .as_ref()
                        .expect("set action has a location"),
                );
                selected = 0;
                scroll = 0;
            }
            status = outcome.message;
            status_ok = outcome.success;
            redraw = true;
        } else if x >= 260 {
            if (31..105).contains(&y) {
                if selected > 0 {
                    selected -= 1;
                    if selected < scroll {
                        scroll = selected;
                    }
                    redraw = true;
                }
            } else if (109..171).contains(&y) && selected + 1 < catalog.len() {
                selected += 1;
                if selected >= scroll + ROW_COUNT {
                    scroll = selected + 1 - ROW_COUNT;
                }
                redraw = true;
            }
        } else if i32::from(y) >= ROW_TOP {
            let row = ((y as i32 - ROW_TOP) / ROW_HEIGHT) as usize;
            let index = scroll + row;
            if row < ROW_COUNT && index < catalog.len() {
                selected = index;
                redraw = true;
            }
        }

        if redraw {
            render(&mut display, &catalog, selected, scroll, &status, status_ok)?;
        }
        FreeRtos::delay_ms(UI_POLL_MS);
    }
}

fn initialize_pca9557(i2c: &mut I2cDriver<'_>) -> Result<(), Box<dyn Error>> {
    let address = shared_i2c::PCA9557_ADDRESS;
    // PCA9557 IO0 is LCD_CS. Keep it high while the SPI panel IO is created.
    i2c.write(address, &[0x01, 0x03], BLOCK)?;
    i2c.write(address, &[0x03, 0xf8], BLOCK)?;
    Ok(())
}

fn select_lcd(i2c: &mut I2cDriver<'_>) -> Result<(), Box<dyn Error>> {
    let address = shared_i2c::PCA9557_ADDRESS;
    // Assert the active-low LCD_CS while preserving the amplifier output bit.
    i2c.write(address, &[0x01, 0x02], BLOCK)?;
    Ok(())
}

fn read_touch(i2c: &mut I2cDriver<'_>) -> Result<Option<(u16, u16)>, Box<dyn Error>> {
    let mut data = [0u8; 5];
    i2c.write_read(shared_i2c::FT5X06_ADDRESS, &[0x02], &mut data, BLOCK)?;
    if data[0] & 0x0f == 0 {
        return Ok(None);
    }

    let raw_x = (((data[1] & 0x0f) as u16) << 8) | data[2] as u16;
    let raw_y = (((data[3] & 0x0f) as u16) << 8) | data[4] as u16;
    // The board reference mirrors the FT5x06 X axis and then swaps XY to
    // match the ST7789 landscape orientation.
    let x = raw_y.min(display::WIDTH - 1);
    let y = (240u16.saturating_sub(raw_x)).min(display::HEIGHT - 1);
    Ok(Some((x, y)))
}

fn render(
    display: &mut LcdDisplay,
    catalog: &[Location],
    selected: usize,
    scroll: usize,
    status: &str,
    status_ok: bool,
) -> Result<(), Box<dyn Error>> {
    display
        .clear(Rgb565::new(2, 5, 8))
        .map_err(|_| io::Error::other("display clear failed"))?;

    let title_style = MonoTextStyle::new(&FONT_8X13_BOLD, Rgb565::WHITE);
    let text_style = MonoTextStyle::new(&FONT_6X10, Rgb565::WHITE);
    let dim_style = MonoTextStyle::new(&FONT_6X10, Rgb565::new(18, 38, 22));
    let status_color = if status_ok { Rgb565::CYAN } else { Rgb565::RED };
    let status_style = MonoTextStyle::new(&FONT_6X10, status_color);

    Text::new("iPhone Location", Point::new(5, 12), title_style)
        .draw(display)
        .map_err(|_| io::Error::other("display title failed"))?;
    Text::new(&truncate(status, 23), Point::new(5, 27), status_style)
        .draw(display)
        .map_err(|_| io::Error::other("display status failed"))?;

    for row in 0..ROW_COUNT {
        let index = scroll + row;
        let top = ROW_TOP + row as i32 * ROW_HEIGHT;
        let bounds = Rectangle::new(Point::new(2, top), Size::new(LIST_WIDTH - 4, 33));
        let is_selected = index == selected;
        let style = PrimitiveStyleBuilder::new()
            .fill_color(if is_selected {
                Rgb565::new(2, 27, 26)
            } else {
                Rgb565::new(4, 9, 12)
            })
            .stroke_color(if is_selected {
                Rgb565::CYAN
            } else {
                Rgb565::new(8, 16, 17)
            })
            .stroke_width(1)
            .build();
        bounds
            .into_styled(style)
            .draw(display)
            .map_err(|_| io::Error::other("display row failed"))?;
        if let Some(location) = catalog.get(index) {
            Text::new(
                &truncate(&location.name, 27),
                Point::new(7, top + 11),
                text_style,
            )
            .draw(display)
            .map_err(|_| io::Error::other("display location failed"))?;
            let coordinates = format!("{}, {}", location.latitude, location.longitude);
            Text::new(
                &truncate(&coordinates, 39),
                Point::new(7, top + 26),
                dim_style,
            )
            .draw(display)
            .map_err(|_| io::Error::other("display coordinates failed"))?;
        }
    }

    button(
        display,
        Rectangle::new(Point::new(260, 31), Size::new(58, 74)),
        "UP",
        false,
    )?;
    button(
        display,
        Rectangle::new(Point::new(260, 109), Size::new(58, 62)),
        "DN",
        false,
    )?;
    button(
        display,
        Rectangle::new(Point::new(2, ACTION_TOP), Size::new(193, 48)),
        "SET LOCATION",
        true,
    )?;
    button(
        display,
        Rectangle::new(Point::new(199, ACTION_TOP), Size::new(119, 48)),
        "RESTORE",
        false,
    )?;
    display.flush()?;
    Ok(())
}

fn button<D>(
    display: &mut D,
    bounds: Rectangle,
    label: &str,
    primary: bool,
) -> Result<(), Box<dyn Error>>
where
    D: DrawTarget<Color = Rgb565>,
{
    let fill = if primary {
        Rgb565::new(0, 30, 23)
    } else {
        Rgb565::new(8, 13, 16)
    };
    bounds
        .into_styled(
            PrimitiveStyleBuilder::new()
                .fill_color(fill)
                .stroke_color(Rgb565::CYAN)
                .stroke_width(1)
                .build(),
        )
        .draw(display)
        .map_err(|_| io::Error::other("display button failed"))?;
    let width = label.len() as i32 * 8;
    let position = Point::new(
        bounds.top_left.x + (bounds.size.width as i32 - width) / 2,
        bounds.top_left.y + (bounds.size.height as i32 + 13) / 2 - 2,
    );
    Text::new(
        label,
        position,
        MonoTextStyle::new(&FONT_8X13_BOLD, Rgb565::WHITE),
    )
    .draw(display)
    .map_err(|_| io::Error::other("display button label failed"))?;
    Ok(())
}

fn truncate(value: &str, characters: usize) -> String {
    value.chars().take(characters).collect()
}
