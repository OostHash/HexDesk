//! Compare Windows OCR and ocrs on the same HexDesk BMP captures.

use std::path::{Path, PathBuf};
use std::time::Instant;

use hexdesk_capture::{recognize_bmp_with, set_model_dir, Provider};

fn bmp_dimensions(bytes: &[u8]) -> Result<(u32, u32), String> {
    if bytes.len() < 26 || &bytes[..2] != b"BM" {
        return Err("not a BMP file".to_string());
    }
    let i32_at = |offset: usize| {
        i32::from_le_bytes(
            bytes[offset..offset + 4]
                .try_into()
                .expect("four-byte BMP field"),
        )
    };
    let width = i32_at(18);
    let height = i32_at(22);
    if width <= 0 || height == 0 {
        return Err(format!("unsupported BMP dimensions {width}x{height}"));
    }
    Ok((width as u32, height.unsigned_abs()))
}

fn compare(path: &Path) -> Result<(), String> {
    let bytes = std::fs::read(path).map_err(|e| format!("read {}: {e}", path.display()))?;
    let (width, height) = bmp_dimensions(&bytes)?;
    println!("\n=== {} ({width}x{height}) ===", path.display());
    for provider in [Provider::Windows, Provider::Ocrs] {
        let started = Instant::now();
        match recognize_bmp_with(provider, &bytes, width, height) {
            Ok(read) => {
                println!(
                    "\n--- {provider:?}: {} ms, {} lines ---",
                    started.elapsed().as_millis(),
                    read.lines.len()
                );
                for line in read.lines {
                    println!("{}", line.text);
                }
            }
            Err(error) => println!(
                "\n--- {provider:?}: {} ms, ERROR: {error} ---",
                started.elapsed().as_millis()
            ),
        }
    }
    Ok(())
}

fn main() -> Result<(), String> {
    let mut args = std::env::args_os().skip(1);
    let model_dir = args
        .next()
        .map(PathBuf::from)
        .ok_or("usage: ocr_compare <model-dir> <capture.bmp> [capture.bmp ...]")?;
    let captures: Vec<PathBuf> = args.map(PathBuf::from).collect();
    if captures.is_empty() {
        return Err("provide at least one capture.bmp".to_string());
    }
    set_model_dir(model_dir);
    for capture in captures {
        compare(&capture)?;
    }
    Ok(())
}
