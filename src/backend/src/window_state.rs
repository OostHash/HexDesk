//! Main and pop-out window geometry, kept in settings.json.

use hexdesk_persist::Settings;
use tracing::warn;

/// Stores the geometry of `window` under keys starting with `prefix`.
pub(crate) fn save_window_state(window: &tauri::WebviewWindow, settings: &Settings, prefix: &str) {
    let maximized = window.is_maximized().unwrap_or(false);
    let minimized = window.is_minimized().unwrap_or(false);
    let pos = window.outer_position().ok();
    let size = window.outer_size().ok();

    let result = settings.merge(|map| {
        map.insert(format!("{}Maximized", prefix), maximized.into());
        // Only overwrite position/size when not maximised/minimised.
        // Also guard against the Windows minimized sentinel (-32000,-32000) and dummy size (160×28)
        // which can slip through when is_minimized() is unreliable at CloseRequested time.
        if !maximized && !minimized {
            if let Some(p) = pos {
                if p.x > -10_000 && p.y > -10_000 {
                    map.insert(format!("{}X", prefix), p.x.into());
                    map.insert(format!("{}Y", prefix), p.y.into());
                }
            }
            if let Some(s) = size {
                if s.width >= 100 && s.height >= 50 {
                    map.insert(format!("{}Width", prefix), (s.width as i64).into());
                    map.insert(format!("{}Height", prefix), (s.height as i64).into());
                }
            }
        }
    });
    if let Err(e) = result {
        warn!(error = %e, "not saving window state");
    }
}

/// Restores the geometry saved by [`save_window_state`], kept on a connected
/// monitor.
pub(crate) fn restore_window_state(
    app: &tauri::AppHandle,
    window: &tauri::WebviewWindow,
    settings: &Settings,
    prefix: &str,
    min_w: u32,
    min_h: u32,
) {
    let Ok(snapshot) = settings.read() else {
        return;
    };
    let map = snapshot.map();

    let maximized = map
        .get(&format!("{}Maximized", prefix))
        .and_then(|v| v.as_bool())
        .unwrap_or(false);
    if maximized {
        let _ = window.maximize();
        return;
    }

    let x = map.get(&format!("{}X", prefix)).and_then(|v| v.as_i64());
    let y = map.get(&format!("{}Y", prefix)).and_then(|v| v.as_i64());
    let w = map
        .get(&format!("{}Width", prefix))
        .and_then(|v| v.as_i64())
        .map(|v| v as u32);
    let h = map
        .get(&format!("{}Height", prefix))
        .and_then(|v| v.as_i64())
        .map(|v| v as u32);

    if let (Some(x), Some(y)) = (x, y) {
        // Guard against Windows' minimized-window sentinel (-32000, -32000) and positions
        // that fall outside every connected monitor (e.g. secondary unplugged since last run).
        if x > -10_000 && y > -10_000 {
            let monitors = app.available_monitors().unwrap_or_default();
            let on_screen = monitors.iter().any(|m| {
                let mp = m.position();
                let ms = m.size();
                x >= mp.x as i64
                    && x < (mp.x as i64 + ms.width as i64)
                    && y >= mp.y as i64
                    && y < (mp.y as i64 + ms.height as i64)
            });
            if on_screen {
                let _ = window.set_position(tauri::PhysicalPosition::new(x as i32, y as i32));
            }
            // If off-screen, leave the window at its default centered position.
        }
    }
    if let (Some(w), Some(h)) = (w, h) {
        if w >= min_w && h >= min_h {
            // Clamp to the monitor that contains the window's top-left corner so the
            // bottom edge never ends up off-screen (e.g. a session saved on a 1440p monitor
            // restored on a 768p monitor would otherwise put the bottom 432px off-screen,
            // making the scrollbar unreachable and the bottom of every page inaccessible).
            let monitors = app.available_monitors().unwrap_or_default();
            let wx = x.unwrap_or(0);
            let wy = y.unwrap_or(0);
            let max_h = monitors
                .iter()
                .find(|m| {
                    let mp = m.position();
                    let ms = m.size();
                    wx >= mp.x as i64
                        && wx < (mp.x as i64 + ms.width as i64)
                        && wy >= mp.y as i64
                        && wy < (mp.y as i64 + ms.height as i64)
                })
                .map(|m| {
                    // Leave 60px for the Windows taskbar (physical pixels, before DPI scale).
                    m.size().height.saturating_sub(60)
                });
            let clamped_h = if let Some(max) = max_h { h.min(max) } else { h };
            let max_w = monitors
                .iter()
                .find(|m| {
                    let mp = m.position();
                    let ms = m.size();
                    wx >= mp.x as i64
                        && wx < (mp.x as i64 + ms.width as i64)
                        && wy >= mp.y as i64
                        && wy < (mp.y as i64 + ms.height as i64)
                })
                .map(|m| m.size().width);
            let clamped_w = if let Some(max) = max_w { w.min(max) } else { w };
            let _ = window.set_size(tauri::PhysicalSize::new(clamped_w, clamped_h));
        }
    }
}
