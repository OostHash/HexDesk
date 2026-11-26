//! Windows OCR (Windows.Media.Ocr).

use windows::core::{Error, HSTRING};
use windows::Globalization::Language;
use windows::Graphics::Imaging::BitmapDecoder;
use windows::Media::Ocr::OcrEngine;
use windows::Storage::Streams::{DataWriter, InMemoryRandomAccessStream};

use super::EngineError;
use crate::text::{Line, TextRead, Word};

/// Joins a WinRT call's error with the step that failed, for the log.
fn step<T>(name: &str, result: windows::core::Result<T>) -> Result<T, EngineError> {
    result.map_err(|e: Error| EngineError::Failed(format!("[{name}] {e}")))
}

/// Tokio's blocking threads start without a COM apartment, and WinRT calls
/// then fail or return nothing. The result (first set-up, already
/// multithreaded, already single-threaded) is safe to ignore in every case.
fn init_com() {
    unsafe {
        windows_sys::Win32::System::Com::CoInitializeEx(
            std::ptr::null(),
            windows_sys::Win32::System::Com::COINIT_MULTITHREADED
                .try_into()
                .unwrap_or(0),
        );
    }
}

/// English first, then the user's languages, then any installed one.
/// `TryCreate*` fails when the language pack is not installed.
fn engine() -> Option<OcrEngine> {
    for tag in ["en-US", "en-GB"] {
        if let Ok(lang) = Language::CreateLanguage(&HSTRING::from(tag)) {
            if let Ok(engine) = OcrEngine::TryCreateFromLanguage(&lang) {
                return Some(engine);
            }
        }
    }
    if let Ok(engine) = OcrEngine::TryCreateFromUserProfileLanguages() {
        return Some(engine);
    }
    let langs = OcrEngine::AvailableRecognizerLanguages().ok()?;
    if langs.Size().ok()? > 0 {
        return OcrEngine::TryCreateFromLanguage(&langs.GetAt(0).ok()?).ok();
    }
    None
}

/// Whether Windows can create an OCR engine with an installed language.
pub(crate) fn available() -> bool {
    init_com();
    engine().is_some()
}

/// Reads the text in a .bmp file of `width` by `height` pixels.
pub(crate) fn recognize(bmp: &[u8], width: u32, height: u32) -> Result<TextRead, EngineError> {
    init_com();
    let stream = step("stream-create", InMemoryRandomAccessStream::new())?;
    let writer = step("writer-create", DataWriter::CreateDataWriter(&stream))?;
    step("write-bytes", writer.WriteBytes(bmp))?;
    step("store", writer.StoreAsync().and_then(|op| op.join()))?;
    step("flush", writer.FlushAsync().and_then(|op| op.join()))?;
    step("detach-stream", writer.DetachStream())?;
    step("seek", stream.Seek(0))?;
    let decoder = step(
        "decoder",
        BitmapDecoder::CreateAsync(&stream).and_then(|op| op.join()),
    )?;
    let bitmap = step(
        "bitmap",
        decoder.GetSoftwareBitmapAsync().and_then(|op| op.join()),
    )?;
    let engine = engine().ok_or(EngineError::NoEngine)?;
    let result = step(
        "recognize",
        engine.RecognizeAsync(&bitmap).and_then(|op| op.join()),
    )?;

    let (w, h) = (width.max(1) as f32, height.max(1) as f32);
    let mut lines = Vec::new();
    for line in step("lines", result.Lines())? {
        let mut words = Vec::new();
        for word in step("words", line.Words())? {
            let r = step("bounding-rect", word.BoundingRect())?;
            words.push(Word {
                text: step("word-text", word.Text())?.to_string(),
                left: r.X / w,
                top: r.Y / h,
                width: r.Width / w,
                height: r.Height / h,
            });
        }
        lines.push(Line {
            text: step("line-text", line.Text())?.to_string(),
            words,
        });
    }
    Ok(TextRead {
        engine: "windows".into(),
        width,
        height,
        lines,
    })
}

/// Language tags of the installed Windows OCR language packs. Empty when
/// none are installed or WinRT fails.
pub(crate) fn languages() -> Vec<String> {
    init_com();
    let Ok(langs) = OcrEngine::AvailableRecognizerLanguages() else {
        return Vec::new();
    };
    let count = langs.Size().unwrap_or(0);
    (0..count)
        .filter_map(|i| langs.GetAt(i).ok())
        .filter_map(|lang| lang.LanguageTag().ok())
        .map(|tag| tag.to_string())
        .collect()
}
