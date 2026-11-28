//! Overlay windows: placing, showing and hiding them. The windows are declared
//! in `src/backend/tauri.conf.json` and live as long as the app.

use tauri::Manager;

use crate::app_state::AppState;

/// The Relic Pick window.
pub(crate) const RELIC_PICK: &str = "relic-pick-overlay";

/// The riven check window.
pub(crate) const RIVEN: &str = "riven-overlay";

/// The short status line above the game window.
pub(crate) const STATUS: &str = "overlay-status";

/// Transparent WebView2 windows stay alive at this physical y coordinate.
const PARKED_Y: i32 = -3000;

/// The riven window's width at text size 100 %; the window widens itself
/// with the text size chosen in the app.
const RIVEN_WIDTH: f64 = 300.0;
/// Gap between the Relic Pick window and the monitor's right edge, in
/// logical pixels.
const PICK_RIGHT_MARGIN: f64 = 100.0;

const STATUS_WIDTH: f64 = 440.0;
const STATUS_HEIGHT: f64 = 52.0;
const TESTING_FEEDBACK_WIDTH: f64 = 620.0;
const TESTING_FEEDBACK_HEIGHT: f64 = 100.0;

/// One overlay's saved x/y offset (logical pixels) from settings.json.
/// Missing settings or missing axes mean 0, which keeps the built-in placement.
pub(crate) fn saved_offset(app: &tauri::AppHandle, prefix: &str) -> (f64, f64) {
    let Some(state) = app.try_state::<AppState>() else {
        return (0.0, 0.0);
    };
    let settings = state.settings.snapshot();
    let Some(obj) = settings.get("overlayOffsets").and_then(|v| v.as_object()) else {
        return (0.0, 0.0);
    };
    let axis = |suffix: &str| -> f64 {
        obj.get(&format!("{prefix}{suffix}"))
            .and_then(|v| v.as_f64())
            .unwrap_or(0.0)
    };
    (axis("X"), axis("Y"))
}

/// Left edge of the Relic Pick window, in logical pixels: its right edge
/// sits `PICK_RIGHT_MARGIN` from the monitor's right edge, whatever width
/// the window has (it follows the text size), then the user's offset.
pub(crate) fn pick_x(monitor_width: f64, window_width: f64, offset_x: f64) -> f64 {
    (monitor_width - PICK_RIGHT_MARGIN - window_width + offset_x).round()
}

/// Places the Relic Pick window at the right edge of the primary monitor,
/// 20 px from the top, plus the user's offset (Settings → Overlays), and
/// shows it. The window keeps its right edge when it resizes to its content
/// (`fitPickWindow` in src/frontend/src/api/overlays.ts).
pub(crate) fn show_relic_pick(app: &tauri::AppHandle) -> Result<(), String> {
    let win = app
        .get_webview_window(RELIC_PICK)
        .ok_or("its window does not exist")?;
    let monitor_width = win
        .primary_monitor()
        .ok()
        .flatten()
        .map_or(1920.0, |m| m.size().width as f64 / m.scale_factor());
    let scale = win.scale_factor().unwrap_or(1.0);
    let window_width = win.outer_size().map_or(460.0, |s| s.width as f64 / scale);
    let (off_x, off_y) = saved_offset(app, "relicPick");
    let _ = win.set_position(tauri::Position::Logical(tauri::LogicalPosition {
        x: pick_x(monitor_width, window_width, off_x),
        y: 20.0 + off_y,
    }));
    win.show().map_err(|e| e.to_string())
}

/// Where the riven window goes, in logical pixels: 10 px from the game
/// window's left edge, from 20 % to 80 % of its height, moved by the user's
/// offset. `game` is the game window in physical pixels (x, y, width,
/// height) and `scale` the scale factor of its monitor.
pub(crate) fn riven_place(game: [i32; 4], scale: f64, offset: (f64, f64)) -> (f64, f64, f64, f64) {
    let scale = if scale > 0.0 { scale } else { 1.0 };
    let [x, y, _, h] = game.map(|v| v as f64 / scale);
    (
        (x + 10.0 + offset.0).round(),
        (y + h * 0.2 + offset.1).round(),
        RIVEN_WIDTH,
        (h * 0.6).round(),
    )
}

/// The game client area and its monitor scale, or the primary monitor when
/// the game is not running.
fn game_area(win: &tauri::WebviewWindow) -> Result<([i32; 4], f64), String> {
    let game = get_warframe_window_rect().or_else(|why| {
        let monitor = win
            .primary_monitor()
            .ok()
            .flatten()
            .ok_or(format!("{why}; no monitor found either"))?;
        let (p, s) = (monitor.position(), monitor.size());
        Ok::<_, String>([p.x, p.y, s.width as i32, s.height as i32])
    })?;
    let scale = win
        .available_monitors()
        .ok()
        .and_then(|monitors| {
            monitors.into_iter().find(|m| {
                let (p, s) = (m.position(), m.size());
                game[0] >= p.x
                    && game[0] < p.x + s.width as i32
                    && game[1] >= p.y
                    && game[1] < p.y + s.height as i32
            })
        })
        .or_else(|| win.primary_monitor().ok().flatten())
        .map_or(1.0, |m| m.scale_factor());
    Ok((game, scale))
}

/// Places the riven window beside the riven card over the game window, or
/// on the primary monitor when the game is not running, and shows it.
pub(crate) fn show_riven(app: &tauri::AppHandle) -> Result<(), String> {
    let win = app
        .get_webview_window(RIVEN)
        .ok_or("its window does not exist")?;
    let (game, scale) = game_area(&win)?;
    let (x, y, width, height) = riven_place(game, scale, saved_offset(app, "riven"));
    let _ = win.set_size(tauri::Size::Logical(tauri::LogicalSize { width, height }));
    let _ = win.set_position(tauri::Position::Logical(tauri::LogicalPosition { x, y }));
    win.show().map_err(|e| e.to_string())
}

/// Physical bounds for the status line, centred 16 logical pixels below the
/// top of the game client area.
fn status_bounds(game: [i32; 4], scale: f64, offset: (f64, f64)) -> (i32, i32, u32, u32) {
    let scale = if scale > 0.0 { scale } else { 1.0 };
    let width = (STATUS_WIDTH * scale).round() as u32;
    let height = (STATUS_HEIGHT * scale).round() as u32;
    let x = game[0] + ((game[2] - width as i32) as f64 / 2.0 + offset.0 * scale).round() as i32;
    let y = game[1] + ((16.0 + offset.1) * scale).round() as i32;
    (x, y, width, height)
}

/// Places the click-through status line at the top centre of the game window.
#[tauri::command]
pub(crate) fn show_overlay_status_window(app: tauri::AppHandle) -> Result<(), String> {
    show_status(&app, STATUS_WIDTH, STATUS_HEIGHT)
}

/// Places the persistent Page Up/Page Down prompt over the game.
pub(crate) fn show_testing_feedback(app: &tauri::AppHandle) -> Result<(), String> {
    show_status(app, TESTING_FEEDBACK_WIDTH, TESTING_FEEDBACK_HEIGHT)
}

fn show_status(app: &tauri::AppHandle, width: f64, height: f64) -> Result<(), String> {
    let win = app
        .get_webview_window(STATUS)
        .ok_or("its window does not exist")?;
    let (game, scale) = game_area(&win)?;
    let mut bounds = status_bounds(game, scale, saved_offset(app, "status"));
    bounds.0 -= (((width - STATUS_WIDTH) * scale) / 2.0).round() as i32;
    bounds.2 = (width * scale).round() as u32;
    bounds.3 = (height * scale).round() as u32;
    let (x, y, width, height) = bounds;
    let _ = win.set_size(tauri::Size::Physical(tauri::PhysicalSize { width, height }));
    let _ = win.set_position(tauri::Position::Physical(tauri::PhysicalPosition { x, y }));
    let _ = win.set_always_on_top(true);
    win.show().map_err(|e| e.to_string())
}

/// Returns the Warframe game CLIENT AREA as [x, y, width, height] in screen pixels.
/// Uses GetClientRect + ClientToScreen so the rect matches what the OCR captures —
/// both exclude the window title bar and borders in windowed mode.
#[tauri::command]
pub(crate) fn get_warframe_window_rect() -> Result<[i32; 4], String> {
    use hexdesk_platform::{Platform, WindowManager};
    Platform::get_warframe_window_rect()
}

/// Position and show the pick window without emitting a payload — used by the
/// outline toggle and by live offset changes, which only need the placement.
#[tauri::command]
pub(crate) fn show_relic_pick_window(app: tauri::AppHandle) {
    if let Err(reason) = show_relic_pick(&app) {
        hexdesk_diag::debug!(relic_pick, reason = %reason, "Relic Pick preview not shown");
    }
}

/// Reposition the pre-declared relic-overlay window and bring it on screen.
/// The overlay is pre-declared in tauri.conf.json at y=-3000 (off-screen) so
/// WebView2 initialises at app startup. We never create/destroy it — just move it.
#[tauri::command]
pub(crate) fn show_overlay_window(
    app: tauri::AppHandle,
    x: i32,
    y: i32,
    w: u32,
    h: u32,
) -> Result<(), String> {
    let win = app
        .get_webview_window("relic-overlay")
        .ok_or_else(|| "relic-overlay window not found".to_string())?;
    let _ = win.set_size(tauri::Size::Physical(tauri::PhysicalSize {
        width: w,
        height: h,
    }));
    // Caller passes physical pixels, offsets are stored as logical — scale them
    // with the window's own monitor so the shift reads the same at any DPI.
    let (off_x, off_y) = saved_offset(&app, "relic");
    let scale = win.scale_factor().unwrap_or(1.0);
    let _ = win.set_position(tauri::Position::Physical(tauri::PhysicalPosition {
        x: x + (off_x * scale).round() as i32,
        y: y + (off_y * scale).round() as i32,
    }));
    let _ = win.show();
    let _ = win.set_always_on_top(true);

    // On Windows 10, WebView2 defers loading the page when the window starts
    // off-screen. If it's still on about:blank, navigate to the overlay URL now.
    if let Ok(url) = win.url() {
        if url.as_str() == "about:blank" || url.as_str().starts_with("about:") {
            hexdesk_diag::debug!(
                overlay,
                url = %url,
                "WebView2 deferred load detected, navigating to overlay URL"
            );
            let overlay_url = if cfg!(debug_assertions) {
                "http://localhost:1420/index.html?overlay"
            } else {
                "tauri://localhost/index.html?overlay"
            };
            if let Ok(nav_url) = tauri::Url::parse(overlay_url) {
                let _ = win.navigate(nav_url);
            }
        }
    }

    Ok(())
}

/// Move the relic-overlay window back off-screen (visual "close" without destroying it).
/// Destroying and recreating transparent WebView2 windows deadlocks on Windows.
#[tauri::command]
pub(crate) fn move_overlay_offscreen(app: tauri::AppHandle) -> Result<(), String> {
    park(&app, "relic-overlay")
}

/// Parks the Relic Reward window off screen: the window lives as long as
/// the app, so WebView2 keeps its page loaded.
pub(crate) fn park_reward(app: &tauri::AppHandle) {
    let _ = park(app, "relic-overlay");
}

/// Parks the Relic Pick window without suspending its transparent WebView2.
pub(crate) fn park_relic_pick(app: &tauri::AppHandle) -> Result<(), String> {
    park(app, RELIC_PICK)
}

/// Settings previews use the same lifetime-safe close path as live Relic Pick.
#[tauri::command]
pub(crate) fn park_relic_pick_window(app: tauri::AppHandle) -> Result<(), String> {
    park_relic_pick(&app)
}

fn park(app: &tauri::AppHandle, label: &str) -> Result<(), String> {
    let win = app
        .get_webview_window(label)
        .ok_or("its window does not exist")?;
    win.set_position(tauri::Position::Physical(tauri::PhysicalPosition {
        x: 0,
        y: PARKED_Y,
    }))
    .map_err(|e| e.to_string())
}

/// Hides an overlay window.
pub(crate) fn hide(app: &tauri::AppHandle, label: &str) -> Result<(), String> {
    let win = app
        .get_webview_window(label)
        .ok_or("its window does not exist")?;
    win.hide().map_err(|e| e.to_string())
}

/// Whether an overlay window is on screen.
pub(crate) fn visible(app: &tauri::AppHandle, label: &str) -> bool {
    app.get_webview_window(label)
        .is_some_and(|w| w.is_visible().unwrap_or(false))
}

/// Whether the always-alive Relic Pick window is actually on screen.
pub(crate) fn relic_pick_visible(app: &tauri::AppHandle) -> bool {
    app.get_webview_window(RELIC_PICK).is_some_and(|win| {
        win.is_visible().unwrap_or(false)
            && win
                .outer_position()
                .map_or(true, |position| position.y != PARKED_Y)
    })
}

/// Where an overlay window is and whether it can be seen, for the log:
/// "x=1700 y=20 w=440 h=600 visible on_top", or why that is not known.
pub(crate) fn describe(app: &tauri::AppHandle, label: &str) -> String {
    let Some(win) = app.get_webview_window(label) else {
        return "window does not exist".to_string();
    };
    let position = win
        .outer_position()
        .map(|p| format!("x={} y={}", p.x, p.y))
        .unwrap_or_else(|e| format!("position unknown ({e})"));
    let size = win
        .outer_size()
        .map(|s| format!("w={} h={}", s.width, s.height))
        .unwrap_or_else(|e| format!("size unknown ({e})"));
    let visible = if win.is_visible().unwrap_or(false) {
        "visible"
    } else {
        "hidden"
    };
    let on_top = if win.is_always_on_top().unwrap_or(false) {
        " on_top"
    } else {
        ""
    };
    format!("{position} {size} {visible}{on_top}")
}

#[cfg(test)]
mod tests {
    use super::{pick_x, riven_place, status_bounds};

    #[test]
    fn the_pick_window_keeps_its_right_edge_off_the_monitor_edge() {
        // 460 px wide on a 1920 px monitor: right edge 100 px from the edge.
        assert_eq!(pick_x(1920.0, 460.0, 0.0), 1360.0);
        // Twice as wide at a larger text size: it moves left, not off screen.
        assert_eq!(pick_x(1920.0, 920.0, 0.0), 900.0);
        // The user's offset still applies.
        assert_eq!(pick_x(2560.0, 460.0, -40.0), 1960.0);
    }

    #[test]
    fn the_riven_window_sits_left_over_the_game_window() {
        // A 2560 by 1440 game window at 150 % scale, moved 20 px right.
        assert_eq!(
            riven_place([0, 0, 2560, 1440], 1.5, (20.0, 0.0)),
            (30.0, 192.0, 300.0, 576.0)
        );
        // An unknown scale counts as 100 %.
        assert_eq!(
            riven_place([100, 50, 1920, 1080], 0.0, (0.0, -10.0)),
            (110.0, 256.0, 300.0, 648.0)
        );
    }

    #[test]
    fn the_status_line_is_centred_at_the_top_of_the_game_window() {
        assert_eq!(
            status_bounds([100, 50, 1920, 1080], 1.0, (0.0, 0.0)),
            (840, 66, 440, 52)
        );
        assert_eq!(
            status_bounds([1920, 0, 2560, 1440], 1.5, (20.0, -10.0)),
            (2900, 9, 660, 78)
        );
    }
}
