//! A named mutex as the lock and an auto-reset named event as the signal.
//!
//! See https://learn.microsoft.com/en-us/windows/win32/sync/using-named-objects

use std::ffi::c_void;
use std::io;
use std::ptr;
use std::sync::atomic::{AtomicPtr, Ordering};

use windows_sys::Win32::Foundation::{
    CloseHandle, GetLastError, ERROR_ALREADY_EXISTS, HANDLE, WAIT_OBJECT_0,
};
use windows_sys::Win32::System::Threading::{
    CreateEventW, CreateMutexW, SetEvent, WaitForSingleObject, INFINITE,
};
use windows_sys::Win32::UI::WindowsAndMessaging::{AllowSetForegroundWindow, ASFW_ANY};

use super::ObjectNames;

pub(super) struct Instance {
    lock: AtomicPtr<c_void>,
    // Stays open for the life of the process: the listener thread waits on
    // it, and closing a handle that is being waited on is undefined.
    signal: usize,
}

fn wide(text: &str) -> Vec<u16> {
    text.encode_utf16().chain(std::iter::once(0)).collect()
}

pub(super) fn start(names: &ObjectNames) -> io::Result<Option<Instance>> {
    // The signal is opened first, so a start that finds the lock taken can
    // always reach it.
    let signal_name = wide(&names.signal);
    // SAFETY: the name is a NUL-terminated UTF-16 string that outlives the call.
    let signal = unsafe { CreateEventW(ptr::null(), 0, 0, signal_name.as_ptr()) };
    if signal.is_null() {
        return Err(io::Error::last_os_error());
    }

    let lock_name = wide(&names.lock);
    // SAFETY: as above. GetLastError is read right after the call it belongs to.
    let (lock, taken) = unsafe {
        let lock = CreateMutexW(ptr::null(), 0, lock_name.as_ptr());
        (lock, GetLastError() == ERROR_ALREADY_EXISTS)
    };
    if lock.is_null() {
        let error = io::Error::last_os_error();
        // SAFETY: `signal` is a handle this function opened.
        unsafe { CloseHandle(signal) };
        return Err(error);
    }

    if taken {
        // SAFETY: both handles were opened above and are not used afterwards.
        unsafe {
            // This process was just started by the user, so it may pass on
            // the right to take the foreground to the running instance.
            AllowSetForegroundWindow(ASFW_ANY);
            SetEvent(signal);
            CloseHandle(lock);
            CloseHandle(signal);
        }
        return Ok(None);
    }

    Ok(Some(Instance {
        lock: AtomicPtr::new(lock),
        signal: signal as usize,
    }))
}

impl Instance {
    pub(super) fn on_second_start<F>(&self, on_start: F) -> io::Result<()>
    where
        F: Fn() + Send + 'static,
    {
        let signal = self.signal;
        std::thread::Builder::new()
            .name("single-instance".into())
            .spawn(move || loop {
                // SAFETY: the signal handle is never closed (see `Instance`).
                let woke = unsafe { WaitForSingleObject(signal as HANDLE, INFINITE) };
                if woke != WAIT_OBJECT_0 {
                    break;
                }
                on_start();
            })?;
        Ok(())
    }

    pub(super) fn release(&self) {
        let lock = self.lock.swap(ptr::null_mut(), Ordering::AcqRel);
        if !lock.is_null() {
            // SAFETY: the swap hands the handle to exactly one caller.
            unsafe { CloseHandle(lock) };
        }
    }
}

impl Drop for Instance {
    fn drop(&mut self) {
        self.release();
    }
}
