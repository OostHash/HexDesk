//! Platforms without screen capture yet.

use crate::frame::Frame;

/// How the game was captured.
#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub enum Method {}

impl Method {
    pub const fn name(self) -> &'static str {
        match self {}
    }
}

/// A capture of the game window.
#[derive(Debug, Clone)]
pub struct Capture {
    pub frame: Frame,
    pub method: Method,
    pub brightness: u32,
    pub print_window_brightness: Option<u32>,
}

/// Always fails: screen capture is not supported on this platform yet.
pub fn capture_game() -> Result<Capture, String> {
    Err("Screen capture is not supported on this platform yet".into())
}

/// Always fails: window capture is not supported on this platform yet.
pub fn capture_window(_handle: isize) -> Result<Frame, String> {
    Err("Window capture is not supported on this platform yet".into())
}
