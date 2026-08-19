mod idevice_runtime;

pub use idevice_runtime::DeviceRuntime;

use async_trait::async_trait;

use crate::model::{Coordinate, DeviceSummary};

#[async_trait]
pub trait DeviceAdapter: Send + Sync {
    async fn list_devices(&self) -> Result<Vec<DeviceSummary>, String>;
    async fn connect_device(&self, device_id: &str) -> Result<DeviceSummary, String>;
    async fn disconnect_device(&self) -> Result<(), String>;
    async fn set_location(&self, point: Coordinate) -> Result<(), String>;
    async fn clear_location(&self) -> Result<(), String>;
}
