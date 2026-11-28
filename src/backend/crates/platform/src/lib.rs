//! Code that differs per operating system.
//!
//! Every module offers one interface with a Windows implementation and a
//! fallback for other platforms, so the backend does not need `cfg` blocks of
//! its own.

pub mod dir_watch;
pub mod game_paths;
pub mod keyboard_hook;
mod os;
pub mod single_instance;

pub use os::*;
