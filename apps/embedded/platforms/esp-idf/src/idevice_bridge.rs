//! Build-visible metadata for the pinned `idevice` protocol layer.

use idevice::provider::TcpProvider;

pub const IDEVICE_REVISION: &str = "63a341d7f624b5c1f2540e4cecb269151a2caf52";

/// A runtime-visible symbol proving that the network provider was compiled into
/// the firmware, rather than merely mentioned in documentation.
pub fn linked_protocol() -> &'static str {
    core::any::type_name::<TcpProvider>()
}
