use hexdesk_platform::{LocaleProvider, Platform};

/// The user's locale as the operating system reports it, such as `en-US`.
#[tauri::command]
pub(crate) fn get_system_locale() -> String {
    <Platform as LocaleProvider>::get_system_locale()
}
