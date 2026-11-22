use std::collections::{HashMap, VecDeque};
use std::io::Write;
use std::sync::{Mutex, RwLock};

use chrono::{DateTime, Local};

use crate::entry::{Entry, Repeat};

/// Settings for a [`Collector`].
#[derive(Debug, Clone)]
pub struct Config {
    /// How many entries are kept in memory for the console and the export.
    pub capacity: usize,
    /// An entry only counts as a repeat if the same entry was seen less than
    /// this long ago. Rare events are always written in full.
    pub repeat_window: chrono::Duration,
    /// Pending repeat counts are written at least this often, so a long run
    /// of repeats still shows up in the log while it is going on.
    pub repeat_flush: chrono::Duration,
}

impl Default for Config {
    fn default() -> Self {
        Self {
            capacity: 2000,
            repeat_window: chrono::Duration::seconds(60),
            repeat_flush: chrono::Duration::minutes(5),
        }
    }
}

type Listener = Box<dyn Fn(&Entry) + Send + Sync>;

/// Receives every entry, collapses repeats, writes the log file and keeps
/// the most recent entries in memory.
///
/// Repeats are tracked per source. The first occurrence of an entry is
/// written in full. Later identical entries (see [`Entry`] equality rules in
/// `same_as`) are only counted. As soon as that source logs something new, or
/// on [`Collector::flush`], one `… repeated N times` entry is written for
/// each counted entry.
pub struct Collector {
    config: Config,
    inner: Mutex<Inner>,
    sink: Mutex<Option<Box<dyn Write + Send>>>,
    listener: RwLock<Option<Listener>>,
}

#[derive(Default)]
struct Inner {
    capacity: usize,
    next_id: u64,
    buffer: VecDeque<Entry>,
    sources: HashMap<String, Vec<Seen>>,
}

struct Seen {
    entry: Entry,
    last_seen: DateTime<Local>,
    pending: Option<Repeat>,
    pending_since: Option<DateTime<Local>>,
}

/// More distinct entries than this per source without a repeat resets the
/// bookkeeping, so it cannot grow without bound.
const MAX_SEEN_PER_SOURCE: usize = 256;

impl Collector {
    pub fn new(config: Config) -> Self {
        Self {
            inner: Mutex::new(Inner {
                capacity: config.capacity.max(1),
                next_id: 1,
                ..Inner::default()
            }),
            sink: Mutex::new(None),
            listener: RwLock::new(None),
            config,
        }
    }

    /// Writes every entry, as a line, to `sink` (the log file).
    pub fn with_sink(self, sink: impl Write + Send + 'static) -> Self {
        *self.sink.lock().unwrap_or_else(|e| e.into_inner()) = Some(Box::new(sink));
        self
    }

    /// Replaces the file writer. Logging can keep using the same collector
    /// while its current log file is removed and reopened.
    pub fn set_sink(&self, sink: impl Write + Send + 'static) {
        *self.sink.lock().unwrap_or_else(|e| e.into_inner()) = Some(Box::new(sink));
    }

    /// Drops the current file writer after pending entries have been flushed.
    pub fn take_sink(&self) {
        self.sink.lock().unwrap_or_else(|e| e.into_inner()).take();
    }

    /// Clears the activity console and repeat bookkeeping without changing
    /// the next entry id.
    pub fn clear(&self) {
        let mut inner = self.inner.lock().unwrap_or_else(|e| e.into_inner());
        inner.buffer.clear();
        inner.sources.clear();
    }

    /// Calls `listener` for every entry that is written, for example to push
    /// it to the activity console. Replaces an earlier listener.
    pub fn set_listener(&self, listener: impl Fn(&Entry) + Send + Sync + 'static) {
        *self.listener.write().unwrap_or_else(|e| e.into_inner()) = Some(Box::new(listener));
    }

    /// Takes in an entry. Returns the entries that were actually written,
    /// which is none for a repeat.
    pub fn record(&self, entry: Entry) -> Vec<Entry> {
        let written = {
            let mut inner = self.inner.lock().unwrap_or_else(|e| e.into_inner());
            inner.record(entry, &self.config)
        };
        self.emit(&written);
        written
    }

    /// Writes all pending repeat counts.
    pub fn flush(&self) {
        let written = {
            let mut inner = self.inner.lock().unwrap_or_else(|e| e.into_inner());
            let mut out = Vec::new();
            let keys: Vec<String> = inner.sources.keys().cloned().collect();
            let now = Local::now();
            for source in keys {
                inner.flush_source(&source, &mut out, now);
            }
            out
        };
        self.emit(&written);
        if let Some(sink) = self.sink.lock().unwrap_or_else(|e| e.into_inner()).as_mut() {
            let _ = sink.flush();
        }
    }

    /// The most recent written entries, oldest first.
    pub fn recent(&self, limit: usize) -> Vec<Entry> {
        let inner = self.inner.lock().unwrap_or_else(|e| e.into_inner());
        let skip = inner.buffer.len().saturating_sub(limit);
        inner.buffer.iter().skip(skip).cloned().collect()
    }

    fn emit(&self, written: &[Entry]) {
        if written.is_empty() {
            return;
        }
        if let Some(sink) = self.sink.lock().unwrap_or_else(|e| e.into_inner()).as_mut() {
            for entry in written {
                // Nowhere to report a failing log write; the entry is still
                // in memory.
                let _ = writeln!(sink, "{}", entry.to_line());
            }
        }
        if let Some(listener) = self
            .listener
            .read()
            .unwrap_or_else(|e| e.into_inner())
            .as_ref()
        {
            for entry in written {
                listener(entry);
            }
        }
    }
}

impl Inner {
    fn record(&mut self, entry: Entry, config: &Config) -> Vec<Entry> {
        let mut out = Vec::new();
        let now = entry.time;
        let source = entry.source.clone();

        // Write counts that have been pending too long.
        if let Some(seen) = self.sources.get(&source) {
            if seen.iter().any(|s| {
                s.pending_since
                    .is_some_and(|t| now - t >= config.repeat_flush)
            }) {
                self.flush_source(&source, &mut out, now);
            }
        }

        let seen = self.sources.entry(source.clone()).or_default();
        if let Some(s) = seen.iter_mut().find(|s| s.entry.same_as(&entry)) {
            if now - s.last_seen < config.repeat_window {
                s.last_seen = now;
                let pending = s.pending.get_or_insert(Repeat {
                    of: s.entry.id,
                    count: 0,
                    until: now,
                    last_op: None,
                });
                pending.count += 1;
                pending.until = now;
                pending.last_op = entry.op;
                s.pending_since.get_or_insert(now);
                return out;
            }
        }

        // Something new (or an old entry seen again after a long time): write
        // what was counted for this source, then start over.
        let had_pending = seen.iter().any(|s| s.pending.is_some());
        if had_pending {
            self.flush_source(&source, &mut out, now);
        }
        let seen = self.sources.entry(source.clone()).or_default();
        if had_pending || seen.len() >= MAX_SEEN_PER_SOURCE {
            seen.clear();
        }
        seen.retain(|s| !s.entry.same_as(&entry));

        let entry = self.push(entry);
        let seen = self.sources.entry(source).or_default();
        seen.push(Seen {
            entry: entry.clone(),
            last_seen: now,
            pending: None,
            pending_since: None,
        });
        out.push(entry);
        out
    }

    fn flush_source(&mut self, source: &str, out: &mut Vec<Entry>, now: DateTime<Local>) {
        let Some(seen) = self.sources.get_mut(source) else {
            return;
        };
        let mut repeats = Vec::new();
        for s in seen.iter_mut() {
            if let Some(repeat) = s.pending.take() {
                s.pending_since = None;
                let mut entry = s.entry.clone();
                entry.time = now;
                entry.fields.clear();
                entry.causes.clear();
                entry.op = None;
                entry.repeat = Some(repeat);
                repeats.push(entry);
            }
        }
        repeats.sort_by_key(|e| e.repeat.as_ref().map(|r| r.of));
        for entry in repeats {
            out.push(self.push(entry));
        }
    }

    fn push(&mut self, mut entry: Entry) -> Entry {
        entry.id = self.next_id;
        self.next_id += 1;
        self.buffer.push_back(entry.clone());
        while self.buffer.len() > self.capacity {
            self.buffer.pop_front();
        }
        entry
    }
}

#[cfg(test)]
mod tests {
    use super::*;
    use crate::entry::tests::{at, entry};
    use std::sync::{Arc, Mutex as StdMutex};

    #[derive(Clone, Default)]
    struct Sink(Arc<StdMutex<Vec<u8>>>);
    impl Write for Sink {
        fn write(&mut self, buf: &[u8]) -> std::io::Result<usize> {
            self.0.lock().unwrap().extend_from_slice(buf);
            Ok(buf.len())
        }
        fn flush(&mut self) -> std::io::Result<()> {
            Ok(())
        }
    }
    impl Sink {
        fn text(&self) -> String {
            String::from_utf8(self.0.lock().unwrap().clone()).unwrap()
        }
    }

    fn timed(message: &str, h: u32, m: u32, s: u32) -> Entry {
        let mut e = entry(message);
        e.time = at(h, m, s);
        e
    }

    #[test]
    fn identical_entries_are_counted_and_written_once_something_new_arrives() {
        let sink = Sink::default();
        let c = Collector::new(Config::default()).with_sink(sink.clone());
        assert_eq!(c.record(timed("Blob not found", 15, 0, 0)).len(), 1);
        for s in 1..=36 {
            let mut e = timed("Blob not found", 15, 0, s);
            e.op = Some(40 + u64::from(s));
            assert!(c.record(e).is_empty());
        }
        let written = c.record(timed("Blob found", 15, 1, 0));
        assert_eq!(written.len(), 2);
        let repeat = written[0].repeat.as_ref().unwrap();
        assert_eq!((repeat.of, repeat.count, repeat.last_op), (1, 36, Some(76)));
        assert_eq!(written[1].message, "Blob found");

        let text = sink.text();
        let lines: Vec<&str> = text.lines().collect();
        assert_eq!(lines.len(), 3);
        assert!(lines[1].contains("Blob not found … repeated 36 times until 15:00:36, last in #76"));
        // Written when the new entry arrived, so the file stays in time order.
        assert_eq!(written[0].time, at(15, 1, 0));
    }

    #[test]
    fn a_repeating_cycle_of_entries_collapses() {
        let c = Collector::new(Config::default());
        let cycle = ["Scan started", "Process found", "Blob not found"];
        let mut written = 0;
        for pass in 0..10u32 {
            for (i, msg) in cycle.iter().enumerate() {
                written += c.record(timed(msg, 15, 0, pass * 3 + i as u32)).len();
            }
        }
        assert_eq!(written, 3);
        c.flush();
        let recent = c.recent(100);
        assert_eq!(recent.len(), 6);
        assert!(recent[3..]
            .iter()
            .all(|e| e.repeat.as_ref().unwrap().count == 9));
    }

    #[test]
    fn different_causes_are_not_repeats() {
        let c = Collector::new(Config::default());
        let mut a = timed("Blob not found", 15, 0, 0);
        a.causes = vec!["0 regions matched".into()];
        let mut b = timed("Blob not found", 15, 0, 1);
        b.causes = vec!["memory read denied".into()];
        assert_eq!(c.record(a).len(), 1);
        assert_eq!(c.record(b).len(), 1);
    }

    #[test]
    fn sources_are_tracked_separately() {
        let c = Collector::new(Config::default());
        let mut market = timed("Price request failed", 15, 0, 0);
        market.source = "market".into();
        c.record(timed("Blob not found", 15, 0, 0));
        c.record(timed("Blob not found", 15, 0, 1));
        // A market entry does not end the scanner's run of repeats.
        assert_eq!(c.record(market).len(), 1);
        assert!(c.record(timed("Blob not found", 15, 0, 2)).is_empty());
    }

    #[test]
    fn an_entry_seen_again_after_the_window_is_written_in_full() {
        let c = Collector::new(Config::default());
        c.record(timed("Signed in", 15, 0, 0));
        assert_eq!(c.record(timed("Signed in", 16, 0, 0)).len(), 1);
    }

    #[test]
    fn long_runs_of_repeats_are_flushed_periodically() {
        let c = Collector::new(Config::default());
        c.record(timed("Blob not found", 15, 0, 0));
        let mut total = 0;
        for m in 0..7u32 {
            for s in (0..60).step_by(10) {
                if m == 0 && s == 0 {
                    continue;
                }
                total += c.record(timed("Blob not found", 15, m, s)).len();
            }
        }
        // The count is written once the repeats have been pending for five
        // minutes; counting then continues.
        assert_eq!(total, 1);
        c.flush();
        assert!(c.recent(10).last().unwrap().repeat.is_some());
    }

    #[test]
    fn keeps_only_capacity_entries() {
        let c = Collector::new(Config {
            capacity: 3,
            ..Config::default()
        });
        for s in 0..5 {
            c.record(timed(&format!("Entry {s}"), 15, 0, s));
        }
        let recent = c.recent(10);
        assert_eq!(
            recent
                .iter()
                .map(|e| e.message.as_str())
                .collect::<Vec<_>>(),
            ["Entry 2", "Entry 3", "Entry 4"]
        );
        assert_eq!(c.recent(1)[0].message, "Entry 4");
    }

    #[test]
    fn listener_sees_written_entries() {
        let c = Collector::new(Config::default());
        let seen = Arc::new(StdMutex::new(Vec::new()));
        let s = seen.clone();
        c.set_listener(move |e| s.lock().unwrap().push(e.id));
        c.record(timed("One", 15, 0, 0));
        c.record(timed("One", 15, 0, 1));
        c.record(timed("Two", 15, 0, 2));
        assert_eq!(*seen.lock().unwrap(), vec![1, 2, 3]);
    }

    #[test]
    fn clearing_forgets_recent_entries_and_repeat_state() {
        let c = Collector::new(Config::default());
        c.record(timed("One", 15, 0, 0));
        c.record(timed("One", 15, 0, 1));
        c.clear();
        assert!(c.recent(10).is_empty());

        let written = c.record(timed("One", 15, 0, 2));
        assert_eq!(written.len(), 1);
        assert_eq!(written[0].id, 2);
    }
}
