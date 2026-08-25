use std::{
    sync::{
        Arc,
        atomic::{AtomicBool, Ordering},
    },
    time::Instant,
};

use tokio::sync::{Mutex, RwLock, mpsc, watch};

use crate::{
    device::{DeviceAdapter, DeviceRuntime},
    model::{SimulationPlan, SimulationSnapshot, SimulationState},
    route::{advance_joystick, route_samples},
};

#[derive(Debug, Clone, Copy, PartialEq, Eq)]
enum PlaybackState {
    Running,
    Paused,
    Stop,
}

#[derive(Debug, Clone, Copy)]
struct RunControl {
    playback: PlaybackState,
    restart_generation: u64,
}

impl Default for RunControl {
    fn default() -> Self {
        Self {
            playback: PlaybackState::Running,
            restart_generation: 0,
        }
    }
}

pub struct SimulationController {
    device: Arc<dyn DeviceAdapter>,
    snapshot: Arc<RwLock<SimulationSnapshot>>,
    control: Mutex<Option<watch::Sender<RunControl>>>,
    route_extension: Mutex<Option<mpsc::Sender<Vec<crate::model::Coordinate>>>>,
    active: Arc<AtomicBool>,
    joystick_heading: Arc<RwLock<f64>>,
}

impl SimulationController {
    pub fn new(device: Arc<DeviceRuntime>) -> Arc<Self> {
        Self::with_device(device)
    }

    fn with_device(device: Arc<dyn DeviceAdapter>) -> Arc<Self> {
        Arc::new(Self {
            device,
            snapshot: Arc::new(RwLock::new(SimulationSnapshot::default())),
            control: Mutex::new(None),
            route_extension: Mutex::new(None),
            active: Arc::new(AtomicBool::new(false)),
            joystick_heading: Arc::new(RwLock::new(0.0)),
        })
    }

    pub fn is_active(&self) -> bool {
        self.active.load(Ordering::SeqCst)
    }

    pub async fn snapshot(&self) -> SimulationSnapshot {
        self.snapshot.read().await.clone()
    }

    pub async fn start(&self, plan: SimulationPlan) -> Result<(), String> {
        self.stop().await?;
        match plan {
            SimulationPlan::Teleport { point } => {
                self.device.set_location(point).await?;
                self.active.store(true, Ordering::SeqCst);
                *self.snapshot.write().await = SimulationSnapshot {
                    state: SimulationState::Running,
                    point: Some(point),
                    progress: 1.0,
                    elapsed_ms: 0,
                    remaining_ms: None,
                    error: None,
                };
            }
            SimulationPlan::Path {
                points, options, ..
            } => {
                let extendable = options.repetitions == 1 && !options.round_trip;
                let samples = route_samples(&points, &options)?;
                self.start_samples(samples, extendable).await?;
            }
            SimulationPlan::Gpx {
                points, options, ..
            } => {
                let samples = route_samples(&points, &options)?;
                self.start_samples(samples, false).await?;
            }
            SimulationPlan::Joystick {
                origin,
                speed_kph,
                heading_degrees,
            } => {
                origin.validate()?;
                self.device.set_location(origin).await?;
                *self.joystick_heading.write().await = heading_degrees;
                let (sender, mut receiver) = watch::channel(RunControl::default());
                *self.control.lock().await = Some(sender);
                self.active.store(true, Ordering::SeqCst);
                let device = self.device.clone();
                let snapshot = self.snapshot.clone();
                let active = self.active.clone();
                let joystick_heading = self.joystick_heading.clone();
                tokio::spawn(async move {
                    let started = Instant::now();
                    let mut point = origin;
                    let mut restart_generation = 0;
                    loop {
                        let control = *receiver.borrow();
                        if control.restart_generation != restart_generation {
                            point = origin;
                            restart_generation = control.restart_generation;
                        }
                        match control.playback {
                            PlaybackState::Stop => break,
                            PlaybackState::Paused => {
                                if receiver.changed().await.is_err() {
                                    break;
                                }
                                continue;
                            }
                            PlaybackState::Running => {}
                        }
                        let heading_degrees = *joystick_heading.read().await;
                        match advance_joystick(point, heading_degrees, speed_kph) {
                            Ok(next) => point = next,
                            Err(error) => {
                                set_error(&snapshot, error).await;
                                break;
                            }
                        }
                        if let Err(error) = device.set_location(point).await {
                            set_error(&snapshot, error).await;
                            break;
                        }
                        *snapshot.write().await = SimulationSnapshot {
                            state: SimulationState::Running,
                            point: Some(point),
                            progress: 0.0,
                            elapsed_ms: started.elapsed().as_millis() as u64,
                            remaining_ms: None,
                            error: None,
                        };
                        tokio::time::sleep(std::time::Duration::from_secs(1)).await;
                    }
                    active.store(false, Ordering::SeqCst);
                });
            }
        }
        Ok(())
    }

    async fn start_samples(
        &self,
        samples: Vec<crate::model::Coordinate>,
        extendable: bool,
    ) -> Result<(), String> {
        let first = *samples
            .first()
            .ok_or_else(|| "route contains no points".to_string())?;
        self.device.set_location(first).await?;
        let (sender, mut receiver) = watch::channel(RunControl::default());
        *self.control.lock().await = Some(sender);
        let (extension_sender, mut extension_receiver) = mpsc::channel(8);
        *self.route_extension.lock().await = extendable.then_some(extension_sender);
        self.active.store(true, Ordering::SeqCst);
        let device = self.device.clone();
        let snapshot = self.snapshot.clone();
        let active = self.active.clone();
        tokio::spawn(async move {
            let started = Instant::now();
            let mut samples = samples;
            let mut index = 0_usize;
            let mut restart_generation = 0;
            loop {
                while let Ok(mut extension) = extension_receiver.try_recv() {
                    samples.append(&mut extension);
                }
                if index >= samples.len() {
                    break;
                }
                let control = *receiver.borrow();
                if control.restart_generation != restart_generation {
                    index = 0;
                    restart_generation = control.restart_generation;
                }
                match control.playback {
                    PlaybackState::Stop => break,
                    PlaybackState::Paused => {
                        if receiver.changed().await.is_err() {
                            break;
                        }
                        continue;
                    }
                    PlaybackState::Running => {}
                }
                let point = samples[index];
                if let Err(error) = device.set_location(point).await {
                    set_error(&snapshot, error).await;
                    active.store(false, Ordering::SeqCst);
                    return;
                }
                let elapsed_ms = started.elapsed().as_millis() as u64;
                let remaining = (samples.len() - index - 1) as u64 * 1000;
                *snapshot.write().await = SimulationSnapshot {
                    state: SimulationState::Running,
                    point: Some(point),
                    progress: index as f64 / (samples.len() - 1).max(1) as f64,
                    elapsed_ms,
                    remaining_ms: Some(remaining),
                    error: None,
                };
                index += 1;
                tokio::time::sleep(std::time::Duration::from_secs(1)).await;
            }
            active.store(false, Ordering::SeqCst);
            let mut current = snapshot.write().await;
            if current.state != SimulationState::Error {
                current.state = SimulationState::RestoreRequired;
                current.progress = 1.0;
            }
        });
        Ok(())
    }

    pub async fn extend_route(
        &self,
        points: Vec<crate::model::Coordinate>,
        mut options: crate::model::RouteOptions,
    ) -> Result<(), String> {
        if !self.is_active() {
            return Err("no running route is available to extend".into());
        }
        let sender = self.route_extension.lock().await.clone().ok_or_else(|| {
            "the current route cannot be extended; use one repetition with round trip off"
                .to_string()
        })?;
        options.repetitions = 1;
        options.round_trip = false;
        let extension = route_samples(&points, &options)?
            .into_iter()
            .skip(1)
            .collect::<Vec<_>>();
        if extension.is_empty() {
            return Err("the route extension contains no movement".into());
        }
        sender
            .send(extension)
            .await
            .map_err(|_| "the running route finished before it could be extended".to_string())
    }

    pub async fn control(&self, action: &str) -> Result<(), String> {
        let mut snapshot_state = SimulationState::Running;
        if let Some(sender) = self.control.lock().await.as_ref() {
            let mut control = *sender.borrow();
            match action {
                "pause" => {
                    control.playback = PlaybackState::Paused;
                    snapshot_state = SimulationState::Paused;
                }
                "resume" => control.playback = PlaybackState::Running,
                "restart" => {
                    control.playback = PlaybackState::Running;
                    control.restart_generation = control.restart_generation.wrapping_add(1);
                }
                "stop" => {
                    control.playback = PlaybackState::Stop;
                    snapshot_state = SimulationState::RestoreRequired;
                }
                _ => return Err("unknown simulation control action".into()),
            }
            sender
                .send(control)
                .map_err(|_| "simulation task has stopped".to_string())?;
        } else if action != "stop" {
            return Err("no route or joystick simulation is active".into());
        }
        let mut snapshot = self.snapshot.write().await;
        snapshot.state = snapshot_state;
        if action == "stop" {
            self.active.store(false, Ordering::SeqCst);
        }
        Ok(())
    }

    pub async fn update_joystick_heading(&self, heading_degrees: f64) -> Result<(), String> {
        if !heading_degrees.is_finite() {
            return Err("joystick heading must be a finite number".into());
        }
        if self.control.lock().await.is_none() || !self.is_active() {
            return Err("no joystick simulation is active".into());
        }
        *self.joystick_heading.write().await = heading_degrees.rem_euclid(360.0);
        Ok(())
    }

    pub async fn stop(&self) -> Result<(), String> {
        self.route_extension.lock().await.take();
        if let Some(sender) = self.control.lock().await.take() {
            let current = *sender.borrow();
            let _ = sender.send(RunControl {
                playback: PlaybackState::Stop,
                ..current
            });
        }
        self.active.store(false, Ordering::SeqCst);
        Ok(())
    }

    pub async fn restored(&self) {
        self.stop().await.ok();
        *self.snapshot.write().await = SimulationSnapshot::default();
    }
}

async fn set_error(snapshot: &RwLock<SimulationSnapshot>, error: String) {
    let mut current = snapshot.write().await;
    current.state = SimulationState::Error;
    current.error = Some(error);
}

#[cfg(test)]
mod tests {
    use std::sync::{
        Mutex as StdMutex,
        atomic::{AtomicUsize, Ordering},
    };

    use async_trait::async_trait;

    use super::*;
    use crate::model::{Coordinate, DeviceSummary, RouteOptions, SpeedProfile};

    #[derive(Default)]
    struct FakeDevice {
        points: StdMutex<Vec<Coordinate>>,
        clears: AtomicUsize,
    }

    #[async_trait]
    impl DeviceAdapter for FakeDevice {
        async fn list_devices(&self) -> Result<Vec<DeviceSummary>, String> {
            Ok(Vec::new())
        }

        async fn connect_device(&self, _device_id: &str) -> Result<DeviceSummary, String> {
            Err("not used by simulation tests".into())
        }

        async fn disconnect_device(&self) -> Result<(), String> {
            Ok(())
        }

        async fn set_location(&self, point: Coordinate) -> Result<(), String> {
            self.points.lock().unwrap().push(point);
            Ok(())
        }

        async fn clear_location(&self) -> Result<(), String> {
            self.clears.fetch_add(1, Ordering::SeqCst);
            Ok(())
        }
    }

    fn origin() -> Coordinate {
        Coordinate {
            latitude: 49.2827,
            longitude: -123.1207,
            altitude_meters: None,
        }
    }

    fn route_options() -> RouteOptions {
        RouteOptions {
            speed_kph: 108.0,
            speed_profile: SpeedProfile::Constant,
            repetitions: 1,
            round_trip: false,
            update_interval_ms: 1000,
            natural_variation_seed: None,
        }
    }

    #[tokio::test]
    async fn running_route_continues_into_an_appended_leg() {
        let device = Arc::new(FakeDevice::default());
        let controller = SimulationController::with_device(device.clone());
        let first = origin();
        let second = Coordinate {
            longitude: first.longitude + 0.000_001,
            ..first
        };
        let third = Coordinate {
            longitude: first.longitude + 0.000_002,
            ..first
        };
        controller
            .start(SimulationPlan::Path {
                points: vec![first, second],
                options: route_options(),
                honor_timestamps: false,
                waypoints: Some(vec![first, second]),
                routing_profile: None,
            })
            .await
            .unwrap();
        controller
            .extend_route(vec![second, third], route_options())
            .await
            .unwrap();

        tokio::time::timeout(std::time::Duration::from_secs(4), async {
            loop {
                if device.points.lock().unwrap().iter().any(|point| {
                    (point.latitude - third.latitude).abs() < 1e-9
                        && (point.longitude - third.longitude).abs() < 1e-9
                }) {
                    break;
                }
                tokio::time::sleep(std::time::Duration::from_millis(20)).await;
            }
        })
        .await
        .unwrap();
        controller.stop().await.unwrap();
    }

    #[tokio::test]
    async fn joystick_can_pause_change_direction_stop_and_restore() {
        let device = Arc::new(FakeDevice::default());
        let controller = SimulationController::with_device(device.clone());
        controller
            .start(SimulationPlan::Joystick {
                origin: origin(),
                speed_kph: 3.6,
                heading_degrees: 0.0,
            })
            .await
            .unwrap();
        tokio::task::yield_now().await;

        controller.control("pause").await.unwrap();
        assert_eq!(controller.snapshot().await.state, SimulationState::Paused);
        controller.update_joystick_heading(-90.0).await.unwrap();
        assert_eq!(*controller.joystick_heading.read().await, 270.0);
        controller.control("resume").await.unwrap();
        assert_eq!(controller.snapshot().await.state, SimulationState::Running);
        controller.control("stop").await.unwrap();
        assert_eq!(
            controller.snapshot().await.state,
            SimulationState::RestoreRequired
        );

        device.clear_location().await.unwrap();
        controller.restored().await;
        assert_eq!(controller.snapshot().await, SimulationSnapshot::default());
        assert!(!controller.is_active());
        assert_eq!(device.clears.load(Ordering::SeqCst), 1);
        assert!(!device.points.lock().unwrap().is_empty());
    }
}
