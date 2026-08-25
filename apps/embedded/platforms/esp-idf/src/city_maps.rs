//! Bundled and installable offline city-map storage.

use std::{error::Error, str, time::Duration};

use embedded_svc::http::client::Client as HttpClient;
use esp_idf_svc::{
    http::{
        Method,
        client::{Configuration as HttpConfiguration, EspHttpConnection},
    },
    nvs::{EspKeyValueStorage, EspNvs, NvsCustom},
    partition::EspPartition,
    sys,
};

use crate::persistent_storage::PersistentNvsPartition;
use sha2::{Digest, Sha256};

const PARTITION_LABEL: &str = "mapdata";
const ACTIVE_NAMESPACE: &str = "citymaps";
const ACTIVE_KEY: &str = "active";
const HEADER_BYTES: usize = 256;
const HEADER_MAGIC: &[u8; 16] = b"ENIGMA-CITY-V3\0\0";
const ID_OFFSET: usize = 52;
const ID_BYTES: usize = 32;
const NAME_OFFSET: usize = 84;
const NAME_BYTES: usize = 64;
const BOUNDS_OFFSET: usize = 148;
const WIDTH_OFFSET: usize = 180;
const HEIGHT_OFFSET: usize = 182;
const DETAIL_BYTES_OFFSET: usize = 184;
const DETAIL_UNCOMPRESSED_BYTES_OFFSET: usize = 188;
const DETAIL_HASH_OFFSET: usize = 192;
const DOWNLOAD_TIMEOUT: Duration = Duration::from_secs(180);
const MAX_SVG_BYTES: usize = 1_500_000;
const MAX_DETAIL_BYTES: usize = 3_000_000;
const MAX_DETAIL_UNCOMPRESSED_BYTES: usize = 12_000_000;
const MAP_SERVICE_URL: &str = "https://enigma.bruceshi.com/api/city-map.pack?city=";
const VANCOUVER_MAP: &[u8] = include_bytes!("../assets/location-map-vancouver.svg");
const VANCOUVER_DETAILS: &[u8] = include_bytes!("../assets/location-map-vancouver.json.gz");
const RICHMOND_MAP: &[u8] = include_bytes!("../assets/location-map-richmond.svg");
const RICHMOND_DETAILS: &[u8] = include_bytes!("../assets/location-map-richmond.json.gz");
const VANCOUVER_ID: &str = "vancouver";
const RICHMOND_ID: &str = "richmond";

#[derive(Clone, Debug, PartialEq)]
pub struct CityMapDefinition {
    pub id: String,
    pub name: String,
    pub west: f64,
    pub south: f64,
    pub east: f64,
    pub north: f64,
    pub width: u16,
    pub height: u16,
    pub bytes: usize,
    pub svg_bytes: usize,
    pub detail_bytes: usize,
    pub detail_uncompressed_bytes: usize,
    pub bundled: bool,
    svg_sha256: Option<[u8; 32]>,
    detail_sha256: Option<[u8; 32]>,
}

fn vancouver() -> CityMapDefinition {
    CityMapDefinition {
        id: String::from(VANCOUVER_ID),
        name: String::from("Vancouver"),
        west: -123.28,
        south: 49.195,
        east: -122.99,
        north: 49.335,
        width: 1200,
        height: 888,
        bytes: VANCOUVER_MAP.len() + VANCOUVER_DETAILS.len(),
        svg_bytes: VANCOUVER_MAP.len(),
        detail_bytes: VANCOUVER_DETAILS.len(),
        detail_uncompressed_bytes: gzip_uncompressed_size(VANCOUVER_DETAILS),
        bundled: true,
        svg_sha256: None,
        detail_sha256: None,
    }
}

fn richmond() -> CityMapDefinition {
    CityMapDefinition {
        id: String::from(RICHMOND_ID),
        name: String::from("Richmond"),
        west: -123.30,
        south: 49.075,
        east: -123.04,
        north: 49.205,
        width: 1200,
        height: 917,
        bytes: RICHMOND_MAP.len() + RICHMOND_DETAILS.len(),
        svg_bytes: RICHMOND_MAP.len(),
        detail_bytes: RICHMOND_DETAILS.len(),
        detail_uncompressed_bytes: gzip_uncompressed_size(RICHMOND_DETAILS),
        bundled: true,
        svg_sha256: None,
        detail_sha256: None,
    }
}

struct CityMapPayload {
    svg: Vec<u8>,
    details: Vec<u8>,
}

#[derive(Clone)]
pub struct CityMapStatus {
    pub map: CityMapDefinition,
    pub installed: bool,
    pub active: bool,
}

pub struct CityMapStore {
    partition: EspPartition,
    storage: EspKeyValueStorage<NvsCustom>,
    downloaded: Option<(CityMapDefinition, CityMapPayload)>,
    active_id: String,
}

impl CityMapStore {
    pub fn open(nvs_partition: PersistentNvsPartition) -> Result<Self, Box<dyn Error>> {
        // The partition is opened once here and then owned behind the portal's mutex.
        let mut partition =
            unsafe { EspPartition::new(PARTITION_LABEL)? }.ok_or("mapdata partition is missing")?;
        let downloaded = load_downloaded(&mut partition)?;
        let storage = EspKeyValueStorage::new(EspNvs::new(nvs_partition, ACTIVE_NAMESPACE, true)?);
        let saved_active = read_active(&storage);
        if let Some((definition, _)) = &downloaded {
            log::info!(
                "offline city map ready: {} ({} bytes)",
                definition.name,
                definition.bytes
            );
        } else {
            log::info!("offline city maps ready: bundled Vancouver and Richmond");
        }
        let active_id = saved_active
            .filter(|id| {
                id == VANCOUVER_ID
                    || id == RICHMOND_ID
                    || downloaded
                        .as_ref()
                        .is_some_and(|(definition, _)| definition.id == *id)
            })
            .unwrap_or_else(|| String::from(VANCOUVER_ID));
        Ok(Self {
            partition,
            storage,
            downloaded,
            active_id,
        })
    }

    pub fn active_definition(&self) -> CityMapDefinition {
        if self.active_id == RICHMOND_ID {
            return richmond();
        }
        if let Some((definition, _)) = self.downloaded.as_ref()
            && self.active_id == definition.id
        {
            return definition.clone();
        }
        vancouver()
    }

    pub fn active_bytes(&self) -> &[u8] {
        if self.active_id == RICHMOND_ID {
            return RICHMOND_MAP;
        }
        if let Some((definition, payload)) = self.downloaded.as_ref()
            && self.active_id == definition.id
        {
            return &payload.svg;
        }
        VANCOUVER_MAP
    }

    pub fn active_details(&self) -> &[u8] {
        if self.active_id == RICHMOND_ID {
            return RICHMOND_DETAILS;
        }
        if let Some((definition, payload)) = self.downloaded.as_ref()
            && self.active_id == definition.id
        {
            return &payload.details;
        }
        VANCOUVER_DETAILS
    }

    pub fn status(&self) -> Vec<CityMapStatus> {
        let active = self.active_definition();
        let mut status = vec![
            CityMapStatus {
                map: vancouver(),
                installed: true,
                active: active.id == VANCOUVER_ID,
            },
            CityMapStatus {
                map: richmond(),
                installed: true,
                active: active.id == RICHMOND_ID,
            },
        ];
        if let Some((definition, _)) = self.downloaded.as_ref() {
            status.push(CityMapStatus {
                map: definition.clone(),
                installed: true,
                active: definition.id == active.id,
            });
        }
        status
    }

    pub fn activate(&mut self, city_id: &str) -> Result<String, String> {
        if matches!(city_id, VANCOUVER_ID | RICHMOND_ID) {
            self.storage
                .set_raw(ACTIVE_KEY, city_id.as_bytes())
                .map_err(|error| format!("Could not save active map: {error}"))?;
            self.active_id = String::from(city_id);
            return Ok(format!(
                "Using bundled {} map",
                self.active_definition().name
            ));
        }
        if self
            .downloaded
            .as_ref()
            .is_some_and(|(definition, _)| definition.id == city_id)
        {
            self.storage
                .set_raw(ACTIVE_KEY, city_id.as_bytes())
                .map_err(|error| format!("Could not save active map: {error}"))?;
            self.active_id = String::from(city_id);
            return Ok(format!(
                "Using {} offline map",
                self.active_definition().name
            ));
        }
        Err(String::from("Download that city map first"))
    }

    pub fn install(&mut self, city_query: &str) -> Result<String, Box<dyn Error>> {
        validate_query(city_query)?;
        let (definition, payload) = download(city_query, self.partition.size())?;
        persist(&mut self.partition, &definition, &payload)?;
        self.storage.set_raw(ACTIVE_KEY, definition.id.as_bytes())?;
        let message = format!(
            "Downloaded {} ({:.1} KiB) and made it active",
            definition.name,
            definition.bytes as f64 / 1024.0
        );
        self.active_id = definition.id.clone();
        self.downloaded = Some((definition, payload));
        Ok(message)
    }
}

fn read_active(storage: &EspKeyValueStorage<NvsCustom>) -> Option<String> {
    let mut buffer = [0u8; ID_BYTES];
    str::from_utf8(storage.get_raw(ACTIVE_KEY, &mut buffer).ok()??)
        .ok()
        .map(String::from)
}

fn load_downloaded(
    partition: &mut EspPartition,
) -> Result<Option<(CityMapDefinition, CityMapPayload)>, Box<dyn Error>> {
    let mut header = [0u8; HEADER_BYTES];
    partition.read(0, &mut header)?;
    if &header[..HEADER_MAGIC.len()] != HEADER_MAGIC {
        return Ok(None);
    }
    let svg_bytes = u32::from_le_bytes(header[16..20].try_into()?) as usize;
    let svg_hash: [u8; 32] = header[20..52].try_into()?;
    let detail_bytes =
        u32::from_le_bytes(header[DETAIL_BYTES_OFFSET..DETAIL_BYTES_OFFSET + 4].try_into()?)
            as usize;
    let detail_uncompressed_bytes = u32::from_le_bytes(
        header[DETAIL_UNCOMPRESSED_BYTES_OFFSET..DETAIL_UNCOMPRESSED_BYTES_OFFSET + 4]
            .try_into()?,
    ) as usize;
    let detail_hash: [u8; 32] = header[DETAIL_HASH_OFFSET..DETAIL_HASH_OFFSET + 32].try_into()?;
    let definition = match definition_from_header(
        &header,
        svg_bytes,
        detail_bytes,
        detail_uncompressed_bytes,
        svg_hash,
        detail_hash,
    ) {
        Ok(definition) => definition,
        Err(error) => {
            log::warn!("ignoring city map with unreadable flash header: {error}");
            return Ok(None);
        }
    };
    if validate_metadata(&definition, partition.size()).is_err() {
        log::warn!("ignoring city map with invalid flash header");
        return Ok(None);
    }
    let mut svg = vec![0u8; definition.svg_bytes];
    partition.read(HEADER_BYTES, &mut svg)?;
    let mut details = vec![0u8; definition.detail_bytes];
    partition.read(HEADER_BYTES + definition.svg_bytes, &mut details)?;
    let payload = CityMapPayload { svg, details };
    if validate(&definition, &payload).is_err() {
        log::warn!("ignoring city map that failed integrity validation");
        return Ok(None);
    }
    Ok(Some((definition, payload)))
}

fn definition_from_header(
    header: &[u8; HEADER_BYTES],
    svg_bytes: usize,
    detail_bytes: usize,
    detail_uncompressed_bytes: usize,
    svg_hash: [u8; 32],
    detail_hash: [u8; 32],
) -> Result<CityMapDefinition, Box<dyn Error>> {
    Ok(CityMapDefinition {
        id: read_header_string(&header, ID_OFFSET, ID_BYTES)?,
        name: read_header_string(&header, NAME_OFFSET, NAME_BYTES)?,
        west: read_header_f64(&header, BOUNDS_OFFSET)?,
        south: read_header_f64(&header, BOUNDS_OFFSET + 8)?,
        east: read_header_f64(&header, BOUNDS_OFFSET + 16)?,
        north: read_header_f64(&header, BOUNDS_OFFSET + 24)?,
        width: u16::from_le_bytes(header[WIDTH_OFFSET..WIDTH_OFFSET + 2].try_into()?),
        height: u16::from_le_bytes(header[HEIGHT_OFFSET..HEIGHT_OFFSET + 2].try_into()?),
        bytes: svg_bytes + detail_bytes,
        svg_bytes,
        detail_bytes,
        detail_uncompressed_bytes,
        bundled: false,
        svg_sha256: Some(svg_hash),
        detail_sha256: Some(detail_hash),
    })
}

fn read_header_string(
    header: &[u8; HEADER_BYTES],
    offset: usize,
    capacity: usize,
) -> Result<String, Box<dyn Error>> {
    let slice = &header[offset..offset + capacity];
    let end = slice.iter().position(|byte| *byte == 0).unwrap_or(capacity);
    Ok(String::from(str::from_utf8(&slice[..end])?))
}

fn read_header_f64(header: &[u8; HEADER_BYTES], offset: usize) -> Result<f64, Box<dyn Error>> {
    Ok(f64::from_le_bytes(header[offset..offset + 8].try_into()?))
}

fn download(
    city_query: &str,
    partition_bytes: usize,
) -> Result<(CityMapDefinition, CityMapPayload), Box<dyn Error>> {
    let url = format!("{MAP_SERVICE_URL}{}", encode_query(city_query));
    let configuration = HttpConfiguration {
        timeout: Some(DOWNLOAD_TIMEOUT),
        crt_bundle_attach: Some(sys::esp_crt_bundle_attach),
        ..Default::default()
    };
    let mut client = HttpClient::wrap(EspHttpConnection::new(&configuration)?);
    let headers = [("Accept", "application/vnd.enigma.city-map")];
    let request = client.request(Method::Get, &url, &headers)?;
    log::info!("requesting offline city map for `{city_query}`");
    let mut response = request.submit()?;
    if response.status() != 200 {
        return Err(format!("map service returned HTTP {}", response.status()).into());
    }
    if !response
        .header("Content-Type")
        .is_some_and(|value| value.starts_with("application/vnd.enigma.city-map"))
    {
        return Err("map service returned an unexpected content type".into());
    }
    let definition = definition_from_response(&response)?;
    validate_metadata(&definition, partition_bytes)?;
    let mut package = Vec::with_capacity(definition.bytes);
    let mut buffer = [0u8; 4_096];
    loop {
        let count = response.read(&mut buffer)?;
        if count == 0 {
            break;
        }
        if package.len() + count > definition.bytes {
            return Err("downloaded city pack is larger than declared".into());
        }
        package.extend_from_slice(&buffer[..count]);
    }
    if package.len() != definition.bytes {
        return Err("downloaded city pack is incomplete".into());
    }
    let details = package.split_off(definition.svg_bytes);
    let payload = CityMapPayload {
        svg: package,
        details,
    };
    validate(&definition, &payload)?;
    Ok((definition, payload))
}

fn definition_from_response(
    response: &esp_idf_svc::http::client::Response<&mut EspHttpConnection>,
) -> Result<CityMapDefinition, Box<dyn Error>> {
    if response.header("X-Enigma-Map-Version") != Some("2") {
        return Err("map service returned an unsupported map version".into());
    }
    let id = required_header(response, "X-Enigma-Map-Id")?.to_owned();
    let name = decode_percent(required_header(response, "X-Enigma-Map-Name-Encoded")?)?;
    let bounds = required_header(response, "X-Enigma-Map-Bounds")?
        .split(',')
        .map(str::parse::<f64>)
        .collect::<Result<Vec<_>, _>>()?;
    if bounds.len() != 4 {
        return Err("map service returned invalid bounds".into());
    }
    if response.header("X-Enigma-Map-Data-Encoding") != Some("gzip") {
        return Err("map service returned an unsupported detail encoding".into());
    }
    let bytes = required_header(response, "X-Enigma-Map-Package-Bytes")?.parse::<usize>()?;
    let svg_bytes = required_header(response, "X-Enigma-Map-Svg-Bytes")?.parse::<usize>()?;
    let detail_bytes = required_header(response, "X-Enigma-Map-Data-Bytes")?.parse::<usize>()?;
    if svg_bytes.checked_add(detail_bytes) != Some(bytes) {
        return Err("map service returned inconsistent city-pack lengths".into());
    }
    Ok(CityMapDefinition {
        id,
        name,
        west: bounds[0],
        south: bounds[1],
        east: bounds[2],
        north: bounds[3],
        width: required_header(response, "X-Enigma-Map-Width")?.parse()?,
        height: required_header(response, "X-Enigma-Map-Height")?.parse()?,
        bytes,
        svg_bytes,
        detail_bytes,
        detail_uncompressed_bytes: required_header(
            response,
            "X-Enigma-Map-Data-Uncompressed-Bytes",
        )?
        .parse()?,
        bundled: false,
        svg_sha256: Some(parse_sha256(required_header(
            response,
            "X-Enigma-Map-Svg-Sha256",
        )?)?),
        detail_sha256: Some(parse_sha256(required_header(
            response,
            "X-Enigma-Map-Data-Sha256",
        )?)?),
    })
}

fn required_header<'a>(
    response: &'a esp_idf_svc::http::client::Response<&mut EspHttpConnection>,
    name: &str,
) -> Result<&'a str, Box<dyn Error>> {
    response
        .header(name)
        .ok_or_else(|| format!("map service response is missing {name}").into())
}

fn parse_sha256(value: &str) -> Result<[u8; 32], Box<dyn Error>> {
    if value.len() != 64 {
        return Err("map service returned an invalid SHA-256 digest".into());
    }
    let mut digest = [0u8; 32];
    for (index, output) in digest.iter_mut().enumerate() {
        let offset = index * 2;
        *output = u8::from_str_radix(&value[offset..offset + 2], 16)?;
    }
    Ok(digest)
}

fn gzip_uncompressed_size(payload: &[u8]) -> usize {
    if payload.len() < 4 {
        return 0;
    }
    let offset = payload.len() - 4;
    u32::from_le_bytes(payload[offset..].try_into().unwrap_or_default()) as usize
}

fn validate_query(query: &str) -> Result<(), Box<dyn Error>> {
    if query.is_empty() || query.len() > 96 || query.chars().any(|character| character.is_control())
    {
        return Err("city must be 1 to 96 UTF-8 bytes".into());
    }
    Ok(())
}

fn validate_metadata(
    definition: &CityMapDefinition,
    partition_bytes: usize,
) -> Result<(), Box<dyn Error>> {
    if definition.bundled
        || definition.id.is_empty()
        || definition.id.len() >= ID_BYTES
        || !definition
            .id
            .bytes()
            .all(|byte| byte.is_ascii_lowercase() || byte.is_ascii_digit() || byte == b'-')
    {
        return Err("map service returned an invalid city identifier".into());
    }
    if definition.name.is_empty()
        || definition.name.len() >= NAME_BYTES
        || definition
            .name
            .chars()
            .any(|character| character.is_control())
    {
        return Err("map service returned an invalid city name".into());
    }
    if ![
        definition.west,
        definition.south,
        definition.east,
        definition.north,
    ]
    .into_iter()
    .all(f64::is_finite)
        || definition.west < -180.0
        || definition.east > 180.0
        || definition.south < -90.0
        || definition.north > 90.0
        || definition.west >= definition.east
        || definition.south >= definition.north
        || definition.width == 0
        || definition.height == 0
        || definition.width > 4_096
        || definition.height > 4_096
    {
        return Err("map service returned invalid map geometry".into());
    }
    if definition.svg_bytes == 0
        || definition.svg_bytes > MAX_SVG_BYTES
        || definition.detail_bytes == 0
        || definition.detail_bytes > MAX_DETAIL_BYTES
        || definition.detail_uncompressed_bytes == 0
        || definition.detail_uncompressed_bytes > MAX_DETAIL_UNCOMPRESSED_BYTES
        || definition.bytes != definition.svg_bytes + definition.detail_bytes
        || HEADER_BYTES + definition.bytes > partition_bytes
        || definition.svg_sha256.is_none()
        || definition.detail_sha256.is_none()
    {
        return Err("city map is too large for the board".into());
    }
    Ok(())
}

fn validate(
    definition: &CityMapDefinition,
    payload: &CityMapPayload,
) -> Result<(), Box<dyn Error>> {
    if payload.svg.len() != definition.svg_bytes || payload.details.len() != definition.detail_bytes
    {
        return Err("downloaded city pack is incomplete".into());
    }
    let expected_svg_hash = definition
        .svg_sha256
        .ok_or("city SVG has no expected digest")?;
    if Sha256::digest(&payload.svg).as_slice() != expected_svg_hash {
        return Err("downloaded city SVG failed SHA-256 validation".into());
    }
    let expected_detail_hash = definition
        .detail_sha256
        .ok_or("city details have no expected digest")?;
    if Sha256::digest(&payload.details).as_slice() != expected_detail_hash {
        return Err("downloaded city details failed SHA-256 validation".into());
    }
    if payload.details.get(..3) != Some(&[0x1f, 0x8b, 0x08])
        || gzip_uncompressed_size(&payload.details) != definition.detail_uncompressed_bytes
    {
        return Err("downloaded city details are not the declared gzip JSON".into());
    }
    let svg = str::from_utf8(&payload.svg)?;
    let blocked = [
        "<script",
        "<foreignObject",
        " onload=",
        " onerror=",
        " href=",
        "url(",
    ];
    if !svg.starts_with("<?xml")
        || !svg.contains("<svg")
        || blocked.iter().any(|token| svg.contains(token))
    {
        return Err("downloaded city map contains unsupported SVG content".into());
    }
    Ok(())
}

fn persist(
    partition: &mut EspPartition,
    definition: &CityMapDefinition,
    payload: &CityMapPayload,
) -> Result<(), Box<dyn Error>> {
    validate_metadata(definition, partition.size())?;
    partition.erase(0, partition.size())?;
    partition.write(HEADER_BYTES, &payload.svg)?;
    partition.write(HEADER_BYTES + payload.svg.len(), &payload.details)?;

    // Commit the header last, so power loss cannot expose a partial download.
    let mut header = [0xffu8; HEADER_BYTES];
    header[..16].copy_from_slice(HEADER_MAGIC);
    header[16..20].copy_from_slice(&(payload.svg.len() as u32).to_le_bytes());
    header[20..52].copy_from_slice(&definition.svg_sha256.ok_or("city SVG has no digest")?);
    write_header_string(&mut header, ID_OFFSET, ID_BYTES, &definition.id)?;
    write_header_string(&mut header, NAME_OFFSET, NAME_BYTES, &definition.name)?;
    for (index, coordinate) in [
        definition.west,
        definition.south,
        definition.east,
        definition.north,
    ]
    .into_iter()
    .enumerate()
    {
        let offset = BOUNDS_OFFSET + index * 8;
        header[offset..offset + 8].copy_from_slice(&coordinate.to_le_bytes());
    }
    header[WIDTH_OFFSET..WIDTH_OFFSET + 2].copy_from_slice(&definition.width.to_le_bytes());
    header[HEIGHT_OFFSET..HEIGHT_OFFSET + 2].copy_from_slice(&definition.height.to_le_bytes());
    header[DETAIL_BYTES_OFFSET..DETAIL_BYTES_OFFSET + 4]
        .copy_from_slice(&(payload.details.len() as u32).to_le_bytes());
    header[DETAIL_UNCOMPRESSED_BYTES_OFFSET..DETAIL_UNCOMPRESSED_BYTES_OFFSET + 4]
        .copy_from_slice(&(definition.detail_uncompressed_bytes as u32).to_le_bytes());
    header[DETAIL_HASH_OFFSET..DETAIL_HASH_OFFSET + 32].copy_from_slice(
        &definition
            .detail_sha256
            .ok_or("city details have no digest")?,
    );
    partition.write(0, &header)?;
    Ok(())
}

fn write_header_string(
    header: &mut [u8; HEADER_BYTES],
    offset: usize,
    capacity: usize,
    value: &str,
) -> Result<(), Box<dyn Error>> {
    if value.len() >= capacity {
        return Err("city map header text is too long".into());
    }
    header[offset..offset + value.len()].copy_from_slice(value.as_bytes());
    header[offset + value.len()] = 0;
    Ok(())
}

fn encode_query(value: &str) -> String {
    let mut encoded = String::with_capacity(value.len());
    for byte in value.bytes() {
        if byte.is_ascii_alphanumeric() || matches!(byte, b'-' | b'.' | b'_' | b'~') {
            encoded.push(char::from(byte));
        } else {
            encoded.push('%');
            encoded.push_str(&format!("{byte:02X}"));
        }
    }
    encoded
}

fn decode_percent(value: &str) -> Result<String, Box<dyn Error>> {
    let bytes = value.as_bytes();
    let mut decoded = Vec::with_capacity(bytes.len());
    let mut index = 0;
    while index < bytes.len() {
        if bytes[index] == b'%' {
            if index + 2 >= bytes.len() {
                return Err("map service returned an invalid city name".into());
            }
            decoded.push(u8::from_str_radix(&value[index + 1..index + 3], 16)?);
            index += 3;
        } else {
            decoded.push(bytes[index]);
            index += 1;
        }
    }
    Ok(String::from_utf8(decoded)?)
}
