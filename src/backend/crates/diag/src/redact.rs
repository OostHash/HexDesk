//! Redaction of secrets and personal data before anything reaches a log line,
//! the console or the export.
//!
//! Three layers, applied to every entry:
//!
//! 1. Field names that hold secrets (token, password, email, player, ...)
//!    always get [`REDACTED`] as value.
//! 2. Text is scanned for e-mail addresses, `Bearer` tokens and sensitive
//!    `key=value` pairs (for example in URLs).
//! 3. Values the app knows to be personal at runtime, such as the player name
//!    or a session token, are registered with [`register_secret`] and removed
//!    wherever they appear. The user's home folder is registered with
//!    [`register_replacement`] so paths stay readable as `%USERPROFILE%\...`.

use std::sync::RwLock;

/// What a redacted value is replaced with.
pub const REDACTED: &str = "[redacted]";

/// Parts of a field name that mark its value as secret or personal.
const SENSITIVE_KEYS: &[&str] = &[
    "token",
    "password",
    "passwd",
    "secret",
    "cookie",
    "session",
    "auth",
    "nonce",
    "email",
    "player",
    "username",
    "user_name",
    "account_name",
    "display_name",
    "credential",
];

/// Keys that hold a credential in `key: value` text (HTTP headers, config
/// dumps). Prose such as "the session: warframe.market answered 403" also has
/// a word before a colon, so this form is limited to these keys; `key=value`
/// and JSON `"key":` use the wider [`SENSITIVE_KEYS`] rule.
const COLON_KEYS: &[&str] = &[
    "password",
    "passwd",
    "secret",
    "authorization",
    "cookie",
    "set-cookie",
    "api_key",
    "apikey",
    "jwt",
];

fn is_colon_credential_key(key: &str) -> bool {
    let key = key.to_ascii_lowercase();
    COLON_KEYS.contains(&key.as_str()) || key.ends_with("token") || key.ends_with("password")
}

/// Registered secrets shorter than this are ignored; replacing very short
/// strings would mangle unrelated text.
const MIN_SECRET_LEN: usize = 3;

/// `(value, replacement)` pairs, longest value first.
static SECRETS: RwLock<Vec<(String, String)>> = RwLock::new(Vec::new());

/// Whether a field with this name must never show its value.
pub fn is_sensitive_key(key: &str) -> bool {
    let key = key.to_ascii_lowercase();
    SENSITIVE_KEYS.iter().any(|s| key.contains(s))
}

/// Registers a value that must be removed from all text from now on, for
/// example the player name once it is known.
pub fn register_secret(value: &str) {
    register_replacement(value, REDACTED);
}

/// Like [`register_secret`], but replaces `value` with `replacement` instead
/// of [`REDACTED`], for example the home folder with `%USERPROFILE%`.
pub fn register_replacement(value: &str, replacement: &str) {
    let value = value.trim();
    if value.chars().count() < MIN_SECRET_LEN {
        return;
    }
    let mut secrets = SECRETS.write().unwrap_or_else(|e| e.into_inner());
    if !secrets.iter().any(|(s, _)| s == value) {
        secrets.push((value.to_string(), replacement.to_string()));
        // Longest first, so a secret that contains another is replaced whole.
        secrets.sort_by_key(|(s, _)| std::cmp::Reverse(s.len()));
    }
}

/// Forgets all registered secrets. For tests.
#[doc(hidden)]
pub fn clear_secrets() {
    SECRETS.write().unwrap_or_else(|e| e.into_inner()).clear();
}

/// The value to store for a field: redacted when the key is sensitive,
/// otherwise the value with secrets removed from its text.
pub fn field(key: &str, value: &str) -> String {
    if is_sensitive_key(key) {
        REDACTED.to_string()
    } else {
        text(value)
    }
}

/// Removes registered secrets, e-mail addresses, `Bearer` tokens and
/// sensitive `key=value` pairs from free text.
pub fn text(input: &str) -> String {
    let mut out = input.to_string();
    {
        let secrets = SECRETS.read().unwrap_or_else(|e| e.into_inner());
        for (secret, replacement) in secrets.iter() {
            if out.contains(secret.as_str()) {
                out = out.replace(secret.as_str(), replacement);
            }
        }
    }
    out = redact_key_values(&out);
    out = redact_bearer(&out);
    redact_emails(&out)
}

/// Redacts a JSON value in place: sensitive keys get [`REDACTED`], strings
/// are passed through [`text`]. Used for settings in the export.
pub fn json(value: &mut serde_json::Value) {
    match value {
        serde_json::Value::Object(map) => {
            for (key, v) in map.iter_mut() {
                if is_sensitive_key(key) && !v.is_null() && !v.is_object() && !v.is_array() {
                    *v = serde_json::Value::String(REDACTED.to_string());
                } else {
                    json(v);
                }
            }
        }
        serde_json::Value::Array(items) => items.iter_mut().for_each(json),
        serde_json::Value::String(s) => *s = text(s),
        _ => {}
    }
}

fn is_token_char(c: char) -> bool {
    c.is_ascii_alphanumeric() || matches!(c, '-' | '_' | '.' | '~' | '+' | '/' | '=' | '%')
}

/// `Bearer abc123` becomes `Bearer [redacted]`.
fn redact_bearer(input: &str) -> String {
    let lower = input.to_ascii_lowercase();
    let mut out = String::with_capacity(input.len());
    let mut i = 0;
    while let Some(pos) = lower[i..].find("bearer ") {
        let start = i + pos + "bearer ".len();
        let end = input[start..]
            .char_indices()
            .find(|(_, c)| !is_token_char(*c))
            .map_or(input.len(), |(j, _)| start + j);
        out.push_str(&input[i..start]);
        if end > start {
            out.push_str(REDACTED);
        }
        i = end;
    }
    out.push_str(&input[i..]);
    out
}

/// `?token=abc&x=1` becomes `?token=[redacted]&x=1`; also `password: abc`.
fn redact_key_values(input: &str) -> String {
    let mut out = String::with_capacity(input.len());
    let mut i = 0;
    let bytes = input.as_bytes();
    while i < input.len() {
        // Find the next `=` or `:` that follows a key.
        let Some(rel) = input[i..].find(['=', ':']) else {
            break;
        };
        let sep = i + rel;
        // A JSON key ends in a quote: `"csrfToken":"..."`.
        let key_end = if input[..sep].ends_with('"') {
            sep - 1
        } else {
            sep
        };
        let key_start = input[..key_end]
            .char_indices()
            .rev()
            .find(|(_, c)| !(c.is_ascii_alphanumeric() || *c == '_' || *c == '-'))
            .map_or(0, |(j, c)| j + c.len_utf8());
        let key = &input[key_start..key_end];
        let json_key = key_end < sep;
        let sensitive = if bytes[sep] == b':' && !json_key {
            is_colon_credential_key(key)
        } else {
            is_sensitive_key(key)
        };
        let mut value_start = sep + 1;
        while value_start < input.len() && bytes[value_start] == b' ' {
            value_start += 1;
        }
        let quoted = value_start < input.len() && bytes[value_start] == b'"';
        let ends_unquoted = |from: usize| {
            input[from..]
                .char_indices()
                .find(|(_, c)| {
                    c.is_whitespace() || matches!(c, '&' | ',' | ';' | ')' | ']' | '}' | '"')
                })
                .map_or(input.len(), |(j, _)| from + j)
        };
        let (value_start, value_end) = if quoted {
            // Keep the quotes, redact what is between them.
            let start = value_start + 1;
            (
                start,
                input[start..].find('"').map_or(input.len(), |j| start + j),
            )
        } else {
            let mut end = ends_unquoted(value_start);
            // `Authorization: Bearer abc` — the scheme and the credential
            // form one value.
            let scheme = input[value_start..end].to_ascii_lowercase();
            if (scheme == "bearer" || scheme == "basic") && end < input.len() && bytes[end] == b' '
            {
                end = ends_unquoted(end + 1);
            }
            (value_start, end)
        };
        let already = input[value_start..].starts_with(REDACTED);
        if !key.is_empty() && sensitive && value_end > value_start && !already {
            out.push_str(&input[i..value_start]);
            out.push_str(REDACTED);
            i = value_end;
        } else {
            out.push_str(&input[i..=sep]);
            i = sep + 1;
        }
    }
    out.push_str(&input[i..]);
    out
}

/// `name@example.com` becomes `[redacted]`.
fn redact_emails(input: &str) -> String {
    if !input.contains('@') {
        return input.to_string();
    }
    let is_local = |c: char| c.is_ascii_alphanumeric() || matches!(c, '.' | '_' | '-' | '+');
    let is_domain = |c: char| c.is_ascii_alphanumeric() || matches!(c, '.' | '-');
    let mut out = String::with_capacity(input.len());
    let mut i = 0;
    while let Some(rel) = input[i..].find('@') {
        let at = i + rel;
        let start = input[i..at]
            .char_indices()
            .rev()
            .find(|(_, c)| !is_local(*c))
            .map_or(i, |(j, c)| i + j + c.len_utf8());
        let end = input[at + 1..]
            .char_indices()
            .find(|(_, c)| !is_domain(*c))
            .map_or(input.len(), |(j, _)| at + 1 + j);
        let domain = input[at + 1..end].trim_end_matches('.');
        let end = at + 1 + domain.len();
        if start < at && domain.contains('.') && !domain.starts_with('.') {
            out.push_str(&input[i..start]);
            out.push_str(REDACTED);
        } else {
            out.push_str(&input[i..end]);
        }
        i = end;
    }
    out.push_str(&input[i..]);
    out
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn sensitive_keys_are_redacted() {
        assert_eq!(field("token", "abc"), REDACTED);
        assert_eq!(field("jwt_token", "abc"), REDACTED);
        assert_eq!(field("Password", "abc"), REDACTED);
        assert_eq!(field("player_name", "Someone"), REDACTED);
        assert_eq!(field("attempt", "3/3"), "3/3");
    }

    #[test]
    fn bearer_tokens_are_redacted() {
        assert_eq!(
            text("Authorization: Bearer eyJhbGci.x-y_z"),
            "Authorization: [redacted]"
        );
        assert_eq!(
            text("sent bearer abc123 to api"),
            "sent bearer [redacted] to api"
        );
    }

    #[test]
    fn sensitive_key_values_in_text_are_redacted() {
        assert_eq!(
            text("GET https://api.example/v1?token=abc123&item=ash"),
            "GET https://api.example/v1?token=[redacted]&item=ash"
        );
        assert_eq!(
            text("password: hunter2, retry"),
            "password: [redacted], retry"
        );
        assert_eq!(
            text(r#"{"csrfToken":"zzz","item":"ash"}"#),
            r#"{"csrfToken":"[redacted]","item":"ash"}"#
        );
        assert_eq!(text("item=ash_prime attempt=3"), "item=ash_prime attempt=3");
        assert_eq!(text("time 15:03:12"), "time 15:03:12");
        // Prose with a colon after a sensitive-looking word is not a credential.
        assert_eq!(
            text("using the token from the session: warframe.market answered 403"),
            "using the token from the session: warframe.market answered 403"
        );
        assert_eq!(text("x-csrftoken: abc123"), "x-csrftoken: [redacted]");
        assert_eq!(
            text(r#"{"sessionId":"abc"}"#),
            r#"{"sessionId":"[redacted]"}"#
        );
        assert_eq!(text("session=abc&x=1"), "session=[redacted]&x=1");
    }

    #[test]
    fn emails_are_redacted() {
        assert_eq!(
            text("login as someone.else+x@mail.example.com failed"),
            "login as [redacted] failed"
        );
        assert_eq!(text("no mail @ here"), "no mail @ here");
        assert_eq!(text("pattern a@b"), "pattern a@b");
    }

    /// Registered secrets are global; tests that touch them run one at a time.
    static SECRETS_LOCK: std::sync::Mutex<()> = std::sync::Mutex::new(());

    #[test]
    fn registered_secrets_are_redacted_everywhere() {
        let _lock = SECRETS_LOCK.lock().unwrap_or_else(|e| e.into_inner());
        register_secret("TenoPlayer");
        register_secret("xy"); // too short, ignored
        assert_eq!(
            text("Logged in as TenoPlayer (TenoPlayer)"),
            "Logged in as [redacted] ([redacted])"
        );
        assert_eq!(text("xy stays"), "xy stays");
        assert_eq!(
            field("detail", "TenoPlayer opened relic"),
            "[redacted] opened relic"
        );
        clear_secrets();
    }

    #[test]
    fn the_home_folder_becomes_a_placeholder() {
        let _lock = SECRETS_LOCK.lock().unwrap_or_else(|e| e.into_inner());
        register_replacement(r"C:\Users\SomeUser", "%USERPROFILE%");
        assert_eq!(
            text(r"log_dir=C:\Users\SomeUser\AppData\Local\x"),
            r"log_dir=%USERPROFILE%\AppData\Local\x"
        );
        clear_secrets();
    }

    #[test]
    fn json_is_redacted_recursively() {
        let mut value = serde_json::json!({
            "wfmToken": "abc",
            "theme": "dark",
            "accounts": [{ "email": "a@b.example", "region": "eu" }],
            "note": "contact a@b.example"
        });
        json(&mut value);
        assert_eq!(value["wfmToken"], REDACTED);
        assert_eq!(value["theme"], "dark");
        assert_eq!(value["accounts"][0]["email"], REDACTED);
        assert_eq!(value["accounts"][0]["region"], "eu");
        assert_eq!(value["note"], "contact [redacted]");
    }
}
