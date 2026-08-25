mod device;
mod model;
pub mod probe;
mod provisioning;
mod route;
mod simulation;
mod storage;

use std::{
    path::PathBuf,
    sync::{Arc, OnceLock},
};

use device::{DeviceAdapter, DeviceRuntime};
use model::{
    Coordinate, DeviceSummary, DeviceTransport, LocalPlanRecord, SimulationPlan, SimulationSnapshot,
};
use simulation::SimulationController;
use storage::{EncryptedRecord, LocalVault};
use tauri::{Emitter, Manager, WindowEvent};

struct DeferredVault {
    path: PathBuf,
    value: OnceLock<Result<LocalVault, String>>,
}

impl DeferredVault {
    fn new(path: PathBuf) -> Self {
        Self {
            path,
            value: OnceLock::new(),
        }
    }

    fn open(&self) -> Result<&LocalVault, String> {
        match self.value.get_or_init(|| LocalVault::open(&self.path)) {
            Ok(vault) => Ok(vault),
            Err(error) => Err(error.clone()),
        }
    }

    fn warm_up(&self) {
        if let Err(error) = self.open() {
            tracing::warn!(%error, "local vault initialization failed");
        }
    }

    fn put_encrypted(
        &self,
        id: &str,
        kind: &str,
        display_metadata: &str,
        plaintext: &[u8],
    ) -> Result<(), String> {
        self.open()?
            .put_encrypted(id, kind, display_metadata, plaintext)
    }

    fn latest_encrypted(&self, kind: &str) -> Result<Option<Vec<u8>>, String> {
        self.open()?.latest_encrypted(kind)
    }

    fn list_encrypted(&self, kind: &str, limit: usize) -> Result<Vec<EncryptedRecord>, String> {
        self.open()?.list_encrypted(kind, limit)
    }

    fn delete_encrypted(&self, id: &str, kind: &str) -> Result<(), String> {
        self.open()?.delete_encrypted(id, kind)
    }

    fn set_dirty_session(&self, dirty: bool) -> Result<(), String> {
        self.open()?.set_dirty_session(dirty)
    }

    fn has_dirty_session(&self) -> Result<bool, String> {
        self.open()?.has_dirty_session()
    }

    fn should_guard_exit(&self) -> bool {
        self.open().map_or(true, LocalVault::should_guard_exit)
    }

    fn get_mapbox_access_token(&self) -> Result<Option<String>, String> {
        self.open()?.get_mapbox_access_token()
    }

    fn set_mapbox_access_token(&self, token: Option<&str>) -> Result<(), String> {
        self.open()?.set_mapbox_access_token(token)
    }
}

pub struct AppState {
    device: Arc<DeviceRuntime>,
    simulation: Arc<SimulationController>,
    vault: Arc<DeferredVault>,
}

async fn run_vault_task<T, F>(vault: Arc<DeferredVault>, task: F) -> Result<T, String>
where
    T: Send + 'static,
    F: FnOnce(&DeferredVault) -> Result<T, String> + Send + 'static,
{
    tokio::task::spawn_blocking(move || task(&vault))
        .await
        .map_err(|error| format!("local vault task failed: {error}"))?
}

#[tauri::command]
async fn list_devices(state: tauri::State<'_, AppState>) -> Result<Vec<DeviceSummary>, String> {
    state.device.list_devices().await
}

#[tauri::command]
async fn connect_device(
    state: tauri::State<'_, AppState>,
    device_id: String,
) -> Result<DeviceSummary, String> {
    state.device.connect_device(&device_id).await
}

#[tauri::command]
async fn disconnect_device(state: tauri::State<'_, AppState>) -> Result<(), String> {
    state.device.disconnect_device().await
}

#[tauri::command]
async fn provision_embedded(
    state: tauri::State<'_, AppState>,
    device_id: String,
) -> Result<provisioning::ProvisioningResult, String> {
    let pairing_record = state.device.pairing_record_for(&device_id).await?;
    tokio::task::spawn_blocking(move || provisioning::provision_pairing_record(&pairing_record))
        .await
        .map_err(|error| format!("board provisioning task failed: {error}"))?
}

#[tauri::command]
async fn enable_desktop_wifi(
    state: tauri::State<'_, AppState>,
    device_id: String,
) -> Result<(), String> {
    state.device.enable_desktop_wifi(&device_id).await
}

#[tauri::command]
async fn set_location(state: tauri::State<'_, AppState>, point: Coordinate) -> Result<(), String> {
    let plan = SimulationPlan::Teleport { point };
    start_and_record(&state, plan).await
}

#[tauri::command]
async fn start_simulation(
    state: tauri::State<'_, AppState>,
    plan: SimulationPlan,
) -> Result<(), String> {
    start_and_record(&state, plan).await
}

#[tauri::command]
async fn extend_route_simulation(
    state: tauri::State<'_, AppState>,
    points: Vec<Coordinate>,
    options: model::RouteOptions,
) -> Result<(), String> {
    state.simulation.extend_route(points, options).await
}

async fn start_and_record(state: &AppState, plan: SimulationPlan) -> Result<(), String> {
    state.vault.set_dirty_session(true)?;
    if let Err(error) = state.simulation.start(plan.clone()).await {
        state
            .vault
            .set_dirty_session(false)
            .map_err(|reset_error| {
                format!("{error}; could not clear the recovery marker: {reset_error}")
            })?;
        return Err(error);
    }
    if let Err(error) = record_history(&state.vault, &plan) {
        tracing::warn!(error = %error, "simulation started but local history could not be saved");
    }
    Ok(())
}

fn record_history(vault: &DeferredVault, plan: &SimulationPlan) -> Result<(), String> {
    let id = uuid::Uuid::new_v4().to_string();
    let plaintext = serde_json::to_vec(plan).map_err(|error| error.to_string())?;
    vault.put_encrypted(&id, "history", r#"{"recordType":"simulation"}"#, &plaintext)
}

#[derive(serde::Serialize, serde::Deserialize)]
#[serde(rename_all = "camelCase")]
struct FavoritePayload {
    name: String,
    plan: SimulationPlan,
}

fn plan_name(plan: &SimulationPlan) -> &'static str {
    match plan {
        SimulationPlan::Teleport { .. } => "Teleport",
        SimulationPlan::Path { .. } => "Route",
        SimulationPlan::Gpx { .. } => "GPX route",
        SimulationPlan::Joystick { .. } => "Joystick session",
    }
}

#[tauri::command]
async fn latest_history(
    state: tauri::State<'_, AppState>,
) -> Result<Option<SimulationPlan>, String> {
    run_vault_task(state.vault.clone(), |vault| {
        vault
            .latest_encrypted("history")?
            .map(|plaintext| serde_json::from_slice(&plaintext).map_err(|error| error.to_string()))
            .transpose()
    })
    .await
}

#[tauri::command]
async fn list_history(state: tauri::State<'_, AppState>) -> Result<Vec<LocalPlanRecord>, String> {
    run_vault_task(state.vault.clone(), |vault| {
        vault
            .list_encrypted("history", 50)?
            .into_iter()
            .map(|record| {
                let plan: SimulationPlan =
                    serde_json::from_slice(&record.plaintext).map_err(|error| error.to_string())?;
                Ok(LocalPlanRecord {
                    id: record.id,
                    name: plan_name(&plan).into(),
                    created_at: record.created_at,
                    plan,
                })
            })
            .collect()
    })
    .await
}

#[tauri::command]
async fn list_favorites(state: tauri::State<'_, AppState>) -> Result<Vec<LocalPlanRecord>, String> {
    run_vault_task(state.vault.clone(), |vault| {
        vault
            .list_encrypted("favorite", 100)?
            .into_iter()
            .map(|record| {
                let favorite: FavoritePayload =
                    serde_json::from_slice(&record.plaintext).map_err(|error| error.to_string())?;
                Ok(LocalPlanRecord {
                    id: record.id,
                    name: favorite.name,
                    created_at: record.created_at,
                    plan: favorite.plan,
                })
            })
            .collect()
    })
    .await
}

#[tauri::command]
fn save_favorite(
    state: tauri::State<'_, AppState>,
    name: String,
    plan: SimulationPlan,
) -> Result<LocalPlanRecord, String> {
    let name = name.trim();
    if name.is_empty() || name.chars().count() > 80 {
        return Err("favorite name must contain between 1 and 80 characters".into());
    }
    let id = uuid::Uuid::new_v4().to_string();
    let payload = FavoritePayload {
        name: name.into(),
        plan: plan.clone(),
    };
    let plaintext = serde_json::to_vec(&payload).map_err(|error| error.to_string())?;
    state
        .vault
        .put_encrypted(&id, "favorite", "{}", &plaintext)?;
    Ok(LocalPlanRecord {
        id,
        name: name.into(),
        created_at: time::OffsetDateTime::now_utc()
            .format(&time::format_description::well_known::Rfc3339)
            .map_err(|error| error.to_string())?,
        plan,
    })
}

#[tauri::command]
fn delete_saved_plan(
    state: tauri::State<'_, AppState>,
    id: String,
    kind: String,
) -> Result<(), String> {
    let kind = match kind.as_str() {
        "favorite" => "favorite",
        "history" => "history",
        _ => return Err("unknown saved-plan kind".into()),
    };
    state.vault.delete_encrypted(&id, kind)
}

#[tauri::command]
async fn control_simulation(
    state: tauri::State<'_, AppState>,
    action: String,
) -> Result<(), String> {
    state.simulation.control(&action).await
}

#[tauri::command]
async fn update_joystick_heading(
    state: tauri::State<'_, AppState>,
    heading_degrees: f64,
) -> Result<(), String> {
    state
        .simulation
        .update_joystick_heading(heading_degrees)
        .await
}

#[tauri::command]
async fn clear_location(state: tauri::State<'_, AppState>) -> Result<(), String> {
    state.device.clear_location().await?;
    state.simulation.restored().await;
    state.vault.set_dirty_session(false)
}

#[tauri::command]
async fn get_simulation_snapshot(
    state: tauri::State<'_, AppState>,
) -> Result<SimulationSnapshot, String> {
    Ok(state.simulation.snapshot().await)
}

#[tauri::command]
async fn get_host_location() -> Result<Coordinate, String> {
    Err("native computer location is unavailable; use the last map view or select a point".into())
}

#[tauri::command]
async fn has_dirty_session(state: tauri::State<'_, AppState>) -> Result<bool, String> {
    run_vault_task(state.vault.clone(), DeferredVault::has_dirty_session).await
}

#[tauri::command]
async fn get_mapbox_access_token(
    state: tauri::State<'_, AppState>,
) -> Result<Option<String>, String> {
    run_vault_task(state.vault.clone(), DeferredVault::get_mapbox_access_token).await
}

#[tauri::command]
fn set_mapbox_access_token(
    state: tauri::State<'_, AppState>,
    token: Option<String>,
) -> Result<(), String> {
    state.vault.set_mapbox_access_token(token.as_deref())
}

#[tauri::command]
async fn recover_dirty_session(
    state: tauri::State<'_, AppState>,
    choice: String,
) -> Result<(), String> {
    match choice.as_str() {
        "restore" => {
            state.device.clear_location().await?;
            state.simulation.restored().await;
            state.vault.set_dirty_session(false)
        }
        "keep" => state.vault.set_dirty_session(true),
        _ => Err("unknown recovery choice".into()),
    }
}

#[tauri::command]
async fn resolve_exit(
    app: tauri::AppHandle,
    state: tauri::State<'_, AppState>,
    choice: String,
) -> Result<(), String> {
    match choice.as_str() {
        "restore" => {
            state.device.clear_location().await?;
            state.simulation.restored().await;
            state.vault.set_dirty_session(false)?;
            app.exit(0);
        }
        "keep" => {
            state.vault.set_dirty_session(true)?;
            app.exit(0);
        }
        "cancel" => {}
        _ => return Err("unknown exit choice".into()),
    }
    Ok(())
}

#[tauri::command]
async fn export_diagnostics(state: tauri::State<'_, AppState>) -> Result<String, String> {
    let snapshot = state.simulation.snapshot().await;
    let dirty_session = state.vault.has_dirty_session()?;
    let (devices, scan_error) = match state.device.list_devices().await {
        Ok(devices) => (devices, None),
        Err(error) => (Vec::new(), Some(classify_diagnostic_error(&error))),
    };
    serde_json::to_string_pretty(&diagnostics_document(
        &snapshot,
        &devices,
        dirty_session,
        scan_error,
    ))
    .map_err(|error| error.to_string())
}

fn diagnostics_document(
    snapshot: &SimulationSnapshot,
    devices: &[DeviceSummary],
    dirty_session: bool,
    scan_error: Option<&str>,
) -> serde_json::Value {
    let network_device_count = devices
        .iter()
        .filter(|device| device.transport == DeviceTransport::Network)
        .count();
    let qualified_network_device_count = devices
        .iter()
        .filter(|device| device.is_validated_same_lan())
        .count();
    let usb_device_count = devices
        .iter()
        .filter(|device| device.transport == DeviceTransport::Usb)
        .count();
    serde_json::json!({
        "schemaVersion": 1,
        "appVersion": env!("CARGO_PKG_VERSION"),
        "platform": std::env::consts::OS,
        "architecture": std::env::consts::ARCH,
        "ideviceRevision": "63a341d7f624b5c1f2540e4cecb269151a2caf52",
        "simulationState": snapshot.state,
        "dirtySession": dirty_session,
        "connection": {
            "validatedPath": "macos_ios27_same_lan",
            "networkDeviceCount": network_device_count,
            "qualifiedNetworkDeviceCount": qualified_network_device_count,
            "usbDeviceCount": usb_device_count,
            "usbQualification": "software_enabled_physical_acceptance_pending",
            "scanErrorCode": scan_error
        },
        "containsLocationData": false,
        "containsDeviceIdentifiers": false
    })
}

fn classify_diagnostic_error(error: &str) -> &'static str {
    let normalized = error.to_ascii_lowercase();
    if normalized.contains("driver") || normalized.contains("usbmux") {
        "APPLE_DRIVER_OR_USBMUX_UNAVAILABLE"
    } else if normalized.contains("pair") || normalized.contains("trust") {
        "PAIRING_UNAVAILABLE"
    } else if normalized.contains("network") || normalized.contains("connect") {
        "NETWORK_DISCOVERY_UNAVAILABLE"
    } else {
        "DEVICE_SCAN_FAILED"
    }
}

pub fn run() {
    tracing_subscriber::fmt()
        .with_env_filter(
            tracing_subscriber::EnvFilter::try_from_default_env()
                .unwrap_or_else(|_| "enigma_desktop=info,warn".into()),
        )
        .with_target(false)
        .compact()
        .init();

    let device = DeviceRuntime::new();
    let simulation = SimulationController::new(device.clone());
    tauri::Builder::default()
        .plugin(tauri_plugin_single_instance::init(|app, _argv, _cwd| {
            if let Some(window) = app.get_webview_window("main") {
                let _ = window.show();
                let _ = window.set_focus();
            }
        }))
        .plugin(tauri_plugin_updater::Builder::new().build())
        .setup(move |app| {
            let data_dir = app.path().app_data_dir()?;
            std::fs::create_dir_all(&data_dir)?;
            let vault = Arc::new(DeferredVault::new(data_dir.join("enigma.sqlite")));
            app.manage(AppState {
                device: device.clone(),
                simulation: simulation.clone(),
                vault: vault.clone(),
            });
            let vault_warmup = vault.clone();
            tauri::async_runtime::spawn_blocking(move || vault_warmup.warm_up());
            let handle = app.handle().clone();
            if let Some(window) = app.get_webview_window("main") {
                window.show()?;
                window.set_focus()?;
                let vault = vault.clone();
                window.on_window_event(move |event| {
                    if let WindowEvent::CloseRequested { api, .. } = event
                        && vault.should_guard_exit()
                    {
                        api.prevent_close();
                        let _ = handle.emit("enigma://exit-requested", ());
                    }
                });
            }
            Ok(())
        })
        .invoke_handler(tauri::generate_handler![
            list_devices,
            connect_device,
            disconnect_device,
            provision_embedded,
            enable_desktop_wifi,
            get_host_location,
            set_location,
            start_simulation,
            extend_route_simulation,
            control_simulation,
            update_joystick_heading,
            clear_location,
            get_simulation_snapshot,
            latest_history,
            list_history,
            list_favorites,
            save_favorite,
            delete_saved_plan,
            has_dirty_session,
            get_mapbox_access_token,
            set_mapbox_access_token,
            recover_dirty_session,
            resolve_exit,
            export_diagnostics,
        ])
        .run(tauri::generate_context!())
        .expect("error while running Enigma");
}

#[cfg(test)]
mod privacy_tests {
    use super::*;
    use crate::model::{DeviceState, SimulationState};

    #[test]
    fn diagnostics_omit_locations_and_device_identifiers() {
        let snapshot = SimulationSnapshot {
            state: SimulationState::Running,
            point: Some(Coordinate {
                latitude: 49.2827,
                longitude: -123.1207,
                altitude_meters: None,
            }),
            ..SimulationSnapshot::default()
        };
        let devices = vec![DeviceSummary {
            id: "opaque-session-id".into(),
            name: "Personal iPhone".into(),
            model: Some("private-model".into()),
            os_version: Some("27.0".into()),
            os_build: Some("private-build".into()),
            transport: DeviceTransport::Network,
            state: DeviceState::Ready,
            diagnostic_code: None,
        }];
        let serialized = diagnostics_document(&snapshot, &devices, true, None).to_string();
        for forbidden in [
            "49.2827",
            "-123.1207",
            "opaque-session-id",
            "Personal iPhone",
            "private-model",
            "private-build",
            "mapbox",
            "pk.",
        ] {
            assert!(!serialized.contains(forbidden));
        }
        assert!(serialized.contains("\"containsLocationData\":false"));
        assert!(serialized.contains("\"containsDeviceIdentifiers\":false"));
        assert!(serialized.contains("\"qualifiedNetworkDeviceCount\":1"));
    }
}
