//! Board-owned Wi-Fi used as the post-provisioning iPhone transport.

use std::{
    error::Error,
    net::{IpAddr, Ipv4Addr},
    sync::atomic::{AtomicU32, Ordering},
};

use esp_idf_svc::{
    eventloop::{EspSystemEventLoop, EspSystemSubscription},
    hal::modem::Modem,
    netif::IpEvent,
    wifi::{
        AccessPointConfiguration, AuthMethod, BlockingWifi, Configuration, EspWifi, WifiDeviceId,
        WifiEvent,
    },
};

pub const PASSWORD: &str = "enigma-setup";
const CHANNEL: u8 = 6;
const NO_CLIENT: u32 = 0;

static CLIENT_IPV4: AtomicU32 = AtomicU32::new(NO_CLIENT);

/// Owns every ESP-IDF resource needed to keep the board access point alive.
pub struct WifiAccessPoint {
    _wifi: BlockingWifi<EspWifi<'static>>,
    _ip_subscription: EspSystemSubscription<'static>,
    _wifi_subscription: EspSystemSubscription<'static>,
    ssid: String,
}

impl WifiAccessPoint {
    pub fn start(modem: Modem<'static>) -> Result<Self, Box<dyn Error>> {
        CLIENT_IPV4.store(NO_CLIENT, Ordering::Release);
        let event_loop = EspSystemEventLoop::take()?;
        let mut wifi = BlockingWifi::wrap(
            EspWifi::new(modem, event_loop.clone(), None)?,
            event_loop.clone(),
        )?;
        let mac = wifi.wifi().get_mac(WifiDeviceId::Ap)?;
        let ssid = format!("Enigma-{:02X}{:02X}", mac[4], mac[5]);
        let configuration = Configuration::AccessPoint(AccessPointConfiguration {
            ssid: ssid.as_str().try_into()?,
            ssid_hidden: false,
            channel: CHANNEL,
            auth_method: AuthMethod::WPA2Personal,
            password: PASSWORD.try_into()?,
            max_connections: 1,
            ..Default::default()
        });

        let ip_subscription = event_loop.subscribe::<IpEvent, _>(|event| {
            if let IpEvent::ApStaIpAssigned(assignment) = event {
                let ip = assignment.ip();
                CLIENT_IPV4.store(u32::from_be_bytes(ip.octets()), Ordering::Release);
                log::info!("Wi-Fi: iPhone received address {ip}");
            }
        })?;
        let wifi_subscription = event_loop.subscribe::<WifiEvent, _>(|event| {
            if matches!(event, WifiEvent::ApStaDisconnected(_)) {
                CLIENT_IPV4.store(NO_CLIENT, Ordering::Release);
                log::info!("Wi-Fi: iPhone disconnected from board access point");
            }
        })?;

        wifi.set_configuration(&configuration)?;
        wifi.start()?;
        wifi.wait_netif_up()?;
        log::info!("Wi-Fi access point ready: SSID `{ssid}`, password `{PASSWORD}`");

        Ok(Self {
            _wifi: wifi,
            _ip_subscription: ip_subscription,
            _wifi_subscription: wifi_subscription,
            ssid,
        })
    }

    pub fn display_label(&self) -> String {
        format!("{} / {}", self.ssid, PASSWORD)
    }
}

pub fn iphone_address() -> Result<IpAddr, Box<dyn Error>> {
    let raw = CLIENT_IPV4.load(Ordering::Acquire);
    if raw == NO_CLIENT {
        return Err("join the iPhone to the Enigma Wi-Fi first".into());
    }
    Ok(IpAddr::V4(Ipv4Addr::from(raw.to_be_bytes())))
}
