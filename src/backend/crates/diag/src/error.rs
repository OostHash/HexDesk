use std::cell::RefCell;
use std::fmt::{self, Display};

use serde::ser::SerializeStruct;
use serde::{Serialize, Serializer};

use crate::{redact, Kind, Level, Source};

/// A failure with its source, kind, a message for humans, the facts around it
/// and the chain of causes. Everything in it is redacted on the way in.
///
/// Log an error once: where it is handled, or with [`DiagError::log`] right
/// before it crosses the Tauri command boundary.
#[derive(Debug, Clone, PartialEq)]
pub struct DiagError {
    source: Source,
    kind: Kind,
    message: String,
    fields: Vec<(String, String)>,
    causes: Vec<String>,
}

thread_local! {
    /// Hands the error being logged to the layer. Tracing events only carry
    /// static field names, so the error's own fields travel this way. The
    /// layer runs on the same thread, inside the `emit_error` call.
    pub(crate) static LOGGING: RefCell<Option<DiagError>> = const { RefCell::new(None) };
}

impl DiagError {
    pub fn new(source: Source, kind: Kind, message: impl Into<String>) -> Self {
        Self {
            source,
            kind,
            message: redact::text(&message.into()),
            fields: Vec::new(),
            causes: Vec::new(),
        }
    }

    /// Adds a fact, for example `.with("attempt", "3/3")`.
    pub fn with(mut self, key: &str, value: impl Display) -> Self {
        self.fields
            .push((key.to_string(), redact::field(key, &value.to_string())));
        self
    }

    /// Adds the cause, and the causes of that cause, as `caused by:` lines.
    pub fn caused_by(mut self, cause: &(dyn std::error::Error + 'static)) -> Self {
        let mut next = Some(cause);
        while let Some(err) = next {
            self.causes.push(redact::text(&err.to_string()));
            next = err.source();
        }
        self
    }

    /// Adds a cause that is only available as text.
    pub fn caused_by_text(mut self, cause: impl Display) -> Self {
        self.causes.push(redact::text(&cause.to_string()));
        self
    }

    pub fn source(&self) -> Source {
        self.source
    }

    pub fn kind(&self) -> Kind {
        self.kind
    }

    pub fn message(&self) -> &str {
        &self.message
    }

    pub fn fields(&self) -> &[(String, String)] {
        &self.fields
    }

    pub fn causes(&self) -> &[String] {
        &self.causes
    }

    /// `source.kind`, for example `scanner.not_found`.
    pub fn code(&self) -> String {
        format!("{}.{}", self.source.as_str(), self.kind.as_str())
    }

    /// Logs the error as a warning and returns it.
    #[must_use = "a logged error should still be returned or handled"]
    pub fn log(self) -> Self {
        self.log_at(Level::Warn)
    }

    /// Logs the error at `level` and returns it.
    #[must_use = "a logged error should still be returned or handled"]
    pub fn log_at(self, level: Level) -> Self {
        LOGGING.with(|slot| *slot.borrow_mut() = Some(self.clone()));
        crate::source::emit_error(self.source, level, &self.code(), &self.message);
        LOGGING.with(|slot| slot.borrow_mut().take());
        self
    }
}

impl Display for DiagError {
    fn fmt(&self, f: &mut fmt::Formatter<'_>) -> fmt::Result {
        f.write_str(&self.message)
    }
}

impl std::error::Error for DiagError {}

/// Crosses the Tauri command boundary as
/// `{ source, kind, code, message, fields, causes }`.
impl Serialize for DiagError {
    fn serialize<S: Serializer>(&self, serializer: S) -> Result<S::Ok, S::Error> {
        let fields: serde_json::Map<String, serde_json::Value> = self
            .fields
            .iter()
            .map(|(k, v)| (k.clone(), serde_json::Value::String(v.clone())))
            .collect();
        let mut s = serializer.serialize_struct("DiagError", 6)?;
        s.serialize_field("source", &self.source)?;
        s.serialize_field("kind", &self.kind)?;
        s.serialize_field("code", &self.code())?;
        s.serialize_field("message", &self.message)?;
        s.serialize_field("fields", &fields)?;
        s.serialize_field("causes", &self.causes)?;
        s.end()
    }
}

/// Turns any `Result` into one with a [`DiagError`], keeping the original
/// error as the cause.
pub trait ResultExt<T> {
    fn diag(self, source: Source, kind: Kind, message: impl Into<String>) -> Result<T, DiagError>;
}

impl<T, E: Display> ResultExt<T> for Result<T, E> {
    fn diag(self, source: Source, kind: Kind, message: impl Into<String>) -> Result<T, DiagError> {
        self.map_err(|e| DiagError::new(source, kind, message).caused_by_text(e))
    }
}

/// Turns a missing value into a [`DiagError`].
pub trait OptionExt<T> {
    fn or_diag(
        self,
        source: Source,
        kind: Kind,
        message: impl Into<String>,
    ) -> Result<T, DiagError>;
}

impl<T> OptionExt<T> for Option<T> {
    fn or_diag(
        self,
        source: Source,
        kind: Kind,
        message: impl Into<String>,
    ) -> Result<T, DiagError> {
        self.ok_or_else(|| DiagError::new(source, kind, message))
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    #[derive(Debug)]
    struct Outer(std::io::Error);
    impl Display for Outer {
        fn fmt(&self, f: &mut fmt::Formatter<'_>) -> fmt::Result {
            f.write_str("reading region failed")
        }
    }
    impl std::error::Error for Outer {
        fn source(&self) -> Option<&(dyn std::error::Error + 'static)> {
            Some(&self.0)
        }
    }

    #[test]
    fn code_combines_source_and_kind() {
        let e = DiagError::new(Source::Scanner, Kind::NotFound, "Account blob not found");
        assert_eq!(e.code(), "scanner.not_found");
        assert_eq!(e.to_string(), "Account blob not found");
    }

    #[test]
    fn cause_chain_is_kept() {
        let inner = std::io::Error::other("os error 299");
        let e = DiagError::new(Source::Scanner, Kind::Io, "Memory read failed")
            .caused_by(&Outer(inner));
        assert_eq!(e.causes(), ["reading region failed", "os error 299"]);
    }

    #[test]
    fn fields_and_text_are_redacted() {
        let e = DiagError::new(
            Source::Market,
            Kind::Denied,
            "Sign-in failed for a@b.example",
        )
        .with("token", "abc")
        .with("status", 401);
        assert_eq!(e.message(), "Sign-in failed for [redacted]");
        assert_eq!(
            e.fields(),
            [
                ("token".into(), "[redacted]".into()),
                ("status".into(), "401".into())
            ]
        );
    }

    #[test]
    fn result_and_option_helpers_build_errors() {
        let r: Result<(), String> = Err("connection reset".into());
        let e = r
            .diag(Source::Market, Kind::Network, "Price request failed")
            .unwrap_err();
        assert_eq!(e.code(), "market.network");
        assert_eq!(e.causes(), ["connection reset"]);

        let e = None::<u8>
            .or_diag(Source::Scanner, Kind::NotFound, "Process not found")
            .unwrap_err();
        assert_eq!(e.code(), "scanner.not_found");
    }

    #[test]
    fn serializes_for_the_command_boundary() {
        let e = DiagError::new(Source::Updater, Kind::Timeout, "Update check timed out")
            .with("after_s", 10);
        let json = serde_json::to_value(&e).unwrap();
        assert_eq!(
            json,
            serde_json::json!({
                "source": "updater",
                "kind": "timeout",
                "code": "updater.timeout",
                "message": "Update check timed out",
                "fields": { "after_s": "10" },
                "causes": []
            })
        );
    }
}
