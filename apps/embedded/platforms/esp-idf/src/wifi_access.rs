//! Board-owned Wi-Fi used as the post-provisioning iPhone transport.

use std::{
    error::Error,
    net::{IpAddr, Ipv4Addr},
    str,
    sync::{
        Arc, Mutex,
        atomic::{AtomicU32, Ordering},
    },
};

use esp_idf_svc::{
    eventloop::{EspSystemEventLoop, EspSystemSubscription},
    hal::modem::Modem,
    handle::RawHandle,
    ipv4,
    netif::IpEvent,
    netif::{EspNetif, NetifConfiguration, NetifStack},
    nvs::{EspKeyValueStorage, EspNvs, NvsCustom},
    sys::{self, esp},
    wifi::{
        AccessPointConfiguration, AuthMethod, BlockingWifi, ClientConfiguration, Configuration,
        EspWifi, WifiDeviceId, WifiDriver, WifiEvent,
    },
};

use crate::persistent_storage::PersistentNvsPartition;

pub const PASSWORD: &str = "enigma-setup";
const CHANNEL: u8 = 6;
const NO_CLIENT: u32 = 0;
const WIFI_NAMESPACE: &str = "upstream";
const SSID_KEY: &str = "ssid";
const PASSWORD_KEY: &str = "password";

static CLIENT_IPV4: AtomicU32 = AtomicU32::new(NO_CLIENT);

/// Owns every ESP-IDF resource needed to keep the board access point alive.
pub struct WifiAccessPoint {
    wifi: BlockingWifi<EspWifi<'static>>,
    _ip_subscription: EspSystemSubscription<'static>,
    _wifi_subscription: EspSystemSubscription<'static>,
    storage: EspKeyValueStorage<NvsCustom>,
    ap_configuration: AccessPointConfiguration,
    status: WifiStatus,
    ssid: String,
    address: Ipv4Addr,
    subnet: ipv4::Subnet,
}

#[derive(Clone, Default)]
pub struct WifiStatus {
    upstream: Arc<Mutex<UpstreamConnection>>,
}

#[derive(Default)]
struct UpstreamConnection {
    ssid: Option<String>,
    dns: Option<Ipv4Addr>,
}

impl WifiStatus {
    pub fn connected_ssid(&self) -> Option<String> {
        self.upstream.lock().ok()?.ssid.clone()
    }

    pub fn upstream_dns(&self) -> Option<Ipv4Addr> {
        self.upstream.lock().ok()?.dns
    }

    pub fn internet_relayed(&self) -> bool {
        self.upstream
            .lock()
            .is_ok_and(|connection| connection.ssid.is_some())
    }

    fn set(&self, ssid: Option<String>, dns: Option<Ipv4Addr>) {
        if let Ok(mut connection) = self.upstream.lock() {
            connection.ssid = ssid;
            connection.dns = dns;
        }
    }
}

impl WifiAccessPoint {
    pub fn start(
        modem: Modem<'static>,
        partition: PersistentNvsPartition,
        clear_credentials: bool,
    ) -> Result<Self, Box<dyn Error>> {
        CLIENT_IPV4.store(NO_CLIENT, Ordering::Release);
        let event_loop = EspSystemEventLoop::take()?;
        let driver = WifiDriver::new(modem, event_loop.clone(), None)?;
        let mut router = ipv4::RouterConfiguration::default();
        let portal_address = router.subnet.gateway;
        // DHCP always points clients to the board. Before upstream Wi-Fi is
        // configured, its DNS responder provides captive onboarding. Once the
        // station joins a network, the responder keeps enigma.test local and
        // forwards every other DNS query through that upstream connection.
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
        let ap_configuration = AccessPointConfiguration {
            ssid: ssid.as_str().try_into()?,
            ssid_hidden: false,
            channel: CHANNEL,
            auth_method: AuthMethod::WPA2Personal,
            password: PASSWORD.try_into()?,
            max_connections: 1,
            ..Default::default()
        };

        let ip_subscription = event_loop.subscribe::<IpEvent, _>(|event| {
            if let IpEvent::ApStaIpAssigned(assignment) = event {
                let ip = assignment.ip();
                CLIENT_IPV4.store(u32::from_be_bytes(ip.octets()), Ordering::Release);
                log::info!("Wi-Fi: iPhone received address {ip}");
            }
        })?;
        let status = WifiStatus::default();
        let event_status = status.clone();
        let wifi_subscription = event_loop.subscribe::<WifiEvent, _>(move |event| match event {
            WifiEvent::ApStaDisconnected(_) => {
                CLIENT_IPV4.store(NO_CLIENT, Ordering::Release);
                log::info!("Wi-Fi: iPhone disconnected from board access point");
            }
            WifiEvent::StaDisconnected(_) => {
                event_status.set(None, None);
                log::warn!("upstream Wi-Fi disconnected; hotspot internet relay is offline");
            }
            _ => {}
        })?;

        wifi.set_configuration(&Configuration::AccessPoint(ap_configuration.clone()))?;
        wifi.start()?;
        wifi.wait_netif_up()?;
        let ip_info = wifi.wifi().ap_netif().get_ip_info()?;
        let address = ip_info.ip;
        log::info!(
            "Wi-Fi access point ready: SSID `{ssid}`, password `{PASSWORD}`, address {address}, DNS {}",
            ip_info.dns.unwrap_or(portal_address)
        );

        let storage = EspKeyValueStorage::new(EspNvs::new(partition, WIFI_NAMESPACE, true)?);
        if clear_credentials {
            let _ = storage.remove(SSID_KEY)?;
            let _ = storage.remove(PASSWORD_KEY)?;
            log::info!("startup control cleared stored upstream Wi-Fi credentials");
        }
        let saved_credentials = read_credentials(&storage);
        let mut access_point = Self {
            wifi,
            _ip_subscription: ip_subscription,
            _wifi_subscription: wifi_subscription,
            storage,
            ap_configuration,
            status,
            ssid,
            address,
            subnet: ip_info.subnet,
        };
        if let Some((saved_ssid, saved_password)) = saved_credentials {
            if let Err(error) = access_point.connect_upstream(&saved_ssid, &saved_password) {
                log::warn!("saved upstream Wi-Fi `{saved_ssid}` is unavailable: {error}");
            }
        }
        Ok(access_point)
    }

    pub fn display_label(&self) -> String {
        format!("{} / {}", self.ssid, PASSWORD)
    }

    pub fn address(&self) -> Ipv4Addr {
        self.address
    }

    pub fn status(&self) -> WifiStatus {
        self.status.clone()
    }

    pub fn connect_upstream(
        &mut self,
        ssid: &str,
        password: &str,
    ) -> Result<String, Box<dyn Error>> {
        validate_credentials(ssid, password)?;
        let auth_method = if password.is_empty() {
            AuthMethod::None
        } else {
            AuthMethod::WPA2Personal
        };
        let client = ClientConfiguration {
            ssid: ssid.try_into()?,
            password: password.try_into()?,
            auth_method,
            ..Default::default()
        };
        if self.status.connected_ssid().is_some() {
            let _ = self.wifi.disconnect();
        }
        self.status.set(None, None);
        self.wifi
            .set_configuration(&Configuration::Mixed(client, self.ap_configuration.clone()))?;
        self.wifi.connect()?;
        self.wifi.wait_netif_up()?;
        let station_info = self.wifi.wifi().sta_netif().get_ip_info()?;
        if subnets_overlap(self.subnet, station_info.subnet) {
            let _ = self.wifi.disconnect();
            return Err(format!(
                "upstream network {} overlaps the Enigma hotspot {}; use another network",
                station_info.subnet, self.subnet
            )
            .into());
        }
        let upstream_dns = station_info
            .dns
            .filter(|address| !address.is_unspecified())
            .or_else(|| {
                station_info
                    .secondary_dns
                    .filter(|address| !address.is_unspecified())
            })
            .ok_or("upstream Wi-Fi did not provide a DNS server")?;
        esp!(unsafe { sys::esp_netif_set_default_netif(self.wifi.wifi().sta_netif().handle()) })?;
        esp!(unsafe { sys::esp_netif_napt_enable(self.wifi.wifi().ap_netif().handle()) })?;
        self.storage.set_raw(SSID_KEY, ssid.as_bytes())?;
        self.storage.set_raw(PASSWORD_KEY, password.as_bytes())?;
        self.status
            .set(Some(String::from(ssid)), Some(upstream_dns));
        log::info!(
            "upstream Wi-Fi connected: `{ssid}` at {}, DNS {upstream_dns}; Enigma hotspot NAPT enabled",
            station_info.ip
        );
        Ok(format!(
            "Connected to {ssid}. Enigma hotspot internet access and city-map downloads are enabled."
        ))
    }
}

fn subnets_overlap(left: ipv4::Subnet, right: ipv4::Subnet) -> bool {
    address_in_subnet(left.gateway, right) || address_in_subnet(right.gateway, left)
}

fn address_in_subnet(address: Ipv4Addr, subnet: ipv4::Subnet) -> bool {
    let mask = u32::from(Ipv4Addr::from(subnet.mask));
    u32::from(address) & mask == u32::from(subnet.gateway) & mask
}

fn validate_credentials(ssid: &str, password: &str) -> Result<(), Box<dyn Error>> {
    if ssid.is_empty() || ssid.len() > 32 || ssid.contains('\0') {
        return Err("Wi-Fi name must be 1 to 32 bytes".into());
    }
    if (!password.is_empty() && !(8..=63).contains(&password.len())) || password.contains('\0') {
        return Err("Wi-Fi password must be empty or 8 to 63 bytes".into());
    }
    Ok(())
}

fn read_credentials(storage: &EspKeyValueStorage<NvsCustom>) -> Option<(String, String)> {
    let mut ssid_buffer = [0u8; 32];
    let mut password_buffer = [0u8; 63];
    let ssid = str::from_utf8(storage.get_raw(SSID_KEY, &mut ssid_buffer).ok()??)
        .ok()?
        .to_owned();
    let password = str::from_utf8(storage.get_raw(PASSWORD_KEY, &mut password_buffer).ok()??)
        .ok()?
        .to_owned();
    validate_credentials(&ssid, &password).ok()?;
    Some((ssid, password))
}

pub fn iphone_address() -> Result<IpAddr, Box<dyn Error>> {
    let raw = CLIENT_IPV4.load(Ordering::Acquire);
    if raw == NO_CLIENT {
        return Err("join the iPhone to the Enigma Wi-Fi first".into());
    }
    Ok(IpAddr::V4(Ipv4Addr::from(raw.to_be_bytes())))
}
