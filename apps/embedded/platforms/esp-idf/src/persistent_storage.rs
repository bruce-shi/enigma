//! User-owned NVS stored beyond the factory application image.
//!
//! Release firmware is distributed as a merged image starting at flash offset
//! zero. Gaps inside that image are padded, so the default NVS partition before
//! the factory app is not a safe home for state that must survive reflashing.

use std::error::Error;

use enigma_embedded_bridge_protocol::MAX_PAIRING_RECORD_BYTES;
use esp_idf_svc::nvs::{EspCustomNvsPartition, EspDefaultNvsPartition, EspKeyValueStorage, EspNvs};

pub const PARTITION_LABEL: &str = "userdata";
pub type PersistentNvsPartition = EspCustomNvsPartition;

pub fn take_and_migrate(
    legacy_partition: EspDefaultNvsPartition,
) -> Result<PersistentNvsPartition, Box<dyn Error>> {
    let persistent_partition = EspCustomNvsPartition::take(PARTITION_LABEL)?;
    let mut migrated = 0usize;
    migrated += migrate_namespace(
        legacy_partition.clone(),
        persistent_partition.clone(),
        "idevice",
        &[
            ("pair_record", MAX_PAIRING_RECORD_BYTES),
            ("rp_record", MAX_PAIRING_RECORD_BYTES),
        ],
    )?;
    migrated += migrate_namespace(
        legacy_partition.clone(),
        persistent_partition.clone(),
        "upstream",
        &[("ssid", 64), ("password", 64)],
    )?;
    migrated += migrate_namespace(
        legacy_partition.clone(),
        persistent_partition.clone(),
        "locations",
        &[
            ("recent0", 128),
            ("recent1", 128),
            ("recent2", 128),
            ("recent3", 128),
            ("recent4", 128),
            ("recent5", 128),
        ],
    )?;
    migrated += migrate_namespace(
        legacy_partition,
        persistent_partition.clone(),
        "citymaps",
        &[("active", 128)],
    )?;
    log::info!("persistent userdata partition ready; migrated {migrated} legacy values");
    Ok(persistent_partition)
}

fn migrate_namespace(
    legacy_partition: EspDefaultNvsPartition,
    persistent_partition: PersistentNvsPartition,
    namespace: &str,
    keys: &[(&str, usize)],
) -> Result<usize, Box<dyn Error>> {
    // Open the legacy namespace read/write because an absent namespace cannot
    // be opened read-only. Migration never removes or changes legacy values.
    let legacy = EspKeyValueStorage::new(EspNvs::new(legacy_partition, namespace, true)?);
    let persistent = EspKeyValueStorage::new(EspNvs::new(persistent_partition, namespace, true)?);
    let mut migrated = 0usize;
    for (key, capacity) in keys {
        if persistent.contains(key)? {
            continue;
        }
        let mut buffer = vec![0u8; *capacity];
        if let Some(value) = legacy.get_raw(key, &mut buffer)? {
            persistent.set_raw(key, value)?;
            migrated += 1;
        }
    }
    Ok(migrated)
}
