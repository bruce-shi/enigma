use std::f64::consts::PI;

use crate::model::{Coordinate, RouteOptions, SpeedProfile};

const EARTH_RADIUS_METERS: f64 = 6_371_008.8;
const MAX_ROUTE_SAMPLES: usize = 100_000;

pub fn distance_meters(start: Coordinate, end: Coordinate) -> f64 {
    let lat1 = start.latitude.to_radians();
    let lat2 = end.latitude.to_radians();
    let delta_lat = lat2 - lat1;
    let delta_lon = normalize_longitude(end.longitude - start.longitude).to_radians();
    let a =
        (delta_lat / 2.0).sin().powi(2) + lat1.cos() * lat2.cos() * (delta_lon / 2.0).sin().powi(2);
    2.0 * EARTH_RADIUS_METERS * a.sqrt().min(1.0).asin()
}

pub fn interpolate(start: Coordinate, end: Coordinate, fraction: f64) -> Coordinate {
    let lat1 = start.latitude.to_radians();
    let lon1 = start.longitude.to_radians();
    let lat2 = end.latitude.to_radians();
    let lon2 = end.longitude.to_radians();
    let angular = distance_meters(start, end) / EARTH_RADIUS_METERS;
    if angular.abs() < f64::EPSILON {
        return start;
    }
    let a = ((1.0 - fraction) * angular).sin() / angular.sin();
    let b = (fraction * angular).sin() / angular.sin();
    let x = a * lat1.cos() * lon1.cos() + b * lat2.cos() * lon2.cos();
    let y = a * lat1.cos() * lon1.sin() + b * lat2.cos() * lon2.sin();
    let z = a * lat1.sin() + b * lat2.sin();
    Coordinate {
        latitude: z.atan2((x * x + y * y).sqrt()).to_degrees(),
        longitude: normalize_longitude(y.atan2(x).to_degrees()),
        altitude_meters: match (start.altitude_meters, end.altitude_meters) {
            (Some(start), Some(end)) => Some(start + (end - start) * fraction),
            _ => None,
        },
    }
}

pub fn route_samples(
    points: &[Coordinate],
    options: &RouteOptions,
) -> Result<Vec<Coordinate>, String> {
    if points.len() < 2 {
        return Err("a route needs at least two points".into());
    }
    if !(0.4..=108.0).contains(&options.speed_kph) {
        return Err("speed must be between 0.4 and 108 km/h".into());
    }
    if options.repetitions == 0 || options.update_interval_ms != 1000 {
        return Err("routes require at least one repetition and a 1000 ms update interval".into());
    }
    for point in points {
        point.validate()?;
    }
    let mut base = points.to_vec();
    if options.round_trip {
        base.extend(points[..points.len() - 1].iter().rev().copied());
    }
    let mut output = vec![base[0]];
    let mut sample_index = 0_u64;
    for repetition in 0..options.repetitions {
        if repetition > 0 && output.last() != base.first() {
            ensure_sample_capacity(output.len())?;
            output.push(base[0]);
        }
        for segment in base.windows(2) {
            let start = segment[0];
            let end = segment[1];
            let length = distance_meters(start, end);
            let mut traveled: f64 = 0.0;
            while traveled < length {
                let speed = match options.speed_profile {
                    SpeedProfile::Constant => options.speed_kph,
                    SpeedProfile::Natural => {
                        options.speed_kph
                            * deterministic_variation(
                                options.natural_variation_seed.unwrap_or(1),
                                sample_index,
                            )
                    }
                };
                traveled = (traveled + speed * 1000.0 / 3600.0).min(length);
                ensure_sample_capacity(output.len())?;
                output.push(interpolate(start, end, traveled / length));
                sample_index += 1;
            }
        }
    }
    Ok(output)
}

fn ensure_sample_capacity(length: usize) -> Result<(), String> {
    if length >= MAX_ROUTE_SAMPLES {
        return Err(
            "route exceeds 100,000 updates; increase speed, shorten the route, or reduce repetitions"
                .into(),
        );
    }
    Ok(())
}

fn deterministic_variation(seed: u64, index: u64) -> f64 {
    let angle = seed as f64 * 12.9898 + index as f64 * 78.233;
    let raw = angle.sin() * 43_758.5453;
    let value = raw - raw.floor();
    0.95 + value * 0.1
}

fn normalize_longitude(longitude: f64) -> f64 {
    (longitude + 180.0).rem_euclid(360.0) - 180.0
}

pub fn advance_joystick(
    origin: Coordinate,
    heading_degrees: f64,
    speed_kph: f64,
) -> Result<Coordinate, String> {
    origin.validate()?;
    if !(0.4..=108.0).contains(&speed_kph) {
        return Err("speed must be between 0.4 and 108 km/h".into());
    }
    let distance = speed_kph * 1000.0 / 3600.0;
    let angular = distance / EARTH_RADIUS_METERS;
    let bearing = heading_degrees.rem_euclid(360.0) * PI / 180.0;
    let lat1 = origin.latitude.to_radians();
    let lon1 = origin.longitude.to_radians();
    let lat2 = (lat1.sin() * angular.cos() + lat1.cos() * angular.sin() * bearing.cos()).asin();
    let lon2 = lon1
        + (bearing.sin() * angular.sin() * lat1.cos())
            .atan2(angular.cos() - lat1.sin() * lat2.sin());
    Ok(Coordinate {
        latitude: lat2.to_degrees(),
        longitude: normalize_longitude(lon2.to_degrees()),
        altitude_meters: origin.altitude_meters,
    })
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn crosses_antimeridian_on_short_arc() {
        let midpoint = interpolate(
            Coordinate {
                latitude: 0.0,
                longitude: 179.0,
                altitude_meters: None,
            },
            Coordinate {
                latitude: 0.0,
                longitude: -179.0,
                altitude_meters: None,
            },
            0.5,
        );
        assert!((midpoint.longitude.abs() - 180.0).abs() < 0.00001);
    }

    #[test]
    fn joystick_moves_one_meter_at_three_point_six_kph() {
        let origin = Coordinate {
            latitude: 49.2827,
            longitude: -123.1207,
            altitude_meters: None,
        };
        let next = advance_joystick(origin, 0.0, 3.6).unwrap();
        assert!((distance_meters(origin, next) - 1.0).abs() < 0.01);
    }

    fn route_options(repetitions: u32, round_trip: bool) -> RouteOptions {
        RouteOptions {
            speed_kph: 108.0,
            speed_profile: SpeedProfile::Constant,
            repetitions,
            round_trip,
            update_interval_ms: 1000,
            natural_variation_seed: None,
        }
    }

    #[test]
    fn repetitions_replay_from_start_and_round_trips_end_at_start() {
        let start = Coordinate {
            latitude: 0.0,
            longitude: 0.0,
            altitude_meters: None,
        };
        let end = Coordinate {
            latitude: 0.0,
            longitude: 0.00001,
            altitude_meters: None,
        };
        let repeated = route_samples(&[start, end], &route_options(2, false)).unwrap();
        assert_eq!(repeated.iter().filter(|point| **point == start).count(), 2);
        assert!(distance_meters(*repeated.last().unwrap(), end) < 0.01);

        let round_trip = route_samples(&[start, end], &route_options(2, true)).unwrap();
        assert!(distance_meters(*round_trip.last().unwrap(), start) < 0.01);
    }

    #[test]
    fn rejects_routes_that_would_allocate_too_many_updates() {
        let start = Coordinate {
            latitude: 0.0,
            longitude: 0.0,
            altitude_meters: None,
        };
        let end = Coordinate {
            latitude: 0.0,
            longitude: 1.0,
            altitude_meters: None,
        };
        let error = route_samples(
            &[start, end],
            &RouteOptions {
                speed_kph: 0.4,
                speed_profile: SpeedProfile::Constant,
                repetitions: 1,
                round_trip: false,
                update_interval_ms: 1000,
                natural_variation_seed: None,
            },
        )
        .unwrap_err();
        assert!(error.contains("100,000 updates"));
    }
}
