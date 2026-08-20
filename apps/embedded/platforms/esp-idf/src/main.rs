mod backend;
mod board;
mod boards;
mod idevice_bridge;
mod iphone;
mod location_store;
mod serial_provision;
mod wifi_access;

#[cfg(not(feature = "board-lichuang-esp32s3"))]
compile_error!("select one supported board feature; try `board-lichuang-esp32s3`");

fn main() {
    if let Err(error) = board::run::<boards::SelectedBoard>() {
        log::error!("firmware startup failed: {error}");
        // Keep the UART monitor and the last error alive. Returning from
        // app_main tears down the ESP-IDF main task and can surface on the
        // host as an unrelated serial `Broken pipe` error.
        loop {
            esp_idf_svc::hal::delay::FreeRtos::delay_ms(1_000);
        }
    }
}
