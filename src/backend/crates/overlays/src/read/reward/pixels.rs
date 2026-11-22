//! What the pixels of the reward screen say: where the rarity bars under the
//! cards are, and what shape a card's icon has.

use hexdesk_capture::Frame;

/// What a card's icon looks like, which narrows the rewards it can be when
/// its name was read badly.
#[derive(Debug, Clone, Copy, PartialEq)]
pub enum IconType {
    /// A part icon that many primes share, by the part it shows
    /// ("chassis", "barrel").
    Component(&'static str),
    /// The model of a whole warframe or weapon: a blueprint.
    FullModel,
    /// The blue Forma spiral.
    Forma,
    Unknown,
}

/// The coloured rarity bars under the reward cards: the centre of each bar
/// and the height of the bars, in fractions of the frame, with a line that
/// says what the scan found.
pub(super) fn find_rarity_bars(frame: &Frame) -> (Option<(Vec<f32>, f32)>, String) {
    let (pixels, pix_w, pix_h) = (&frame.pixels, frame.width, frame.height);
    let x_lo = (pix_w as f32 * 0.05) as u32;
    let x_hi = (pix_w as f32 * 0.95) as u32;
    let y_lo = (pix_h as f32 * 0.55) as u32;
    let y_hi = (pix_h as f32 * 0.97) as u32;

    let scan_w = (x_hi - x_lo) as usize;

    #[inline]
    fn is_bar_pixel(b: u32, g: u32, r: u32) -> bool {
        let lum = (r + g + b) / 3;
        if lum < 25 {
            return false;
        }
        let is_orange = r > 80 && r > b + 20;
        let is_teal = b > 65 && g > 50 && b > r + 8;
        let is_gold = r > 100 && g > 80 && b < r.saturating_sub(10);
        let max_ch = r.max(g).max(b);
        let min_ch = r.min(g).min(b);
        let is_bright = lum > 160 && max_ch - min_ch < 50;
        is_orange || is_teal || is_gold || is_bright
    }

    let mut col_score = vec![0u32; scan_w];
    for y in y_lo..y_hi {
        for (xi, x) in (x_lo..x_hi).enumerate() {
            let i = ((y * pix_w + x) * 4) as usize;
            if i + 2 < pixels.len()
                && is_bar_pixel(pixels[i] as u32, pixels[i + 1] as u32, pixels[i + 2] as u32)
            {
                col_score[xi] += 1;
            }
        }
    }

    let max_col = col_score.iter().max().copied().unwrap_or(0);
    if max_col < 2 {
        return (
            None,
            format!(
                "no bars — column projection: max_col={} (need ≥2; y={:.0}–{:.0}%)",
                max_col,
                y_lo as f32 / pix_h as f32 * 100.0,
                y_hi as f32 / pix_h as f32 * 100.0,
            ),
        );
    }

    let col_threshold = (max_col / 4).max(2);
    let mut lit: Vec<bool> = col_score.iter().map(|&s| s >= col_threshold).collect();

    let bridge = (scan_w / 100).max(3);
    {
        let mut xi = 0;
        while xi < scan_w {
            if !lit[xi] {
                let gap_start = xi;
                while xi < scan_w && !lit[xi] {
                    xi += 1;
                }
                let gap_len = xi - gap_start;
                if gap_len <= bridge && gap_start > 0 && xi < scan_w {
                    lit[gap_start..xi].fill(true);
                }
            } else {
                xi += 1;
            }
        }
    }

    let min_band = (scan_w / 150).max(6);
    let mut bands: Vec<(usize, usize)> = Vec::new();
    let mut in_band = false;
    let mut band_start = 0usize;
    for (xi, &is_lit) in lit.iter().enumerate().take(scan_w) {
        match (is_lit, in_band) {
            (true, false) => {
                band_start = xi;
                in_band = true;
            }
            (false, true) => {
                if xi - band_start >= min_band {
                    bands.push((band_start, xi));
                }
                in_band = false;
            }
            _ => {}
        }
    }
    if in_band && scan_w - band_start >= min_band {
        bands.push((band_start, scan_w));
    }

    let lit_count = lit.iter().filter(|&&b| b).count();
    if bands.is_empty() {
        return (
            None,
            format!(
                "no bars — {} lit columns (threshold={}/{}), no segment ≥{}px (bridge={}px)",
                lit_count, col_threshold, max_col, min_band, bridge
            ),
        );
    }
    if bands.len() > 4 {
        return (
            None,
            format!(
                "no bars — {} segments after bridging (expected 1–4); max_col={}, threshold={}",
                bands.len(),
                max_col,
                col_threshold
            ),
        );
    }

    let lit_xs: Vec<u32> = (0..scan_w as u32)
        .filter(|&xi| lit[xi as usize])
        .map(|xi| x_lo + xi)
        .collect();

    let mut best_row_y = (y_lo + y_hi) / 2;
    let mut best_row_cnt = 0u32;
    for y in y_lo..y_hi {
        let mut cnt = 0u32;
        for &x in &lit_xs {
            let i = ((y * pix_w + x) * 4) as usize;
            if i + 2 < pixels.len()
                && is_bar_pixel(pixels[i] as u32, pixels[i + 1] as u32, pixels[i + 2] as u32)
            {
                cnt += 1;
            }
        }
        if cnt > best_row_cnt {
            best_row_cnt = cnt;
            best_row_y = y;
        }
    }

    let centers: Vec<f32> = bands
        .iter()
        .map(|(s, e)| {
            let best_xi = (*s..*e)
                .max_by_key(|&xi| col_score[xi])
                .unwrap_or((s + e) / 2);
            (x_lo as f32 + best_xi as f32) / pix_w as f32
        })
        .collect();

    let bar_y = best_row_y as f32 / pix_h as f32;
    let diag =
        format!(
        "{} bars — centers x=[{}], bar_y={:.2} ({:.0}%), max_col={}px, threshold={}px, lit={}px",
        bands.len(),
        centers.iter().map(|x| format!("{:.3}", x)).collect::<Vec<_>>().join(", "),
        bar_y, bar_y * 100.0, max_col, col_threshold, lit_count,
    );
    (Some((centers, bar_y)), diag)
}

/// The shape of a card's icon, from an 8 by 8 grid of brightness over the
/// area above its rarity bar.
pub(super) fn classify_card_icon(frame: &Frame, x_left: f32, x_right: f32, bar_y: f32) -> IconType {
    let pix_h = frame.height;
    let iy_top = ((bar_y - 0.28).max(0.0) * pix_h as f32) as u32;
    let iy_bot = ((bar_y - 0.04).min(1.0) * pix_h as f32) as u32;
    let ix_lo = (x_left * frame.width as f32) as u32;
    let ix_hi = (x_right * frame.width as f32).min(frame.width as f32) as u32;
    if ix_hi <= ix_lo || iy_bot <= iy_top {
        return IconType::Unknown;
    }
    let (pixels, pix_w) = (&frame.pixels, frame.width);

    const G: usize = 8;
    let mut lum = [[0.0f32; G]; G];
    let mut blue = [[0.0f32; G]; G];
    let mut cnt = [[0u32; G]; G];

    for y in iy_top..iy_bot {
        let gy = (((y - iy_top) as f32 / (iy_bot - iy_top) as f32) * G as f32).min(G as f32 - 1.0)
            as usize;
        for x in ix_lo..ix_hi {
            let gx = (((x - ix_lo) as f32 / (ix_hi - ix_lo) as f32) * G as f32).min(G as f32 - 1.0)
                as usize;
            let i = ((y * pix_w + x) * 4) as usize;
            if i + 2 >= pixels.len() {
                continue;
            }
            let b = pixels[i] as f32;
            let g = pixels[i + 1] as f32;
            let r = pixels[i + 2] as f32;
            lum[gy][gx] += (r + g + b) / 3.0;
            blue[gy][gx] += b;
            cnt[gy][gx] += 1;
        }
    }
    for gy in 0..G {
        for gx in 0..G {
            if cnt[gy][gx] > 0 {
                lum[gy][gx] /= cnt[gy][gx] as f32;
                blue[gy][gx] /= cnt[gy][gx] as f32;
            }
        }
    }

    let total_cells = G * G;
    let lit_cells = lum.iter().flatten().filter(|&&l| l > 60.0).count();
    let fill_ratio = lit_cells as f32 / total_cells as f32;

    let mut min_x = G;
    let mut max_x = 0usize;
    let mut min_y = G;
    let mut max_y = 0usize;
    for (gy, row) in lum.iter().enumerate() {
        for (gx, &l) in row.iter().enumerate() {
            if l > 60.0 {
                min_x = min_x.min(gx);
                max_x = max_x.max(gx);
                min_y = min_y.min(gy);
                max_y = max_y.max(gy);
            }
        }
    }
    let bb_w = if max_x >= min_x {
        (max_x - min_x + 1) as f32
    } else {
        0.0
    };
    let bb_h = if max_y >= min_y {
        (max_y - min_y + 1) as f32
    } else {
        0.0
    };
    let aspect = if bb_h > 0.0 { bb_w / bb_h } else { 0.0 };

    let mut sum_y = 0.0f32;
    let mut sum_lum = 0.0f32;
    for (gy, row) in lum.iter().enumerate() {
        for &l in row.iter() {
            sum_y += l * gy as f32;
            sum_lum += l;
        }
    }
    let cm_y = if sum_lum > 0.0 {
        sum_y / sum_lum / (G - 1) as f32
    } else {
        0.5
    };

    let mut left_sum = 0.0f32;
    let mut right_sum = 0.0f32;
    for row in lum.iter() {
        for &l in &row[..G / 2] {
            left_sum += l;
        }
    }
    for row in lum.iter() {
        for &l in &row[G / 2..] {
            right_sum += l;
        }
    }
    let symmetry = if left_sum + right_sum > 0.0 {
        left_sum.min(right_sum) / left_sum.max(right_sum)
    } else {
        0.0
    };

    let blue_avg: f32 = blue.iter().flatten().sum::<f32>() / total_cells as f32;
    let lum_avg: f32 = lum.iter().flatten().sum::<f32>() / total_cells as f32;
    let blue_dom = if lum_avg > 0.0 {
        blue_avg / lum_avg
    } else {
        0.0
    };

    // Forma: blue spiral
    if blue_dom > 0.55 && fill_ratio > 0.15 {
        return IconType::Forma;
    }
    // Full model: high fill + even spread
    if fill_ratio > 0.45 && aspect > 0.6 && aspect < 1.8 {
        return IconType::FullModel;
    }
    // neuroptics: bright top half, symmetric, roughly square
    if cm_y < 0.45 && symmetry > 0.7 && aspect > 0.7 && aspect < 1.3 {
        return IconType::Component("neuroptics");
    }
    // systems: bright central region, compact
    if cm_y > 0.35 && cm_y < 0.65 && fill_ratio > 0.25 && fill_ratio < 0.55 {
        return IconType::Component("systems");
    }
    // chassis: large central region, wider, lower CoM
    if cm_y > 0.45 && fill_ratio > 0.35 && aspect > 1.0 {
        return IconType::Component("chassis");
    }
    // barrel: wide aspect ratio
    if aspect > 1.5 {
        return IconType::Component("barrel");
    }
    // handle: tall aspect ratio
    if aspect < 0.5 && bb_h > 3.0 {
        return IconType::Component("handle");
    }
    // blade: low symmetry, moderate aspect
    if symmetry < 0.5 && fill_ratio > 0.2 {
        return IconType::Component("blade");
    }
    // upper/lower limb: low fill, arc-shaped
    if fill_ratio < 0.2 && bb_h > 2.0 {
        return IconType::Component("limb");
    }

    IconType::Unknown
}
