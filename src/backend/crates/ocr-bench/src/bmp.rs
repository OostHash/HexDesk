//! Reading the .bmp files HexDesk saves as captures.

use hexdesk_capture::Frame;

/// A 24- or 32-bit uncompressed .bmp file as a BGRA frame. Rows may run
/// top-down (negative height, as HexDesk writes them) or bottom-up.
pub fn decode(bytes: &[u8]) -> Result<Frame, String> {
    if bytes.len() < 54 || &bytes[..2] != b"BM" {
        return Err("not a BMP file".to_string());
    }
    let u32_at = |at: usize| u32::from_le_bytes(bytes[at..at + 4].try_into().unwrap());
    let i32_at = |at: usize| i32::from_le_bytes(bytes[at..at + 4].try_into().unwrap());
    let offset = u32_at(10) as usize;
    let width = i32_at(18);
    let height = i32_at(22);
    let bits = u16::from_le_bytes([bytes[28], bytes[29]]);
    let compression = u32_at(30);
    if width <= 0 || height == 0 || compression != 0 || !(bits == 24 || bits == 32) {
        return Err(format!(
            "unsupported BMP: {width}x{height}, {bits} bits, compression {compression}"
        ));
    }
    let (width, rows) = (width as usize, height.unsigned_abs() as usize);
    let bytes_per_pixel = bits as usize / 8;
    let stride = (width * bytes_per_pixel + 3) & !3;
    if bytes.len() < offset + stride * rows {
        return Err("BMP pixel data is cut off".to_string());
    }
    let mut pixels = Vec::with_capacity(width * rows * 4);
    for row in 0..rows {
        let source = if height < 0 { row } else { rows - 1 - row };
        let start = offset + source * stride;
        for px in bytes[start..start + width * bytes_per_pixel].chunks_exact(bytes_per_pixel) {
            pixels.extend_from_slice(&[px[0], px[1], px[2], 255]);
        }
    }
    Ok(Frame::new(pixels, width as u32, rows as u32))
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn a_bmp_written_by_hexdesk_reads_back() {
        let pixels = vec![10, 20, 30, 255, 40, 50, 60, 255, 70, 80, 90, 255];
        let bmp = hexdesk_capture::bgra_to_bmp(&pixels, 3, 1);
        let frame = decode(&bmp).unwrap();
        assert_eq!((frame.width, frame.height), (3, 1));
        assert_eq!(frame.pixels, pixels);
    }
}
