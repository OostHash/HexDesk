//! Pictures of the game: BGRA pixels, top row first.

/// A part of a frame, in fractions (0.0 to 1.0) of its width and height.
#[derive(Debug, Clone, Copy, PartialEq)]
pub struct Rect {
    pub left: f32,
    pub right: f32,
    pub top: f32,
    pub bottom: f32,
}

impl Rect {
    /// The whole frame.
    pub const FULL: Rect = Rect::new(0.0, 1.0, 0.0, 1.0);

    pub const fn new(left: f32, right: f32, top: f32, bottom: f32) -> Rect {
        Rect {
            left,
            right,
            top,
            bottom,
        }
    }
}

/// A picture as BGRA pixels, top row first.
#[derive(Debug, Clone, PartialEq, Eq)]
pub struct Frame {
    pub pixels: Vec<u8>,
    pub width: u32,
    pub height: u32,
}

impl Frame {
    pub fn new(pixels: Vec<u8>, width: u32, height: u32) -> Frame {
        Frame {
            pixels,
            width,
            height,
        }
    }

    /// A part of the frame. Fails when the part is smaller than 4 by 4 pixels.
    pub fn crop(&self, rect: Rect) -> Result<Frame, String> {
        let fraction =
            |f: f32, size: u32| ((size as f32 * f.clamp(0.0, 1.0)) as usize).min(size as usize);
        let (left, right) = (
            fraction(rect.left, self.width),
            fraction(rect.right, self.width),
        );
        let (top, bottom) = (
            fraction(rect.top, self.height),
            fraction(rect.bottom, self.height),
        );
        if right.saturating_sub(left) < 4 || bottom.saturating_sub(top) < 4 {
            return Err("Region too small".into());
        }
        let (width, height) = (right - left, bottom - top);
        let src_stride = self.width as usize * 4;
        let row_bytes = width * 4;
        let mut pixels = Vec::with_capacity(row_bytes * height);
        for row in top..bottom {
            let start = row * src_stride + left * 4;
            pixels.extend_from_slice(&self.pixels[start..start + row_bytes]);
        }
        Ok(Frame::new(pixels, width as u32, height as u32))
    }

    /// Grey with a mild contrast stretch, which OCR reads best. Element icons
    /// (Cold, Heat, Toxin) are coloured glyphs that make OCR drop a whole
    /// line; in grey they are neutral shapes, and the text around them is
    /// read.
    pub fn grayscale(&self) -> Frame {
        let mut pixels = self.pixels.clone();
        for px in pixels.chunks_exact_mut(4) {
            // Luminance 0.299 R + 0.587 G + 0.114 B, in BGRA order.
            let gray = ((u32::from(px[2]) * 299 + u32::from(px[1]) * 587 + u32::from(px[0]) * 114)
                / 1000)
                .min(255) as i32;
            // Stretch [20, 235] to [0, 255].
            let v = ((gray - 20) * 255 / 215).clamp(0, 255) as u8;
            px[0] = v;
            px[1] = v;
            px[2] = v;
        }
        Frame::new(pixels, self.width, self.height)
    }

    /// The frame with dark and light swapped. OCR reads dark text on a light
    /// background more reliably than light text on dark.
    pub fn inverted(&self) -> Frame {
        let mut pixels = self.pixels.clone();
        for px in pixels.chunks_exact_mut(4) {
            px[0] = 255 - px[0];
            px[1] = 255 - px[1];
            px[2] = 255 - px[2];
        }
        Frame::new(pixels, self.width, self.height)
    }

    /// The frame at twice the width and height, blended between pixels
    /// (bilinear). Windows OCR reads nothing in short texts such as a count
    /// badge when each pixel is only repeated: the letters come out blocky.
    pub fn upscale_2x(&self) -> Frame {
        let (w, h) = (self.width as usize, self.height as usize);
        // An output pixel lies a quarter pixel from its nearest source pixel
        // (weight 3) toward the next one (weight 1), clamped at the edges.
        let near = |o: usize, n: usize| {
            let i = o / 2;
            let j = if o.is_multiple_of(2) {
                i.saturating_sub(1)
            } else {
                (i + 1).min(n - 1)
            };
            (i, j)
        };
        let at = |x: usize, y: usize, c: usize| u32::from(self.pixels[(y * w + x) * 4 + c]);
        let mut out = vec![0u8; w * h * 16];
        for y in 0..h * 2 {
            let (ya, yb) = near(y, h);
            for x in 0..w * 2 {
                let (xa, xb) = near(x, w);
                let dst = (y * w * 2 + x) * 4;
                for c in 0..4 {
                    let sum =
                        9 * at(xa, ya, c) + 3 * at(xb, ya, c) + 3 * at(xa, yb, c) + at(xb, yb, c);
                    out[dst + c] = ((sum + 8) / 16) as u8;
                }
            }
        }
        Frame::new(out, self.width * 2, self.height * 2)
    }

    /// The frame at half the width and height, keeping every other pixel.
    pub fn downscale_2x(&self) -> Frame {
        let (w, nw, nh) = (
            self.width as usize,
            (self.width / 2) as usize,
            (self.height / 2) as usize,
        );
        let mut out = vec![0u8; nw * nh * 4];
        for y in 0..nh {
            for x in 0..nw {
                let src = (y * 2 * w + x * 2) * 4;
                let dst = (y * nw + x) * 4;
                out[dst..dst + 4].copy_from_slice(&self.pixels[src..src + 4]);
            }
        }
        Frame::new(out, self.width / 2, self.height / 2)
    }

    /// Average brightness (0 to 255), sampled every 64 pixels. A frame
    /// below 20 is black: the capture did not reach the game's picture.
    pub fn brightness(&self) -> u32 {
        let sum: u32 = self
            .pixels
            .chunks_exact(4)
            .step_by(64)
            .map(|p| (u32::from(p[0]) + u32::from(p[1]) + u32::from(p[2])) / 3)
            .sum();
        sum / (self.pixels.len() / 4 / 64).max(1) as u32
    }

    /// The brightest luminance (0 to 255) in a part of the frame, or None
    /// when the part is empty.
    pub fn max_luma(&self, rect: Rect) -> Option<u8> {
        let part = self.crop(rect).ok()?;
        part.pixels
            .chunks_exact(4)
            .map(|p| {
                ((u32::from(p[2]) * 299 + u32::from(p[1]) * 587 + u32::from(p[0]) * 114) / 1000)
                    as u8
            })
            .max()
    }

    /// Draws the border of a part of the frame in magenta, `thickness`
    /// pixels wide, inside the part.
    pub fn outline(&mut self, rect: Rect, thickness: u32) {
        let (w, h) = (self.width, self.height);
        let x0 = ((rect.left * w as f32) as u32).min(w.saturating_sub(1));
        let x1 = ((rect.right * w as f32) as u32).clamp(x0 + 1, w);
        let y0 = ((rect.top * h as f32) as u32).min(h.saturating_sub(1));
        let y1 = ((rect.bottom * h as f32) as u32).clamp(y0 + 1, h);
        let t = thickness.max(1);
        for y in y0..y1 {
            for x in x0..x1 {
                let edge = x < x0 + t || x + t >= x1 || y < y0 + t || y + t >= y1;
                if edge {
                    let i = ((y * w + x) * 4) as usize;
                    self.pixels[i..i + 3].copy_from_slice(&[255, 0, 255]);
                }
            }
        }
    }

    /// The frame as a .bmp file.
    pub fn to_bmp(&self) -> Vec<u8> {
        bgra_to_bmp(&self.pixels, self.width, self.height)
    }
}

/// BGRA pixels as a 24-bit, top-down .bmp file.
pub fn bgra_to_bmp(pixels: &[u8], width: u32, height: u32) -> Vec<u8> {
    let row_bytes = width * 3;
    let padding = (4 - row_bytes % 4) % 4;
    let image_size = (row_bytes + padding) * height;
    let file_size = 54 + image_size;

    let mut bmp = Vec::with_capacity(file_size as usize);
    bmp.extend_from_slice(b"BM");
    bmp.extend_from_slice(&file_size.to_le_bytes());
    bmp.extend_from_slice(&0u32.to_le_bytes());
    bmp.extend_from_slice(&54u32.to_le_bytes());
    bmp.extend_from_slice(&40u32.to_le_bytes());
    bmp.extend_from_slice(&(width as i32).to_le_bytes());
    // A negative height means the rows run top-down.
    bmp.extend_from_slice(&(-(height as i32)).to_le_bytes());
    bmp.extend_from_slice(&1u16.to_le_bytes());
    bmp.extend_from_slice(&24u16.to_le_bytes());
    bmp.extend_from_slice(&0u32.to_le_bytes());
    bmp.extend_from_slice(&image_size.to_le_bytes());
    for _ in 0..4 {
        bmp.extend_from_slice(&0u32.to_le_bytes());
    }
    for row in 0..height {
        for col in 0..width {
            let i = ((row * width + col) * 4) as usize;
            bmp.extend_from_slice(&[pixels[i], pixels[i + 1], pixels[i + 2]]);
        }
        bmp.extend(std::iter::repeat_n(0, padding as usize));
    }
    bmp
}

/// The RGB bytes of a .bmp file written by [`bgra_to_bmp`].
pub(crate) fn bmp_to_rgb(bmp: &[u8], width: u32, height: u32) -> Vec<u8> {
    let row_stride = ((width * 3 + 3) & !3) as usize;
    let mut rgb = Vec::with_capacity((width * height * 3) as usize);
    for row in 0..height as usize {
        let base = 54 + row * row_stride;
        for col in 0..width as usize {
            let i = base + col * 3;
            if i + 2 < bmp.len() {
                rgb.extend_from_slice(&[bmp[i + 2], bmp[i + 1], bmp[i]]);
            }
        }
    }
    rgb
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn an_outline_marks_only_the_border_of_the_part() {
        let mut frame = Frame::new(vec![0; 10 * 10 * 4], 10, 10);
        frame.outline(Rect::new(0.2, 0.8, 0.2, 0.8), 1);
        let px = |x: u32, y: u32| frame.pixels[((y * 10 + x) * 4) as usize];
        assert_eq!(px(2, 2), 255);
        assert_eq!(px(7, 5), 255);
        assert_eq!(px(5, 5), 0, "inside stays as it was");
        assert_eq!(px(1, 1), 0, "outside stays as it was");
    }

    fn frame(pixels: &[[u8; 4]], width: u32) -> Frame {
        let height = pixels.len() as u32 / width;
        Frame::new(pixels.concat(), width, height)
    }

    #[test]
    fn downscale_keeps_every_other_pixel() {
        let f = frame(&[[1; 4], [2; 4], [3; 4], [4; 4]], 2).downscale_2x();
        assert_eq!((f.width, f.height), (1, 1));
        assert_eq!(f.pixels, [1; 4]);
    }

    #[test]
    fn upscale_blends_between_pixels() {
        let f = frame(&[[0; 4], [160; 4]], 2).upscale_2x();
        assert_eq!((f.width, f.height), (4, 2));
        assert_eq!(
            &f.pixels[..16],
            [[0; 4], [40; 4], [120; 4], [160; 4]].concat()
        );
        assert_eq!(f.pixels[16..32], f.pixels[..16]);
    }

    #[test]
    fn crop_takes_the_part_in_fractions() {
        let pixels: Vec<[u8; 4]> = (0..64).map(|i| [i as u8; 4]).collect();
        let f = frame(&pixels, 8)
            .crop(Rect::new(0.5, 1.0, 0.0, 0.5))
            .unwrap();
        assert_eq!((f.width, f.height), (4, 4));
        assert_eq!(&f.pixels[..4], [4; 4]);
        assert!(frame(&pixels, 8)
            .crop(Rect::new(0.0, 0.25, 0.0, 1.0))
            .is_err());
    }

    #[test]
    fn inverting_swaps_dark_and_light_and_keeps_alpha() {
        let f = frame(&[[0, 100, 255, 7]], 1).inverted();
        assert_eq!(f.pixels, [255, 155, 0, 7]);
    }

    #[test]
    fn the_brightest_pixel_of_a_part() {
        let pixels: Vec<[u8; 4]> = (0..64).map(|i| [i as u8 * 2; 4]).collect();
        let f = frame(&pixels, 8);
        assert_eq!(f.max_luma(Rect::new(0.0, 0.5, 0.0, 0.5)), Some(54));
        assert_eq!(f.max_luma(Rect::FULL), Some(126));
    }

    #[test]
    fn a_bmp_round_trips_to_rgb() {
        let f = frame(&[[10, 20, 30, 255], [40, 50, 60, 255]], 2);
        let rgb = bmp_to_rgb(&f.to_bmp(), 2, 1);
        assert_eq!(rgb, [30, 20, 10, 60, 50, 40]);
    }
}
