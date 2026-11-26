//! ocrs, a pure-Rust OCR engine (<https://github.com/robertknight/ocrs>).
//! It runs where Windows OCR is not available: no English language pack,
//! some LTSC and managed Windows images, other platforms. Its two model
//! files (about 12 MB) are downloaded to the model folder on first use.

use std::io::Read as _;
use std::path::{Path, PathBuf};
use std::sync::{Mutex, OnceLock};

use ocrs::{ImageSource, OcrEngine, OcrEngineParams, TextItem};
use rten::Model;
use sha2::{Digest, Sha256};

use super::EngineError;
use crate::text::{Line, TextRead, Word};

struct ModelFile {
    name: &'static str,
    url: &'static str,
    bytes: usize,
    sha256: &'static str,
}

const MODELS: [ModelFile; 2] = [
    ModelFile {
        name: "text-detection.onnx",
        url: "https://ocrs-models.s3-accelerate.amazonaws.com/text-detection.onnx",
        bytes: 2_499_479,
        sha256: "a917b23dbd9524b465df7e922641b3ff2981623df4ded5a0234004ef2fee7cfe",
    },
    ModelFile {
        name: "text-recognition.onnx",
        url: "https://ocrs-models.s3-accelerate.amazonaws.com/text-recognition.onnx",
        bytes: 9_713_177,
        sha256: "86c145c2edb96c8caed5b1ebb8f44d706408922211451c309c625157dd6061c5",
    },
];

static MODEL_DIR: OnceLock<PathBuf> = OnceLock::new();

/// The engine once its models loaded. A failure is not kept, so the next
/// read tries again.
static ENGINE: Mutex<Option<OcrEngine>> = Mutex::new(None);

/// Sets the folder the models are kept in. Called once at startup.
pub(crate) fn set_model_dir(dir: PathBuf) {
    let _ = MODEL_DIR.set(dir);
}

fn valid_model(bytes: &[u8], model: &ModelFile) -> bool {
    bytes.len() == model.bytes && sha256_hex(bytes) == model.sha256
}

fn sha256_hex(bytes: &[u8]) -> String {
    Sha256::digest(bytes)
        .iter()
        .map(|b| format!("{b:02x}"))
        .collect()
}

/// Writes to a `.tmp` file and renames it when complete, so a cut-off
/// download is never taken for a model.
fn download(model: &ModelFile, dest: &Path) -> Result<(), String> {
    tracing::info!(
        url = model.url,
        model = model.name,
        "OCR model download started"
    );
    let mut body = Vec::new();
    ureq::get(model.url)
        .call()
        .map_err(|e| format!("download {}: {e}", model.url))?
        .into_reader()
        .read_to_end(&mut body)
        .map_err(|e| format!("read {}: {e}", model.url))?;
    if !valid_model(&body, model) {
        return Err(format!(
            "{} did not match the expected size and SHA-256 checksum",
            model.name
        ));
    }
    let tmp = dest.with_extension("tmp");
    std::fs::write(&tmp, &body).map_err(|e| format!("write {}: {e}", tmp.display()))?;
    std::fs::rename(&tmp, dest).map_err(|e| format!("rename to {}: {e}", dest.display()))?;
    tracing::info!(
        model = model.name,
        bytes = body.len(),
        "OCR model downloaded"
    );
    Ok(())
}

fn load_engine() -> Result<OcrEngine, String> {
    let dir = MODEL_DIR.get().ok_or("model folder not set")?;
    std::fs::create_dir_all(dir).map_err(|e| format!("create {}: {e}", dir.display()))?;
    for model in &MODELS {
        let path = dir.join(model.name);
        let valid = std::fs::read(&path)
            .map(|bytes| valid_model(&bytes, model))
            .unwrap_or(false);
        if !valid {
            let _ = std::fs::remove_file(&path);
            download(model, &path)?;
        }
    }
    let detection = dir.join(MODELS[0].name);
    let recognition = dir.join(MODELS[1].name);
    // A model that does not load is a damaged download; removing it makes
    // the next read download it again.
    let load = |path: &Path| {
        Model::load_file(path).map_err(|e| {
            let _ = std::fs::remove_file(path);
            format!("load {}: {e}", path.display())
        })
    };
    OcrEngine::new(OcrEngineParams {
        detection_model: Some(load(&detection)?),
        recognition_model: Some(load(&recognition)?),
        ..Default::default()
    })
    .map_err(|e| format!("engine set-up: {e}"))
}

/// Whether a read can start without a download: the models are loaded, or
/// on disk at their expected size.
pub(crate) fn ready() -> bool {
    if ENGINE.try_lock().is_ok_and(|engine| engine.is_some()) {
        return true;
    }
    let Some(dir) = MODEL_DIR.get() else {
        return false;
    };
    MODELS.iter().all(|model| {
        std::fs::metadata(dir.join(model.name)).is_ok_and(|meta| meta.len() == model.bytes as u64)
    })
}

/// Downloads, validates and loads the models without performing a screen read.
pub(crate) fn prepare() -> Result<(), String> {
    let mut guard = ENGINE.lock().unwrap_or_else(|e| e.into_inner());
    if guard.is_none() {
        *guard = Some(load_engine()?);
    }
    Ok(())
}

/// Reads the text in a .bmp file of `width` by `height` pixels.
pub(crate) fn recognize(bmp: &[u8], width: u32, height: u32) -> Result<TextRead, EngineError> {
    prepare().map_err(EngineError::Failed)?;
    let guard = ENGINE.lock().unwrap_or_else(|e| e.into_inner());
    let Some(engine) = guard.as_ref() else {
        return Err(EngineError::NoEngine);
    };
    let failed =
        |step: &str, e: &dyn std::fmt::Display| EngineError::Failed(format!("[{step}] {e}"));
    let rgb = crate::frame::bmp_to_rgb(bmp, width, height);
    let source = ImageSource::from_bytes(&rgb, (width, height)).map_err(|e| failed("image", &e))?;
    let input = engine
        .prepare_input(source)
        .map_err(|e| failed("prepare", &e))?;
    let found = engine
        .detect_words(&input)
        .map_err(|e| failed("detect", &e))?;
    let groups = engine.find_text_lines(&input, &found);
    let recognized = engine
        .recognize_text(&input, &groups)
        .map_err(|e| failed("recognize", &e))?;

    let (w, h) = (width.max(1) as f32, height.max(1) as f32);
    let lines = recognized
        .iter()
        .flatten()
        .map(|line| {
            let words: Vec<Word> = line
                .words()
                .map(|word| {
                    let r = word.bounding_rect();
                    Word {
                        text: word.to_string(),
                        left: r.left() as f32 / w,
                        top: r.top() as f32 / h,
                        width: r.width() as f32 / w,
                        height: r.height() as f32 / h,
                    }
                })
                .collect();
            Line {
                text: line.to_string(),
                words,
            }
        })
        .filter(|line| !line.text.trim().is_empty())
        .collect();
    Ok(TextRead {
        engine: "ocrs".into(),
        width,
        height,
        lines,
    })
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn sha256_hex_is_lower_case_hex() {
        assert_eq!(
            sha256_hex(b"abc"),
            "ba7816bf8f01cfea414140de5dae2223b00361a396177a9cb410ff61f20015ad"
        );
    }
}
