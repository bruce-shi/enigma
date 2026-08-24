//! HTTPS location portal and captive hotspot DNS for iPhone Safari.

use std::{
    error::Error,
    fmt::Write as FmtWrite,
    io::ErrorKind,
    net::{Ipv4Addr, UdpSocket},
    str,
    sync::{
        Arc,
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

pub const HOSTNAME: &str = "enigma.test";
pub const HTTPS_URL: &str = "https://enigma.test";
const HTTPS_ORIGIN: &str = "https://enigma.test";
const HTTPS_IP_ORIGIN: &str = "https://192.168.71.1";
const MAX_FORM_BYTES: usize = 512;
const LIST_TIMEOUT: Duration = Duration::from_secs(10);
const ACTION_TIMEOUT: Duration = Duration::from_secs(60);

const SERVER_CERTIFICATE: &[u8] =
    concat!(include_str!("../assets/location-portal-server.crt"), "\0").as_bytes();
const SERVER_PRIVATE_KEY: &[u8] =
    concat!(include_str!("../assets/location-portal-server.key"), "\0").as_bytes();
const CA_CERTIFICATE: &[u8] = include_bytes!("../assets/location-portal-ca.crt");
const IOS_TRUST_PROFILE: &[u8] = include_bytes!("../assets/enigma-location-portal.mobileconfig");

const SECURITY_HEADERS: [(&str, &str); 5] = [
    ("Content-Type", "text/html; charset=utf-8"),
    ("Cache-Control", "no-store"),
    ("X-Content-Type-Options", "nosniff"),
    ("Referrer-Policy", "no-referrer"),
    (
        "Content-Security-Policy",
        "default-src 'self'; connect-src 'self'; img-src 'self' data:; style-src 'unsafe-inline'; script-src 'unsafe-inline'; base-uri 'none'; form-action 'self'; frame-ancestors 'none'",
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

const LOCATION_PAGE: &str = r##"<!doctype html>
<html lang="en">
<head>
  <meta charset="utf-8">
  <meta name="viewport" content="width=device-width,initial-scale=1,viewport-fit=cover">
  <meta name="theme-color" content="#071018">
  <title>Enigma location control</title>
  <style>
    :root { color-scheme: dark; font: 17px/1.45 -apple-system, BlinkMacSystemFont, "SF Pro Text", sans-serif; }
    * { box-sizing: border-box; }
    body { min-height: 100vh; margin: 0; padding: max(16px, env(safe-area-inset-top)) 16px max(28px, env(safe-area-inset-bottom)); background: #071018; color: #eef8ff; -webkit-tap-highlight-color: transparent; }
    main { width: 100%; max-width: 560px; margin: auto; }
    .eyebrow { color: #6fe1ff; font-weight: 700; letter-spacing: .08em; text-transform: uppercase; font-size: 12px; }
    h1 { margin: 5px 0 6px; font-size: clamp(27px, 8vw, 34px); line-height: 1.08; }
    p { color: #bdd0dc; margin: 0; }
    .page-header { padding: 4px 2px 16px; }
    .page-header p { font-size: 15px; line-height: 1.4; }
    .tabs { position: sticky; top: max(8px, env(safe-area-inset-top)); z-index: 2; display: grid; grid-template-columns: 1fr 1fr; gap: 4px; margin-bottom: 14px; padding: 4px; border: 1px solid #294451; border-radius: 15px; background: rgba(14, 29, 38, .96); box-shadow: 0 8px 24px rgba(0, 0, 0, .22); }
    .tab { min-height: 46px; width: 100%; margin: 0; padding: 10px 12px; border-radius: 11px; background: transparent; color: #a9bfcb; }
    .tab[aria-selected="true"] { background: #19b8df; color: #001117; box-shadow: 0 3px 10px rgba(25, 184, 223, .24); }
    .count { display: inline-grid; min-width: 22px; height: 22px; margin-left: 5px; padding: 0 6px; place-items: center; border-radius: 999px; background: #274653; color: #dffaff; font-size: 12px; }
    .tab[aria-selected="true"] .count { background: rgba(0, 17, 23, .18); color: #001117; }
    .panel { padding: 18px; border: 1px solid #253f4c; border-radius: 18px; background: #0b1921; box-shadow: 0 12px 32px rgba(0, 0, 0, .18); }
    [hidden] { display: none !important; }
    .section-heading { margin-bottom: 16px; }
    h2 { margin: 0; font-size: 22px; line-height: 1.2; }
    .section-heading p { margin-top: 5px; font-size: 14px; }
    label { display: block; margin: 15px 0 7px; font-weight: 700; }
    input { width: 100%; min-height: 48px; border: 1px solid #36515f; border-radius: 12px; padding: 12px 13px; background: #07151d; color: #eef8ff; font: 16px/1.3 -apple-system, BlinkMacSystemFont, sans-serif; }
    input:focus { outline: 2px solid #39c9ec; border-color: transparent; }
    .coordinates { display: grid; grid-template-columns: 1fr 1fr; gap: 12px; }
    button { min-height: 46px; width: 100%; border: 0; border-radius: 14px; padding: 13px 16px; margin-top: 14px; background: #19b8df; color: #001117; font: inherit; font-weight: 800; cursor: pointer; touch-action: manipulation; }
    button.secondary { background: #1c2b35; color: #eef8ff; }
    button:disabled { opacity: .45; }
    #status { margin: 0 0 14px; padding: 12px 14px; border: 1px solid #26543a; border-radius: 12px; background: #10291c; color: #80e69e; font-size: 15px; font-weight: 700; }
    #status.error { border-color: #673838; background: #2b1719; color: #ff8a8a; }
    details { margin-top: 16px; padding-top: 14px; border-top: 1px solid #253b47; color: #9eb3bf; }
    summary { min-height: 44px; padding: 9px 2px; color: #c2d4de; font-weight: 700; cursor: pointer; }
    details p { margin-top: 7px; font-size: 14px; }
    .stored { min-height: 180px; }
    .stored-header { display: flex; align-items: center; justify-content: space-between; gap: 16px; }
    .stored-header button { min-height: 42px; width: auto; margin: 0; padding: 8px 13px; }
    .location-list { display: grid; gap: 12px; margin-top: 16px; }
    .location-card { display: grid; grid-template-columns: minmax(0, 1fr) auto; align-items: center; gap: 12px; padding: 13px; border: 1px solid #2c4654; border-radius: 14px; background: #07151d; }
    .location-card strong, .location-card small { display: block; overflow-wrap: anywhere; }
    .location-card small { margin-top: 3px; color: #8fa6b5; }
    .location-card button { min-width: 66px; width: auto; margin: 0; padding: 10px 14px; }
    .empty { color: #8fa6b5; padding: 14px 0; }
    @media (max-width: 390px) {
      body { padding-left: 12px; padding-right: 12px; }
      .panel { padding: 15px; }
      .coordinates { grid-template-columns: 1fr; gap: 0; }
      .location-card { grid-template-columns: 1fr; }
      .location-card button { width: 100%; }
    }
  </style>
</head>
<body><main>
  <header class="page-header">
    <div class="eyebrow">Enigma board</div>
    <h1>Location control</h1>
    <p>Save this iPhone's position or activate a location already stored on the board.</p>
  </header>
  <nav class="tabs" role="tablist" aria-label="Location sections">
    <button type="button" id="new-tab" class="tab" role="tab" aria-selected="true" aria-controls="new-panel">New location</button>
    <button type="button" id="saved-tab" class="tab" role="tab" aria-selected="false" aria-controls="saved-panel" tabindex="-1">Saved <span id="saved-count" class="count" hidden>0</span></button>
  </nav>
  <div id="status" role="status" aria-live="polite" hidden></div>
  <section id="new-panel" class="panel" role="tabpanel" aria-labelledby="new-tab">
    <div class="section-heading"><h2>Add a location</h2><p>Capture GPS, choose a name, then save it to the board.</p></div>
    <form id="location-form">
      <label for="name">Location name</label>
      <input id="name" name="name" maxlength="64" value="Current location" autocomplete="off" required>
      <div class="coordinates">
        <div><label for="latitude">Latitude</label><input id="latitude" name="latitude" inputmode="decimal" readonly required></div>
        <div><label for="longitude">Longitude</label><input id="longitude" name="longitude" inputmode="decimal" readonly required></div>
      </div>
      <button type="button" id="capture">Use my current location</button>
      <button type="submit" id="save" class="secondary" disabled>Save to board</button>
    </form>
    <details><summary>Enter coordinates manually</summary><p>If Location Services are unavailable, unlock the coordinate fields and enter decimal degrees.</p><button type="button" id="manual" class="secondary">Unlock fields</button></details>
  </section>
  <section id="saved-panel" class="panel stored" role="tabpanel" aria-labelledby="saved-tab" hidden>
    <div class="stored-header"><h2 id="stored-heading">Stored locations</h2><button type="button" id="reload" class="secondary">Refresh</button></div>
    <div id="locations" class="location-list" aria-live="polite"><div class="empty">Loading from board...</div></div>
  </section>
</main>
<script>
(() => {
  const form = document.querySelector('#location-form');
  const name = document.querySelector('#name');
  const latitude = document.querySelector('#latitude');
  const longitude = document.querySelector('#longitude');
  const capture = document.querySelector('#capture');
  const save = document.querySelector('#save');
  const manual = document.querySelector('#manual');
  const reload = document.querySelector('#reload');
  const locations = document.querySelector('#locations');
  const status = document.querySelector('#status');
  const savedCount = document.querySelector('#saved-count');
  const tabs = [...document.querySelectorAll('[role="tab"]')];
  const selectPanel = (panelId, focus = false) => {
    tabs.forEach((tab) => {
      const selected = tab.getAttribute('aria-controls') === panelId;
      tab.setAttribute('aria-selected', String(selected));
      tab.tabIndex = selected ? 0 : -1;
      document.querySelector(`#${tab.getAttribute('aria-controls')}`).hidden = !selected;
      if (selected && focus) tab.focus();
    });
  };
  tabs.forEach((tab, index) => {
    tab.addEventListener('click', () => selectPanel(tab.getAttribute('aria-controls')));
    tab.addEventListener('keydown', (event) => {
      if (event.key !== 'ArrowLeft' && event.key !== 'ArrowRight') return;
      event.preventDefault();
      const offset = event.key === 'ArrowRight' ? 1 : tabs.length - 1;
      const next = tabs[(index + offset) % tabs.length];
      selectPanel(next.getAttribute('aria-controls'), true);
    });
  });
  const show = (message, error = false) => {
    status.textContent = message;
    status.hidden = !message;
    status.classList.toggle('error', error);
  };
  const coordinatesReady = () => {
    const lat = Number(latitude.value), lon = Number(longitude.value);
    return latitude.value !== '' && longitude.value !== '' && Number.isFinite(lat) && Number.isFinite(lon) && lat >= -90 && lat <= 90 && lon >= -180 && lon <= 180;
  };
  const refresh = () => { save.disabled = !coordinatesReady() || !name.value.trim(); };
  const locationBody = (location) => new URLSearchParams({ name: location.name, latitude: location.latitude, longitude: location.longitude });

  const loadLocations = async () => {
    reload.disabled = true;
    try {
      const response = await fetch('/api/locations', { cache: 'no-store' });
      if (!response.ok) throw new Error(await response.text() || `HTTP ${response.status}`);
      const payload = await response.json();
      savedCount.textContent = payload.locations.length;
      savedCount.hidden = false;
      locations.replaceChildren();
      if (!payload.locations.length) {
        const empty = document.createElement('div');
        empty.className = 'empty';
        empty.textContent = 'No stored locations yet. Capture and save one above.';
        locations.append(empty);
        return;
      }
      payload.locations.forEach((location) => {
        const card = document.createElement('div');
        card.className = 'location-card';
        const details = document.createElement('div');
        const title = document.createElement('strong');
        title.textContent = location.name;
        const coordinates = document.createElement('small');
        coordinates.textContent = `${location.latitude}, ${location.longitude}`;
        details.append(title, coordinates);
        const set = document.createElement('button');
        set.type = 'button';
        set.textContent = 'Set';
        set.addEventListener('click', async () => {
          set.disabled = true;
          show(`Setting ${location.name} on the iPhone...`);
          try {
            const response = await fetch('/api/set-location', {
              method: 'POST',
              headers: { 'Content-Type': 'application/x-www-form-urlencoded;charset=UTF-8' },
              body: locationBody(location)
            });
            const message = await response.text();
            if (!response.ok) throw new Error(message || `HTTP ${response.status}`);
            show(message);
            await loadLocations();
          } catch (error) {
            show(`Set failed: ${error.message}`, true);
          } finally {
            set.disabled = false;
          }
        });
        card.append(details, set);
        locations.append(card);
      });
    } catch (error) {
      locations.replaceChildren();
      const empty = document.createElement('div');
      empty.className = 'empty';
      empty.textContent = `Could not load stored locations: ${error.message}`;
      locations.append(empty);
    } finally {
      reload.disabled = false;
    }
  };

  capture.addEventListener('click', () => {
    if (!window.isSecureContext || !navigator.geolocation) {
      show('Location access needs the trusted HTTPS portal. Finish the certificate setup, then reload.', true);
      return;
    }
    capture.disabled = true;
    show('Getting a precise GPS fix...');
    navigator.geolocation.getCurrentPosition(
      ({ coords }) => {
        latitude.value = coords.latitude.toFixed(6);
        longitude.value = coords.longitude.toFixed(6);
        capture.disabled = false;
        refresh();
        show(`Location captured (accuracy about ${Math.round(coords.accuracy)} m).`);
      },
      (error) => {
        capture.disabled = false;
        const hint = error.code === 1 ? 'Allow location access for enigma.test in Safari settings.' : 'Move somewhere with a clearer GPS signal and try again.';
        show(`Could not get the current location. ${hint}`, true);
      },
      { enableHighAccuracy: true, timeout: 20000, maximumAge: 0 }
    );
  });

  manual.addEventListener('click', () => {
    latitude.readOnly = false;
    longitude.readOnly = false;
    latitude.focus();
    show('Coordinate fields unlocked. Use decimal degrees.');
  });
  [name, latitude, longitude].forEach((input) => input.addEventListener('input', refresh));

  form.addEventListener('submit', async (event) => {
    event.preventDefault();
    refresh();
    if (save.disabled) { show('Capture or enter valid coordinates first.', true); return; }
    save.disabled = true;
    show('Saving to the board...');
    try {
      const response = await fetch('/api/locations', {
        method: 'POST',
        headers: { 'Content-Type': 'application/x-www-form-urlencoded;charset=UTF-8' },
        body: locationBody({ name: name.value.trim(), latitude: latitude.value.trim(), longitude: longitude.value.trim() })
      });
      const message = await response.text();
      if (!response.ok) throw new Error(message || `HTTP ${response.status}`);
      show(message);
      await loadLocations();
      selectPanel('saved-panel');
    } catch (error) {
      show(`Save failed: ${error.message}`, true);
    } finally {
      refresh();
    }
  });
  reload.addEventListener('click', loadLocations);
  loadLocations();
})();
</script>
</body>
</html>"##;

pub enum PortalRequest {
    List {
        reply: SyncSender<Vec<Location>>,
    },
    Save {
        location: Location,
        reply: SyncSender<Outcome>,
    },
    Set {
        location: Location,
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
    pub fn start(address: Ipv4Addr) -> Result<(Self, Receiver<PortalRequest>), Box<dyn Error>> {
        let (request_sender, request_receiver) = sync_channel::<PortalRequest>(2);

        let mut http = EspHttpServer::new(&Configuration {
            http_port: 80,
            ctrl_port: 32_768,
            max_uri_handlers: 3,
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
            max_uri_handlers: 4,
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
        let list_sender = request_sender.clone();
        https.fn_handler("/api/locations", Method::Get, move |request| {
            handle_location_list(request, &list_sender)
        })?;
        let save_sender = request_sender.clone();
        https.fn_handler("/api/locations", Method::Post, move |request| {
            handle_location_post(request, &save_sender, PortalAction::Save)
        })?;
        https.fn_handler("/api/set-location", Method::Post, move |request| {
            handle_location_post(request, &request_sender, PortalAction::Set)
        })?;

        let dns = DnsRedirect::start(address)?;
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

fn locations_json(locations: &[Location]) -> String {
    let mut json = String::from("{\"locations\":[");
    for (index, location) in locations.iter().enumerate() {
        if index > 0 {
            json.push(',');
        }
        json.push_str("{\"name\":");
        push_json_string(&mut json, &location.name);
        json.push_str(",\"latitude\":");
        push_json_string(&mut json, &location.latitude);
        json.push_str(",\"longitude\":");
        push_json_string(&mut json, &location.longitude);
        json.push('}');
    }
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
    fn start(address: Ipv4Addr) -> Result<Self, Box<dyn Error>> {
        let socket = UdpSocket::bind((Ipv4Addr::UNSPECIFIED, 53))?;
        socket.set_read_timeout(Some(Duration::from_millis(250)))?;
        let running = Arc::new(AtomicBool::new(true));
        let worker_running = running.clone();
        let worker = thread::Builder::new()
            .name(String::from("enigma-dns"))
            .stack_size(6_144)
            .spawn(move || dns_loop(socket, address, worker_running))?;
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

fn dns_loop(socket: UdpSocket, address: Ipv4Addr, running: Arc<AtomicBool>) {
    let mut query = [0u8; 512];
    while running.load(Ordering::Acquire) {
        match socket.recv_from(&mut query) {
            Ok((length, peer)) => {
                if let Some(response) = dns_response(&query[..length], address)
                    && let Err(error) = socket.send_to(&response, peer)
                {
                    log::warn!("hotspot DNS response failed: {error}");
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

fn dns_response(query: &[u8], address: Ipv4Addr) -> Option<Vec<u8>> {
    if query.len() < 17 || query[2] & 0x80 != 0 || u16::from_be_bytes([query[4], query[5]]) != 1 {
        return None;
    }

    let mut cursor = 12;
    loop {
        let label_length = *query.get(cursor)? as usize;
        cursor += 1;
        if label_length == 0 {
            break;
        }
        if label_length > 63 || cursor.checked_add(label_length)? > query.len() {
            return None;
        }
        cursor += label_length;
    }
    let question_end = cursor.checked_add(4)?;
    if question_end > query.len() {
        return None;
    }
    let query_type = u16::from_be_bytes([query[cursor], query[cursor + 1]]);
    let query_class = u16::from_be_bytes([query[cursor + 2], query[cursor + 3]]);
    let answer = query_class == 1 && matches!(query_type, 1 | 255);

    let mut response = Vec::with_capacity(question_end + usize::from(answer) * 16);
    response.extend_from_slice(&query[0..2]);
    response.push(0x84 | (query[2] & 0x01));
    response.push(0x00);
    response.extend_from_slice(&1u16.to_be_bytes());
    response.extend_from_slice(&u16::from(answer).to_be_bytes());
    response.extend_from_slice(&0u16.to_be_bytes());
    response.extend_from_slice(&0u16.to_be_bytes());
    response.extend_from_slice(&query[12..question_end]);
    if answer {
        response.extend_from_slice(&[0xc0, 0x0c]);
        response.extend_from_slice(&1u16.to_be_bytes());
        response.extend_from_slice(&1u16.to_be_bytes());
        response.extend_from_slice(&60u32.to_be_bytes());
        response.extend_from_slice(&4u16.to_be_bytes());
        response.extend_from_slice(&address.octets());
    }
    Some(response)
}
