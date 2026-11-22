//! A coarse brightness grid of a saved .bmp, to leave out test samples that
//! add nothing: a black capture, or the same screen read again a moment
//! later.

/// Columns and rows of the grid.
const COLUMNS: usize = 64;
const ROWS: usize = 36;

/// Every n-th pixel in both directions counts towards its cell; enough for a
/// brightness average and much faster than reading every pixel.
const STRIDE: usize = 4;

/// Below this mean difference per cell (0 to 255) two captures show the same
/// screen. Repeated reads of an unchanged screen differ by about 1 to 3 from
/// animated backgrounds; a changed list, card or hover differs by 8 or more.
const SAME_SCREEN: f32 = 4.0;

/// A capture whose brightest cell stays below this shows nothing.
const BLACK: u8 = 4;

/// The brightness grid of one capture.
#[derive(Debug, Clone, PartialEq)]
pub(crate) struct Thumbnail {
    cells: Vec<u8>,
}

impl Thumbnail {
    /// The grid of a 24-bit .bmp as written by `hexdesk_capture::bgra_to_bmp`,
    /// or `None` for anything else.
    pub(crate) fn from_bmp(bmp: &[u8]) -> Option<Thumbnail> {
        let header = bmp.get(..54)?;
        let read_u32 = |at: usize| u32::from_le_bytes(header[at..at + 4].try_into().unwrap());
        let read_i32 = |at: usize| i32::from_le_bytes(header[at..at + 4].try_into().unwrap());
        let read_u16 = |at: usize| u16::from_le_bytes(header[at..at + 2].try_into().unwrap());
        if &header[..2] != b"BM" || read_u16(28) != 24 || read_u32(30) != 0 {
            return None;
        }
        let offset = read_u32(10) as usize;
        let width = usize::try_from(read_i32(18)).ok()?;
        let height = read_i32(22).unsigned_abs() as usize;
        if width == 0 || height == 0 {
            return None;
        }
        let stride = (width * 3).div_ceil(4) * 4;
        if bmp.len() < offset + stride * height {
            return None;
        }
        let mut sums = vec![0u32; COLUMNS * ROWS];
        let mut counts = vec![0u32; COLUMNS * ROWS];
        for y in (0..height).step_by(STRIDE) {
            let row = offset + y * stride;
            let cell_row = y * ROWS / height;
            for x in (0..width).step_by(STRIDE) {
                let i = row + x * 3;
                let (b, g, r) = (bmp[i] as u32, bmp[i + 1] as u32, bmp[i + 2] as u32);
                let cell = cell_row * COLUMNS + x * COLUMNS / width;
                sums[cell] += (r * 299 + g * 587 + b * 114) / 1000;
                counts[cell] += 1;
            }
        }
        let cells = sums
            .iter()
            .zip(&counts)
            .map(|(sum, count)| if *count == 0 { 0 } else { (sum / count) as u8 })
            .collect();
        Some(Thumbnail { cells })
    }

    /// Whether the capture shows nothing at all.
    pub(crate) fn is_black(&self) -> bool {
        self.cells.iter().all(|cell| *cell < BLACK)
    }

    /// Whether `other` shows the same screen.
    pub(crate) fn same_screen(&self, other: &Thumbnail) -> bool {
        let total: u32 = self
            .cells
            .iter()
            .zip(&other.cells)
            .map(|(a, b)| a.abs_diff(*b) as u32)
            .sum();
        (total as f32 / self.cells.len() as f32) < SAME_SCREEN
    }
}

#[cfg(test)]
mod tests {
    use super::Thumbnail;

    /// A 128 x 72 capture filled by `pixel(x, y)`.
    fn capture(pixel: impl Fn(u32, u32) -> u8) -> Vec<u8> {
        let (width, height) = (128, 72);
        let mut bgra = Vec::new();
        for y in 0..height {
            for x in 0..width {
                let value = pixel(x, y);
                bgra.extend_from_slice(&[value, value, value, 255]);
            }
        }
        hexdesk_capture::bgra_to_bmp(&bgra, width, height)
    }

    fn thumbnail(pixel: impl Fn(u32, u32) -> u8) -> Thumbnail {
        Thumbnail::from_bmp(&capture(pixel)).expect("a capture bmp")
    }

    #[test]
    fn a_black_capture_is_black() {
        assert!(thumbnail(|_, _| 0).is_black());
        assert!(thumbnail(|_, _| 2).is_black());
        assert!(!thumbnail(|x, _| if x < 10 { 200 } else { 0 }).is_black());
    }

    #[test]
    fn small_noise_is_the_same_screen_and_a_changed_part_is_not() {
        let screen = thumbnail(|x, y| ((x + y) % 200) as u8);
        let noisy = thumbnail(|x, y| ((x + y) % 200) as u8 + ((x * y) % 3) as u8);
        assert!(screen.same_screen(&noisy));
        let changed = thumbnail(|x, y| if x < 64 { ((x + y) % 200) as u8 } else { 250 });
        assert!(!screen.same_screen(&changed));
    }

    #[test]
    fn anything_but_a_capture_bmp_has_no_thumbnail() {
        assert_eq!(Thumbnail::from_bmp(b"not an image"), None);
        let mut truncated = capture(|_, _| 100);
        truncated.truncate(100);
        assert_eq!(Thumbnail::from_bmp(&truncated), None);
    }
}
