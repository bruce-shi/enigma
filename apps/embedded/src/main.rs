//! Host-side launcher for building or deploying a selected embedded platform.

use std::{
    env, fs,
    path::PathBuf,
    process::{Command, ExitCode},
};

const DEFAULT_PLATFORM: &str = "esp-idf";

#[derive(Debug, Eq, PartialEq)]
struct Options {
    build_only: bool,
    platform: String,
    board: Option<String>,
}

struct Platform {
    directory: PathBuf,
    rustup_toolchain: &'static str,
}

fn main() -> ExitCode {
    let options = match parse_options(env::args().skip(1)) {
        Ok(Some(options)) => options,
        Ok(None) => return ExitCode::SUCCESS,
        Err(error) => {
            eprintln!("error: {error}\n");
            print_help();
            return ExitCode::FAILURE;
        }
    };

    let platform = match platform(&options.platform) {
        Some(platform) => platform,
        None => {
            eprintln!(
                "error: unsupported embedded platform `{}`; supported: {DEFAULT_PLATFORM}",
                options.platform
            );
            return ExitCode::FAILURE;
        }
    };

    if !options.build_only
        && let Err(error) = deploy_preflight()
    {
        eprintln!("error: {error}");
        return ExitCode::FAILURE;
    }

    let cargo_action = if options.build_only { "build" } else { "run" };
    // The outer launcher is built by the host workspace's stable toolchain.
    // Invoke the platform toolchain explicitly so RUSTUP_TOOLCHAIN inherited
    // from that Cargo process cannot force stable Rust on the Xtensa build.
    let mut command = Command::new("rustup");
    command
        .current_dir(&platform.directory)
        .arg("run")
        .arg(platform.rustup_toolchain)
        .arg("cargo")
        .arg(cargo_action)
        .arg("--release");
    if let Some(board) = &options.board {
        command
            .arg("--no-default-features")
            .arg("--features")
            .arg(board);
    }

    let purpose = if options.build_only {
        "building"
    } else {
        "flashing and monitoring"
    };
    println!(
        "Enigma Embedded: {purpose} platform `{}`{}",
        options.platform,
        options
            .board
            .as_deref()
            .map(|board| format!(" with `{board}`"))
            .unwrap_or_default()
    );

    match command.status() {
        Ok(status) if status.success() => ExitCode::SUCCESS,
        Ok(status) => {
            eprintln!("embedded Cargo command failed with {status}");
            ExitCode::FAILURE
        }
        Err(error) => {
            eprintln!(
                "could not start Cargo in {}: {error}",
                platform.directory.display()
            );
            ExitCode::FAILURE
        }
    }
}

#[cfg(target_os = "macos")]
fn deploy_preflight() -> Result<(), String> {
    let serial_devices = fs::read_dir("/dev")
        .map(|entries| {
            entries
                .filter_map(Result::ok)
                .filter_map(|entry| entry.file_name().into_string().ok())
                .filter(|name| name.starts_with("cu."))
                .collect::<Vec<_>>()
        })
        .unwrap_or_default();
    if has_usb_serial_device(&serial_devices) {
        return Ok(());
    }

    let output = Command::new("ioreg")
        .args(["-r", "-n", "USB Serial", "-l", "-w", "0"])
        .output()
        .map_err(|error| format!("could not inspect macOS USB devices: {error}"))?;
    let registry = String::from_utf8_lossy(&output.stdout);
    if registry.contains("\"idVendor\" = 6790") && registry.contains("\"idProduct\" = 29986") {
        return Err(
            "the Lichuang board is connected, but macOS has not attached a serial driver to its \
             CH340K (USB 1a86:7522). Install the official WCH CH34XSER macOS driver, approve it in \
             System Settings if prompted, reconnect the board, and retry. \
             https://www.wch-ic.com/downloads/CH34XSER_MAC_ZIP.html"
                .to_owned(),
        );
    }
    Ok(())
}

#[cfg(not(target_os = "macos"))]
fn deploy_preflight() -> Result<(), String> {
    Ok(())
}

fn has_usb_serial_device(devices: &[String]) -> bool {
    devices.iter().any(|name| {
        name.starts_with("cu.usbmodem")
            || name.starts_with("cu.usbserial")
            || name.starts_with("cu.wchusbserial")
            || name.starts_with("cu.SLAB_USBtoUART")
    })
}

fn parse_options(arguments: impl IntoIterator<Item = String>) -> Result<Option<Options>, String> {
    let mut options = Options {
        build_only: false,
        platform: DEFAULT_PLATFORM.to_owned(),
        board: None,
    };
    let mut arguments = arguments.into_iter();
    while let Some(argument) = arguments.next() {
        match argument.as_str() {
            "--build-only" => options.build_only = true,
            "--platform" => {
                options.platform = arguments
                    .next()
                    .ok_or_else(|| "--platform requires a value".to_owned())?;
            }
            "--board" => {
                options.board = Some(
                    arguments
                        .next()
                        .ok_or_else(|| "--board requires a Cargo feature".to_owned())?,
                );
            }
            "-h" | "--help" => {
                print_help();
                return Ok(None);
            }
            unknown => return Err(format!("unknown option `{unknown}`")),
        }
    }
    Ok(Some(options))
}

fn platform(name: &str) -> Option<Platform> {
    match name {
        "esp-idf" => Some(Platform {
            directory: PathBuf::from(env!("CARGO_MANIFEST_DIR"))
                .join("platforms")
                .join("esp-idf"),
            rustup_toolchain: "esp",
        }),
        _ => None,
    }
}

fn print_help() {
    println!(
        "Enigma embedded launcher\n\n\
         Usage:\n  \
           cargo run --release [-- <options>]\n\n\
         Options:\n  \
           --build-only          Build without flashing hardware\n  \
           --platform <name>     Platform to use (default: esp-idf)\n  \
           --board <feature>     Select a platform Cargo board feature\n  \
           -h, --help            Show this help"
    );
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn defaults_to_deploying_esp_idf() {
        assert_eq!(
            parse_options(Vec::new()).unwrap(),
            Some(Options {
                build_only: false,
                platform: String::from("esp-idf"),
                board: None,
            })
        );
    }

    #[test]
    fn parses_build_and_board_selection() {
        assert_eq!(
            parse_options([
                String::from("--build-only"),
                String::from("--board"),
                String::from("board-lichuang-esp32s3"),
            ])
            .unwrap(),
            Some(Options {
                build_only: true,
                platform: String::from("esp-idf"),
                board: Some(String::from("board-lichuang-esp32s3")),
            })
        );
    }

    #[test]
    fn recognizes_common_macos_usb_serial_devices() {
        assert!(has_usb_serial_device(&[String::from(
            "cu.wchusbserial1410"
        )]));
        assert!(has_usb_serial_device(&[String::from("cu.usbmodem2101")]));
        assert!(!has_usb_serial_device(&[
            String::from("cu.Bluetooth-Incoming-Port"),
            String::from("cu.debug-console"),
        ]));
    }
}
