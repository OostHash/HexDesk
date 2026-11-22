//! HexDesk capture: pictures of the game window and the text OCR reads in
//! them.
//!
//! - [`capture_game`] captures the game window as a [`Frame`];
//!   [`capture_window`] captures one window's client area.
//! - [`recognize`] reads the text in a frame as a [`TextRead`]: lines of
//!   words, each with its place in the picture. A read can be saved as json
//!   with its picture, so readers can be tested on recorded screens.
//!
//! Windows has both. Other platforms get the same interface: OCR through
//! ocrs, and an error for capture until it is written for them.

mod engine;
mod frame;
mod screen;
mod text;

pub use engine::{
    languages, prepare_provider, provider_ready, recognize_bmp, recognize_bmp_with, set_model_dir,
    Provider,
};
pub use frame::{bgra_to_bmp, Frame, Rect};
pub use screen::{capture_game, capture_window, Capture, Method};
pub use text::{Line, TextRead, Word};

/// Reads the text in a frame.
pub fn recognize(frame: &Frame) -> Result<TextRead, String> {
    recognize_bmp(&frame.to_bmp(), frame.width, frame.height)
}
