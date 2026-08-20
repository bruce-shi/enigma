//! ESP-IDF implementation of the shared location backend contract.

use std::error::Error;

use enigma_embedded_core::{Location, LocationBackend};
use esp_idf_svc::nvs::EspDefaultNvsPartition;

use crate::{iphone, location_store::LocationStore};

pub struct EspIdfBackend {
    pairing_storage: iphone::PairingStorage,
    location_store: LocationStore,
    controller: Option<iphone::IphoneController>,
}

impl EspIdfBackend {
    pub fn new(
        partition: EspDefaultNvsPartition,
        clear_pairing: bool,
    ) -> Result<Self, Box<dyn Error>> {
        let pairing_storage = iphone::pairing_storage(partition.clone())?;
        let location_store = LocationStore::new(partition)?;
        if clear_pairing {
            iphone::clear_pairing(&pairing_storage)?;
        }
        Ok(Self {
            pairing_storage,
            location_store,
            controller: None,
        })
    }

    pub fn catalog(&self) -> Result<Vec<Location>, Box<dyn Error>> {
        self.location_store.catalog()
    }

    pub fn has_pairing_record(&self) -> Result<bool, Box<dyn Error>> {
        iphone::has_pairing_record(&self.pairing_storage)
    }

    pub fn import_pairing_record(&self, bytes: &[u8]) -> Result<(), Box<dyn Error>> {
        iphone::import_pairing_record(&self.pairing_storage, bytes)
    }

    fn connect_if_needed(&mut self) -> Result<(), Box<dyn Error>> {
        if self.controller.is_none() {
            self.controller = Some(iphone::IphoneController::connect(&self.pairing_storage)?);
        }
        Ok(())
    }
}

impl LocationBackend for EspIdfBackend {
    type Error = Box<dyn Error>;

    fn set_location(&mut self, location: &Location) -> Result<(), Self::Error> {
        let result = (|| {
            self.connect_if_needed()?;
            self.controller
                .as_mut()
                .expect("controller initialized above")
                .set(location)?;
            self.location_store.record(location)
        })();
        if result.is_err() {
            // Discard a potentially stale mux session. The next action makes
            // a fresh connection without requiring a board reset.
            self.controller.take();
        }
        result
    }

    fn restore_location(&mut self) -> Result<(), Self::Error> {
        let result = (|| {
            self.connect_if_needed()?;
            self.controller
                .as_mut()
                .expect("controller initialized above")
                .restore()?;
            Ok(())
        })();
        if result.is_err() {
            self.controller.take();
        }
        result
    }
}
