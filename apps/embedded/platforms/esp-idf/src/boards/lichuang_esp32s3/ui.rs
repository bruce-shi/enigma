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
use enigma_embedded_core::{Action, Location, Outcome, PinGate, PinKey, PinResult, promote};
use esp_idf_svc::{
    hal::{
        delay::{BLOCK, FreeRtos},
        gpio::{Level, PinDriver},
        i2c::{I2cConfig, I2cDriver},
        sleep::LightSleep,
        units::FromValueType,
    },
    sys,
};

use super::{Hardware, display, lcd::LcdDisplay, shared_i2c};
use crate::{
    location_portal::{LocationPortal, PortalRequest},
    location_store::MAX_SAVED_LOCATIONS,
    wifi_access::WifiAccessPoint,
};

const ROW_COUNT: usize = 4;
const ROW_TOP: i32 = 31;
const ROW_HEIGHT: i32 = 35;
const LIST_WIDTH: u32 = 257;
const ACTION_TOP: i32 = 190;
const UI_POLL_MS: u32 = 25;
const UI_HEARTBEAT_TICKS: u32 = 400;
const LCD_SELF_TEST_MS: u32 = 500;
const POWER_BUTTON_HOLD_TICKS: u32 = 80;
const POWER_BUTTON_RELEASE_DEBOUNCE_MS: u32 = 100;
const POWER_OFF_MESSAGE_MS: u32 = 500;
const OPERATOR_PIN: [u8; 4] = [1, 2, 3, 4];
const PIN_KEYPAD_LEFT: i32 = 5;
const PIN_KEYPAD_TOP: i32 = 70;
const PIN_KEY_WIDTH: u32 = 100;
const PIN_KEY_HEIGHT: u32 = 37;
const PIN_KEY_GAP: i32 = 3;

pub fn run<F>(
    hardware: Hardware,
    mut catalog: Vec<Location>,
    mut saved_locations: Vec<Location>,
    mut handle: F,
) -> Result<(), Box<dyn Error>>
where
    F: FnMut(Action) -> Outcome,
{
    if catalog.is_empty() {
        return Err("location catalog is empty".into());
    }

    let Hardware {
        uart: _uart,
        modem,
        spi,
        i2c,
        sclk,
        mosi,
        dc,
        backlight,
        sda,
        scl,
        boot_button,
    } = hardware;
    let access_point = WifiAccessPoint::start(modem)
        .map_err(|error| io::Error::other(format!("Wi-Fi access point failed: {error}")))?;
    let (location_portal, portal_requests) = LocationPortal::start(access_point.address())
        .map_err(|error| io::Error::other(format!("location portal failed: {error}")))?;
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
    let wifi_label = access_point.display_label();
    let mut status = wifi_label.clone();
    let mut status_ok = true;
    let mut location_active = false;
    let mut pin_gate = PinGate::new(OPERATOR_PIN);
    let mut locked = true;
    let mut lock_message = "Enter operator PIN";

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
    render_lock(
        &mut display,
        &wifi_label,
        lock_message,
        true,
        pin_gate.entered_len(),
    )?;
    log::info!("display: first frame drawn; touch UI locked and ready");

    let mut touch_was_down = false;
    let mut idle_ticks = 0u32;
    let mut touch_error_count = 0u32;
    let mut power_button_ticks = 0u32;
    loop {
        if let Ok(request) = portal_requests.try_recv() {
            let action_request = match request {
                PortalRequest::List { reply } => {
                    let _ = reply.send(saved_locations.clone());
                    None
                }
                PortalRequest::Save { location, reply } => Some((false, location, reply)),
                PortalRequest::Set { location, reply } => Some((true, location, reply)),
            };
            if let Some((set_location, location, reply)) = action_request {
                let action_label = if set_location { "setting" } else { "saving" };
                log::info!("web portal: {action_label} location `{}`", location.name);
                let outcome = handle(if set_location {
                    Action::Set(location.clone())
                } else {
                    Action::Save(location.clone())
                });
                if outcome.success {
                    promote(&mut catalog, &location);
                    promote(&mut saved_locations, &location);
                    saved_locations.truncate(MAX_SAVED_LOCATIONS);
                    selected = 0;
                    scroll = 0;
                    if set_location {
                        location_active = true;
                    }
                } else {
                    log::error!("web portal location action failed: {}", outcome.message);
                }
                if !locked {
                    status = outcome.message.clone();
                    status_ok = outcome.success;
                    render(&mut display, &catalog, selected, scroll, &status, status_ok)?;
                }
                let _ = reply.send(outcome);
            }
        }

        if boot_button.is_low() {
            power_button_ticks = power_button_ticks.saturating_add(1);
            if power_button_ticks >= POWER_BUTTON_HOLD_TICKS {
                if locked {
                    render_lock(
                        &mut display,
                        &wifi_label,
                        "Release BOOT to power off",
                        true,
                        pin_gate.entered_len(),
                    )?;
                } else {
                    status = String::from("Release BOOT to power off");
                    status_ok = true;
                    render(&mut display, &catalog, selected, scroll, &status, status_ok)?;
                }
                loop {
                    while boot_button.is_low() {
                        FreeRtos::delay_ms(UI_POLL_MS);
                    }
                    FreeRtos::delay_ms(POWER_BUTTON_RELEASE_DEBOUNCE_MS);
                    if !boot_button.is_low() {
                        break;
                    }
                }

                if location_active {
                    if locked {
                        render_lock(
                            &mut display,
                            &wifi_label,
                            "Restoring GPS before power off...",
                            true,
                            pin_gate.entered_len(),
                        )?;
                    } else {
                        status = String::from("Restoring real GPS before power off...");
                        render(&mut display, &catalog, selected, scroll, &status, true)?;
                    }
                    let outcome = handle(Action::Restore);
                    if outcome.success {
                        location_active = false;
                    } else {
                        log::warn!("could not restore iPhone location before power off");
                    }
                }

                let power_off_message = if location_active {
                    "Powering off; restore GPS after wake"
                } else {
                    "Powering off. Press BOOT to wake"
                };
                status_ok = !location_active;
                if locked {
                    render_lock(
                        &mut display,
                        &wifi_label,
                        power_off_message,
                        status_ok,
                        pin_gate.entered_len(),
                    )?;
                } else {
                    status = String::from(power_off_message);
                    render(&mut display, &catalog, selected, scroll, &status, status_ok)?;
                }
                FreeRtos::delay_ms(POWER_OFF_MESSAGE_MS);

                display.power_off()?;
                backlight.set_high().map_err(|error| {
                    io::Error::other(format!("backlight power-off failed: {error}"))
                })?;
                drop(location_portal);
                drop(access_point);
                let mut sleep = LightSleep::new()?.wakeup_on_gpio(&boot_button, Level::Low)?;
                log::info!("power off: entering low-power sleep; press BOOT to wake");
                sleep.enter()?;

                // GPIO0 is also the ESP32-S3 boot strap. Wait until it is high
                // before restarting so a wake press cannot enter the ROM
                // downloader instead of the Enigma firmware.
                loop {
                    while boot_button.is_low() {
                        FreeRtos::delay_ms(UI_POLL_MS);
                    }
                    FreeRtos::delay_ms(POWER_BUTTON_RELEASE_DEBOUNCE_MS);
                    if !boot_button.is_low() {
                        break;
                    }
                }
                log::info!("power button wake: restarting Enigma firmware");
                unsafe { sys::esp_restart() };
            }
        } else {
            power_button_ticks = 0;
        }

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
        if locked {
            if let Some(key) = pin_key_at(x, y) {
                match pin_gate.apply(key) {
                    PinResult::Pending => {
                        lock_message = "Enter operator PIN";
                    }
                    PinResult::Accepted => {
                        locked = false;
                        status = wifi_label.clone();
                        status_ok = true;
                        log::info!("operator PIN accepted; location controls unlocked");
                    }
                    PinResult::Rejected => {
                        lock_message = "Wrong PIN; try again";
                        log::warn!("operator PIN rejected");
                    }
                }
            }
            if locked {
                render_lock(
                    &mut display,
                    &wifi_label,
                    lock_message,
                    lock_message == "Enter operator PIN",
                    pin_gate.entered_len(),
                )?;
            } else {
                render(&mut display, &catalog, selected, scroll, &status, status_ok)?;
            }
            FreeRtos::delay_ms(UI_POLL_MS);
            continue;
        }

        let mut redraw = false;
        if i32::from(y) < ROW_TOP && x >= 260 {
            pin_gate.clear();
            locked = true;
            lock_message = "Enter operator PIN";
            log::info!("location controls locked");
            render_lock(
                &mut display,
                &wifi_label,
                lock_message,
                true,
                pin_gate.entered_len(),
            )?;
            FreeRtos::delay_ms(UI_POLL_MS);
            continue;
        } else if i32::from(y) >= ACTION_TOP {
            let action = if x < 198 {
                log::info!("touch action: set location `{}`", catalog[selected].name);
                status = String::from("Finding iPhone on Enigma Wi-Fi...");
                status_ok = true;
                render(&mut display, &catalog, selected, scroll, &status, status_ok)?;
                Action::Set(catalog[selected].clone())
            } else {
                log::info!("touch action: restore real location");
                status = String::from("Finding iPhone to restore GPS...");
                status_ok = true;
                render(&mut display, &catalog, selected, scroll, &status, status_ok)?;
                Action::Restore
            };
            let applied = matches!(action, Action::Set(_));
            let selected_location = match &action {
                Action::Set(location) => Some(location.clone()),
                Action::Save(_) => unreachable!("touch UI only creates set or restore actions"),
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
                promote(
                    &mut saved_locations,
                    selected_location
                        .as_ref()
                        .expect("set action has a location"),
                );
                saved_locations.truncate(MAX_SAVED_LOCATIONS);
                selected = 0;
                scroll = 0;
            }
            if outcome.success {
                location_active = applied;
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

fn pin_key_at(x: u16, y: u16) -> Option<PinKey> {
    let relative_x = i32::from(x) - PIN_KEYPAD_LEFT;
    let relative_y = i32::from(y) - PIN_KEYPAD_TOP;
    if relative_x < 0 || relative_y < 0 {
        return None;
    }

    let column_stride = PIN_KEY_WIDTH as i32 + PIN_KEY_GAP;
    let row_stride = PIN_KEY_HEIGHT as i32 + PIN_KEY_GAP;
    let column = relative_x / column_stride;
    let row = relative_y / row_stride;
    if column >= 3
        || row >= 4
        || relative_x % column_stride >= PIN_KEY_WIDTH as i32
        || relative_y % row_stride >= PIN_KEY_HEIGHT as i32
    {
        return None;
    }

    match (row, column) {
        (0, 0) => Some(PinKey::Digit(1)),
        (0, 1) => Some(PinKey::Digit(2)),
        (0, 2) => Some(PinKey::Digit(3)),
        (1, 0) => Some(PinKey::Digit(4)),
        (1, 1) => Some(PinKey::Digit(5)),
        (1, 2) => Some(PinKey::Digit(6)),
        (2, 0) => Some(PinKey::Digit(7)),
        (2, 1) => Some(PinKey::Digit(8)),
        (2, 2) => Some(PinKey::Digit(9)),
        (3, 0) => Some(PinKey::Clear),
        (3, 1) => Some(PinKey::Digit(0)),
        (3, 2) => Some(PinKey::Submit),
        _ => None,
    }
}

fn render_lock(
    display: &mut LcdDisplay,
    wifi_label: &str,
    message: &str,
    message_ok: bool,
    entered_len: usize,
) -> Result<(), Box<dyn Error>> {
    display
        .clear(Rgb565::new(2, 5, 8))
        .map_err(|_| io::Error::other("display clear failed"))?;

    let title_style = MonoTextStyle::new(&FONT_8X13_BOLD, Rgb565::WHITE);
    let text_style = MonoTextStyle::new(&FONT_6X10, Rgb565::new(18, 38, 22));
    let message_style = MonoTextStyle::new(
        &FONT_6X10,
        if message_ok {
            Rgb565::CYAN
        } else {
            Rgb565::RED
        },
    );

    Text::new("Enigma Locked", Point::new(5, 13), title_style)
        .draw(display)
        .map_err(|_| io::Error::other("display lock title failed"))?;
    Text::new(&truncate(wifi_label, 40), Point::new(5, 28), text_style)
        .draw(display)
        .map_err(|_| io::Error::other("display lock Wi-Fi label failed"))?;
    Text::new(&truncate(message, 40), Point::new(5, 43), message_style)
        .draw(display)
        .map_err(|_| io::Error::other("display lock message failed"))?;

    let mut masked_pin = String::new();
    for index in 0..OPERATOR_PIN.len() {
        if index > 0 {
            masked_pin.push(' ');
        }
        masked_pin.push(if index < entered_len { '*' } else { '_' });
    }
    Text::new(&masked_pin, Point::new(124, 65), title_style)
        .draw(display)
        .map_err(|_| io::Error::other("display masked PIN failed"))?;

    for row in 0..4 {
        for column in 0..3 {
            let label = match (row, column) {
                (0, 0) => "1",
                (0, 1) => "2",
                (0, 2) => "3",
                (1, 0) => "4",
                (1, 1) => "5",
                (1, 2) => "6",
                (2, 0) => "7",
                (2, 1) => "8",
                (2, 2) => "9",
                (3, 0) => "CLEAR",
                (3, 1) => "0",
                (3, 2) => "ENTER",
                _ => unreachable!(),
            };
            button(
                display,
                Rectangle::new(
                    Point::new(
                        PIN_KEYPAD_LEFT + column * (PIN_KEY_WIDTH as i32 + PIN_KEY_GAP),
                        PIN_KEYPAD_TOP + row * (PIN_KEY_HEIGHT as i32 + PIN_KEY_GAP),
                    ),
                    Size::new(PIN_KEY_WIDTH, PIN_KEY_HEIGHT),
                ),
                label,
                row == 3 && column == 2,
            )?;
        }
    }
    display.flush()?;
    Ok(())
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
    Text::new("Hold BOOT", Point::new(199, 12), dim_style)
        .draw(display)
        .map_err(|_| io::Error::other("display power hint failed"))?;
    button(
        display,
        Rectangle::new(Point::new(260, 2), Size::new(58, 25)),
        "LOCK",
        false,
    )?;
    Text::new(&truncate(status, 40), Point::new(5, 27), status_style)
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
