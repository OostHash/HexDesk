//! Code that differs per operating system.
//!
//! Every module offers one interface with a Windows implementation and a
//! fallback for other platforms, so the backend does not need `cfg` blocks of
//! its own.

pub mod single_instance;
