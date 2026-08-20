//! ESP-IDF USB host transport for Apple devices over an ESP board's USB-OTG path.

use core::{ffi::c_void, ptr};
use std::{
    collections::VecDeque,
    io,
    sync::atomic::{AtomicBool, AtomicU8, AtomicU32, Ordering},
};

use esp_idf_svc::sys::{self, EspError, esp};

pub const APPLE_VENDOR_ID: u16 = 0x05ac;
const APPLE_PID_MIN: u16 = 0x1290;
const APPLE_PID_MAX: u16 = 0x12af;
const USB_CLASS_VENDOR_SPECIFIC: u8 = 0xff;
const APPLE_MUX_SUBCLASS: u8 = 0xfe;
const APPLE_MUX_PROTOCOL: u8 = 0x02;
const USB_DESCRIPTOR_INTERFACE: u8 = 4;
const USB_DESCRIPTOR_ENDPOINT: u8 = 5;
const USB_TRANSFER_BULK: u8 = 2;
const READ_TRANSFER_BYTES: usize = 16 * 1024;
const APPLE_SET_MODE_REQUEST: u8 = 0x52;
const APPLE_MUX_MODE: u16 = 3;

static NEW_DEVICE_ADDRESS: AtomicU8 = AtomicU8::new(0);
static DEVICE_GONE: AtomicBool = AtomicBool::new(false);
static TRANSFER_DONE: AtomicBool = AtomicBool::new(false);
static TRANSFER_STATUS: AtomicU32 = AtomicU32::new(0);
static HOST_INSTALLED: AtomicBool = AtomicBool::new(false);

#[derive(Debug, Clone, Copy)]
struct MuxInterface {
    number: u8,
    alternate: u8,
    endpoint_in: u8,
    endpoint_out: u8,
    max_packet_in: u16,
    max_packet_out: u16,
}

/// A claimed Apple usbmux bulk interface.
#[derive(Debug)]
pub struct UsbBulk {
    client: sys::usb_host_client_handle_t,
    device: sys::usb_device_handle_t,
    interface: MuxInterface,
    pending_read: VecDeque<u8>,
}

// ESP-IDF owns the pointed-to handles. Access remains serialized by the mux
// core, and client events are pumped from the firmware task that owns UsbBulk.
unsafe impl Send for UsbBulk {}

impl UsbBulk {
    pub fn wait_for_iphone() -> Result<Self, EspError> {
        install_host()?;

        let mut client_config: sys::usb_host_client_config_t = unsafe { core::mem::zeroed() };
        client_config.max_num_event_msg = 5;
        client_config.__bindgen_anon_1.async_.client_event_callback = Some(client_event);
        client_config.__bindgen_anon_1.async_.callback_arg = ptr::null_mut();

        let mut client: sys::usb_host_client_handle_t = ptr::null_mut();
        esp!(unsafe { sys::usb_host_client_register(&client_config, &mut client) })?;

        log::info!("USB host ready; connect and unlock the iPhone");
        let (device, interface) = loop {
            let (device, vendor, product) = loop {
                let address = NEW_DEVICE_ADDRESS.swap(0, Ordering::SeqCst);
                if address == 0 {
                    unsafe { sys::usb_host_client_handle_events(client, u32::MAX) };
                    continue;
                }
                let mut device: sys::usb_device_handle_t = ptr::null_mut();
                if let Err(error) =
                    esp!(unsafe { sys::usb_host_device_open(client, address, &mut device) })
                {
                    log::warn!("could not open USB address {address}: {error}");
                    continue;
                }
                match device_ids(device) {
                    Ok((vendor, product))
                        if vendor == APPLE_VENDOR_ID
                            && (APPLE_PID_MIN..=APPLE_PID_MAX).contains(&product) =>
                    {
                        break (device, vendor, product);
                    }
                    Ok((vendor, product)) => {
                        log::debug!("ignoring USB device {:04x}:{:04x}", vendor, product);
                    }
                    Err(error) => log::warn!("could not read USB device descriptor: {error}"),
                }
                unsafe { sys::usb_host_device_close(client, device) };
            };
            DEVICE_GONE.store(false, Ordering::SeqCst);
            log::info!("iPhone USB device found: {:04x}:{:04x}", vendor, product);

            match find_active_mux_interface(device) {
                Ok(interface) => break (device, interface),
                Err(error) if error.code() == sys::ESP_ERR_NOT_FOUND => {
                    log::info!("Apple mux interface absent; requesting USB mode {APPLE_MUX_MODE}");
                    let mode_result = request_apple_mux_mode(client, device);
                    unsafe { sys::usb_host_device_close(client, device) };
                    mode_result?;
                    // SET_MODE reconnects the phone with a mux-bearing USB
                    // configuration. Wait for the next NEW_DEV event.
                }
                Err(error) => {
                    unsafe { sys::usb_host_device_close(client, device) };
                    return Err(error);
                }
            }
        };
        esp!(unsafe {
            sys::usb_host_interface_claim(client, device, interface.number, interface.alternate)
        })?;
        log::info!(
            "claimed Apple mux interface {} alt {} (IN 0x{:02x}, OUT 0x{:02x})",
            interface.number,
            interface.alternate,
            interface.endpoint_in,
            interface.endpoint_out
        );

        Ok(Self {
            client,
            device,
            interface,
            pending_read: VecDeque::new(),
        })
    }

    pub fn read(&mut self, output: &mut [u8]) -> io::Result<usize> {
        if output.is_empty() {
            return Ok(0);
        }
        loop {
            if !self.pending_read.is_empty() {
                let count = output.len().min(self.pending_read.len());
                for byte in &mut output[..count] {
                    *byte = self.pending_read.pop_front().expect("length checked");
                }
                return Ok(count);
            }
            let capacity = READ_TRANSFER_BYTES;
            let rounded = capacity.div_ceil(self.interface.max_packet_in as usize)
                * self.interface.max_packet_in as usize;
            let (status, actual, transfer) =
                self.transfer(self.interface.endpoint_in, &[], rounded)?;
            if status != sys::usb_transfer_status_t_USB_TRANSFER_STATUS_COMPLETED {
                unsafe { sys::usb_host_transfer_free(transfer) };
                return Err(io::Error::other(format!("USB IN status {status}")));
            }
            let actual = actual.max(0) as usize;
            if actual > 0 {
                let received = unsafe {
                    core::slice::from_raw_parts((*transfer).data_buffer, actual.min(rounded))
                };
                self.pending_read.extend(received.iter().copied());
            }
            unsafe { sys::usb_host_transfer_free(transfer) };
        }
    }

    pub fn write_frame(&mut self, bytes: &[u8]) -> io::Result<()> {
        let (status, actual, transfer) =
            self.transfer(self.interface.endpoint_out, bytes, bytes.len())?;
        unsafe { sys::usb_host_transfer_free(transfer) };
        if status != sys::usb_transfer_status_t_USB_TRANSFER_STATUS_COMPLETED
            || actual as usize != bytes.len()
        {
            return Err(io::Error::other(format!(
                "USB OUT status {status}, wrote {actual}/{} bytes",
                bytes.len()
            )));
        }

        // A zero-length packet terminates frames whose length is exactly a USB
        // packet multiple; Apple's mux parser uses the transfer boundary.
        if !bytes.is_empty()
            && bytes
                .len()
                .is_multiple_of(self.interface.max_packet_out as usize)
        {
            let (status, _, transfer) = self.transfer(self.interface.endpoint_out, &[], 0)?;
            unsafe { sys::usb_host_transfer_free(transfer) };
            if status != sys::usb_transfer_status_t_USB_TRANSFER_STATUS_COMPLETED {
                return Err(io::Error::other(format!("USB OUT ZLP status {status}")));
            }
        }
        Ok(())
    }

    fn transfer(
        &mut self,
        endpoint: u8,
        source: &[u8],
        allocation: usize,
    ) -> io::Result<(u32, i32, *mut sys::usb_transfer_t)> {
        if DEVICE_GONE.load(Ordering::SeqCst) {
            return Err(io::Error::new(
                io::ErrorKind::NotConnected,
                "iPhone disconnected",
            ));
        }
        let mut transfer: *mut sys::usb_transfer_t = ptr::null_mut();
        // ESP-IDF still needs an allocated transfer buffer for a zero-length
        // OUT packet, so reserve one byte while submitting num_bytes = 0.
        esp!(unsafe { sys::usb_host_transfer_alloc(allocation.max(1), 0, &mut transfer) })
            .map_err(io::Error::other)?;
        unsafe {
            let transfer_ref = &mut *transfer;
            if !source.is_empty() {
                ptr::copy_nonoverlapping(source.as_ptr(), transfer_ref.data_buffer, source.len());
            }
            transfer_ref.num_bytes = if endpoint & 0x80 != 0 {
                allocation as i32
            } else {
                source.len() as i32
            };
            transfer_ref.device_handle = self.device;
            transfer_ref.bEndpointAddress = endpoint;
            transfer_ref.callback = Some(transfer_complete);
            transfer_ref.context = ptr::null_mut();
        }
        TRANSFER_DONE.store(false, Ordering::SeqCst);
        if let Err(error) = esp!(unsafe { sys::usb_host_transfer_submit(transfer) }) {
            unsafe { sys::usb_host_transfer_free(transfer) };
            return Err(io::Error::other(error));
        }
        while !TRANSFER_DONE.load(Ordering::SeqCst) {
            unsafe { sys::usb_host_client_handle_events(self.client, u32::MAX) };
        }
        let actual = unsafe { (*transfer).actual_num_bytes };
        Ok((TRANSFER_STATUS.load(Ordering::SeqCst), actual, transfer))
    }
}

impl Drop for UsbBulk {
    fn drop(&mut self) {
        unsafe {
            let _ =
                sys::usb_host_interface_release(self.client, self.device, self.interface.number);
            let _ = sys::usb_host_device_close(self.client, self.device);
            let _ = sys::usb_host_client_deregister(self.client);
        }
    }
}

fn install_host() -> Result<(), EspError> {
    if HOST_INSTALLED.load(Ordering::SeqCst) {
        return Ok(());
    }

    let mut config: sys::usb_host_config_t = unsafe { core::mem::zeroed() };
    config.intr_flags = sys::ESP_INTR_FLAG_LEVEL1 as i32;
    config.enum_filter_cb = Some(enumeration_filter);
    config.peripheral_map = 1;
    esp!(unsafe { sys::usb_host_install(&config) })?;

    std::thread::Builder::new()
        .name("usb-host-daemon".into())
        .stack_size(4096)
        .spawn(|| {
            loop {
                let mut flags = 0;
                unsafe { sys::usb_host_lib_handle_events(u32::MAX, &mut flags) };
            }
        })
        .map_err(|_| EspError::from_infallible::<{ sys::ESP_FAIL }>())?;
    HOST_INSTALLED.store(true, Ordering::SeqCst);
    Ok(())
}

fn device_ids(device: sys::usb_device_handle_t) -> Result<(u16, u16), EspError> {
    let mut descriptor: *const sys::usb_device_desc_t = ptr::null();
    esp!(unsafe { sys::usb_host_get_device_descriptor(device, &mut descriptor) })?;
    let fields = unsafe { (*descriptor).__bindgen_anon_1 };
    Ok((fields.idVendor, fields.idProduct))
}

fn find_active_mux_interface(device: sys::usb_device_handle_t) -> Result<MuxInterface, EspError> {
    let mut descriptor: *const sys::usb_config_desc_t = ptr::null();
    esp!(unsafe { sys::usb_host_get_active_config_descriptor(device, &mut descriptor) })?;
    let bytes = descriptor.cast::<u8>();
    let total = unsafe { u16::from_le_bytes([*bytes.add(2), *bytes.add(3)]) as usize };
    let data = unsafe { core::slice::from_raw_parts(bytes, total) };

    let mut offset = 0;
    let mut candidate: Option<MuxInterface> = None;
    while offset + 2 <= data.len() {
        let length = data[offset] as usize;
        if length < 2 || offset + length > data.len() {
            break;
        }
        match data[offset + 1] {
            USB_DESCRIPTOR_INTERFACE if length >= 9 => {
                candidate = (data[offset + 5] == USB_CLASS_VENDOR_SPECIFIC
                    && data[offset + 6] == APPLE_MUX_SUBCLASS
                    && data[offset + 7] == APPLE_MUX_PROTOCOL)
                    .then_some(MuxInterface {
                        number: data[offset + 2],
                        alternate: data[offset + 3],
                        endpoint_in: 0,
                        endpoint_out: 0,
                        max_packet_in: 0,
                        max_packet_out: 0,
                    });
            }
            USB_DESCRIPTOR_ENDPOINT if length >= 7 => {
                if let Some(target) = candidate.as_mut()
                    && data[offset + 3] & 0x03 == USB_TRANSFER_BULK
                {
                    let address = data[offset + 2];
                    let max_packet = u16::from_le_bytes([data[offset + 4], data[offset + 5]]);
                    if address & 0x80 != 0 {
                        target.endpoint_in = address;
                        target.max_packet_in = max_packet;
                    } else {
                        target.endpoint_out = address;
                        target.max_packet_out = max_packet;
                    }
                    if target.endpoint_in != 0 && target.endpoint_out != 0 {
                        return Ok(*target);
                    }
                }
            }
            _ => {}
        }
        offset += length;
    }
    Err(EspError::from_infallible::<{ sys::ESP_ERR_NOT_FOUND }>())
}

fn request_apple_mux_mode(
    client: sys::usb_host_client_handle_t,
    device: sys::usb_device_handle_t,
) -> Result<(), EspError> {
    const SETUP_BYTES: usize = 8;
    let mut transfer: *mut sys::usb_transfer_t = ptr::null_mut();
    esp!(unsafe { sys::usb_host_transfer_alloc(SETUP_BYTES + 1, 0, &mut transfer) })?;
    unsafe {
        // Vendor, device-to-host, device recipient; bRequest 0x52; mode 3 in
        // wIndex; one-byte response. All multi-byte fields are little-endian.
        let setup = [
            0xc0,
            APPLE_SET_MODE_REQUEST,
            0,
            0,
            APPLE_MUX_MODE as u8,
            (APPLE_MUX_MODE >> 8) as u8,
            1,
            0,
        ];
        ptr::copy_nonoverlapping(setup.as_ptr(), (*transfer).data_buffer, setup.len());
        (*transfer).num_bytes = (SETUP_BYTES + 1) as i32;
        (*transfer).device_handle = device;
        (*transfer).bEndpointAddress = 0;
        (*transfer).callback = Some(transfer_complete);
        (*transfer).context = ptr::null_mut();
    }
    TRANSFER_DONE.store(false, Ordering::SeqCst);
    if let Err(error) = esp!(unsafe { sys::usb_host_transfer_submit_control(client, transfer) }) {
        unsafe { sys::usb_host_transfer_free(transfer) };
        return Err(error);
    }
    while !TRANSFER_DONE.load(Ordering::SeqCst) {
        unsafe { sys::usb_host_client_handle_events(client, u32::MAX) };
    }
    let status = TRANSFER_STATUS.load(Ordering::SeqCst);
    unsafe { sys::usb_host_transfer_free(transfer) };
    if status == sys::usb_transfer_status_t_USB_TRANSFER_STATUS_COMPLETED
        || status == sys::usb_transfer_status_t_USB_TRANSFER_STATUS_NO_DEVICE
    {
        Ok(())
    } else {
        log::error!("Apple SET_MODE transfer failed with USB status {status}");
        Err(EspError::from_infallible::<{ sys::ESP_FAIL }>())
    }
}

unsafe extern "C" fn enumeration_filter(
    descriptor: *const sys::usb_device_desc_t,
    configuration: *mut u8,
) -> bool {
    let fields = unsafe { (*descriptor).__bindgen_anon_1 };
    if fields.idVendor == APPLE_VENDOR_ID && !configuration.is_null() {
        // Apple normally places the mobile-device mux interface in its highest
        // configuration. Selecting it during enumeration avoids a later
        // SET_CONFIGURATION operation that ESP-IDF's host API does not expose.
        unsafe { *configuration = fields.bNumConfigurations.max(1) };
    }
    true
}

unsafe extern "C" fn client_event(
    message: *const sys::usb_host_client_event_msg_t,
    _argument: *mut c_void,
) {
    let message = unsafe { &*message };
    #[allow(non_upper_case_globals)]
    match message.event {
        sys::usb_host_client_event_t_USB_HOST_CLIENT_EVENT_NEW_DEV => {
            let address = unsafe { message.__bindgen_anon_1.new_dev.address };
            NEW_DEVICE_ADDRESS.store(address, Ordering::SeqCst);
        }
        sys::usb_host_client_event_t_USB_HOST_CLIENT_EVENT_DEV_GONE => {
            DEVICE_GONE.store(true, Ordering::SeqCst);
        }
        _ => {}
    }
}

unsafe extern "C" fn transfer_complete(transfer: *mut sys::usb_transfer_t) {
    TRANSFER_STATUS.store(unsafe { (*transfer).status }, Ordering::SeqCst);
    TRANSFER_DONE.store(true, Ordering::SeqCst);
}
