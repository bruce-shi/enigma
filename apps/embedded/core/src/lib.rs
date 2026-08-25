#![no_std]

extern crate alloc;

use alloc::{
    format,
    string::{String, ToString},
    vec::Vec,
};
use core::fmt::Display;

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
    Save(Location),
    Restore,
}

#[derive(Clone, Copy, Debug, Eq, PartialEq)]
pub enum PinKey {
    Digit(u8),
    Clear,
    Submit,
}

#[derive(Clone, Copy, Debug, Eq, PartialEq)]
pub enum PinResult {
    Pending,
    Accepted,
    Rejected,
}

/// Small allocation-free PIN gate shared by embedded user interfaces.
///
/// The expected PIN is still a firmware constant in the first prototype. This
/// type keeps input handling independent from a specific display or touch
/// controller so a later settings-backed credential can replace it cleanly.
pub struct PinGate<const N: usize> {
    expected: [u8; N],
    entered: [u8; N],
    entered_len: usize,
}

impl<const N: usize> PinGate<N> {
    pub fn new(expected: [u8; N]) -> Self {
        assert!(N > 0, "PIN must contain at least one digit");
        assert!(
            expected.iter().all(|digit| *digit <= 9),
            "invalid PIN digit"
        );
        Self {
            expected,
            entered: [0; N],
            entered_len: 0,
        }
    }

    pub fn entered_len(&self) -> usize {
        self.entered_len
    }

    pub fn clear(&mut self) {
        self.entered.fill(0);
        self.entered_len = 0;
    }

    pub fn apply(&mut self, key: PinKey) -> PinResult {
        match key {
            PinKey::Digit(digit) if digit <= 9 && self.entered_len < N => {
                self.entered[self.entered_len] = digit;
                self.entered_len += 1;
                if self.entered_len == N {
                    self.submit()
                } else {
                    PinResult::Pending
                }
            }
            PinKey::Digit(_) => PinResult::Pending,
            PinKey::Clear => {
                self.clear();
                PinResult::Pending
            }
            PinKey::Submit => self.submit(),
        }
    }

    fn submit(&mut self) -> PinResult {
        let mut difference = u8::from(self.entered_len != N);
        for (entered, expected) in self.entered.iter().zip(self.expected.iter()) {
            difference |= entered ^ expected;
        }
        self.clear();
        if difference == 0 {
            PinResult::Accepted
        } else {
            PinResult::Rejected
        }
    }
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

    /// Persists a location without changing the connected device.
    fn save_location(&mut self, location: &Location) -> Result<(), Self::Error>;

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
            Action::Save(location) => self
                .backend
                .save_location(&location)
                .map(|()| format!("Saved: {}", location.name)),
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

/// Parses local-only presets supplied by the platform build environment.
///
/// Each record is `name|latitude|longitude`, separated by semicolons. Invalid
/// records are ignored so a malformed private entry cannot prevent boot.
pub fn parse_location_presets(encoded: &str) -> Vec<Location> {
    encoded
        .split(';')
        .filter_map(|record| {
            let mut fields = record.split('|');
            let location = Location::new(fields.next()?, fields.next()?, fields.next()?);
            (fields.next().is_none() && location.is_valid()).then_some(location)
        })
        .collect()
}

/// Collects valid, unique saved and private locations into the board catalog.
pub fn merge_catalog(locations: impl IntoIterator<Item = Location>) -> Vec<Location> {
    let mut catalog = Vec::new();
    for location in locations {
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
    fn catalog_preserves_order_and_deduplicates_coordinates() {
        let vancouver = Location::new("Vancouver", "49.2827", "-123.1207");
        let duplicate = Location::new("Saved Vancouver", "49.2827", "-123.1207");
        let custom = Location::new("Home", "48.0000", "-123.0000");
        let catalog = merge_catalog(vec![custom.clone(), vancouver.clone(), duplicate]);

        assert_eq!(catalog.len(), 2);
        assert_eq!(catalog[0], custom);
        assert_eq!(catalog[1], vancouver);
    }

    #[test]
    fn parses_valid_private_presets() {
        let presets = parse_location_presets(
            "Private A|49.25|-123.1;invalid;Private B|49.15|-123.0;Bad|91|0",
        );

        assert_eq!(presets.len(), 2);
        assert_eq!(presets[0], Location::new("Private A", "49.25", "-123.1"));
        assert_eq!(presets[1], Location::new("Private B", "49.15", "-123.0"));
    }

    #[test]
    fn promoted_location_moves_to_front_without_duplication() {
        let home = Location::new("Home", "49.25", "-123.1");
        let cinema = Location::new("Cinema", "49.15", "-123.0");
        let mut catalog = vec![home.clone(), cinema.clone()];
        promote(&mut catalog, &cinema);

        assert_eq!(catalog[0], cinema);
        assert_eq!(catalog[1], home);
        assert_eq!(catalog.len(), 2);
    }

    struct MockBackend {
        fail: bool,
        restored: bool,
        saved: Option<Location>,
    }

    impl LocationBackend for MockBackend {
        type Error = &'static str;

        fn set_location(&mut self, _location: &Location) -> Result<(), Self::Error> {
            if self.fail { Err("offline") } else { Ok(()) }
        }

        fn save_location(&mut self, location: &Location) -> Result<(), Self::Error> {
            self.saved = Some(location.clone());
            Ok(())
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
            saved: None,
        });
        let failed = application.handle(Action::Set(Location::new("Home", "1", "2")));
        assert_eq!(failed.message, String::from("Error: offline"));
        assert!(!failed.success);

        let restored = application.handle(Action::Restore);
        assert_eq!(restored, Outcome::success("Real GPS restored"));

        let saved = application.handle(Action::Save(Location::new("Home", "1", "2")));
        assert_eq!(saved, Outcome::success("Saved: Home"));
    }

    #[test]
    fn pin_gate_accepts_only_the_complete_expected_pin() {
        let mut gate = PinGate::new([1, 2, 3, 4]);
        for digit in [1, 2, 3] {
            assert_eq!(gate.apply(PinKey::Digit(digit)), PinResult::Pending);
        }
        assert_eq!(gate.entered_len(), 3);
        assert_eq!(gate.apply(PinKey::Digit(4)), PinResult::Accepted);
        assert_eq!(gate.entered_len(), 0);
    }

    #[test]
    fn pin_gate_clears_input_after_rejection_or_clear() {
        let mut gate = PinGate::new([1, 2, 3, 4]);
        assert_eq!(gate.apply(PinKey::Digit(1)), PinResult::Pending);
        assert_eq!(gate.apply(PinKey::Submit), PinResult::Rejected);
        assert_eq!(gate.entered_len(), 0);

        assert_eq!(gate.apply(PinKey::Digit(9)), PinResult::Pending);
        assert_eq!(gate.apply(PinKey::Clear), PinResult::Pending);
        assert_eq!(gate.entered_len(), 0);

        for digit in [1, 2, 3, 9] {
            let result = gate.apply(PinKey::Digit(digit));
            if digit == 9 {
                assert_eq!(result, PinResult::Rejected);
            } else {
                assert_eq!(result, PinResult::Pending);
            }
        }
        assert_eq!(gate.entered_len(), 0);
    }
}
