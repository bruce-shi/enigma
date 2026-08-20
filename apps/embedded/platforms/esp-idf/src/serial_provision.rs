//! One-time pairing-record import over the board's CH340K console UART.

use std::time::{Duration, Instant};

use enigma_embedded_bridge_protocol::{HEADER_PREFIX, READY_LINE, parse_header, verify_payload};
use esp_idf_svc::{
    hal::{delay::TickType, uart::UartDriver},
    sys,
};

const HEADER_LIMIT: usize = 160;
const READ_SLICE: Duration = Duration::from_millis(250);
const PAYLOAD_TIMEOUT: Duration = Duration::from_secs(15);

pub fn receive_pairing_record(
    uart: &UartDriver<'_>,
    header_timeout: Duration,
) -> Result<Option<Vec<u8>>, String> {
    log::info!("{READY_LINE}");
    let Some(header) = read_header(uart, header_timeout)? else {
        log::warn!("pairing provisioning window expired; continuing without a pairing record");
        return Ok(None);
    };
    let payload = read_exact_with_timeout(uart, header.payload_len, PAYLOAD_TIMEOUT)?;
    verify_payload(&header, &payload).map_err(|error| error.to_string())?;
    Ok(Some(payload))
}

fn read_header(
    uart: &UartDriver<'_>,
    timeout: Duration,
) -> Result<Option<enigma_embedded_bridge_protocol::Header>, String> {
    let deadline = Instant::now() + timeout;
    let mut line = Vec::with_capacity(HEADER_LIMIT);
    let mut chunk = [0u8; 128];
    while Instant::now() < deadline {
        match uart.read(
            &mut chunk,
            TickType::new_millis(READ_SLICE.as_millis() as u64).ticks(),
        ) {
            Ok(count) => {
                for byte in &chunk[..count] {
                    if *byte == b'\n' {
                        if let Ok(text) = core::str::from_utf8(&line)
                            && let Some(offset) = text.find(HEADER_PREFIX)
                        {
                            return parse_header(&text[offset..])
                                .map(Some)
                                .map_err(|error| error.to_string());
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
    timeout: Duration,
) -> Result<Vec<u8>, String> {
    let deadline = Instant::now() + timeout;
    let mut payload = vec![0; length];
    let mut offset = 0;
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
