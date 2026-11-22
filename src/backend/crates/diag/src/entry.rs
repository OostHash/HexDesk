use chrono::{DateTime, Local};
use serde::ser::SerializeMap;
use serde::{Serialize, Serializer};

/// Severity of an entry.
#[derive(Debug, Clone, Copy, PartialEq, Eq, PartialOrd, Ord, Hash, Serialize)]
#[serde(rename_all = "lowercase")]
pub enum Level {
    Error,
    Warn,
    Info,
    Debug,
    Trace,
}

impl Level {
    pub const fn as_str(self) -> &'static str {
        match self {
            Level::Error => "ERROR",
            Level::Warn => "WARN",
            Level::Info => "INFO",
            Level::Debug => "DEBUG",
            Level::Trace => "TRACE",
        }
    }
}

impl From<&tracing::Level> for Level {
    fn from(level: &tracing::Level) -> Self {
        match *level {
            tracing::Level::ERROR => Level::Error,
            tracing::Level::WARN => Level::Warn,
            tracing::Level::INFO => Level::Info,
            tracing::Level::DEBUG => Level::Debug,
            tracing::Level::TRACE => Level::Trace,
        }
    }
}

/// Written instead of entries that repeat: how often the entry with id `of`
/// occurred again, and when the last one was.
#[derive(Debug, Clone, PartialEq, Serialize)]
pub struct Repeat {
    pub of: u64,
    pub count: u64,
    pub until: DateTime<Local>,
    pub last_op: Option<u64>,
}

/// One log entry: what the log file, the console and the export show.
/// All text in it is already redacted.
#[derive(Debug, Clone, PartialEq, Serialize)]
pub struct Entry {
    /// Increasing number within a session; 0 until the collector assigns it.
    pub id: u64,
    pub time: DateTime<Local>,
    pub level: Level,
    /// A [`crate::Source`] name, or the module or crate name for code that
    /// does not log through a source yet.
    pub source: String,
    /// `source.kind` for errors, for example `scanner.not_found`.
    pub code: Option<String>,
    pub message: String,
    #[serde(serialize_with = "fields_as_map")]
    pub fields: Vec<(String, String)>,
    pub causes: Vec<String>,
    /// The operation (`#42`) the entry belongs to.
    pub op: Option<u64>,
    pub repeat: Option<Repeat>,
}

fn fields_as_map<S: Serializer>(
    fields: &[(String, String)],
    serializer: S,
) -> Result<S::Ok, S::Error> {
    let mut map = serializer.serialize_map(Some(fields.len()))?;
    for (k, v) in fields {
        map.serialize_entry(k, v)?;
    }
    map.end()
}

const SOURCE_WIDTH: usize = 10;
const OP_WIDTH: usize = 6;

impl Entry {
    /// The entry as it appears in the log file: one line, plus one indented
    /// `caused by:` line per cause.
    ///
    /// ```text
    /// 2026-11-18 15:03:12.481 +01:00 WARN  scanner    #42    Account blob not found: 0 of 412 memory regions matched  attempt=3/3 [scanner.not_found]
    ///                                                        caused by: ReadProcessMemory failed (os error 299)
    /// ```
    pub fn to_line(&self) -> String {
        let op = self.op.map(|id| format!("#{id}")).unwrap_or_default();
        let prefix = format!(
            "{} {:<5} {:<sw$} {:<ow$} ",
            self.time.format("%Y-%m-%d %H:%M:%S%.3f %:z"),
            self.level.as_str(),
            self.source,
            op,
            sw = SOURCE_WIDTH,
            ow = OP_WIDTH,
        );
        let mut line = prefix.clone();
        match &self.repeat {
            Some(r) => {
                line.push_str(&one_line(&self.message));
                line.push_str(&format!(
                    " … repeated {} {} until {}",
                    r.count,
                    if r.count == 1 { "time" } else { "times" },
                    r.until.format("%H:%M:%S")
                ));
                if let Some(op) = r.last_op {
                    line.push_str(&format!(", last in #{op}"));
                }
            }
            None => line.push_str(&one_line(&self.message)),
        }
        if !self.fields.is_empty() {
            line.push(' ');
            for (k, v) in &self.fields {
                line.push(' ');
                line.push_str(k);
                line.push('=');
                line.push_str(&quote(v));
            }
        }
        if let Some(code) = &self.code {
            line.push_str(" [");
            line.push_str(code);
            line.push(']');
        }
        let indent = " ".repeat(prefix.chars().count());
        for cause in &self.causes {
            line.push('\n');
            line.push_str(&indent);
            line.push_str("caused by: ");
            line.push_str(&one_line(cause));
        }
        line
    }

    /// Whether `other` is a repeat of this entry: same level, source, code,
    /// message, causes and identifying fields. Fields that only measure
    /// (numbers, memory addresses) and the operation may differ, so repeated
    /// scans with other timings collapse, while a POST next to a GET or two
    /// different rivens stay apart.
    pub(crate) fn same_as(&self, other: &Entry) -> bool {
        self.level == other.level
            && self.source == other.source
            && self.code == other.code
            && self.message == other.message
            && self.causes == other.causes
            && identifying_fields(&self.fields).eq(identifying_fields(&other.fields))
    }
}

/// The fields that say *what* happened, as opposed to how much or where in
/// memory: everything except numbers and `0x…` addresses.
fn identifying_fields(fields: &[(String, String)]) -> impl Iterator<Item = &(String, String)> {
    fields.iter().filter(|(_, value)| !is_measurement(value))
}

fn is_measurement(value: &str) -> bool {
    let v = value.trim();
    if let Some(hex) = v.strip_prefix("0x") {
        return !hex.is_empty() && hex.chars().all(|c| c.is_ascii_hexdigit());
    }
    !v.is_empty() && v.parse::<f64>().is_ok()
}

/// Text that must stay on one line of the log: line breaks are written as
/// `\n`, the way field values already are.
fn one_line(text: &str) -> std::borrow::Cow<'_, str> {
    if text.contains(['\n', '\r']) {
        text.replace("\r\n", "\\n")
            .replace(['\n', '\r'], "\\n")
            .into()
    } else {
        text.into()
    }
}

fn quote(value: &str) -> String {
    if value.is_empty()
        || value
            .chars()
            .any(|c| c.is_whitespace() || c == '"' || c == '=')
    {
        format!("{value:?}")
    } else {
        value.to_string()
    }
}

#[cfg(test)]
pub(crate) mod tests {
    use super::*;
    use chrono::TimeZone;

    pub(crate) fn at(h: u32, m: u32, s: u32) -> DateTime<Local> {
        Local.with_ymd_and_hms(2026, 11, 18, h, m, s).unwrap()
    }

    pub(crate) fn entry(message: &str) -> Entry {
        Entry {
            id: 0,
            time: at(15, 3, 12),
            level: Level::Warn,
            source: "scanner".into(),
            code: None,
            message: message.into(),
            fields: vec![],
            causes: vec![],
            op: None,
            repeat: None,
        }
    }

    #[test]
    fn line_has_fixed_columns_fields_code_and_causes() {
        let mut e = entry("Account blob not found: 0 of 412 memory regions matched");
        e.op = Some(42);
        e.code = Some("scanner.not_found".into());
        e.fields = vec![
            ("attempt".into(), "3/3".into()),
            ("item".into(), "ash prime".into()),
        ];
        e.causes = vec!["ReadProcessMemory failed (os error 299)".into()];
        let line = e.to_line();
        let mut lines = line.lines();
        let first = lines.next().unwrap();
        assert!(first.ends_with(
            "WARN  scanner    #42    Account blob not found: 0 of 412 memory regions matched  attempt=3/3 item=\"ash prime\" [scanner.not_found]"
        ));
        let second = lines.next().unwrap();
        let message_col = first.find("Account").unwrap();
        assert_eq!(second.find("caused by:"), Some(message_col));
        assert!(lines.next().is_none());
    }

    #[test]
    fn entries_that_differ_in_what_happened_are_not_repeats() {
        let with = |fields: &[(&str, &str)]| {
            let mut e = entry("Request done");
            e.fields = fields
                .iter()
                .map(|(k, v)| (k.to_string(), v.to_string()))
                .collect();
            e
        };
        let get = with(&[
            ("method", "GET"),
            ("path", "/v2/orders/my"),
            ("elapsed_ms", "105"),
        ]);
        let get_later = with(&[
            ("method", "GET"),
            ("path", "/v2/orders/my"),
            ("elapsed_ms", "140"),
        ]);
        let post = with(&[
            ("method", "POST"),
            ("path", "/v2/order"),
            ("elapsed_ms", "98"),
        ]);
        assert!(get.same_as(&get_later));
        assert!(!get.same_as(&post));

        let scan = with(&[("regions_read", "3736"), ("addr", "0x01cd0e7e6000")]);
        let other_scan = with(&[("regions_read", "658"), ("addr", "0x7ff4c6cc0010")]);
        assert!(scan.same_as(&other_scan));

        let riven = |weapon: &str| with(&[("weapon", weapon), ("positives", "2")]);
        assert!(!riven("akarius").same_as(&riven("soma")));
    }

    #[test]
    fn line_breaks_in_messages_and_causes_stay_on_their_line() {
        let mut e = entry("first\nsecond");
        e.causes = vec!["a\r\nb".into()];
        let line = e.to_line();
        assert_eq!(line.lines().count(), 2);
        assert!(line.contains(r"first\nsecond"));
        assert!(line.ends_with(r"caused by: a\nb"));
    }

    #[test]
    fn repeat_line_states_count_time_and_last_op() {
        let mut e = entry("Account blob not found");
        e.repeat = Some(Repeat {
            of: 7,
            count: 36,
            until: at(15, 9, 44),
            last_op: Some(78),
        });
        assert!(e
            .to_line()
            .ends_with("… repeated 36 times until 15:09:44, last in #78"));
        e.repeat = Some(Repeat {
            of: 7,
            count: 1,
            until: at(15, 9, 44),
            last_op: None,
        });
        assert!(e.to_line().ends_with("… repeated 1 time until 15:09:44"));
    }

    #[test]
    fn serializes_fields_as_an_ordered_map() {
        let mut e = entry("Scan started");
        e.fields = vec![("b".into(), "1".into()), ("a".into(), "2".into())];
        let json = serde_json::to_string(&e).unwrap();
        assert!(json.contains(r#""fields":{"b":"1","a":"2"}"#), "{json}");
        assert!(json.contains(r#""level":"warn""#));
    }
}
