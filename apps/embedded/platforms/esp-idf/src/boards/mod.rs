//! Compile-time board selection for the ESP-IDF firmware image.

#[cfg(feature = "board-lichuang-esp32s3")]
pub mod lichuang_esp32s3;

#[cfg(feature = "board-lichuang-esp32s3")]
pub use lichuang_esp32s3::LichuangEsp32S3 as SelectedBoard;
