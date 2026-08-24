//! ESP-IDF NVS-backed recent-location storage.

use std::{error::Error, str};

use enigma_embedded_core::{Location, merge_catalog};
use esp_idf_svc::nvs::{EspDefaultNvsPartition, EspKeyValueStorage, EspNvs, NvsDefault};

const HISTORY_KEYS: [&str; 6] = [
    "recent0", "recent1", "recent2", "recent3", "recent4", "recent5",
];
pub const MAX_SAVED_LOCATIONS: usize = HISTORY_KEYS.len();
const RECORD_BYTES: usize = 128;
const FIELD_SEPARATOR: char = '\u{1f}';

pub struct LocationStore {
    storage: EspKeyValueStorage<NvsDefault>,
}

impl LocationStore {
    pub fn new(partition: EspDefaultNvsPartition) -> Result<Self, Box<dyn Error>> {
        let nvs = EspNvs::new(partition, "locations", true)?;
        Ok(Self {
            storage: EspKeyValueStorage::new(nvs),
        })
    }

    /// Returns saved recent locations first, followed by built-in presets.
    pub fn catalog(&self) -> Result<Vec<Location>, Box<dyn Error>> {
        Ok(merge_catalog(self.saved_locations()?))
    }

    pub fn saved_locations(&self) -> Result<Vec<Location>, Box<dyn Error>> {
        self.history()
    }

    /// Records a location as the newest entry.
    pub fn record(&self, location: &Location) -> Result<(), Box<dyn Error>> {
        if !location.is_valid() {
            return Err("invalid location cannot be recorded".into());
        }

        let mut history = self.history()?;
        history.retain(|existing| !existing.same_coordinates(location));
        history.insert(0, location.clone());
        history.truncate(MAX_SAVED_LOCATIONS);

        for (index, key) in HISTORY_KEYS.iter().enumerate() {
            if let Some(location) = history.get(index) {
                let record = encode(location)?;
                self.storage.set_raw(key, record.as_bytes())?;
            } else {
                let _ = self.storage.remove(key)?;
            }
        }
        Ok(())
    }

    fn history(&self) -> Result<Vec<Location>, Box<dyn Error>> {
        let mut history = Vec::new();
        for key in HISTORY_KEYS {
            let mut buffer = [0u8; RECORD_BYTES];
            let Some(bytes) = self.storage.get_raw(key, &mut buffer)? else {
                continue;
            };
            let Some(location) = decode(str::from_utf8(bytes)?) else {
                log::warn!("ignoring invalid saved location in NVS key {key}");
                continue;
            };
            if !history
                .iter()
                .any(|existing: &Location| existing.same_coordinates(&location))
            {
                history.push(location);
            }
        }
        Ok(history)
    }
}

fn encode(location: &Location) -> Result<String, Box<dyn Error>> {
    if location.name.contains(FIELD_SEPARATOR)
        || location.latitude.contains(FIELD_SEPARATOR)
        || location.longitude.contains(FIELD_SEPARATOR)
    {
        return Err("location contains reserved separator".into());
    }
    let encoded = format!(
        "{}{}{}{}{}",
        location.name, FIELD_SEPARATOR, location.latitude, FIELD_SEPARATOR, location.longitude
    );
    if encoded.len() >= RECORD_BYTES {
        return Err("location record is too long".into());
    }
    Ok(encoded)
}

fn decode(record: &str) -> Option<Location> {
    let mut fields = record.split(FIELD_SEPARATOR);
    let location = Location::new(fields.next()?, fields.next()?, fields.next()?);
    (fields.next().is_none() && location.is_valid()).then_some(location)
}
