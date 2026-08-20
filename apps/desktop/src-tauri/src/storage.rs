use std::{
    fs::{self, OpenOptions},
    io::{ErrorKind, Write},
    path::Path,
    sync::Mutex,
};

#[cfg(unix)]
use std::os::unix::fs::OpenOptionsExt;

use base64::{Engine as _, engine::general_purpose::STANDARD_NO_PAD};
use chacha20poly1305::{
    Key, KeyInit, XChaCha20Poly1305, XNonce,
    aead::{Aead, Payload},
};
use rusqlite::{Connection, OptionalExtension, params};

const VAULT_KEY_FILE: &str = "local-vault.key";

pub struct EncryptedRecord {
    pub id: String,
    pub created_at: String,
    pub plaintext: Vec<u8>,
}

pub struct LocalVault {
    connection: Mutex<Connection>,
    cipher: XChaCha20Poly1305,
}

impl LocalVault {
    pub fn open(path: &Path) -> Result<Self, String> {
        let key = load_or_create_key(path)?;
        let connection = Connection::open(path).map_err(|error| error.to_string())?;
        connection
            .execute_batch(
                "PRAGMA journal_mode=WAL;
                 PRAGMA foreign_keys=ON;
                 CREATE TABLE IF NOT EXISTS encrypted_records (
                   id TEXT PRIMARY KEY NOT NULL,
                   kind TEXT NOT NULL,
                   display_metadata TEXT NOT NULL DEFAULT '{}',
                   nonce BLOB NOT NULL,
                   ciphertext BLOB NOT NULL,
                   created_at TEXT NOT NULL,
                   updated_at TEXT NOT NULL
                 );
                 CREATE INDEX IF NOT EXISTS encrypted_records_kind_updated
                   ON encrypted_records(kind, updated_at DESC);
                 CREATE TABLE IF NOT EXISTS local_settings (
                   key TEXT PRIMARY KEY NOT NULL,
                   value TEXT NOT NULL
                 );",
            )
            .map_err(|error| error.to_string())?;
        Ok(Self {
            connection: Mutex::new(connection),
            cipher: XChaCha20Poly1305::new(Key::from_slice(&key)),
        })
    }

    pub fn put_encrypted(
        &self,
        id: &str,
        kind: &str,
        display_metadata: &str,
        plaintext: &[u8],
    ) -> Result<(), String> {
        let nonce: [u8; 24] = rand::random();
        let aad = format!("{kind}:{id}");
        let ciphertext = self
            .cipher
            .encrypt(
                XNonce::from_slice(&nonce),
                Payload {
                    msg: plaintext,
                    aad: aad.as_bytes(),
                },
            )
            .map_err(|_| "failed to encrypt local location data".to_string())?;
        let now = time::OffsetDateTime::now_utc()
            .format(&time::format_description::well_known::Rfc3339)
            .map_err(|error| error.to_string())?;
        self.connection
            .lock()
            .map_err(|_| "local database lock was poisoned".to_string())?
            .execute(
                "INSERT INTO encrypted_records
                 (id, kind, display_metadata, nonce, ciphertext, created_at, updated_at)
                 VALUES (?1, ?2, ?3, ?4, ?5, ?6, ?6)
                 ON CONFLICT(id) DO UPDATE SET
                   kind=excluded.kind,
                   display_metadata=excluded.display_metadata,
                   nonce=excluded.nonce,
                   ciphertext=excluded.ciphertext,
                   updated_at=excluded.updated_at",
                params![id, kind, display_metadata, nonce, ciphertext, now],
            )
            .map_err(|error| error.to_string())?;
        Ok(())
    }

    pub fn get_encrypted(&self, id: &str, kind: &str) -> Result<Option<Vec<u8>>, String> {
        let connection = self
            .connection
            .lock()
            .map_err(|_| "local database lock was poisoned".to_string())?;
        let encrypted: Option<(Vec<u8>, Vec<u8>)> = connection
            .query_row(
                "SELECT nonce, ciphertext FROM encrypted_records WHERE id=?1 AND kind=?2",
                params![id, kind],
                |row| Ok((row.get(0)?, row.get(1)?)),
            )
            .optional()
            .map_err(|error| error.to_string())?;
        encrypted
            .map(|(nonce, ciphertext)| self.decrypt(id, kind, &nonce, &ciphertext))
            .transpose()
    }

    pub fn latest_encrypted(&self, kind: &str) -> Result<Option<Vec<u8>>, String> {
        let id: Option<String> = self
            .connection
            .lock()
            .map_err(|_| "local database lock was poisoned".to_string())?
            .query_row(
                "SELECT id FROM encrypted_records WHERE kind=?1 ORDER BY updated_at DESC LIMIT 1",
                [kind],
                |row| row.get(0),
            )
            .optional()
            .map_err(|error| error.to_string())?;
        id.map(|id| self.get_encrypted(&id, kind))
            .transpose()
            .map(Option::flatten)
    }

    pub fn set_dirty_session(&self, dirty: bool) -> Result<(), String> {
        self.set_bool_setting("dirty_session", dirty)
    }

    pub fn has_dirty_session(&self) -> Result<bool, String> {
        self.get_bool_setting("dirty_session")
    }

    pub fn set_crash_reporting_consent(&self, consent: bool) -> Result<(), String> {
        self.set_bool_setting("crash_reporting_consent", consent)
    }

    pub fn has_crash_reporting_consent(&self) -> Result<bool, String> {
        self.get_bool_setting("crash_reporting_consent")
    }

    fn set_bool_setting(&self, key: &str, value: bool) -> Result<(), String> {
        self.connection
            .lock()
            .map_err(|_| "local database lock was poisoned".to_string())?
            .execute(
                "INSERT INTO local_settings(key, value) VALUES (?1, ?2)
                 ON CONFLICT(key) DO UPDATE SET value=excluded.value",
                params![key, if value { "1" } else { "0" }],
            )
            .map_err(|error| error.to_string())?;
        Ok(())
    }

    fn get_bool_setting(&self, key: &str) -> Result<bool, String> {
        let value: Option<String> = self
            .connection
            .lock()
            .map_err(|_| "local database lock was poisoned".to_string())?
            .query_row(
                "SELECT value FROM local_settings WHERE key=?1",
                [key],
                |row| row.get(0),
            )
            .optional()
            .map_err(|error| error.to_string())?;
        Ok(value.as_deref() == Some("1"))
    }

    pub fn should_guard_exit(&self) -> bool {
        self.has_dirty_session().unwrap_or(true)
    }

    pub fn list_encrypted(&self, kind: &str, limit: usize) -> Result<Vec<EncryptedRecord>, String> {
        let encrypted = {
            let connection = self
                .connection
                .lock()
                .map_err(|_| "local database lock was poisoned".to_string())?;
            let mut statement = connection
                .prepare(
                    "SELECT id, created_at, nonce, ciphertext
                     FROM encrypted_records WHERE kind=?1
                     ORDER BY updated_at DESC LIMIT ?2",
                )
                .map_err(|error| error.to_string())?;
            let rows = statement
                .query_map(params![kind, limit as i64], |row| {
                    Ok((
                        row.get::<_, String>(0)?,
                        row.get::<_, String>(1)?,
                        row.get::<_, Vec<u8>>(2)?,
                        row.get::<_, Vec<u8>>(3)?,
                    ))
                })
                .map_err(|error| error.to_string())?;
            rows.collect::<Result<Vec<_>, _>>()
                .map_err(|error| error.to_string())?
        };
        encrypted
            .into_iter()
            .map(|(id, created_at, nonce, ciphertext)| {
                let plaintext = self.decrypt(&id, kind, &nonce, &ciphertext)?;
                Ok(EncryptedRecord {
                    id,
                    created_at,
                    plaintext,
                })
            })
            .collect()
    }

    pub fn delete_encrypted(&self, id: &str, kind: &str) -> Result<(), String> {
        self.connection
            .lock()
            .map_err(|_| "local database lock was poisoned".to_string())?
            .execute(
                "DELETE FROM encrypted_records WHERE id=?1 AND kind=?2",
                params![id, kind],
            )
            .map_err(|error| error.to_string())?;
        Ok(())
    }

    fn decrypt(
        &self,
        id: &str,
        kind: &str,
        nonce: &[u8],
        ciphertext: &[u8],
    ) -> Result<Vec<u8>, String> {
        if nonce.len() != 24 {
            return Err("encrypted record has an invalid nonce".to_string());
        }
        let aad = format!("{kind}:{id}");
        self.cipher
            .decrypt(
                XNonce::from_slice(nonce),
                Payload {
                    msg: ciphertext,
                    aad: aad.as_bytes(),
                },
            )
            .map_err(|_| "local location data could not be decrypted".to_string())
    }
}

fn load_or_create_key(database_path: &Path) -> Result<[u8; 32], String> {
    let data_dir = database_path
        .parent()
        .ok_or_else(|| "local database path has no parent directory".to_string())?;
    let key_path = data_dir.join(VAULT_KEY_FILE);
    let encoded = match fs::read_to_string(&key_path) {
        Ok(value) => value,
        Err(error) if error.kind() == ErrorKind::NotFound => {
            let key: [u8; 32] = rand::random();
            let value = STANDARD_NO_PAD.encode(key);
            let mut options = OpenOptions::new();
            options.write(true).create_new(true);
            #[cfg(unix)]
            options.mode(0o600);
            match options.open(&key_path) {
                Ok(mut file) => {
                    file.write_all(value.as_bytes())
                        .and_then(|()| file.sync_all())
                        .map_err(|error| {
                            format!("could not save the local encryption key: {error}")
                        })?;
                    value
                }
                Err(error) if error.kind() == ErrorKind::AlreadyExists => {
                    fs::read_to_string(&key_path).map_err(|error| {
                        format!("could not read the local encryption key: {error}")
                    })?
                }
                Err(error) => {
                    return Err(format!(
                        "could not create the local encryption key: {error}"
                    ));
                }
            }
        }
        Err(error) => return Err(format!("could not read the local encryption key: {error}")),
    };
    let bytes = STANDARD_NO_PAD
        .decode(encoded.trim())
        .map_err(|_| "local encryption key file is invalid".to_string())?;
    bytes
        .try_into()
        .map_err(|_| "local encryption key has the wrong length".to_string())
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn persists_a_private_file_key_without_authentication() {
        let test_dir =
            std::env::temp_dir().join(format!("enigma-local-vault-{}", uuid::Uuid::new_v4()));
        fs::create_dir_all(&test_dir).unwrap();
        let database_path = test_dir.join("enigma.sqlite");

        let first = load_or_create_key(&database_path).unwrap();
        let second = load_or_create_key(&database_path).unwrap();
        assert_eq!(first, second);

        #[cfg(unix)]
        {
            use std::os::unix::fs::PermissionsExt;

            let mode = fs::metadata(test_dir.join(VAULT_KEY_FILE))
                .unwrap()
                .permissions()
                .mode();
            assert_eq!(mode & 0o777, 0o600);
        }

        fs::remove_dir_all(test_dir).unwrap();
    }

    #[test]
    fn encrypts_payloads_and_authenticates_record_identity() {
        let connection = Connection::open_in_memory().unwrap();
        connection
            .execute_batch(
                "CREATE TABLE encrypted_records (
                   id TEXT PRIMARY KEY NOT NULL, kind TEXT NOT NULL,
                   display_metadata TEXT NOT NULL, nonce BLOB NOT NULL,
                   ciphertext BLOB NOT NULL, created_at TEXT NOT NULL, updated_at TEXT NOT NULL
                 );
                 CREATE TABLE local_settings (key TEXT PRIMARY KEY NOT NULL, value TEXT NOT NULL);",
            )
            .unwrap();
        let key = [7_u8; 32];
        let vault = LocalVault {
            connection: Mutex::new(connection),
            cipher: XChaCha20Poly1305::new(Key::from_slice(&key)),
        };
        vault
            .put_encrypted("route-1", "route", "{}", b"49.2,-123.1")
            .unwrap();
        assert_eq!(
            vault.get_encrypted("route-1", "route").unwrap(),
            Some(b"49.2,-123.1".to_vec())
        );
        assert_eq!(vault.get_encrypted("route-1", "history").unwrap(), None);
        assert_eq!(
            vault.latest_encrypted("route").unwrap(),
            Some(b"49.2,-123.1".to_vec())
        );
        let records = vault.list_encrypted("route", 20).unwrap();
        assert_eq!(records.len(), 1);
        assert_eq!(records[0].id, "route-1");
        assert_eq!(records[0].plaintext, b"49.2,-123.1");
        vault.delete_encrypted("route-1", "route").unwrap();
        assert!(vault.list_encrypted("route", 20).unwrap().is_empty());
        vault.set_dirty_session(true).unwrap();
        assert!(vault.has_dirty_session().unwrap());
        assert!(vault.should_guard_exit());
        vault.set_dirty_session(false).unwrap();
        assert!(!vault.should_guard_exit());
        assert!(!vault.has_crash_reporting_consent().unwrap());
        vault.set_crash_reporting_consent(true).unwrap();
        assert!(vault.has_crash_reporting_consent().unwrap());
        vault.set_crash_reporting_consent(false).unwrap();
        assert!(!vault.has_crash_reporting_consent().unwrap());
    }
}
