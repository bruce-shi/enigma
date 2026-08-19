use clap::{Parser, Subcommand};
use enigma_desktop_lib::probe;

#[derive(Debug, Parser)]
#[command(about = "M0 physical-device feasibility probe", version)]
struct Arguments {
    #[command(subcommand)]
    command: Command,
}

#[derive(Debug, Subcommand)]
enum Command {
    /// Enumerate devices without printing UDIDs.
    List,
    /// Set a location and keep the modern service connection alive until Ctrl-C.
    Set {
        #[arg(long, default_value_t = 0)]
        index: usize,
        /// Refuse to select the device unless its reported iOS version matches exactly.
        #[arg(long)]
        expected_ios: Option<String>,
        latitude: f64,
        longitude: f64,
    },
    /// Set two coordinates in one session, then restore automatically.
    Move {
        #[arg(long, default_value_t = 0)]
        index: usize,
        /// Refuse to select the device unless its reported iOS version matches exactly.
        #[arg(long)]
        expected_ios: Option<String>,
        #[arg(long, default_value_t = 2)]
        dwell_seconds: u64,
        start_latitude: f64,
        start_longitude: f64,
        end_latitude: f64,
        end_longitude: f64,
    },
    /// Clear a simulated location.
    Clear {
        #[arg(long, default_value_t = 0)]
        index: usize,
        /// Refuse to select the device unless its reported iOS version matches exactly.
        #[arg(long)]
        expected_ios: Option<String>,
    },
}

#[tokio::main]
async fn main() -> Result<(), String> {
    tracing_subscriber::fmt()
        .with_env_filter("enigma_desktop=debug,idevice=info")
        .with_target(false)
        .compact()
        .init();
    match Arguments::parse().command {
        Command::List => probe::list().await,
        Command::Set {
            index,
            expected_ios,
            latitude,
            longitude,
        } => probe::set(index, expected_ios.as_deref(), latitude, longitude).await,
        Command::Move {
            index,
            expected_ios,
            dwell_seconds,
            start_latitude,
            start_longitude,
            end_latitude,
            end_longitude,
        } => {
            probe::move_between(
                index,
                expected_ios.as_deref(),
                dwell_seconds,
                start_latitude,
                start_longitude,
                end_latitude,
                end_longitude,
            )
            .await
        }
        Command::Clear {
            index,
            expected_ios,
        } => probe::clear(index, expected_ios.as_deref()).await,
    }
}
