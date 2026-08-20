use std::{
    env,
    io::{ErrorKind, Write},
    thread,
    time::{Duration, Instant},
};

use enigma_embedded_bridge_protocol::{
    ERROR_PREFIX, OK_PREFIX, READY_LINE, encode_header, sha256_hex,
};
use serde::Serialize;
use serialport::{FlowControl, SerialPort, SerialPortType};

const BOARD_USB_VID: u16 = 0x1a86;
const BOARD_USB_PID: u16 = 0x7522;
const BOARD_BAUD: u32 = 115_200;
const READY_TIMEOUT: Duration = Duration::from_secs(20);
const RESPONSE_TIMEOUT: Duration = Duration::from_secs(15);

#[derive(Debug, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct ProvisioningResult {
    pub board_port: String,
    pub pairing_fingerprint: String,
    pub pairing_bytes: usize,
}

pub fn provision_pairing_record(payload: &[u8]) -> Result<ProvisioningResult, String> {
    let board_port = find_board_port()?;
    let header = encode_header(payload).map_err(|error| error.to_string())?;
    let digest = sha256_hex(payload);
    let mut port = serialport::new(&board_port, BOARD_BAUD)
        .flow_control(FlowControl::None)
        .dtr_on_open(false)
        .timeout(Duration::from_millis(250))
        .open()
        .map_err(|error| format!("could not open Lichuang board at {board_port}: {error}"))?;

    reset_into_firmware(&mut *port)?;
    wait_for_marker(&mut *port, READY_LINE, READY_TIMEOUT).map_err(|error| {
        format!(
            "the board did not enter pairing provisioning mode: {error}; close any serial monitor and retry"
        )
    })?;

    port.write_all(header.as_bytes())
        .and_then(|()| port.write_all(payload))
        .and_then(|()| port.flush())
        .map_err(|error| format!("could not send the pairing record to the board: {error}"))?;

    let success = format!("{OK_PREFIX} {digest}");
    wait_for_marker(&mut *port, &success, RESPONSE_TIMEOUT)
        .map_err(|error| format!("the board did not confirm the pairing record: {error}"))?;

    Ok(ProvisioningResult {
        board_port,
        pairing_fingerprint: digest[..12].to_string(),
        pairing_bytes: payload.len(),
    })
}

fn find_board_port() -> Result<String, String> {
    if let Ok(port) = env::var("ENIGMA_BOARD_PORT")
        && !port.trim().is_empty()
    {
        return Ok(port);
    }

    let ports = serialport::available_ports()
        .map_err(|error| format!("could not enumerate serial devices: {error}"))?
        .into_iter()
        .filter(|port| {
            matches!(
                &port.port_type,
                SerialPortType::UsbPort(info)
                    if info.vid == BOARD_USB_VID && info.pid == BOARD_USB_PID
            )
        })
        .map(|port| port.port_name)
        .collect::<Vec<_>>();
    choose_board_port(ports)
}

fn choose_board_port(mut ports: Vec<String>) -> Result<String, String> {
    ports.sort();
    ports.dedup();
    let callout_ports = ports
        .iter()
        .filter(|port| port.starts_with("/dev/cu.") || port.starts_with("cu."))
        .cloned()
        .collect::<Vec<_>>();
    if let [port] = callout_ports.as_slice() {
        return Ok(port.clone());
    }
    match ports.as_slice() {
        [port] => Ok(port.clone()),
        [] => Err(
            "Lichuang CH340K board not found; connect the board by USB and install its serial driver"
                .into(),
        ),
        _ => Err(
            "multiple Lichuang CH340K boards found; set ENIGMA_BOARD_PORT to choose one".into(),
        ),
    }
}

fn reset_into_firmware(port: &mut dyn SerialPort) -> Result<(), String> {
    // Match the state expected by espflash's HardReset sequence. Its RTS pulse
    // runs after the bootloader connection has left DTR deasserted; an
    // arbitrary preserved DTR state can defeat the Lichuang board's two-
    // transistor auto-reset circuit. The CH340K also needs time to settle
    // after opening before its modem-control lines are reliable.
    thread::sleep(Duration::from_millis(100));
    port.write_data_terminal_ready(false)
        .map_err(|error| format!("could not prepare the board reset: {error}"))?;
    port.write_request_to_send(true)
        .map_err(|error| format!("could not reset the board: {error}"))?;
    thread::sleep(Duration::from_millis(100));
    port.write_request_to_send(false)
        .map_err(|error| format!("could not release board reset: {error}"))?;
    thread::sleep(Duration::from_millis(100));
    Ok(())
}

fn wait_for_marker(
    port: &mut dyn SerialPort,
    marker: &str,
    timeout: Duration,
) -> Result<(), String> {
    let deadline = Instant::now() + timeout;
    let mut received = Vec::with_capacity(4096);
    let mut chunk = [0u8; 512];
    while Instant::now() < deadline {
        match port.read(&mut chunk) {
            Ok(count) if count > 0 => {
                received.extend_from_slice(&chunk[..count]);
                if received
                    .windows(marker.len())
                    .any(|window| window == marker.as_bytes())
                {
                    return Ok(());
                }
                if let Some(error) = find_error_line(&received) {
                    return Err(error);
                }
                if received.len() > 16 * 1024 {
                    received.drain(..received.len() - 8 * 1024);
                }
            }
            Ok(_) => {}
            Err(error) if error.kind() == ErrorKind::TimedOut => {}
            Err(error) => return Err(error.to_string()),
        }
    }
    Err(format!("timed out waiting for `{marker}`"))
}

fn find_error_line(received: &[u8]) -> Option<String> {
    let text = String::from_utf8_lossy(received);
    text.lines()
        .find(|line| line.contains(ERROR_PREFIX))
        .map(str::to_string)
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn extracts_board_error_without_exposing_pairing_data() {
        let bytes = b"boot log\nENIGMA_PROVISION_ERROR invalid pairing record\n";
        assert_eq!(
            find_error_line(bytes).as_deref(),
            Some("ENIGMA_PROVISION_ERROR invalid pairing record")
        );
    }

    #[test]
    fn treats_macos_callout_and_tty_names_as_one_board() {
        assert_eq!(
            choose_board_port(vec![
                "/dev/tty.wchusbserial2140".into(),
                "/dev/cu.wchusbserial2140".into(),
            ]),
            Ok("/dev/cu.wchusbserial2140".into())
        );
    }

    #[test]
    fn still_rejects_two_physical_callout_ports() {
        let error = choose_board_port(vec![
            "/dev/cu.wchusbserial2140".into(),
            "/dev/cu.wchusbserial3140".into(),
        ])
        .unwrap_err();
        assert!(error.contains("multiple Lichuang"));
    }
}
