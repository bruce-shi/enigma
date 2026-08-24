//! Board-owned Wi-Fi used as the post-provisioning iPhone transport.

use std::{
    error::Error,
    net::{IpAddr, Ipv4Addr},
    sync::atomic::{AtomicU32, Ordering},
};

use esp_idf_svc::{
    eventloop::{EspSystemEventLoop, EspSystemSubscription},
    hal::modem::Modem,
    ipv4,
    netif::IpEvent,
    netif::{EspNetif, NetifConfiguration, NetifStack},
    wifi::{
        AccessPointConfiguration, AuthMethod, BlockingWifi, Configuration, EspWifi, WifiDeviceId,
        WifiDriver, WifiEvent,
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
    address: Ipv4Addr,
}

impl WifiAccessPoint {
    pub fn start(modem: Modem<'static>) -> Result<Self, Box<dyn Error>> {
        CLIENT_IPV4.store(NO_CLIENT, Ordering::Release);
        let event_loop = EspSystemEventLoop::take()?;
        let driver = WifiDriver::new(modem, event_loop.clone(), None)?;
        let mut router = ipv4::RouterConfiguration::default();
        let portal_address = router.subnet.gateway;
        // EspNetif's default AP router advertises 8.8.8.8. The hotspot has no
        // upstream internet and runs its own DNS responder, so DHCP must point
        // clients back to the board for enigma.test and captive-portal names.
        router.dns = Some(portal_address);
        router.secondary_dns = None;
        let ap_netif = EspNetif::new_with_conf(&NetifConfiguration {
            ip_configuration: Some(ipv4::Configuration::Router(router)),
            ..NetifConfiguration::wifi_default_router()
        })?;
        let mut wifi = BlockingWifi::wrap(
            EspWifi::wrap_all(driver, EspNetif::new(NetifStack::Sta)?, ap_netif)?,
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
        let ip_info = wifi.wifi().ap_netif().get_ip_info()?;
        let address = ip_info.ip;
        log::info!(
            "Wi-Fi access point ready: SSID `{ssid}`, password `{PASSWORD}`, address {address}, DNS {}",
            ip_info.dns.unwrap_or(portal_address)
        );

        Ok(Self {
            _wifi: wifi,
            _ip_subscription: ip_subscription,
            _wifi_subscription: wifi_subscription,
            ssid,
            address,
        })
    }

    pub fn display_label(&self) -> String {
        format!("{} / {}", self.ssid, PASSWORD)
    }

    pub fn address(&self) -> Ipv4Addr {
        self.address
    }
}

pub fn iphone_address() -> Result<IpAddr, Box<dyn Error>> {
    let raw = CLIENT_IPV4.load(Ordering::Acquire);
    if raw == NO_CLIENT {
        return Err("join the iPhone to the Enigma Wi-Fi first".into());
    }
    Ok(IpAddr::V4(Ipv4Addr::from(raw.to_be_bytes())))
}
