//! Always-available pairing-record import over the board's CH340K console UART.

use std::{
    thread,
    time::{Duration, Instant},
};

use enigma_embedded_bridge_protocol::{
    ERROR_PREFIX, HEADER_PREFIX, READY_LINE, parse_header, success_line, verify_payload,
};
use esp_idf_svc::{
    hal::{delay::TickType, uart::UartDriver},
    sys,
};

use crate::iphone;

const HEADER_LIMIT: usize = 160;
const READ_SLICE: Duration = Duration::from_millis(250);
const PAYLOAD_TIMEOUT: Duration = Duration::from_secs(15);
const HEADER_POLL_WINDOW: Duration = Duration::from_secs(60);
const LISTENER_STACK_BYTES: usize = 12 * 1024;

pub fn start(uart: UartDriver<'static>, storage: iphone::PairingStorage) -> Result<(), String> {
    thread::Builder::new()
        .name("enigma-provision".into())
        .stack_size(LISTENER_STACK_BYTES)
        .spawn(move || run_listener(uart, storage))
        .map(|_| ())
        .map_err(|error| format!("could not start pairing listener: {error}"))
}

fn run_listener(uart: UartDriver<'static>, storage: iphone::PairingStorage) {
    log::info!("{READY_LINE}");
    log::info!("persistent desktop pairing listener ready");
    loop {
        match receive_pairing_record(&uart) {
            Ok(Some(payload)) => match iphone::import_pairing_record(&storage, &payload) {
                Ok(()) => log::info!("{}", success_line(&payload)),
                Err(error) => log::error!("{ERROR_PREFIX} invalid pairing record: {error}"),
            },
            Ok(None) => {}
            Err(error) => log::error!("{ERROR_PREFIX} {error}"),
        }
    }
}

fn receive_pairing_record(uart: &UartDriver<'_>) -> Result<Option<Vec<u8>>, String> {
    let Some((header, payload_prefix)) = read_header(uart, HEADER_POLL_WINDOW)? else {
        return Ok(None);
    };
    if payload_prefix.len() > header.payload_len {
        return Err("pairing payload started with more bytes than declared".into());
    }
    let payload =
        read_exact_with_timeout(uart, header.payload_len, &payload_prefix, PAYLOAD_TIMEOUT)?;
    verify_payload(&header, &payload).map_err(|error| error.to_string())?;
    Ok(Some(payload))
}

fn read_header(
    uart: &UartDriver<'_>,
    timeout: Duration,
) -> Result<Option<(enigma_embedded_bridge_protocol::Header, Vec<u8>)>, String> {
    let deadline = Instant::now() + timeout;
    let mut line = Vec::with_capacity(HEADER_LIMIT);
    let mut chunk = [0u8; 128];
    while Instant::now() < deadline {
        match uart.read(
            &mut chunk,
            TickType::new_millis(READ_SLICE.as_millis() as u64).ticks(),
        ) {
            Ok(count) => {
                for (index, byte) in chunk[..count].iter().enumerate() {
                    if *byte == b'\n' {
                        if let Ok(text) = core::str::from_utf8(&line)
                            && let Some(offset) = text.find(HEADER_PREFIX)
                        {
                            let header =
                                parse_header(&text[offset..]).map_err(|error| error.to_string())?;
                            // A serial read can contain the end of the header
                            // and the start of the binary payload. Preserve
                            // those bytes instead of dropping them when the
                            // newline is found.
                            return Ok(Some((header, chunk[index + 1..count].to_vec())));
                        }
                        line.clear();
                    } else if line.len() < HEADER_LIMIT {
                        line.push(*byte);
                    } else {
                        line.clear();
                    }
                }
            }
            Err(error) if error.code() == sys::ESP_ERR_TIMEOUT => {}
            Err(error) => return Err(format!("UART provisioning read failed: {error}")),
        }
    }
    Ok(None)
}

fn read_exact_with_timeout(
    uart: &UartDriver<'_>,
    length: usize,
    prefix: &[u8],
    timeout: Duration,
) -> Result<Vec<u8>, String> {
    let deadline = Instant::now() + timeout;
    let mut payload = vec![0; length];
    payload[..prefix.len()].copy_from_slice(prefix);
    let mut offset = prefix.len();
    while offset < length && Instant::now() < deadline {
        match uart.read(
            &mut payload[offset..],
            TickType::new_millis(READ_SLICE.as_millis() as u64).ticks(),
        ) {
            Ok(count) => offset += count,
            Err(error) if error.code() == sys::ESP_ERR_TIMEOUT => {}
            Err(error) => return Err(format!("UART pairing payload read failed: {error}")),
        }
    }
    if offset == length {
        Ok(payload)
    } else {
        Err(format!(
            "pairing payload timed out after {offset}/{length} bytes"
        ))
    }
}
