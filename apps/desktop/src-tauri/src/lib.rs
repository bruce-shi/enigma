mod device;
mod model;
pub mod probe;
mod route;
mod simulation;
mod storage;

use std::sync::Arc;

use device::{DeviceAdapter, DeviceRuntime};
use model::{Coordinate, DeviceSummary, LocalPlanRecord, SimulationPlan, SimulationSnapshot};
use simulation::SimulationController;
use storage::LocalVault;
use tauri::{Emitter, Manager, WindowEvent};

pub struct AppState {
    device: Arc<DeviceRuntime>,
    simulation: Arc<SimulationController>,
    vault: Arc<LocalVault>,
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

fn record_history(vault: &LocalVault, plan: &SimulationPlan) -> Result<(), String> {
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
fn latest_history(state: tauri::State<'_, AppState>) -> Result<Option<SimulationPlan>, String> {
    state
        .vault
        .latest_encrypted("history")?
        .map(|plaintext| serde_json::from_slice(&plaintext).map_err(|error| error.to_string()))
        .transpose()
}

#[tauri::command]
fn list_history(state: tauri::State<'_, AppState>) -> Result<Vec<LocalPlanRecord>, String> {
    state
        .vault
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
}

#[tauri::command]
fn list_favorites(state: tauri::State<'_, AppState>) -> Result<Vec<LocalPlanRecord>, String> {
    state
        .vault
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
    state.vault.has_dirty_session()
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
    serde_json::to_string_pretty(&serde_json::json!({
        "schemaVersion": 1,
        "appVersion": env!("CARGO_PKG_VERSION"),
        "platform": std::env::consts::OS,
        "architecture": std::env::consts::ARCH,
        "ideviceRevision": "63a341d7f624b5c1f2540e4cecb269151a2caf52",
        "simulationState": snapshot.state,
        "containsLocationData": false
    }))
    .map_err(|error| error.to_string())
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
                let _ = window.set_focus();
            }
        }))
        .plugin(tauri_plugin_deep_link::init())
        .plugin(tauri_plugin_opener::init())
        .plugin(tauri_plugin_updater::Builder::new().build())
        .setup(move |app| {
            let data_dir = app.path().app_data_dir()?;
            std::fs::create_dir_all(&data_dir)?;
            let vault = Arc::new(
                LocalVault::open(&data_dir.join("enigma.sqlite")).map_err(std::io::Error::other)?,
            );
            app.manage(AppState {
                device: device.clone(),
                simulation: simulation.clone(),
                vault: vault.clone(),
            });
            let handle = app.handle().clone();
            if let Some(window) = app.get_webview_window("main") {
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
            get_host_location,
            set_location,
            start_simulation,
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
            recover_dirty_session,
            resolve_exit,
            export_diagnostics,
        ])
        .run(tauri::generate_context!())
        .expect("error while running Enigma");
}
