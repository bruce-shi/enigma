#![no_std]

extern crate alloc;

use alloc::{format, string::String, vec::Vec};
use core::fmt::{self, Display};
use sha2::{Digest, Sha256};

pub const READY_LINE: &str = "ENIGMA_PROVISION_READY";
pub const OK_PREFIX: &str = "ENIGMA_PROVISION_OK";
pub const ERROR_PREFIX: &str = "ENIGMA_PROVISION_ERROR";
pub const HEADER_PREFIX: &str = "ENIGMA-PROVISION/1";
pub const MAX_PAIRING_RECORD_BYTES: usize = 24 * 1024;
const PAIRING_BUNDLE_MAGIC: &[u8] = b"ENIGMA-PAIR/2\0";

#[derive(Clone, Copy, Debug, Eq, PartialEq)]
pub struct PairingBundle<'a> {
    pub lockdown: &'a [u8],
    pub remote: Option<&'a [u8]>,
}

#[derive(Clone, Debug, Eq, PartialEq)]
pub struct Header {
    pub payload_len: usize,
    pub sha256: String,
}

#[derive(Clone, Copy, Debug, Eq, PartialEq)]
pub enum ProtocolError {
    BadHeader,
    BadLength,
    BadDigest,
    BadPairingBundle,
    PayloadTooLarge,
}

impl Display for ProtocolError {
    fn fmt(&self, formatter: &mut fmt::Formatter<'_>) -> fmt::Result {
        formatter.write_str(match self {
            Self::BadHeader => "invalid provisioning header",
            Self::BadLength => "invalid pairing-record length",
            Self::BadDigest => "invalid pairing-record SHA-256",
            Self::BadPairingBundle => "invalid pairing identity bundle",
            Self::PayloadTooLarge => "pairing record exceeds the provisioning limit",
        })
    }
}

pub fn encode_pairing_bundle(lockdown: &[u8], remote: &[u8]) -> Result<Vec<u8>, ProtocolError> {
    if lockdown.is_empty() || remote.is_empty() || lockdown.len() > u32::MAX as usize {
        return Err(ProtocolError::BadPairingBundle);
    }
    let payload_len = PAIRING_BUNDLE_MAGIC.len() + 4 + lockdown.len() + remote.len();
    validate_payload_len(payload_len)?;

    let mut payload = Vec::with_capacity(payload_len);
    payload.extend_from_slice(PAIRING_BUNDLE_MAGIC);
    payload.extend_from_slice(&(lockdown.len() as u32).to_be_bytes());
    payload.extend_from_slice(lockdown);
    payload.extend_from_slice(remote);
    Ok(payload)
}

pub fn decode_pairing_bundle(payload: &[u8]) -> Result<PairingBundle<'_>, ProtocolError> {
    validate_payload_len(payload.len())?;
    if !payload.starts_with(PAIRING_BUNDLE_MAGIC) {
        return Ok(PairingBundle {
            lockdown: payload,
            remote: None,
        });
    }
    let length_offset = PAIRING_BUNDLE_MAGIC.len();
    let lockdown_len = payload
        .get(length_offset..length_offset + 4)
        .and_then(|bytes| bytes.try_into().ok())
        .map(u32::from_be_bytes)
        .ok_or(ProtocolError::BadPairingBundle)? as usize;
    let lockdown_start = length_offset + 4;
    let remote_start = lockdown_start
        .checked_add(lockdown_len)
        .ok_or(ProtocolError::BadPairingBundle)?;
    let lockdown = payload
        .get(lockdown_start..remote_start)
        .filter(|bytes| !bytes.is_empty())
        .ok_or(ProtocolError::BadPairingBundle)?;
    let remote = payload
        .get(remote_start..)
        .filter(|bytes| !bytes.is_empty())
        .ok_or(ProtocolError::BadPairingBundle)?;
    Ok(PairingBundle {
        lockdown,
        remote: Some(remote),
    })
}

pub fn sha256_hex(payload: &[u8]) -> String {
    let digest = Sha256::digest(payload);
    let mut output = String::with_capacity(digest.len() * 2);
    for byte in digest {
        use core::fmt::Write;
        write!(output, "{byte:02x}").expect("writing to a String cannot fail");
    }
    output
}

pub fn encode_header(payload: &[u8]) -> Result<String, ProtocolError> {
    validate_payload_len(payload.len())?;
    Ok(format!(
        "{HEADER_PREFIX} {} {}\n",
        payload.len(),
        sha256_hex(payload)
    ))
}

pub fn parse_header(line: &str) -> Result<Header, ProtocolError> {
    let mut fields = line.trim().split_ascii_whitespace();
    if fields.next() != Some(HEADER_PREFIX) {
        return Err(ProtocolError::BadHeader);
    }
    let payload_len = fields
        .next()
        .ok_or(ProtocolError::BadLength)?
        .parse::<usize>()
        .map_err(|_| ProtocolError::BadLength)?;
    validate_payload_len(payload_len)?;
    let sha256 = fields.next().ok_or(ProtocolError::BadDigest)?;
    if sha256.len() != 64
        || !sha256
            .as_bytes()
            .iter()
            .all(|byte| byte.is_ascii_hexdigit())
        || fields.next().is_some()
    {
        return Err(ProtocolError::BadDigest);
    }
    Ok(Header {
        payload_len,
        sha256: sha256.to_ascii_lowercase(),
    })
}

pub fn verify_payload(header: &Header, payload: &[u8]) -> Result<(), ProtocolError> {
    if payload.len() != header.payload_len {
        return Err(ProtocolError::BadLength);
    }
    if sha256_hex(payload) != header.sha256 {
        return Err(ProtocolError::BadDigest);
    }
    Ok(())
}

pub fn success_line(payload: &[u8]) -> String {
    format!("{OK_PREFIX} {}", sha256_hex(payload))
}

fn validate_payload_len(payload_len: usize) -> Result<(), ProtocolError> {
    if payload_len == 0 {
        Err(ProtocolError::BadLength)
    } else if payload_len > MAX_PAIRING_RECORD_BYTES {
        Err(ProtocolError::PayloadTooLarge)
    } else {
        Ok(())
    }
}

#[cfg(test)]
mod tests {
    extern crate std;

    use super::*;

    #[test]
    fn header_round_trips_and_verifies_payload() {
        let payload = b"trusted pairing record";
        let encoded = encode_header(payload).unwrap();
        let header = parse_header(&encoded).unwrap();

        assert_eq!(header.payload_len, payload.len());
        assert_eq!(header.sha256.len(), 64);
        assert_eq!(verify_payload(&header, payload), Ok(()));
    }

    #[test]
    fn rejects_truncated_or_modified_payloads() {
        let payload = b"pairing record";
        let header = parse_header(&encode_header(payload).unwrap()).unwrap();

        assert_eq!(
            verify_payload(&header, b"pairing recor"),
            Err(ProtocolError::BadLength)
        );
        assert_eq!(
            verify_payload(&header, b"pairing rec0rd"),
            Err(ProtocolError::BadDigest)
        );
    }

    #[test]
    fn rejects_oversized_records() {
        let payload = alloc::vec![0; MAX_PAIRING_RECORD_BYTES + 1];
        assert_eq!(encode_header(&payload), Err(ProtocolError::PayloadTooLarge));
    }

    #[test]
    fn pairing_bundle_round_trips_both_apple_identities() {
        let payload = encode_pairing_bundle(b"lockdown", b"remote").unwrap();
        assert_eq!(
            decode_pairing_bundle(&payload),
            Ok(PairingBundle {
                lockdown: b"lockdown",
                remote: Some(b"remote"),
            })
        );
    }

    #[test]
    fn legacy_pairing_payload_remains_readable_for_migration() {
        assert_eq!(
            decode_pairing_bundle(b"legacy plist"),
            Ok(PairingBundle {
                lockdown: b"legacy plist",
                remote: None,
            })
        );
    }

    #[test]
    fn pairing_bundle_rejects_missing_remote_identity() {
        let mut payload = PAIRING_BUNDLE_MAGIC.to_vec();
        payload.extend_from_slice(&1_u32.to_be_bytes());
        payload.push(b'x');
        assert_eq!(
            decode_pairing_bundle(&payload),
            Err(ProtocolError::BadPairingBundle)
        );
    }
}
