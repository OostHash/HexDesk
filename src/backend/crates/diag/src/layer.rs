use std::fmt::Write as _;
use std::sync::Arc;
use std::time::{Duration, Instant};

use chrono::Local;
use tracing::field::{Field, Visit};
use tracing::span::{Attributes, Id, Record};
use tracing::{Event, Subscriber};
use tracing_subscriber::layer::Context;
use tracing_subscriber::registry::LookupSpan;
use tracing_subscriber::Layer;

use crate::entry::Entry;
use crate::error::LOGGING;
use crate::{redact, Collector};

/// The tracing layer that turns events and closing spans into [`Entry`]s for
/// a [`Collector`]. Add a filter to it (for example an `EnvFilter`) to choose
/// which levels reach the log.
pub struct DiagLayer {
    collector: Arc<Collector>,
}

impl DiagLayer {
    pub fn new(collector: Arc<Collector>) -> Self {
        Self { collector }
    }
}

/// Set on spans created by [`crate::op!`].
struct OpInfo {
    id: u64,
    name: String,
}

struct SpanFields(Vec<(String, String)>);

struct Timing {
    busy: Duration,
    idle: Duration,
    last: Instant,
}

impl<S> Layer<S> for DiagLayer
where
    S: Subscriber + for<'a> LookupSpan<'a>,
{
    fn on_new_span(&self, attrs: &Attributes<'_>, id: &Id, ctx: Context<'_, S>) {
        let Some(span) = ctx.span(id) else { return };
        let mut visitor = FieldVisitor::default();
        attrs.record(&mut visitor);
        let mut ext = span.extensions_mut();
        if attrs.metadata().name() == "op" {
            if let Some(op) = visitor.op {
                ext.insert(OpInfo {
                    id: op,
                    name: visitor.op_name.clone().unwrap_or_default(),
                });
            }
        }
        ext.insert(SpanFields(visitor.fields));
        ext.insert(Timing {
            busy: Duration::ZERO,
            idle: Duration::ZERO,
            last: Instant::now(),
        });
    }

    fn on_record(&self, id: &Id, values: &Record<'_>, ctx: Context<'_, S>) {
        let Some(span) = ctx.span(id) else { return };
        let mut visitor = FieldVisitor::default();
        values.record(&mut visitor);
        let mut ext = span.extensions_mut();
        if let Some(fields) = ext.get_mut::<SpanFields>() {
            for (k, v) in visitor.fields {
                match fields.0.iter_mut().find(|(key, _)| *key == k) {
                    Some(slot) => slot.1 = v,
                    None => fields.0.push((k, v)),
                }
            }
        }
    }

    fn on_enter(&self, id: &Id, ctx: Context<'_, S>) {
        if let Some(span) = ctx.span(id) {
            if let Some(t) = span.extensions_mut().get_mut::<Timing>() {
                let now = Instant::now();
                t.idle += now - t.last;
                t.last = now;
            }
        }
    }

    fn on_exit(&self, id: &Id, ctx: Context<'_, S>) {
        if let Some(span) = ctx.span(id) {
            if let Some(t) = span.extensions_mut().get_mut::<Timing>() {
                let now = Instant::now();
                t.busy += now - t.last;
                t.last = now;
            }
        }
    }

    fn on_close(&self, id: Id, ctx: Context<'_, S>) {
        let Some(span) = ctx.span(&id) else { return };
        let meta = span.metadata();
        let ext = span.extensions();
        let mut fields = Vec::new();
        let (op, message) = match ext.get::<OpInfo>() {
            Some(info) => {
                let elapsed = ext
                    .get::<Timing>()
                    .map(|t| t.busy + t.idle + t.last.elapsed());
                if let Some(elapsed) = elapsed {
                    fields.push(("elapsed_ms".to_string(), elapsed.as_millis().to_string()));
                }
                (Some(info.id), format!("{} finished", info.name))
            }
            None => {
                if let Some(span_fields) = ext.get::<SpanFields>() {
                    fields.extend(span_fields.0.iter().cloned());
                }
                if let Some(t) = ext.get::<Timing>() {
                    fields.push(("busy_ms".to_string(), t.busy.as_millis().to_string()));
                    fields.push((
                        "idle_ms".to_string(),
                        (t.idle + t.last.elapsed()).as_millis().to_string(),
                    ));
                }
                let op = span
                    .scope()
                    .skip(1)
                    .find_map(|s| s.extensions().get::<OpInfo>().map(|i| i.id));
                (op, format!("{} finished", meta.name()))
            }
        };
        drop(ext);
        self.collector.record(Entry {
            id: 0,
            time: Local::now(),
            level: meta.level().into(),
            source: source_of(meta.target()),
            code: None,
            message,
            fields,
            causes: Vec::new(),
            op,
            repeat: None,
        });
    }

    fn on_event(&self, event: &Event<'_>, ctx: Context<'_, S>) {
        let meta = event.metadata();
        let mut visitor = FieldVisitor::default();
        event.record(&mut visitor);

        let target = visitor.log_target.as_deref().unwrap_or(meta.target());
        let op = ctx.event_scope(event).and_then(|scope| {
            scope
                .from_root()
                .filter_map(|s| s.extensions().get::<OpInfo>().map(|i| i.id))
                .last()
        });

        let mut entry = Entry {
            id: 0,
            time: Local::now(),
            level: meta.level().into(),
            source: source_of(target),
            code: None,
            message: redact::text(&visitor.message),
            fields: visitor.fields,
            causes: Vec::new(),
            op,
            repeat: None,
        };

        if visitor.diag_error {
            if let Some(err) = LOGGING.with(|slot| slot.borrow().clone()) {
                entry.source = err.source().as_str().to_string();
                entry.code = Some(err.code());
                entry.message = err.message().to_string();
                entry.fields = err.fields().to_vec();
                entry.causes = err.causes().to_vec();
            }
        }

        self.collector.record(entry);
    }
}

/// The source name for a tracing target.
///
/// - `hexdesk::scanner` → `scanner`
/// - `hexdesk_backend::memory_scanner::parse` → `memory_scanner` (code that
///   does not log through a source yet)
/// - `hexdesk_backend`, `hexdesk_diag` → `app`
/// - `ureq::response` → `ureq`
fn source_of(target: &str) -> String {
    if let Some(rest) = target.strip_prefix("hexdesk::") {
        return rest.split("::").next().unwrap_or(rest).to_string();
    }
    let mut parts = target.split("::");
    let first = parts.next().unwrap_or(target);
    if first == "hexdesk_backend" || first == "hexdesk" || first == "hexdesk_diag" {
        return parts
            .next()
            .map_or_else(|| "app".to_string(), str::to_string);
    }
    first.to_string()
}

#[derive(Default)]
struct FieldVisitor {
    message: String,
    fields: Vec<(String, String)>,
    diag_error: bool,
    op: Option<u64>,
    op_name: Option<String>,
    log_target: Option<String>,
}

impl FieldVisitor {
    fn push(&mut self, field: &Field, value: String) {
        match field.name() {
            "message" => self.message = value,
            "diag_error" | "code" if self.diag_error => {}
            "name" if self.op.is_some() => self.op_name = Some(value),
            "log.target" => self.log_target = Some(value),
            name if name.starts_with("log.") => {}
            name => self
                .fields
                .push((name.to_string(), redact::field(name, &value))),
        }
    }
}

impl Visit for FieldVisitor {
    fn record_bool(&mut self, field: &Field, value: bool) {
        if field.name() == "diag_error" {
            self.diag_error = value;
            return;
        }
        self.push(field, value.to_string());
    }

    fn record_u64(&mut self, field: &Field, value: u64) {
        if field.name() == "op" && self.op.is_none() {
            self.op = Some(value);
            return;
        }
        self.push(field, value.to_string());
    }

    fn record_i64(&mut self, field: &Field, value: i64) {
        self.push(field, value.to_string());
    }

    fn record_f64(&mut self, field: &Field, value: f64) {
        self.push(field, value.to_string());
    }

    fn record_str(&mut self, field: &Field, value: &str) {
        self.push(field, value.to_string());
    }

    fn record_error(&mut self, field: &Field, value: &(dyn std::error::Error + 'static)) {
        self.push(field, value.to_string());
    }

    fn record_debug(&mut self, field: &Field, value: &dyn std::fmt::Debug) {
        let mut s = String::new();
        let _ = write!(s, "{value:?}");
        self.push(field, s);
    }
}

#[cfg(test)]
mod tests {
    use super::*;
    use crate::{Config, DiagError, Kind, Level, Source};
    use tracing_subscriber::layer::SubscriberExt;

    fn with_layer(f: impl FnOnce()) -> Arc<Collector> {
        let collector = Arc::new(Collector::new(Config::default()));
        let subscriber = tracing_subscriber::registry().with(DiagLayer::new(collector.clone()));
        tracing::subscriber::with_default(subscriber, f);
        collector
    }

    #[test]
    fn targets_map_to_sources() {
        assert_eq!(source_of("hexdesk::scanner"), "scanner");
        assert_eq!(source_of("hexdesk::blob_parse"), "blob_parse");
        assert_eq!(
            source_of("hexdesk_backend::memory_scanner"),
            "memory_scanner"
        );
        assert_eq!(source_of("hexdesk_backend"), "app");
        assert_eq!(source_of("ureq::response"), "ureq");
    }

    #[test]
    fn macro_events_carry_source_fields_and_op() {
        let c = with_layer(|| {
            let _g = crate::op!(scanner, "Inventory scan").entered();
            crate::info!(scanner, attempt = "1/3", "Scan started");
            crate::debug!(scanner, pid = 18244u64, elevated = false, "Process found");
        });
        let entries = c.recent(10);
        assert_eq!(entries.len(), 3);
        let op = entries[0].op.expect("entry inside op has an id");
        assert_eq!(entries[0].source, "scanner");
        assert_eq!(entries[0].message, "Scan started");
        assert_eq!(entries[0].fields, [("attempt".into(), "1/3".into())]);
        assert_eq!(
            entries[1].fields,
            [
                ("pid".into(), "18244".into()),
                ("elevated".into(), "false".into())
            ]
        );
        assert_eq!(entries[1].op, Some(op));
        assert_eq!(entries[2].message, "Inventory scan finished");
        assert_eq!(entries[2].op, Some(op));
        assert_eq!(entries[2].fields[0].0, "elapsed_ms");
    }

    #[test]
    fn logged_errors_keep_code_fields_and_causes() {
        let c = with_layer(|| {
            let _ = DiagError::new(
                Source::Scanner,
                Kind::NotFound,
                "Account blob not found: 0 of 412 memory regions matched",
            )
            .with("attempt", "3/3")
            .caused_by_text("ReadProcessMemory failed (os error 299)")
            .log();
        });
        let e = &c.recent(1)[0];
        assert_eq!(e.level, Level::Warn);
        assert_eq!(e.source, "scanner");
        assert_eq!(e.code.as_deref(), Some("scanner.not_found"));
        assert_eq!(e.fields, [("attempt".into(), "3/3".into())]);
        assert_eq!(e.causes, ["ReadProcessMemory failed (os error 299)"]);
        assert!(e.to_line().contains("[scanner.not_found]"));
    }

    #[test]
    fn plain_tracing_events_are_redacted() {
        let c = with_layer(|| {
            tracing::warn!(
                token = "abc",
                url = "https://x.example/?password=hunter2",
                "Login for a@b.example failed"
            );
        });
        let e = &c.recent(1)[0];
        assert_eq!(e.message, "Login for [redacted] failed");
        assert_eq!(e.fields[0], ("token".into(), "[redacted]".into()));
        assert_eq!(
            e.fields[1],
            (
                "url".into(),
                "https://x.example/?password=[redacted]".into()
            )
        );
    }

    #[test]
    fn ordinary_spans_report_their_timings() {
        let c = with_layer(|| {
            let span = tracing::info_span!("scan_inventory", max_hits = 3u64);
            let _g = span.enter();
        });
        let e = &c.recent(1)[0];
        assert_eq!(e.message, "scan_inventory finished");
        let keys: Vec<&str> = e.fields.iter().map(|(k, _)| k.as_str()).collect();
        assert_eq!(keys, ["max_hits", "busy_ms", "idle_ms"]);
    }
}
