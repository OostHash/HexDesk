//! The overlay key. It hides whatever overlay is on screen, or, with none on
//! screen, reads the game's screen title and opens the overlay for that
//! screen. A low-level keyboard hook only watches the key and passes it on,
//! so the game still receives it.

use std::sync::atomic::{AtomicU32, Ordering};
use std::sync::{mpsc, Once, OnceLock};

use hexdesk_overlays::title::screen_from_title;
use hexdesk_overlays::{HideBy, Screen, Signal};
use tauri::Manager;
use windows_sys::Win32::Foundation::{LPARAM, LRESULT, WPARAM};
use windows_sys::Win32::UI::WindowsAndMessaging::{
    CallNextHookEx, GetMessageW, SetWindowsHookExW, HC_ACTION, KBDLLHOOKSTRUCT, MSG,
    WH_KEYBOARD_LL, WM_KEYDOWN, WM_KEYUP, WM_SYSKEYDOWN, WM_SYSKEYUP,
};

use crate::app_state::AppState;
use crate::overlays::{self, window};

/// Virtual-key code of the key; 0 means no key.
static KEY: AtomicU32 = AtomicU32::new(0);
/// The keys that answer the testing prompt; Page Up and Page Down until the
/// frontend sends the player's choice.
static CORRECT_KEY: AtomicU32 = AtomicU32::new(0x21);
static WRONG_KEY: AtomicU32 = AtomicU32::new(0x22);
/// Hands key presses from the hook to a normal thread, because Windows drops
/// a low-level hook whose callback takes too long.
static PRESSED: OnceLock<mpsc::Sender<Press>> = OnceLock::new();
static HOOK: Once = Once::new();

#[derive(Clone, Copy)]
enum Press {
    Overlay,
    TestingFeedback { correct: bool },
}

/// Whether a key press with virtual-key code `vk` is the key `configured`.
pub(crate) fn is_overlay_key(vk: u32, configured: u32) -> bool {
    configured != 0 && vk == configured
}

/// The answer a key press gives to the testing prompt: `Some(true)` for the
/// correct key, `Some(false)` for the wrong key, `None` for any other key or
/// a key that is not set (0).
fn feedback_answer(vk: u32, correct: u32, wrong: u32) -> Option<bool> {
    if vk == 0 {
        None
    } else if vk == correct {
        Some(true)
    } else if vk == wrong {
        Some(false)
    } else {
        None
    }
}

/// Sets the keys that answer the testing prompt (Windows virtual-key codes,
/// 0 for none). The prompt is shown with the frontend's names for the same
/// keys; without both keys, testing asks nothing (`src/backend/src/testing/mod.rs`).
#[tauri::command]
pub(crate) fn set_testing_keys(correct: u32, wrong: u32) -> Result<(), String> {
    if correct != 0 && correct == wrong {
        return Err("the testing keys must be two different keys".to_string());
    }
    CORRECT_KEY.store(correct, Ordering::SeqCst);
    WRONG_KEY.store(wrong, Ordering::SeqCst);
    hexdesk_diag::debug!(overlay_key, correct, wrong, "Testing keys set");
    Ok(())
}

/// Sets the overlay key (a Windows virtual-key code, 0 for none). The
/// keyboard hook starts with the first key that is set and keeps running
/// after that.
#[tauri::command]
pub(crate) fn set_overlay_key(app: tauri::AppHandle, vk: u32) {
    KEY.store(vk, Ordering::SeqCst);
    hexdesk_diag::debug!(overlay_key, vk, "Overlay key set");
    if vk != 0 {
        ensure_hook(app);
    }
}

/// Starts the one global keyboard hook used by both the configured overlay
/// key and the keys that answer the testing prompt.
pub(crate) fn ensure_hook(app: tauri::AppHandle) {
    HOOK.call_once(|| start_hook(app));
}

/// Turns saving what OCR reads on screen on or off.
#[tauri::command]
pub(crate) fn set_overlay_key_capture(enabled: bool) {
    crate::captures::set_enabled(enabled);
}

fn start_hook(app: tauri::AppHandle) {
    let (sender, presses) = mpsc::channel();
    let _ = PRESSED.set(sender);
    std::thread::spawn(move || {
        let mut overlay_presses = 0u64;
        for pressed in presses {
            match pressed {
                Press::Overlay => {
                    overlay_presses += 1;
                    // Each press is its own operation, and its lines carry the
                    // number, so the log never folds two presses into one repeat.
                    let press = format!("{overlay_presses} since start");
                    let _op = hexdesk_diag::op!(overlay_key, "Overlay key press").entered();
                    on_key(&app, &press);
                }
                Press::TestingFeedback { correct } => {
                    overlays::send(overlays::Input::TestingFeedback { correct });
                }
            }
        }
    });
    std::thread::spawn(|| {
        // A low-level hook runs on the thread that installed it, and only
        // while that thread pumps messages.
        let hook = unsafe { SetWindowsHookExW(WH_KEYBOARD_LL, Some(keyboard_proc), 0, 0) };
        if hook == 0 {
            let _ = hexdesk_diag::DiagError::new(
                hexdesk_diag::Source::OverlayKey,
                hexdesk_diag::Kind::Internal,
                "Overlay key unavailable: the keyboard hook could not be installed",
            )
            .caused_by(&std::io::Error::last_os_error())
            .log();
            return;
        }
        let mut msg: MSG = unsafe { std::mem::zeroed() };
        while unsafe { GetMessageW(&mut msg, 0, 0, 0) } > 0 {}
    });
}

unsafe extern "system" fn keyboard_proc(code: i32, wparam: WPARAM, lparam: LPARAM) -> LRESULT {
    let key_down = wparam == WM_KEYDOWN as WPARAM || wparam == WM_SYSKEYDOWN as WPARAM;
    let key_up = wparam == WM_KEYUP as WPARAM || wparam == WM_SYSKEYUP as WPARAM;
    if code == HC_ACTION as i32 && (key_down || key_up) {
        let info = &*(lparam as *const KBDLLHOOKSTRUCT);
        let feedback = feedback_answer(
            info.vkCode,
            CORRECT_KEY.load(Ordering::Relaxed),
            WRONG_KEY.load(Ordering::Relaxed),
        );
        if crate::testing::prompt_visible() && feedback.is_some() {
            if key_down {
                if let (Some(sender), Some(correct)) = (PRESSED.get(), feedback) {
                    let _ = sender.send(Press::TestingFeedback { correct });
                }
            }
            // While the prompt is visible these keys belong to HexDesk, not
            // the game. Suppress both halves of the key press.
            return 1;
        }
        if is_overlay_key(info.vkCode, KEY.load(Ordering::Relaxed)) {
            if key_down {
                if let Some(sender) = PRESSED.get() {
                    let _ = sender.send(Press::Overlay);
                }
            }
        }
    }
    CallNextHookEx(0, code, wparam, lparam)
}

fn on_key(app: &tauri::AppHandle, press: &str) {
    let state = app.state::<AppState>();
    if !state.overlays_enabled.load(Ordering::SeqCst) {
        overlays::status(app, "Overlays are turned off");
        hexdesk_diag::info!(
            overlay_key,
            press,
            "Overlay key did nothing: overlays are turned off"
        );
        return;
    }
    if crate::testing::prompt_visible() {
        overlays::send(overlays::Input::DismissTestingFeedback);
        hexdesk_diag::info!(
            overlay_key,
            press,
            "Overlay key dismissed the testing prompt"
        );
        return;
    }
    let pick = window::relic_pick_visible(app);
    let riven = window::visible(app, window::RIVEN);
    let reward = overlays::reward_shown();
    if pick || riven || reward {
        hexdesk_diag::info!(
            overlay_key,
            press,
            relic_pick = pick,
            riven,
            relic_reward = reward,
            "Overlay key hid the overlays on screen"
        );
        overlays::send(overlays::Input::Signals(vec![Signal::hide(
            overlays::now(),
            HideBy::Key,
        )]));
        return;
    }
    overlays::status(app, "Reading the game screen…");
    let read = match crate::ocr::read_screen_title(|text| screen_from_title(text).is_some()) {
        Ok(read) => read,
        Err(error) => {
            overlays::status(app, "Could not capture the game screen");
            hexdesk_diag::info!(
                overlay_key,
                press,
                reason = %error,
                "Overlay key did nothing: the game screen could not be captured"
            );
            return;
        }
    };
    for (scale, text, recognised) in &read.attempts {
        hexdesk_diag::info!(
            overlay_key,
            press,
            scale = *scale,
            recognised = *recognised,
            "Overlay key title OCR at {scale}: \"{}\"",
            one_line(text)
        );
    }
    if crate::captures::enabled() {
        if let Some(file) = crate::captures::save("overlay-key", &read.image) {
            hexdesk_diag::info!(
                overlay_key,
                press,
                capture = %file,
                "Overlay key capture saved"
            );
        }
    }
    let Some(raw_title) = read.text else {
        overlays::status(app, "Could not read the game screen");
        hexdesk_diag::info!(
            overlay_key,
            press,
            "Overlay key captured no text: OCR failed"
        );
        return;
    };
    let text = one_line(&raw_title);
    let screen = screen_from_title(&text);
    if screen.is_none() {
        overlays::status(app, "No supported overlay found on this screen");
    }
    // The runtime decides what the screen means for its overlays.
    overlays::send(overlays::Input::Key {
        signal: Signal::title(overlays::now(), screen),
        op: tracing::Span::current(),
    });
    let action = match screen {
        Some(Screen::RelicSelection | Screen::RelicRefinement) => "sent to the Relic Pick overlay",
        Some(Screen::RewardChoice) => "sent to the Relic Reward overlay",
        Some(Screen::Riven) => "sent to the riven overlay",
        None => "none",
    };
    hexdesk_diag::info!(
        overlay_key,
        press,
        screen = screen.map_or("not recognised", Screen::name),
        action,
        read_at = read.scale,
        "Overlay key captured text: \"{text}\""
    );
}

/// OCR text on one line, for the log.
fn one_line(text: &str) -> String {
    text.split_whitespace().collect::<Vec<_>>().join(" ")
}

#[cfg(test)]
mod tests {
    use super::*;

    const VK_HOME: u32 = 0x24;
    const VK_END: u32 = 0x23;

    #[test]
    fn only_the_configured_key_counts() {
        assert!(is_overlay_key(VK_HOME, VK_HOME));
        assert!(!is_overlay_key(VK_END, VK_HOME));
    }

    #[test]
    fn only_the_two_testing_keys_answer_the_prompt() {
        assert_eq!(feedback_answer(VK_HOME, VK_HOME, VK_END), Some(true));
        assert_eq!(feedback_answer(VK_END, VK_HOME, VK_END), Some(false));
        assert_eq!(feedback_answer(0x21, VK_HOME, VK_END), None);
    }

    #[test]
    fn no_key_counts_when_none_is_set() {
        assert!(!is_overlay_key(0, 0));
        assert!(!is_overlay_key(VK_HOME, 0));
    }
}
