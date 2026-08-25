//! HTTPS location portal and captive hotspot DNS for iPhone Safari.

use std::{
    error::Error,
    fmt::Write as FmtWrite,
    io::{self, ErrorKind},
    net::{IpAddr, Ipv4Addr, UdpSocket},
    str,
    sync::{
        Arc, Mutex,
        atomic::{AtomicBool, Ordering},
        mpsc::{Receiver, SyncSender, TrySendError, sync_channel},
    },
    thread::{self, JoinHandle},
    time::Duration,
};

use enigma_embedded_core::{Location, Outcome};
use esp_idf_svc::{
    http::{
        Method,
        server::{Configuration, EspHttpConnection, EspHttpServer, Request},
    },
    io::{EspIOError, Write},
    tls::X509,
};

use crate::{city_maps::CityMapStore, wifi_access::WifiStatus};

pub const HOSTNAME: &str = "enigma.test";
pub const HTTPS_URL: &str = "https://enigma.test";
const HTTPS_ORIGIN: &str = "https://enigma.test";
const HTTPS_IP_ORIGIN: &str = "https://192.168.71.1";
const MAX_FORM_BYTES: usize = 512;
const LIST_TIMEOUT: Duration = Duration::from_secs(10);
const ACTION_TIMEOUT: Duration = Duration::from_secs(210);
const DNS_PACKET_BYTES: usize = 4_096;
const DNS_UPSTREAM_TIMEOUT: Duration = Duration::from_millis(1_500);

const SERVER_CERTIFICATE: &[u8] =
    concat!(include_str!("../assets/location-portal-server.crt"), "\0").as_bytes();
const SERVER_PRIVATE_KEY: &[u8] =
    concat!(include_str!("../assets/location-portal-server.key"), "\0").as_bytes();
const CA_CERTIFICATE: &[u8] = include_bytes!("../assets/location-portal-ca.crt");
const IOS_TRUST_PROFILE: &[u8] = include_bytes!("../assets/enigma-location-portal.mobileconfig");
const LOCATION_PORTAL_SCRIPT: &[u8] = include_bytes!("../assets/location-portal.js");

pub type SharedCityMaps = Arc<Mutex<CityMapStore>>;

const SECURITY_HEADERS: [(&str, &str); 5] = [
    ("Content-Type", "text/html; charset=utf-8"),
    ("Cache-Control", "no-store"),
    ("X-Content-Type-Options", "nosniff"),
    ("Referrer-Policy", "no-referrer"),
    (
        "Content-Security-Policy",
        "default-src 'self'; connect-src 'self'; img-src 'self' data:; style-src 'unsafe-inline'; script-src 'self'; base-uri 'none'; form-action 'self'; frame-ancestors 'none'",
    ),
];

const ONBOARDING_PAGE: &str = r##"<!doctype html>
<html lang="en">
<head>
  <meta charset="utf-8">
  <meta name="viewport" content="width=device-width,initial-scale=1,viewport-fit=cover">
  <title>Enigma secure portal setup</title>
  <style>
    :root { color-scheme: light dark; font: 17px/1.45 -apple-system, BlinkMacSystemFont, sans-serif; }
    body { margin: 0; padding: max(24px, env(safe-area-inset-top)) 20px max(36px, env(safe-area-inset-bottom)); background: #071018; color: #eef8ff; }
    main { max-width: 560px; margin: auto; }
    .eyebrow { color: #6fe1ff; font-weight: 700; letter-spacing: .08em; text-transform: uppercase; font-size: 12px; }
    h1 { margin: 8px 0 10px; font-size: 32px; line-height: 1.1; }
    p { color: #bdd0dc; }
    ol { padding-left: 24px; }
    li { margin: 14px 0; }
    a.button { display: block; padding: 15px 18px; margin: 18px 0; border-radius: 14px; background: #19b8df; color: #001117; text-align: center; text-decoration: none; font-weight: 800; }
    a.secondary { background: #1c2b35; color: #eef8ff; }
    small { color: #8fa6b5; }
    code { color: #d7f8ff; }
  </style>
</head>
<body><main>
  <div class="eyebrow">One-time iPhone setup</div>
  <h1>Trust the Enigma hotspot portal</h1>
  <p>Safari only shares your GPS position with a trusted HTTPS page. Install the board's public CA once, then enable full trust for it.</p>
  <ol>
    <li>Tap <strong>Download trust profile</strong>. If this mini browser blocks the download, open <code>http://enigma.test</code> in Safari first.</li>
    <li>Open Settings. Tap <strong>Profile Downloaded</strong>, then install <strong>Enigma Location Portal Trust</strong>.</li>
    <li>Go to Settings &rsaquo; General &rsaquo; About &rsaquo; Certificate Trust Settings and enable full trust for <strong>Enigma Local Portal CA</strong>.</li>
    <li>Return here and open the secure portal.</li>
  </ol>
  <a class="button" href="/enigma-location-portal.mobileconfig">Download trust profile</a>
  <a class="button secondary" href="https://enigma.test">Open secure location portal</a>
  <small>The profile contains only the public CA certificate. The CA signing key is not present on the board.</small>
</main></body>
</html>"##;

const LOCATION_PAGE: &str = include_str!("../assets/location-portal.html");

pub struct PortalLocationList {
    pub saved: Vec<Location>,
    pub presets: Vec<Location>,
}

pub enum PortalRequest {
    List {
        reply: SyncSender<PortalLocationList>,
    },
    Save {
        location: Location,
        reply: SyncSender<Outcome>,
    },
    Set {
        location: Location,
        reply: SyncSender<Outcome>,
    },
    Restore {
        reply: SyncSender<Outcome>,
    },
    ConnectWifi {
        ssid: String,
        password: String,
        reply: SyncSender<Outcome>,
    },
    InstallMap {
        city_query: String,
        reply: SyncSender<Outcome>,
    },
}

#[derive(Clone, Copy)]
enum PortalAction {
    Save,
    Set,
}

/// Keeps the HTTP onboarding server, HTTPS portal, and DNS redirect alive.
pub struct LocationPortal {
    _dns: DnsRedirect,
    _http: EspHttpServer<'static>,
    _https: EspHttpServer<'static>,
}

impl LocationPortal {
    pub fn start(
        address: Ipv4Addr,
        city_maps: SharedCityMaps,
        wifi_status: WifiStatus,
    ) -> Result<(Self, Receiver<PortalRequest>), Box<dyn Error>> {
        let (request_sender, request_receiver) = sync_channel::<PortalRequest>(2);

        let mut http = EspHttpServer::new(&Configuration {
            http_port: 80,
            ctrl_port: 32_768,
            max_open_sockets: 2,
            max_uri_handlers: 3,
            session_timeout: Duration::from_secs(30),
            uri_match_wildcard: true,
            stack_size: 8_192,
            ..Default::default()
        })?;
        http.fn_handler(
            "/enigma-location-portal.mobileconfig",
            Method::Get,
            |request| {
                send_bytes(
                    request,
                    200,
                    "OK",
                    &[
                        ("Content-Type", "application/x-apple-aspen-config"),
                        (
                            "Content-Disposition",
                            "attachment; filename=\"enigma-location-portal.mobileconfig\"",
                        ),
                        ("Cache-Control", "no-store"),
                        ("X-Content-Type-Options", "nosniff"),
                    ],
                    IOS_TRUST_PROFILE,
                )
            },
        )?;
        http.fn_handler("/enigma-location-portal-ca.crt", Method::Get, |request| {
            send_bytes(
                request,
                200,
                "OK",
                &[
                    ("Content-Type", "application/x-x509-ca-cert"),
                    ("Cache-Control", "no-store"),
                    ("X-Content-Type-Options", "nosniff"),
                ],
                CA_CERTIFICATE,
            )
        })?;
        http.fn_handler("/*", Method::Get, |request| {
            send_bytes(
                request,
                200,
                "OK",
                &SECURITY_HEADERS,
                ONBOARDING_PAGE.as_bytes(),
            )
        })?;

        let mut https = EspHttpServer::new(&Configuration {
            https_port: 443,
            ctrl_port: 32_769,
            max_open_sockets: 4,
            max_uri_handlers: 12,
            session_timeout: Duration::from_secs(30),
            stack_size: 12_288,
            server_certificate: Some(X509::pem_until_nul(SERVER_CERTIFICATE)),
            private_key: Some(X509::pem_until_nul(SERVER_PRIVATE_KEY)),
            ..Default::default()
        })?;
        https.fn_handler("/", Method::Get, |request| {
            send_bytes(
                request,
                200,
                "OK",
                &SECURITY_HEADERS,
                LOCATION_PAGE.as_bytes(),
            )
        })?;
        let map_asset = city_maps.clone();
        https.fn_handler("/offline-map.svg", Method::Get, move |request| {
            let payload = match map_asset.lock() {
                Ok(store) => store.active_bytes().to_vec(),
                Err(_) => {
                    return send_text(request, 503, "Service Unavailable", "Map storage is busy");
                }
            };
            send_bytes(
                request,
                200,
                "OK",
                &[
                    ("Content-Type", "image/svg+xml"),
                    ("Cache-Control", "no-store"),
                    ("X-Content-Type-Options", "nosniff"),
                ],
                &payload,
            )
        })?;
        let map_details = city_maps.clone();
        https.fn_handler("/offline-map.json", Method::Get, move |request| {
            let payload = match map_details.lock() {
                Ok(store) => store.active_details().to_vec(),
                Err(_) => {
                    return send_text(request, 503, "Service Unavailable", "Map storage is busy");
                }
            };
            send_bytes(
                request,
                200,
                "OK",
                &[
                    ("Content-Type", "application/json; charset=utf-8"),
                    ("Content-Encoding", "gzip"),
                    ("Cache-Control", "no-store"),
                    ("X-Content-Type-Options", "nosniff"),
                ],
                &payload,
            )
        })?;
        https.fn_handler("/location-portal.js", Method::Get, |request| {
            send_bytes(
                request,
                200,
                "OK",
                &[
                    ("Content-Type", "text/javascript; charset=utf-8"),
                    ("Cache-Control", "no-store"),
                    ("X-Content-Type-Options", "nosniff"),
                ],
                LOCATION_PORTAL_SCRIPT,
            )
        })?;
        let list_sender = request_sender.clone();
        https.fn_handler("/api/locations", Method::Get, move |request| {
            handle_location_list(request, &list_sender)
        })?;
        let save_sender = request_sender.clone();
        https.fn_handler("/api/locations", Method::Post, move |request| {
            handle_location_post(request, &save_sender, PortalAction::Save)
        })?;
        let set_sender = request_sender.clone();
        https.fn_handler("/api/set-location", Method::Post, move |request| {
            handle_location_post(request, &set_sender, PortalAction::Set)
        })?;
        let restore_sender = request_sender.clone();
        https.fn_handler("/api/restore-location", Method::Post, move |request| {
            handle_restore(request, &restore_sender)
        })?;
        let map_status = city_maps.clone();
        let dns_status = wifi_status.clone();
        https.fn_handler("/api/maps", Method::Get, move |request| {
            handle_map_status(request, &map_status, &wifi_status)
        })?;
        let wifi_sender = request_sender.clone();
        https.fn_handler("/api/wifi", Method::Post, move |request| {
            handle_wifi_connect(request, &wifi_sender)
        })?;
        let install_sender = request_sender.clone();
        https.fn_handler("/api/maps/install", Method::Post, move |request| {
            handle_map_install(request, &install_sender)
        })?;
        https.fn_handler("/api/maps/activate", Method::Post, move |request| {
            handle_map_activate(request, &city_maps)
        })?;

        let dns = DnsRedirect::start(address, dns_status)?;
        log::info!(
            "location portal ready: onboarding http://{HOSTNAME}, secure portal {HTTPS_URL}"
        );
        Ok((
            Self {
                _dns: dns,
                _http: http,
                _https: https,
            },
            request_receiver,
        ))
    }
}

fn handle_location_list(
    request: Request<&mut EspHttpConnection<'_>>,
    sender: &SyncSender<PortalRequest>,
) -> Result<(), EspIOError> {
    let (reply_sender, reply_receiver) = sync_channel(1);
    match sender.try_send(PortalRequest::List {
        reply: reply_sender,
    }) {
        Ok(()) => {}
        Err(TrySendError::Full(_)) => {
            return send_text(
                request,
                503,
                "Service Unavailable",
                "Board is busy; try again",
            );
        }
        Err(TrySendError::Disconnected(_)) => {
            return send_text(
                request,
                503,
                "Service Unavailable",
                "Location storage is offline",
            );
        }
    }
    match reply_receiver.recv_timeout(LIST_TIMEOUT) {
        Ok(locations) => {
            let json = locations_json(&locations);
            send_bytes(
                request,
                200,
                "OK",
                &[
                    ("Content-Type", "application/json; charset=utf-8"),
                    ("Cache-Control", "no-store"),
                    ("X-Content-Type-Options", "nosniff"),
                ],
                json.as_bytes(),
            )
        }
        Err(_) => send_text(
            request,
            504,
            "Gateway Timeout",
            "Board did not return stored locations",
        ),
    }
}

fn handle_location_post(
    mut request: Request<&mut EspHttpConnection<'_>>,
    sender: &SyncSender<PortalRequest>,
    action: PortalAction,
) -> Result<(), EspIOError> {
    if !request
        .header("Origin")
        .is_some_and(|origin| origin == HTTPS_ORIGIN || origin == HTTPS_IP_ORIGIN)
    {
        return send_text(request, 403, "Forbidden", "Cross-origin action rejected");
    }
    if !request
        .header("Content-Type")
        .is_some_and(|value| value.starts_with("application/x-www-form-urlencoded"))
    {
        return send_text(
            request,
            415,
            "Unsupported Media Type",
            "Expected a URL-encoded form",
        );
    }
    let Some(content_length) = request
        .header("Content-Length")
        .and_then(|value| value.parse::<usize>().ok())
    else {
        return send_text(request, 411, "Length Required", "Missing Content-Length");
    };
    if content_length == 0 || content_length > MAX_FORM_BYTES {
        return send_text(request, 413, "Payload Too Large", "Invalid form size");
    }

    let mut body = vec![0u8; content_length];
    let mut received = 0;
    while received < content_length {
        let count = request.read(&mut body[received..])?;
        if count == 0 {
            break;
        }
        received += count;
    }
    if received != content_length {
        return send_text(request, 400, "Bad Request", "Incomplete form body");
    }
    let location = match parse_location_form(&body) {
        Ok(location) => location,
        Err(message) => return send_text(request, 422, "Unprocessable Content", &message),
    };

    let (reply_sender, reply_receiver) = sync_channel(1);
    let portal_request = match action {
        PortalAction::Save => PortalRequest::Save {
            location,
            reply: reply_sender,
        },
        PortalAction::Set => PortalRequest::Set {
            location,
            reply: reply_sender,
        },
    };
    match sender.try_send(portal_request) {
        Ok(()) => {}
        Err(TrySendError::Full(_)) => {
            return send_text(
                request,
                503,
                "Service Unavailable",
                "Board is busy; try again",
            );
        }
        Err(TrySendError::Disconnected(_)) => {
            return send_text(
                request,
                503,
                "Service Unavailable",
                "Location storage is offline",
            );
        }
    }
    match reply_receiver.recv_timeout(ACTION_TIMEOUT) {
        Ok(outcome) if outcome.success => send_text(
            request,
            if matches!(action, PortalAction::Save) {
                201
            } else {
                200
            },
            if matches!(action, PortalAction::Save) {
                "Created"
            } else {
                "OK"
            },
            &outcome.message,
        ),
        Ok(outcome) => send_text(request, 422, "Unprocessable Content", &outcome.message),
        Err(_) => send_text(
            request,
            504,
            "Gateway Timeout",
            "Board did not finish the location action; check its display",
        ),
    }
}

fn handle_restore(
    request: Request<&mut EspHttpConnection<'_>>,
    sender: &SyncSender<PortalRequest>,
) -> Result<(), EspIOError> {
    if !request
        .header("Origin")
        .is_some_and(|origin| origin == HTTPS_ORIGIN || origin == HTTPS_IP_ORIGIN)
    {
        return send_text(request, 403, "Forbidden", "Cross-origin action rejected");
    }

    let (reply_sender, reply_receiver) = sync_channel(1);
    match sender.try_send(PortalRequest::Restore {
        reply: reply_sender,
    }) {
        Ok(()) => {}
        Err(TrySendError::Full(_)) => {
            return send_text(
                request,
                503,
                "Service Unavailable",
                "Board is busy; try again",
            );
        }
        Err(TrySendError::Disconnected(_)) => {
            return send_text(
                request,
                503,
                "Service Unavailable",
                "Location control is offline",
            );
        }
    }
    match reply_receiver.recv_timeout(ACTION_TIMEOUT) {
        Ok(outcome) if outcome.success => send_text(request, 200, "OK", &outcome.message),
        Ok(outcome) => send_text(request, 422, "Unprocessable Content", &outcome.message),
        Err(_) => send_text(
            request,
            504,
            "Gateway Timeout",
            "Board did not restore real GPS; check its display",
        ),
    }
}

fn handle_map_status(
    request: Request<&mut EspHttpConnection<'_>>,
    city_maps: &SharedCityMaps,
    wifi_status: &WifiStatus,
) -> Result<(), EspIOError> {
    let store = match city_maps.lock() {
        Ok(store) => store,
        Err(_) => return send_text(request, 503, "Service Unavailable", "Map storage is busy"),
    };
    let active = store.active_definition();
    let connected_ssid = wifi_status.connected_ssid();
    let mut json = String::from("{\"active\":");
    push_map_json(&mut json, &active);
    json.push_str(",\"wifi\":{\"connected\":");
    json.push_str(if connected_ssid.is_some() {
        "true"
    } else {
        "false"
    });
    json.push_str(",\"ssid\":");
    if let Some(ssid) = connected_ssid {
        push_json_string(&mut json, &ssid);
    } else {
        json.push_str("null");
    }
    json.push_str(",\"internetRelayed\":");
    json.push_str(if wifi_status.internet_relayed() {
        "true"
    } else {
        "false"
    });
    json.push_str("},\"maps\":[");
    for (index, status) in store.status().into_iter().enumerate() {
        if index > 0 {
            json.push(',');
        }
        json.push('{');
        json.push_str("\"map\":");
        push_map_json(&mut json, &status.map);
        let _ = write!(
            json,
            ",\"installed\":{},\"active\":{}",
            status.installed, status.active
        );
        json.push('}');
    }
    json.push_str("]}");
    send_bytes(
        request,
        200,
        "OK",
        &[
            ("Content-Type", "application/json; charset=utf-8"),
            ("Cache-Control", "no-store"),
            ("X-Content-Type-Options", "nosniff"),
        ],
        json.as_bytes(),
    )
}

fn handle_wifi_connect(
    mut request: Request<&mut EspHttpConnection<'_>>,
    sender: &SyncSender<PortalRequest>,
) -> Result<(), EspIOError> {
    let fields = match read_action_form(&mut request) {
        Ok(fields) => fields,
        Err(error) => return send_text(request, error.status, error.message, &error.body),
    };
    let ssid = match form_field(&fields, "ssid", 32, false) {
        Ok(value) => value,
        Err(message) => return send_text(request, 422, "Unprocessable Content", &message),
    };
    let password = match form_field(&fields, "password", 63, true) {
        Ok(value) => value,
        Err(message) => return send_text(request, 422, "Unprocessable Content", &message),
    };
    let (reply, receiver) = sync_channel(1);
    send_action_request(
        request,
        sender,
        PortalRequest::ConnectWifi {
            ssid,
            password,
            reply,
        },
        receiver,
        "Wi-Fi connection did not finish; reconnect to the Enigma hotspot and refresh",
    )
}

fn handle_map_install(
    mut request: Request<&mut EspHttpConnection<'_>>,
    sender: &SyncSender<PortalRequest>,
) -> Result<(), EspIOError> {
    let fields = match read_action_form(&mut request) {
        Ok(fields) => fields,
        Err(error) => return send_text(request, error.status, error.message, &error.body),
    };
    let city_query = match form_field(&fields, "city", 96, false) {
        Ok(value) => value,
        Err(message) => return send_text(request, 422, "Unprocessable Content", &message),
    };
    let (reply, receiver) = sync_channel(1);
    send_action_request(
        request,
        sender,
        PortalRequest::InstallMap { city_query, reply },
        receiver,
        "City-map download did not finish",
    )
}

fn handle_map_activate(
    mut request: Request<&mut EspHttpConnection<'_>>,
    city_maps: &SharedCityMaps,
) -> Result<(), EspIOError> {
    let fields = match read_action_form(&mut request) {
        Ok(fields) => fields,
        Err(error) => return send_text(request, error.status, error.message, &error.body),
    };
    let city_id = match form_field(&fields, "city", 31, false) {
        Ok(value) => value,
        Err(message) => return send_text(request, 422, "Unprocessable Content", &message),
    };
    match city_maps.lock() {
        Ok(mut store) => match store.activate(&city_id) {
            Ok(message) => send_text(request, 200, "OK", &message),
            Err(message) => send_text(request, 422, "Unprocessable Content", &message),
        },
        Err(_) => send_text(request, 503, "Service Unavailable", "Map storage is busy"),
    }
}

fn send_action_request(
    request: Request<&mut EspHttpConnection<'_>>,
    sender: &SyncSender<PortalRequest>,
    action: PortalRequest,
    receiver: Receiver<Outcome>,
    timeout_message: &str,
) -> Result<(), EspIOError> {
    match sender.try_send(action) {
        Ok(()) => {}
        Err(TrySendError::Full(_)) => {
            return send_text(
                request,
                503,
                "Service Unavailable",
                "Board is busy; try again",
            );
        }
        Err(TrySendError::Disconnected(_)) => {
            return send_text(
                request,
                503,
                "Service Unavailable",
                "Board controls are offline",
            );
        }
    }
    match receiver.recv_timeout(ACTION_TIMEOUT) {
        Ok(outcome) if outcome.success => send_text(request, 200, "OK", &outcome.message),
        Ok(outcome) => send_text(request, 422, "Unprocessable Content", &outcome.message),
        Err(_) => send_text(request, 504, "Gateway Timeout", timeout_message),
    }
}

struct FormError {
    status: u16,
    message: &'static str,
    body: String,
}

fn read_action_form(
    request: &mut Request<&mut EspHttpConnection<'_>>,
) -> Result<Vec<(String, String)>, FormError> {
    if !request
        .header("Origin")
        .is_some_and(|origin| origin == HTTPS_ORIGIN || origin == HTTPS_IP_ORIGIN)
    {
        return Err(FormError {
            status: 403,
            message: "Forbidden",
            body: String::from("Cross-origin action rejected"),
        });
    }
    if !request
        .header("Content-Type")
        .is_some_and(|value| value.starts_with("application/x-www-form-urlencoded"))
    {
        return Err(FormError {
            status: 415,
            message: "Unsupported Media Type",
            body: String::from("Expected a URL-encoded form"),
        });
    }
    let Some(content_length) = request
        .header("Content-Length")
        .and_then(|value| value.parse::<usize>().ok())
    else {
        return Err(FormError {
            status: 411,
            message: "Length Required",
            body: String::from("Missing Content-Length"),
        });
    };
    if content_length == 0 || content_length > MAX_FORM_BYTES {
        return Err(FormError {
            status: 413,
            message: "Payload Too Large",
            body: String::from("Invalid form size"),
        });
    }
    let mut body = vec![0u8; content_length];
    let mut received = 0;
    while received < content_length {
        let count = request
            .read(&mut body[received..])
            .map_err(|error| FormError {
                status: 400,
                message: "Bad Request",
                body: format!("Could not read form: {error}"),
            })?;
        if count == 0 {
            break;
        }
        received += count;
    }
    if received != content_length {
        return Err(FormError {
            status: 400,
            message: "Bad Request",
            body: String::from("Incomplete form body"),
        });
    }
    let form = str::from_utf8(&body).map_err(|_| FormError {
        status: 400,
        message: "Bad Request",
        body: String::from("Form is not valid UTF-8"),
    })?;
    let mut fields = Vec::new();
    for pair in form.split('&') {
        let (key, value) = pair.split_once('=').ok_or_else(|| FormError {
            status: 400,
            message: "Bad Request",
            body: String::from("Malformed form field"),
        })?;
        let key = decode_form_component(key).map_err(|body| FormError {
            status: 400,
            message: "Bad Request",
            body,
        })?;
        let value = decode_form_component(value).map_err(|body| FormError {
            status: 400,
            message: "Bad Request",
            body,
        })?;
        fields.push((key, value));
    }
    Ok(fields)
}

fn form_field(
    fields: &[(String, String)],
    key: &str,
    maximum_bytes: usize,
    allow_empty: bool,
) -> Result<String, String> {
    let mut matches = fields.iter().filter(|(candidate, _)| candidate == key);
    let value = matches
        .next()
        .map(|(_, value)| value.clone())
        .ok_or_else(|| format!("Missing {key}"))?;
    if matches.next().is_some() {
        return Err(format!("Duplicate {key}"));
    }
    if (!allow_empty && value.is_empty()) || value.len() > maximum_bytes || value.contains('\0') {
        return Err(format!("Invalid {key}"));
    }
    Ok(value)
}

fn push_map_json(json: &mut String, map: &crate::city_maps::CityMapDefinition) {
    json.push_str("{\"id\":");
    push_json_string(json, &map.id);
    json.push_str(",\"name\":");
    push_json_string(json, &map.name);
    let _ = write!(
        json,
        ",\"bounds\":{{\"west\":{},\"south\":{},\"east\":{},\"north\":{}}},\"width\":{},\"height\":{},\"bytes\":{},\"svgBytes\":{},\"detailBytes\":{},\"detailUncompressedBytes\":{},\"bundled\":{} }}",
        map.west,
        map.south,
        map.east,
        map.north,
        map.width,
        map.height,
        map.bytes,
        map.svg_bytes,
        map.detail_bytes,
        map.detail_uncompressed_bytes,
        map.bundled
    );
}

fn push_locations_json(json: &mut String, locations: &[Location]) {
    for (index, location) in locations.iter().enumerate() {
        if index > 0 {
            json.push(',');
        }
        json.push_str("{\"name\":");
        push_json_string(json, &location.name);
        json.push_str(",\"latitude\":");
        push_json_string(json, &location.latitude);
        json.push_str(",\"longitude\":");
        push_json_string(json, &location.longitude);
        json.push('}');
    }
}

fn locations_json(locations: &PortalLocationList) -> String {
    let mut json = String::from("{\"locations\":[");
    push_locations_json(&mut json, &locations.saved);
    json.push_str("],\"presets\":[");
    push_locations_json(&mut json, &locations.presets);
    json.push_str("]}");
    json
}

fn push_json_string(json: &mut String, value: &str) {
    json.push('"');
    for character in value.chars() {
        match character {
            '"' => json.push_str("\\\""),
            '\\' => json.push_str("\\\\"),
            '\u{08}' => json.push_str("\\b"),
            '\u{0c}' => json.push_str("\\f"),
            '\n' => json.push_str("\\n"),
            '\r' => json.push_str("\\r"),
            '\t' => json.push_str("\\t"),
            control if control <= '\u{1f}' => {
                let _ = write!(json, "\\u{:04x}", control as u32);
            }
            character => json.push(character),
        }
    }
    json.push('"');
}

fn send_text(
    request: Request<&mut EspHttpConnection<'_>>,
    status: u16,
    message: &str,
    body: &str,
) -> Result<(), EspIOError> {
    send_bytes(
        request,
        status,
        message,
        &[
            ("Content-Type", "text/plain; charset=utf-8"),
            ("Cache-Control", "no-store"),
            ("X-Content-Type-Options", "nosniff"),
        ],
        body.as_bytes(),
    )
}

fn send_bytes(
    request: Request<&mut EspHttpConnection<'_>>,
    status: u16,
    message: &str,
    headers: &[(&str, &str)],
    body: &[u8],
) -> Result<(), EspIOError> {
    let mut response = request.into_response(status, Some(message), headers)?;
    response.write_all(body)
}

fn parse_location_form(body: &[u8]) -> Result<Location, String> {
    let form = str::from_utf8(body).map_err(|_| String::from("Form is not valid UTF-8"))?;
    let mut name = None;
    let mut latitude = None;
    let mut longitude = None;

    for pair in form.split('&') {
        let (key, value) = pair
            .split_once('=')
            .ok_or_else(|| String::from("Malformed form field"))?;
        let key = decode_form_component(key)?;
        let value = decode_form_component(value)?;
        let target = match key.as_str() {
            "name" => &mut name,
            "latitude" => &mut latitude,
            "longitude" => &mut longitude,
            _ => continue,
        };
        if target.replace(value).is_some() {
            return Err(format!("Duplicate {key} field"));
        }
    }

    let name = name.ok_or_else(|| String::from("Missing location name"))?;
    let name = name.trim();
    if name.is_empty() || name.len() > 64 || name.contains('\u{1f}') {
        return Err(String::from(
            "Location name must be 1 to 64 safe characters",
        ));
    }
    let location = Location::new(
        name,
        latitude
            .ok_or_else(|| String::from("Missing latitude"))?
            .trim(),
        longitude
            .ok_or_else(|| String::from("Missing longitude"))?
            .trim(),
    );
    if !location.is_valid() {
        return Err(String::from(
            "Coordinates are outside the valid latitude/longitude range",
        ));
    }
    Ok(location)
}

fn decode_form_component(value: &str) -> Result<String, String> {
    let bytes = value.as_bytes();
    let mut decoded = Vec::with_capacity(bytes.len());
    let mut index = 0;
    while index < bytes.len() {
        match bytes[index] {
            b'+' => decoded.push(b' '),
            b'%' => {
                if index + 2 >= bytes.len() {
                    return Err(String::from("Invalid percent escape"));
                }
                let high = hex_value(bytes[index + 1])?;
                let low = hex_value(bytes[index + 2])?;
                decoded.push((high << 4) | low);
                index += 2;
            }
            byte => decoded.push(byte),
        }
        index += 1;
    }
    String::from_utf8(decoded).map_err(|_| String::from("Form field is not valid UTF-8"))
}

fn hex_value(value: u8) -> Result<u8, String> {
    match value {
        b'0'..=b'9' => Ok(value - b'0'),
        b'a'..=b'f' => Ok(value - b'a' + 10),
        b'A'..=b'F' => Ok(value - b'A' + 10),
        _ => Err(String::from("Invalid percent escape")),
    }
}

struct DnsRedirect {
    running: Arc<AtomicBool>,
    worker: Option<JoinHandle<()>>,
}

impl DnsRedirect {
    fn start(address: Ipv4Addr, status: WifiStatus) -> Result<Self, Box<dyn Error>> {
        // Listen only on the board AP so joining a LAN never exposes an open
        // DNS proxy through the station interface.
        let socket = UdpSocket::bind((address, 53))?;
        socket.set_read_timeout(Some(Duration::from_millis(250)))?;
        let upstream_socket = UdpSocket::bind((Ipv4Addr::UNSPECIFIED, 0))?;
        upstream_socket.set_read_timeout(Some(DNS_UPSTREAM_TIMEOUT))?;
        upstream_socket.set_write_timeout(Some(DNS_UPSTREAM_TIMEOUT))?;
        let running = Arc::new(AtomicBool::new(true));
        let worker_running = running.clone();
        let worker = thread::Builder::new()
            .name(String::from("enigma-dns"))
            .stack_size(8_192)
            .spawn(move || dns_loop(socket, upstream_socket, address, status, worker_running))?;
        Ok(Self {
            running,
            worker: Some(worker),
        })
    }
}

impl Drop for DnsRedirect {
    fn drop(&mut self) {
        self.running.store(false, Ordering::Release);
        if let Some(worker) = self.worker.take() {
            let _ = worker.join();
        }
    }
}

fn dns_loop(
    socket: UdpSocket,
    upstream_socket: UdpSocket,
    address: Ipv4Addr,
    status: WifiStatus,
    running: Arc<AtomicBool>,
) {
    let mut query = vec![0u8; DNS_PACKET_BYTES];
    while running.load(Ordering::Acquire) {
        match socket.recv_from(&mut query) {
            Ok((length, peer)) => {
                let query = &query[..length];
                if let Some(question) = parse_dns_question(query) {
                    let response = if is_local_name(&question.name) {
                        local_dns_response(query, &question, address, false)
                    } else if let Some(upstream_dns) = status.upstream_dns() {
                        match forward_dns(&upstream_socket, query, upstream_dns) {
                            Ok(response) => response,
                            Err(error) => {
                                log::warn!(
                                    "upstream DNS {upstream_dns} failed for {}: {error}",
                                    question.name
                                );
                                dns_error_response(query, question.question_end, 2)
                            }
                        }
                    } else {
                        // Until upstream Wi-Fi is configured, keep the hotspot
                        // discoverable through iOS captive-network behavior.
                        local_dns_response(query, &question, address, true)
                    };
                    if let Err(error) = socket.send_to(&response, peer) {
                        log::warn!("hotspot DNS response failed: {error}");
                    }
                }
            }
            Err(error) if matches!(error.kind(), ErrorKind::WouldBlock | ErrorKind::TimedOut) => {}
            Err(error) => {
                if running.load(Ordering::Acquire) {
                    log::warn!("hotspot DNS listener stopped: {error}");
                }
                break;
            }
        }
    }
}

struct DnsQuestion {
    question_end: usize,
    name: String,
    query_type: u16,
    query_class: u16,
}

fn parse_dns_question(query: &[u8]) -> Option<DnsQuestion> {
    if query.len() < 17 || query[2] & 0x80 != 0 || u16::from_be_bytes([query[4], query[5]]) != 1 {
        return None;
    }

    let mut cursor = 12;
    let mut name = String::new();
    loop {
        let label_length = *query.get(cursor)? as usize;
        cursor += 1;
        if label_length == 0 {
            break;
        }
        if label_length > 63 || cursor.checked_add(label_length)? > query.len() {
            return None;
        }
        let label = str::from_utf8(&query[cursor..cursor + label_length]).ok()?;
        if !name.is_empty() {
            name.push('.');
        }
        name.extend(
            label
                .chars()
                .map(|character| character.to_ascii_lowercase()),
        );
        cursor += label_length;
    }
    let question_end = cursor.checked_add(4)?;
    if question_end > query.len() {
        return None;
    }
    let query_type = u16::from_be_bytes([query[cursor], query[cursor + 1]]);
    let query_class = u16::from_be_bytes([query[cursor + 2], query[cursor + 3]]);
    Some(DnsQuestion {
        question_end,
        name,
        query_type,
        query_class,
    })
}

fn is_local_name(name: &str) -> bool {
    name == HOSTNAME
        || name
            .strip_suffix(HOSTNAME)
            .is_some_and(|prefix| prefix.ends_with('.'))
}

fn local_dns_response(
    query: &[u8],
    question: &DnsQuestion,
    address: Ipv4Addr,
    wildcard: bool,
) -> Vec<u8> {
    let answer = question.query_class == 1
        && matches!(question.query_type, 1 | 255)
        && (wildcard || is_local_name(&question.name));

    let mut response = Vec::with_capacity(question.question_end + usize::from(answer) * 16);
    response.extend_from_slice(&query[0..2]);
    response.push(0x84 | (query[2] & 0x01));
    response.push(0x80);
    response.extend_from_slice(&1u16.to_be_bytes());
    response.extend_from_slice(&u16::from(answer).to_be_bytes());
    response.extend_from_slice(&0u16.to_be_bytes());
    response.extend_from_slice(&0u16.to_be_bytes());
    response.extend_from_slice(&query[12..question.question_end]);
    if answer {
        response.extend_from_slice(&[0xc0, 0x0c]);
        response.extend_from_slice(&1u16.to_be_bytes());
        response.extend_from_slice(&1u16.to_be_bytes());
        response.extend_from_slice(&60u32.to_be_bytes());
        response.extend_from_slice(&4u16.to_be_bytes());
        response.extend_from_slice(&address.octets());
    }
    response
}

fn forward_dns(socket: &UdpSocket, query: &[u8], upstream_dns: Ipv4Addr) -> io::Result<Vec<u8>> {
    socket.send_to(query, (upstream_dns, 53))?;
    let mut response = vec![0u8; DNS_PACKET_BYTES];
    for _ in 0..4 {
        let (length, peer) = socket.recv_from(&mut response)?;
        if peer.ip() == IpAddr::V4(upstream_dns) && length >= 2 && response[..2] == query[..2] {
            response.truncate(length);
            return Ok(response);
        }
    }
    Err(io::Error::new(
        ErrorKind::TimedOut,
        "no matching upstream DNS response",
    ))
}

fn dns_error_response(query: &[u8], question_end: usize, response_code: u8) -> Vec<u8> {
    let mut response = Vec::with_capacity(question_end);
    response.extend_from_slice(&query[0..2]);
    response.push(0x80 | (query[2] & 0x01));
    response.push(0x80 | (response_code & 0x0f));
    response.extend_from_slice(&1u16.to_be_bytes());
    response.extend_from_slice(&0u16.to_be_bytes());
    response.extend_from_slice(&0u16.to_be_bytes());
    response.extend_from_slice(&0u16.to_be_bytes());
    response.extend_from_slice(&query[12..question_end]);
    response
}
