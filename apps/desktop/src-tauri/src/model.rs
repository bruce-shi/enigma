use serde::{Deserialize, Serialize};

#[derive(Debug, Clone, Copy, Serialize, Deserialize, PartialEq, Eq)]
#[serde(rename_all = "lowercase")]
pub enum DeviceTransport {
    Usb,
    Network,
}

#[derive(Debug, Clone, Copy, Serialize, Deserialize, PartialEq, Eq)]
#[serde(rename_all = "snake_case")]
pub enum DeviceState {
    Disconnected,
    Connecting,
    NeedsDriver,
    NeedsTrust,
    NeedsDeveloperMode,
    Preparing,
    Ready,
    Simulating,
    Error,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct DeviceSummary {
    pub id: String,
    pub name: String,
    pub model: Option<String>,
    pub os_version: Option<String>,
    pub os_build: Option<String>,
    pub transport: DeviceTransport,
    pub state: DeviceState,
    pub diagnostic_code: Option<String>,
}

impl DeviceSummary {
    pub fn is_same_lan_wifi_candidate(&self) -> bool {
        self.transport == DeviceTransport::Network
    }

    pub fn is_validated_same_lan(&self) -> bool {
        self.is_same_lan_wifi_candidate()
            && self
                .os_version
                .as_deref()
                .is_some_and(|version| version.starts_with("27."))
    }
}

#[derive(Debug, Clone, Copy, Serialize, Deserialize, PartialEq)]
#[serde(rename_all = "camelCase")]
pub struct Coordinate {
    pub latitude: f64,
    pub longitude: f64,
    pub altitude_meters: Option<f64>,
}

impl Coordinate {
    pub fn validate(self) -> Result<Self, String> {
        if !self.latitude.is_finite() || !self.longitude.is_finite() {
            return Err("coordinates must be finite numbers".into());
        }
        if !(-90.0..=90.0).contains(&self.latitude) {
            return Err("latitude must be between -90 and 90".into());
        }
        if !(-180.0..=180.0).contains(&self.longitude) {
            return Err("longitude must be between -180 and 180".into());
        }
        Ok(self)
    }
}

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct RouteOptions {
    pub speed_kph: f64,
    pub speed_profile: SpeedProfile,
    pub repetitions: u32,
    pub round_trip: bool,
    pub update_interval_ms: u64,
    pub natural_variation_seed: Option<u64>,
}

#[derive(Debug, Clone, Copy, Serialize, Deserialize)]
#[serde(rename_all = "lowercase")]
pub enum SpeedProfile {
    Constant,
    Natural,
}

#[derive(Debug, Clone, Copy, Serialize, Deserialize)]
#[serde(rename_all = "lowercase")]
pub enum RoutingProfile {
    Driving,
    Walking,
    Cycling,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(tag = "kind", rename_all = "lowercase")]
pub enum SimulationPlan {
    Teleport {
        point: Coordinate,
    },
    Path {
        points: Vec<Coordinate>,
        options: RouteOptions,
        #[serde(default, rename = "honorTimestamps", alias = "honor_timestamps")]
        honor_timestamps: bool,
        #[serde(default)]
        waypoints: Option<Vec<Coordinate>>,
        #[serde(default, rename = "routingProfile", alias = "routing_profile")]
        routing_profile: Option<RoutingProfile>,
    },
    Gpx {
        points: Vec<Coordinate>,
        options: RouteOptions,
        #[serde(default, rename = "honorTimestamps", alias = "honor_timestamps")]
        honor_timestamps: bool,
    },
    Joystick {
        origin: Coordinate,
        speed_kph: f64,
        heading_degrees: f64,
    },
}

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct LocalPlanRecord {
    pub id: String,
    pub name: String,
    pub created_at: String,
    pub plan: SimulationPlan,
}

#[derive(Debug, Clone, Copy, Serialize, Deserialize, PartialEq, Eq)]
#[serde(rename_all = "snake_case")]
pub enum SimulationState {
    Idle,
    Starting,
    Running,
    Paused,
    Stopping,
    RestoreRequired,
    Error,
}

#[derive(Debug, Clone, Serialize, Deserialize, PartialEq)]
#[serde(rename_all = "camelCase")]
pub struct SimulationSnapshot {
    pub state: SimulationState,
    pub point: Option<Coordinate>,
    pub progress: f64,
    pub elapsed_ms: u64,
    pub remaining_ms: Option<u64>,
    pub error: Option<String>,
}

impl Default for SimulationSnapshot {
    fn default() -> Self {
        Self {
            state: SimulationState::Idle,
            point: None,
            progress: 0.0,
            elapsed_ms: 0,
            remaining_ms: None,
            error: None,
        }
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    fn device(transport: DeviceTransport, os_version: Option<&str>) -> DeviceSummary {
        DeviceSummary {
            id: "opaque".into(),
            name: "iPhone".into(),
            model: None,
            os_version: os_version.map(str::to_string),
            os_build: None,
            transport,
            state: DeviceState::Ready,
            diagnostic_code: None,
        }
    }

    #[test]
    fn accepts_network_devices_as_wifi_candidates() {
        assert!(device(DeviceTransport::Network, Some("18.7.10")).is_same_lan_wifi_candidate());
        assert!(device(DeviceTransport::Network, None).is_same_lan_wifi_candidate());
        assert!(!device(DeviceTransport::Usb, Some("18.7.10")).is_same_lan_wifi_candidate());
    }

    #[test]
    fn tracks_the_physically_validated_same_lan_path_separately() {
        assert!(device(DeviceTransport::Network, Some("27.0")).is_validated_same_lan());
        assert!(!device(DeviceTransport::Usb, Some("27.0")).is_validated_same_lan());
        assert!(!device(DeviceTransport::Network, Some("26.5.2")).is_validated_same_lan());
        assert!(!device(DeviceTransport::Network, None).is_validated_same_lan());
    }

    #[test]
    fn preserves_mapbox_route_metadata_in_saved_plans() {
        let value = serde_json::json!({
            "kind": "path",
            "points": [
                { "latitude": 49.2827, "longitude": -123.1207 },
                { "latitude": 49.3043, "longitude": -123.1443 }
            ],
            "waypoints": [
                { "latitude": 49.2827, "longitude": -123.1207 },
                { "latitude": 49.3043, "longitude": -123.1443 }
            ],
            "routingProfile": "walking",
            "options": {
                "speedKph": 5.0,
                "speedProfile": "constant",
                "repetitions": 1,
                "roundTrip": false,
                "updateIntervalMs": 1000,
                "naturalVariationSeed": null
            }
        });
        let plan: SimulationPlan = serde_json::from_value(value).unwrap();
        let serialized = serde_json::to_value(plan).unwrap();

        assert_eq!(serialized["routingProfile"], "walking");
        assert_eq!(serialized["waypoints"].as_array().unwrap().len(), 2);
    }
}
