#![no_std]

extern crate alloc;

use alloc::{
    format,
    string::{String, ToString},
    vec::Vec,
};
use core::fmt::Display;

const BUILTIN_LOCATIONS: [(&str, &str, &str); 6] = [
    ("Vancouver", "49.2827", "-123.1207"),
    ("San Francisco", "37.7749", "-122.4194"),
    ("New York", "40.7128", "-74.0060"),
    ("London", "51.5074", "-0.1278"),
    ("Tokyo", "35.6762", "139.6503"),
    ("Sydney", "-33.8688", "151.2093"),
];

#[derive(Clone, Debug, Eq, PartialEq)]
pub struct Location {
    pub name: String,
    pub latitude: String,
    pub longitude: String,
}

impl Location {
    pub fn new(
        name: impl Into<String>,
        latitude: impl Into<String>,
        longitude: impl Into<String>,
    ) -> Self {
        Self {
            name: name.into(),
            latitude: latitude.into(),
            longitude: longitude.into(),
        }
    }

    pub fn is_valid(&self) -> bool {
        let latitude = self.latitude.parse::<f64>();
        let longitude = self.longitude.parse::<f64>();
        matches!(latitude, Ok(value) if (-90.0..=90.0).contains(&value))
            && matches!(longitude, Ok(value) if (-180.0..=180.0).contains(&value))
            && !self.name.is_empty()
    }

    pub fn same_coordinates(&self, other: &Self) -> bool {
        self.latitude == other.latitude && self.longitude == other.longitude
    }
}

#[derive(Clone, Debug, Eq, PartialEq)]
pub enum Action {
    Set(Location),
    Restore,
}

#[derive(Clone, Debug, Eq, PartialEq)]
pub struct Outcome {
    pub success: bool,
    pub message: String,
}

impl Outcome {
    pub fn success(message: impl Into<String>) -> Self {
        Self {
            success: true,
            message: message.into(),
        }
    }

    pub fn error(message: impl Into<String>) -> Self {
        Self {
            success: false,
            message: message.into(),
        }
    }
}

pub trait LocationBackend {
    type Error: Display;

    /// Applies and persists a simulated location.
    fn set_location(&mut self, location: &Location) -> Result<(), Self::Error>;

    /// Clears simulation so the connected device resumes its real location.
    fn restore_location(&mut self) -> Result<(), Self::Error>;
}

pub struct Application<B> {
    backend: B,
}

impl<B> Application<B>
where
    B: LocationBackend,
{
    pub fn new(backend: B) -> Self {
        Self { backend }
    }

    pub fn handle(&mut self, action: Action) -> Outcome {
        let result = match action {
            Action::Set(location) => self
                .backend
                .set_location(&location)
                .map(|()| format!("Set: {}", location.name)),
            Action::Restore => self
                .backend
                .restore_location()
                .map(|()| "Real GPS restored".to_string()),
        };

        match result {
            Ok(message) => Outcome::success(message),
            Err(error) => Outcome::error(format!("Error: {error}")),
        }
    }
}

pub fn builtin_locations() -> Vec<Location> {
    BUILTIN_LOCATIONS
        .into_iter()
        .map(|(name, latitude, longitude)| Location::new(name, latitude, longitude))
        .collect()
}

/// Merges valid, unique history entries ahead of the built-in presets.
pub fn merge_catalog(history: impl IntoIterator<Item = Location>) -> Vec<Location> {
    let mut catalog = Vec::new();
    for location in history.into_iter().chain(builtin_locations()) {
        if location.is_valid()
            && !catalog
                .iter()
                .any(|existing: &Location| existing.same_coordinates(&location))
        {
            catalog.push(location);
        }
    }
    catalog
}

pub fn promote(catalog: &mut Vec<Location>, location: &Location) {
    catalog.retain(|existing| !existing.same_coordinates(location));
    catalog.insert(0, location.clone());
}

#[cfg(test)]
mod tests {
    extern crate std;

    use alloc::{string::String, vec};

    use super::*;

    #[test]
    fn history_precedes_and_deduplicates_builtins() {
        let vancouver = Location::new("Saved Vancouver", "49.2827", "-123.1207");
        let custom = Location::new("Home", "48.0000", "-123.0000");
        let catalog = merge_catalog(vec![custom.clone(), vancouver]);

        assert_eq!(catalog.len(), 7);
        assert_eq!(catalog[0], custom);
        assert_eq!(catalog[1].name, "Saved Vancouver");
        assert_eq!(
            catalog
                .iter()
                .filter(|location| location.latitude == "49.2827")
                .count(),
            1
        );
    }

    #[test]
    fn promoted_location_moves_to_front_without_duplication() {
        let mut catalog = builtin_locations();
        let tokyo = catalog[4].clone();
        promote(&mut catalog, &tokyo);

        assert_eq!(catalog[0], tokyo);
        assert_eq!(catalog.len(), 6);
    }

    struct MockBackend {
        fail: bool,
        restored: bool,
    }

    impl LocationBackend for MockBackend {
        type Error = &'static str;

        fn set_location(&mut self, _location: &Location) -> Result<(), Self::Error> {
            if self.fail { Err("offline") } else { Ok(()) }
        }

        fn restore_location(&mut self) -> Result<(), Self::Error> {
            self.restored = true;
            Ok(())
        }
    }

    #[test]
    fn application_reports_backend_results() {
        let mut application = Application::new(MockBackend {
            fail: true,
            restored: false,
        });
        let failed = application.handle(Action::Set(Location::new("Home", "1", "2")));
        assert_eq!(failed.message, String::from("Error: offline"));
        assert!(!failed.success);

        let restored = application.handle(Action::Restore);
        assert_eq!(restored, Outcome::success("Real GPS restored"));
    }
}
