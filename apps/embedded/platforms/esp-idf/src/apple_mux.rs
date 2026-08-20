//! Single-device Apple USB multiplexing for the ESP-IDF bulk transport.
//!
//! The wire format is Apple's public usbmux protocol. This implementation is
//! intentionally narrow: one attached iPhone and the handful of concurrent
//! virtual ports needed by `idevice` pairing and location simulation.

use std::{
    collections::{BTreeMap, VecDeque},
    future::Future,
    io,
    pin::Pin,
    sync::{Arc, Mutex, MutexGuard},
    task::{Context, Poll},
};

use idevice::{Idevice, IdeviceError, pairing_file::PairingFile, provider::IdeviceProvider};
use tokio::io::{AsyncRead, AsyncWrite, ReadBuf};

use crate::usb_host::UsbBulk;

const V1_HEADER: usize = 8;
const V2_HEADER: usize = 16;
const TCP_HEADER: usize = 20;
const MUX_MAGIC: u32 = 0xfeedface;
const MAX_FRAME: usize = 3 * 16_384;
const MAX_PAYLOAD: usize = 8 * 1024;
const RX_WINDOW: u32 = 131_072;

const PROTOCOL_VERSION: u32 = 0;
const PROTOCOL_SETUP: u32 = 2;
const PROTOCOL_TCP: u32 = 6;
const TCP_SYN: u8 = 0x02;
const TCP_RST: u8 = 0x04;
const TCP_ACK: u8 = 0x10;

#[derive(Debug)]
struct Connection {
    destination_port: u16,
    tx_sequence: u32,
    tx_ack: u32,
    remote_ack: u32,
    remote_window: u32,
    connected: bool,
    closed: bool,
    received: VecDeque<u8>,
}

#[derive(Debug)]
struct Core {
    usb: UsbBulk,
    version: u8,
    mux_tx_sequence: u16,
    mux_rx_sequence: u16,
    next_source_port: u16,
    connections: BTreeMap<u16, Connection>,
}

impl Core {
    fn new(usb: UsbBulk) -> io::Result<Self> {
        let mut this = Self {
            usb,
            version: 0,
            mux_tx_sequence: 0,
            mux_rx_sequence: 0,
            next_source_port: 1,
            connections: BTreeMap::new(),
        };
        let mut version_payload = [0u8; 12];
        version_payload[..4].copy_from_slice(&2u32.to_be_bytes());
        this.send_raw(PROTOCOL_VERSION, &[], &version_payload, false)?;
        let response = this.read_frame()?;
        if response.len() < V1_HEADER + 12
            || u32::from_be_bytes(response[..4].try_into().expect("four bytes")) != PROTOCOL_VERSION
            || u32::from_be_bytes(
                response[V1_HEADER..V1_HEADER + 4]
                    .try_into()
                    .expect("four bytes"),
            ) != 2
        {
            return Err(io::Error::other("iPhone rejected usbmux version 2"));
        }
        this.version = 2;
        this.send_raw(PROTOCOL_SETUP, &[], &[0x07], true)?;
        log::info!("Apple usbmux v2 negotiated");
        Ok(this)
    }

    fn open(&mut self, destination_port: u16) -> io::Result<u16> {
        let source_port = self.next_source_port;
        self.next_source_port = self.next_source_port.wrapping_add(1).max(1);
        self.connections.insert(
            source_port,
            Connection {
                destination_port,
                tx_sequence: 0,
                tx_ack: 0,
                remote_ack: 0,
                remote_window: RX_WINDOW,
                connected: false,
                closed: false,
                received: VecDeque::new(),
            },
        );
        self.send_tcp(source_port, TCP_SYN, &[])?;
        while !self.connection(source_port)?.connected {
            self.pump()?;
        }
        log::info!("usbmux port {destination_port} connected as stream {source_port}");
        Ok(source_port)
    }

    fn write(&mut self, source_port: u16, bytes: &[u8]) -> io::Result<usize> {
        let mut written = 0;
        while written < bytes.len() {
            let available = {
                let connection = self.connection(source_port)?;
                connection
                    .remote_window
                    .saturating_sub(connection.tx_sequence.wrapping_sub(connection.remote_ack))
                    as usize
            };
            if available == 0 {
                self.pump()?;
                continue;
            }
            let count = (bytes.len() - written).min(MAX_PAYLOAD).min(available);
            self.send_tcp(source_port, TCP_ACK, &bytes[written..written + count])?;
            let connection = self.connection_mut(source_port)?;
            connection.tx_sequence = connection.tx_sequence.wrapping_add(count as u32);
            written += count;
        }
        Ok(written)
    }

    fn read(&mut self, source_port: u16, output: &mut [u8]) -> io::Result<usize> {
        if output.is_empty() {
            return Ok(0);
        }
        loop {
            let connection = self.connection_mut(source_port)?;
            if !connection.received.is_empty() {
                let count = output.len().min(connection.received.len());
                for byte in &mut output[..count] {
                    *byte = connection.received.pop_front().expect("length checked");
                }
                return Ok(count);
            }
            if connection.closed {
                return Ok(0);
            }
            self.pump()?;
        }
    }

    fn close(&mut self, source_port: u16) {
        if self.connections.contains_key(&source_port) {
            let _ = self.send_tcp(source_port, TCP_RST, &[]);
            self.connections.remove(&source_port);
        }
    }

    fn pump(&mut self) -> io::Result<()> {
        let frame = self.read_frame()?;
        let header = self.header_size();
        if frame.len() < header {
            return Err(io::Error::other("short usbmux frame"));
        }
        if self.version >= 2 {
            self.mux_rx_sequence = u16::from_be_bytes(frame[14..16].try_into().expect("two bytes"));
        }
        let protocol = u32::from_be_bytes(frame[..4].try_into().expect("four bytes"));
        if protocol != PROTOCOL_TCP {
            return Ok(());
        }
        if frame.len() < header + TCP_HEADER {
            return Err(io::Error::other("short usbmux TCP frame"));
        }
        let tcp = &frame[header..header + TCP_HEADER];
        let source_port = u16::from_be_bytes(tcp[..2].try_into().expect("two bytes"));
        let destination_port = u16::from_be_bytes(tcp[2..4].try_into().expect("two bytes"));
        let sequence = u32::from_be_bytes(tcp[4..8].try_into().expect("four bytes"));
        let ack = u32::from_be_bytes(tcp[8..12].try_into().expect("four bytes"));
        let flags = tcp[13];
        let window = (u16::from_be_bytes(tcp[14..16].try_into().expect("two bytes")) as u32) << 8;
        let payload = &frame[header + TCP_HEADER..];

        let our_source = destination_port;
        let Some(connection) = self.connections.get_mut(&our_source) else {
            return Ok(());
        };
        if connection.destination_port != source_port {
            return Err(io::Error::other("usbmux port mismatch"));
        }
        connection.remote_ack = ack;
        connection.remote_window = window;
        if flags & TCP_RST != 0 {
            connection.closed = true;
            return Err(io::Error::new(
                io::ErrorKind::ConnectionRefused,
                "iPhone reset usbmux stream",
            ));
        }
        if !connection.connected {
            if flags & (TCP_SYN | TCP_ACK) == (TCP_SYN | TCP_ACK) {
                connection.tx_sequence = connection.tx_sequence.wrapping_add(1);
                connection.tx_ack = sequence.wrapping_add(1);
                connection.connected = true;
                self.send_tcp(our_source, TCP_ACK, &[])?;
                return Ok(());
            }
            return Err(io::Error::new(
                io::ErrorKind::ConnectionRefused,
                "iPhone refused usbmux port",
            ));
        }
        if !payload.is_empty() {
            connection.received.extend(payload.iter().copied());
            connection.tx_ack = sequence.wrapping_add(payload.len() as u32);
            self.send_tcp(our_source, TCP_ACK, &[])?;
        }
        Ok(())
    }

    fn send_tcp(&mut self, source_port: u16, flags: u8, payload: &[u8]) -> io::Result<()> {
        let connection = self.connection(source_port)?;
        let mut header = [0u8; TCP_HEADER];
        header[..2].copy_from_slice(&source_port.to_be_bytes());
        header[2..4].copy_from_slice(&connection.destination_port.to_be_bytes());
        header[4..8].copy_from_slice(&connection.tx_sequence.to_be_bytes());
        header[8..12].copy_from_slice(&connection.tx_ack.to_be_bytes());
        header[12] = (TCP_HEADER as u8 / 4) << 4;
        header[13] = flags;
        header[14..16].copy_from_slice(&((RX_WINDOW >> 8) as u16).to_be_bytes());
        self.send_raw(PROTOCOL_TCP, &header, payload, false)
    }

    fn send_raw(
        &mut self,
        protocol: u32,
        protocol_header: &[u8],
        payload: &[u8],
        reset_sequence: bool,
    ) -> io::Result<()> {
        if reset_sequence && self.version >= 2 {
            self.mux_tx_sequence = 0;
            self.mux_rx_sequence = u16::MAX;
        }
        let total = self.header_size() + protocol_header.len() + payload.len();
        if total > MAX_FRAME {
            return Err(io::Error::other("usbmux frame exceeds USB MTU"));
        }
        let mut frame = Vec::with_capacity(total);
        frame.extend_from_slice(&protocol.to_be_bytes());
        frame.extend_from_slice(&(total as u32).to_be_bytes());
        if self.version >= 2 {
            frame.extend_from_slice(&MUX_MAGIC.to_be_bytes());
            frame.extend_from_slice(&self.mux_tx_sequence.to_be_bytes());
            frame.extend_from_slice(&self.mux_rx_sequence.to_be_bytes());
            self.mux_tx_sequence = self.mux_tx_sequence.wrapping_add(1);
        }
        frame.extend_from_slice(protocol_header);
        frame.extend_from_slice(payload);
        self.usb.write_frame(&frame)
    }

    fn read_frame(&mut self) -> io::Result<Vec<u8>> {
        let mut first = [0u8; V1_HEADER];
        self.read_exact(&mut first)?;
        let length = u32::from_be_bytes(first[4..8].try_into().expect("four bytes")) as usize;
        if !(V1_HEADER..=MAX_FRAME).contains(&length) {
            return Err(io::Error::other(format!(
                "invalid usbmux frame length {length}"
            )));
        }
        let mut frame = vec![0u8; length];
        frame[..V1_HEADER].copy_from_slice(&first);
        self.read_exact(&mut frame[V1_HEADER..])?;
        Ok(frame)
    }

    fn read_exact(&mut self, mut output: &mut [u8]) -> io::Result<()> {
        while !output.is_empty() {
            let count = self.usb.read(output)?;
            if count == 0 {
                return Err(io::Error::new(io::ErrorKind::UnexpectedEof, "USB mux EOF"));
            }
            output = &mut output[count..];
        }
        Ok(())
    }

    fn header_size(&self) -> usize {
        if self.version < 2 {
            V1_HEADER
        } else {
            V2_HEADER
        }
    }

    fn connection(&self, source_port: u16) -> io::Result<&Connection> {
        self.connections
            .get(&source_port)
            .ok_or_else(|| io::Error::new(io::ErrorKind::NotConnected, "usbmux stream closed"))
    }

    fn connection_mut(&mut self, source_port: u16) -> io::Result<&mut Connection> {
        self.connections
            .get_mut(&source_port)
            .ok_or_else(|| io::Error::new(io::ErrorKind::NotConnected, "usbmux stream closed"))
    }
}

fn lock_core(core: &Mutex<Core>) -> io::Result<MutexGuard<'_, Core>> {
    core.lock()
        .map_err(|_| io::Error::other("usbmux lock poisoned"))
}

pub struct MuxStream {
    core: Arc<Mutex<Core>>,
    source_port: u16,
}

impl core::fmt::Debug for MuxStream {
    fn fmt(&self, formatter: &mut core::fmt::Formatter<'_>) -> core::fmt::Result {
        formatter
            .debug_struct("MuxStream")
            .field("source_port", &self.source_port)
            .finish()
    }
}

impl AsyncRead for MuxStream {
    fn poll_read(
        self: Pin<&mut Self>,
        _context: &mut Context<'_>,
        output: &mut ReadBuf<'_>,
    ) -> Poll<io::Result<()>> {
        let destination = output.initialize_unfilled();
        match lock_core(&self.core).and_then(|mut core| core.read(self.source_port, destination)) {
            Ok(count) => {
                output.advance(count);
                Poll::Ready(Ok(()))
            }
            Err(error) => Poll::Ready(Err(error)),
        }
    }
}

impl AsyncWrite for MuxStream {
    fn poll_write(
        self: Pin<&mut Self>,
        _context: &mut Context<'_>,
        bytes: &[u8],
    ) -> Poll<io::Result<usize>> {
        Poll::Ready(lock_core(&self.core).and_then(|mut core| core.write(self.source_port, bytes)))
    }

    fn poll_flush(self: Pin<&mut Self>, _context: &mut Context<'_>) -> Poll<io::Result<()>> {
        Poll::Ready(Ok(()))
    }

    fn poll_shutdown(self: Pin<&mut Self>, _context: &mut Context<'_>) -> Poll<io::Result<()>> {
        if let Ok(mut core) = lock_core(&self.core) {
            core.close(self.source_port);
        }
        Poll::Ready(Ok(()))
    }
}

impl Drop for MuxStream {
    fn drop(&mut self) {
        if let Ok(mut core) = lock_core(&self.core) {
            core.close(self.source_port);
        }
    }
}

#[derive(Clone)]
pub struct UsbMuxProvider {
    core: Arc<Mutex<Core>>,
    pairing_file: Arc<Mutex<Option<PairingFile>>>,
}

impl core::fmt::Debug for UsbMuxProvider {
    fn fmt(&self, formatter: &mut core::fmt::Formatter<'_>) -> core::fmt::Result {
        formatter
            .debug_struct("UsbMuxProvider")
            .finish_non_exhaustive()
    }
}

impl UsbMuxProvider {
    pub fn new(usb: UsbBulk) -> io::Result<Self> {
        Ok(Self {
            core: Arc::new(Mutex::new(Core::new(usb)?)),
            pairing_file: Arc::new(Mutex::new(None)),
        })
    }

    pub fn set_pairing_file(&self, pairing_file: PairingFile) {
        if let Ok(mut current) = self.pairing_file.lock() {
            *current = Some(pairing_file);
        }
    }
}

impl IdeviceProvider for UsbMuxProvider {
    fn connect(
        &self,
        port: u16,
    ) -> Pin<Box<dyn Future<Output = Result<Idevice, IdeviceError>> + Send>> {
        let core = self.core.clone();
        Box::pin(async move {
            let source_port = lock_core(&core).and_then(|mut state| state.open(port))?;
            Ok(Idevice::new(
                Box::new(MuxStream { core, source_port }),
                "Enigma ESP32-S3",
            ))
        })
    }

    fn label(&self) -> &str {
        "Enigma ESP32-S3"
    }

    fn get_pairing_file(
        &self,
    ) -> Pin<Box<dyn Future<Output = Result<PairingFile, IdeviceError>> + Send>> {
        let pairing_file = self.pairing_file.lock().ok().and_then(|file| file.clone());
        Box::pin(async move { pairing_file.ok_or(IdeviceError::InvalidHostID) })
    }
}
