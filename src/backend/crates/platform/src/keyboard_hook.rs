//! A global keyboard hook that sees every key press, also while another
//! application such as the game has the focus.

use std::io;

/// One key going down or up.
#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub struct Key {
    /// Windows virtual-key code.
    pub vk: u32,
    /// True when the key goes down, false when it goes up.
    pub down: bool,
}

/// What happens with a key after the handler has seen it.
#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub enum Verdict {
    /// The key goes on to the application that has the focus.
    Pass,
    /// The key is swallowed; no application receives it.
    Suppress,
}

/// Installs the hook on a thread of its own and calls `handler` for every key
/// that goes down or up. Returns once the hook is in place.
///
/// The handler runs on the hook thread for each key of every application, so
/// it must return at once: Windows removes a hook whose callback is slow.
/// Hand any real work to another thread. Only one hook can be installed per
/// process.
pub fn install(handler: fn(Key) -> Verdict) -> io::Result<()> {
    imp::install(handler)
}

#[cfg(windows)]
mod imp {
    use std::io;
    use std::sync::{mpsc, OnceLock};

    use windows_sys::Win32::Foundation::{LPARAM, LRESULT, WPARAM};
    use windows_sys::Win32::UI::WindowsAndMessaging::{
        CallNextHookEx, GetMessageW, SetWindowsHookExW, HC_ACTION, KBDLLHOOKSTRUCT, MSG,
        WH_KEYBOARD_LL, WM_KEYDOWN, WM_KEYUP, WM_SYSKEYDOWN, WM_SYSKEYUP,
    };

    use super::{Key, Verdict};

    // The hook callback receives no context, so the handler is global.
    static HANDLER: OnceLock<fn(Key) -> Verdict> = OnceLock::new();

    pub(super) fn install(handler: fn(Key) -> Verdict) -> io::Result<()> {
        if HANDLER.set(handler).is_err() {
            return Err(io::Error::new(
                io::ErrorKind::AlreadyExists,
                "a keyboard hook is already installed",
            ));
        }
        let (installed, result) = mpsc::channel();
        std::thread::Builder::new()
            .name("keyboard-hook".into())
            .spawn(move || {
                // A low-level hook runs on the thread that installed it, and
                // only while that thread pumps messages.
                // SAFETY: `keyboard_proc` matches HOOKPROC and lives for the
                // whole program; no module handle is needed for WH_KEYBOARD_LL.
                let hook = unsafe {
                    SetWindowsHookExW(WH_KEYBOARD_LL, Some(keyboard_proc), std::ptr::null_mut(), 0)
                };
                if hook.is_null() {
                    let _ = installed.send(Err(io::Error::last_os_error()));
                    return;
                }
                let _ = installed.send(Ok(()));
                // SAFETY: MSG is plain data that GetMessageW fills in.
                let mut msg: MSG = unsafe { std::mem::zeroed() };
                while unsafe { GetMessageW(&mut msg, std::ptr::null_mut(), 0, 0) } > 0 {}
            })?;
        result.recv().unwrap_or_else(|_| {
            Err(io::Error::other(
                "the keyboard hook thread ended before installing the hook",
            ))
        })
    }

    unsafe extern "system" fn keyboard_proc(code: i32, wparam: WPARAM, lparam: LPARAM) -> LRESULT {
        let down = wparam == WM_KEYDOWN as WPARAM || wparam == WM_SYSKEYDOWN as WPARAM;
        let up = wparam == WM_KEYUP as WPARAM || wparam == WM_SYSKEYUP as WPARAM;
        if code == HC_ACTION as i32 && (down || up) {
            if let Some(handler) = HANDLER.get() {
                // SAFETY: for HC_ACTION key messages, lparam points to a
                // KBDLLHOOKSTRUCT that is valid during this call.
                let info = unsafe { &*(lparam as *const KBDLLHOOKSTRUCT) };
                if handler(Key {
                    vk: info.vkCode,
                    down,
                }) == Verdict::Suppress
                {
                    return 1;
                }
            }
        }
        // SAFETY: passes the unchanged arguments on to the next hook.
        unsafe { CallNextHookEx(std::ptr::null_mut(), code, wparam, lparam) }
    }
}

#[cfg(not(windows))]
mod imp {
    use std::io;

    use super::{Key, Verdict};

    pub(super) fn install(_handler: fn(Key) -> Verdict) -> io::Result<()> {
        Err(io::Error::new(
            io::ErrorKind::Unsupported,
            "a global keyboard hook is only available on Windows",
        ))
    }
}
