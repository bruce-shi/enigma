//! Physical-device commands for M0. Output intentionally excludes Apple UDIDs.

use crate::{
    device::{DeviceAdapter, DeviceRuntime},
    model::Coordinate,
};

pub async fn list() -> Result<(), String> {
    let runtime = DeviceRuntime::new();
    let devices = runtime.list_devices().await?;
    println!(
        "{}",
        serde_json::to_string_pretty(&devices).map_err(|error| error.to_string())?
    );
    if devices.is_empty() {
        return Err("NO_DEVICE: connect and unlock an iPhone, then retry".into());
    }
    Ok(())
}

pub async fn set(
    index: usize,
    expected_ios: Option<&str>,
    latitude: f64,
    longitude: f64,
) -> Result<(), String> {
    let runtime = selected_runtime(index, expected_ios).await?;
    let point = Coordinate {
        latitude,
        longitude,
        altitude_meters: None,
    }
    .validate()?;
    runtime.set_location(point).await?;
    println!("Location service accepted the coordinate; press Ctrl-C to restore.");
    tokio::signal::ctrl_c()
        .await
        .map_err(|error| error.to_string())?;
    runtime.clear_location().await?;
    println!("Restore command acknowledged.");
    Ok(())
}

#[allow(clippy::too_many_arguments)]
pub async fn move_between(
    index: usize,
    expected_ios: Option<&str>,
    dwell_seconds: u64,
    start_latitude: f64,
    start_longitude: f64,
    end_latitude: f64,
    end_longitude: f64,
) -> Result<(), String> {
    let runtime = selected_runtime(index, expected_ios).await?;
    let start = Coordinate {
        latitude: start_latitude,
        longitude: start_longitude,
        altitude_meters: None,
    }
    .validate()?;
    let end = Coordinate {
        latitude: end_latitude,
        longitude: end_longitude,
        altitude_meters: None,
    }
    .validate()?;

    let sequence_result = async {
        runtime.set_location(start).await?;
        println!("Start coordinate accepted.");
        tokio::time::sleep(std::time::Duration::from_secs(dwell_seconds)).await;
        runtime.set_location(end).await?;
        println!("Move coordinate accepted.");
        tokio::time::sleep(std::time::Duration::from_secs(dwell_seconds)).await;
        Ok::<(), String>(())
    }
    .await;
    let restore_result = runtime.clear_location().await;
    if restore_result.is_ok() {
        println!("Restore command acknowledged.");
    }
    sequence_result?;
    restore_result
}

pub async fn clear(index: usize, expected_ios: Option<&str>) -> Result<(), String> {
    let runtime = selected_runtime(index, expected_ios).await?;
    runtime.clear_location().await?;
    println!("Restore command acknowledged.");
    Ok(())
}

async fn selected_runtime(
    index: usize,
    expected_ios: Option<&str>,
) -> Result<std::sync::Arc<DeviceRuntime>, String> {
    let runtime = DeviceRuntime::new();
    let devices = runtime.list_devices().await?;
    let selected = devices.get(index).ok_or_else(|| {
        format!(
            "NO_DEVICE: index {index} is unavailable; {} device(s) detected",
            devices.len()
        )
    })?;
    if let Some(expected) = expected_ios
        && selected.os_version.as_deref() != Some(expected)
    {
        return Err(format!(
            "DEVICE_MISMATCH: index {index} reports iOS {}, expected iOS {expected}",
            selected.os_version.as_deref().unwrap_or("unknown")
        ));
    }
    runtime.connect_device(&selected.id).await?;
    println!(
        "Selected {} ({:?}, iOS {}).",
        selected.name,
        selected.transport,
        selected.os_version.as_deref().unwrap_or("unknown")
    );
    Ok(runtime)
}
