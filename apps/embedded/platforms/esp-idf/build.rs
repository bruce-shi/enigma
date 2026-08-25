use std::{env, fs, path::PathBuf};

const PRIVATE_LOCATIONS_KEY: &str = "ENIGMA_PRIVATE_LOCATIONS";

fn dotenv_value(contents: &str, requested_key: &str) -> Option<String> {
    contents.lines().find_map(|line| {
        let line = line.trim();
        if line.is_empty() || line.starts_with('#') {
            return None;
        }
        let line = line.strip_prefix("export ").unwrap_or(line);
        let (key, raw_value) = line.split_once('=')?;
        if key.trim() != requested_key {
            return None;
        }
        let value = raw_value.trim();
        let value = value
            .strip_prefix('"')
            .and_then(|value| value.strip_suffix('"'))
            .or_else(|| {
                value
                    .strip_prefix('\'')
                    .and_then(|value| value.strip_suffix('\''))
            })
            .unwrap_or(value);
        (!value.is_empty()).then(|| value.to_owned())
    })
}

fn main() {
    embuild::espidf::sysenv::output();

    let env_path =
        PathBuf::from(env::var_os("CARGO_MANIFEST_DIR").expect("manifest directory")).join(".env");
    println!("cargo:rerun-if-changed={}", env_path.display());
    println!("cargo:rerun-if-env-changed={PRIVATE_LOCATIONS_KEY}");
    let private_locations = env::var(PRIVATE_LOCATIONS_KEY).ok().or_else(|| {
        fs::read_to_string(&env_path)
            .ok()
            .and_then(|contents| dotenv_value(&contents, PRIVATE_LOCATIONS_KEY))
    });
    if let Some(private_locations) = private_locations {
        println!("cargo:rustc-env={PRIVATE_LOCATIONS_KEY}={private_locations}");
    }
}
