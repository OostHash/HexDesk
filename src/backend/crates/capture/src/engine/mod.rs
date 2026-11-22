//! OCR engines.

mod ocrs;
#[cfg(windows)]
mod windows;

use std::path::PathBuf;

use crate::text::TextRead;

/// An OCR engine.
#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub enum Provider {
    /// Windows OCR when available, otherwise ocrs.
    Auto,
    /// Windows.Media.Ocr.
    Windows,
    /// The local ocrs neural-network models.
    Ocrs,
}

impl Provider {
    /// Short name, as the log and the OCR bench write it.
    pub fn id(self) -> &'static str {
        match self {
            Self::Auto => "auto",
            Self::Windows => "windows",
            Self::Ocrs => "ocrs",
        }
    }

    /// Reads a short name.
    pub fn from_id(value: &str) -> Option<Self> {
        match value {
            "auto" => Some(Self::Auto),
            "windows" => Some(Self::Windows),
            "ocrs" => Some(Self::Ocrs),
            _ => None,
        }
    }
}

/// Makes sure an explicitly selected engine is ready before it becomes active.
/// For ocrs this downloads, validates and loads the models once.
pub fn prepare_provider(provider: Provider) -> Result<(), String> {
    match provider {
        Provider::Auto => Ok(()),
        Provider::Windows => {
            #[cfg(windows)]
            if !windows::available() {
                return Err("Windows OCR has no installed recognition language".to_string());
            }
            #[cfg(not(windows))]
            return Err("Windows OCR is only available on Windows".to_string());
            #[cfg(windows)]
            Ok(())
        }
        Provider::Ocrs => ocrs::prepare(),
    }
}

/// Whether an engine can read now without preparing first: for ocrs, without
/// downloading its models.
pub fn provider_ready(provider: Provider) -> bool {
    match provider {
        Provider::Auto => true,
        Provider::Windows => {
            #[cfg(windows)]
            return windows::available();
            #[cfg(not(windows))]
            false
        }
        Provider::Ocrs => ocrs::ready(),
    }
}

/// Why an engine read nothing.
#[derive(Debug)]
pub(crate) enum EngineError {
    /// The engine is not available, such as Windows OCR without an
    /// installed language pack.
    NoEngine,
    /// The engine failed; says at which step and why.
    Failed(String),
}

impl std::fmt::Display for EngineError {
    fn fmt(&self, f: &mut std::fmt::Formatter<'_>) -> std::fmt::Result {
        match self {
            EngineError::NoEngine => f.write_str("no OCR engine available"),
            EngineError::Failed(why) => f.write_str(why),
        }
    }
}

/// Sets the folder the ocrs models are kept in.
pub fn set_model_dir(dir: PathBuf) {
    ocrs::set_model_dir(dir);
}

/// Reads the text in a .bmp file of `width` by `height` pixels: with
/// Windows OCR where it is available, otherwise with ocrs.
pub fn recognize_bmp(bmp: &[u8], width: u32, height: u32) -> Result<TextRead, String> {
    recognize_bmp_with(Provider::Auto, bmp, width, height)
}

/// Reads text with one given engine: a second engine for what the first
/// could not read, or engines compared on the same picture.
pub fn recognize_bmp_with(
    provider: Provider,
    bmp: &[u8],
    width: u32,
    height: u32,
) -> Result<TextRead, String> {
    match provider {
        Provider::Auto => recognize_auto(bmp, width, height),
        Provider::Windows => {
            #[cfg(windows)]
            return windows::recognize(bmp, width, height).map_err(|e| e.to_string());
            #[cfg(not(windows))]
            Err("Windows OCR is only available on Windows".to_string())
        }
        Provider::Ocrs => ocrs::recognize(bmp, width, height).map_err(|e| e.to_string()),
    }
}

fn recognize_auto(bmp: &[u8], width: u32, height: u32) -> Result<TextRead, String> {
    #[cfg(windows)]
    match windows::recognize(bmp, width, height) {
        Err(EngineError::NoEngine) => {}
        other => return other.map_err(|e| e.to_string()),
    }
    ocrs::recognize(bmp, width, height).map_err(|e| e.to_string())
}

/// Language tags of the installed Windows OCR language packs; empty on other
/// platforms.
pub fn languages() -> Vec<String> {
    #[cfg(windows)]
    return windows::languages();
    #[cfg(not(windows))]
    Vec::new()
}
