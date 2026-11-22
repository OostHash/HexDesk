//! Logging macros that tie every event to a [`crate::Source`].
//!
//! `hexdesk_diag::info!(scanner, pid, "Process found")` expands to
//! `tracing::info!(target: "hexdesk::scanner", pid, "Process found")`.
//! Everything after the source uses normal `tracing` syntax. An unknown
//! source name is a compile error.

#[doc(hidden)]
#[macro_export]
macro_rules! __event {
    ($level:ident, $source:ident, $($rest:tt)+) => {{
        let _ = $crate::sources::$source;
        $crate::__tracing::$level!(target: concat!("hexdesk::", stringify!($source)), $($rest)+)
    }};
}

/// Logs an error entry for a source.
#[macro_export]
macro_rules! error {
    ($source:ident, $($rest:tt)+) => { $crate::__event!(error, $source, $($rest)+) };
}

/// Logs a warning entry for a source.
#[macro_export]
macro_rules! warn {
    ($source:ident, $($rest:tt)+) => { $crate::__event!(warn, $source, $($rest)+) };
}

/// Logs an info entry for a source.
#[macro_export]
macro_rules! info {
    ($source:ident, $($rest:tt)+) => { $crate::__event!(info, $source, $($rest)+) };
}

/// Logs a debug entry for a source.
#[macro_export]
macro_rules! debug {
    ($source:ident, $($rest:tt)+) => { $crate::__event!(debug, $source, $($rest)+) };
}

/// Starts an operation: a span whose id (`#42`) is shown on every entry
/// logged inside it. Returns a `tracing::Span`; enter it for the duration of
/// the operation. When the span closes, an entry with its duration is logged.
///
/// ```ignore
/// let _guard = hexdesk_diag::op!(scanner, "Inventory scan").entered();
/// ```
#[macro_export]
macro_rules! op {
    ($source:ident, $name:expr) => {{
        let _ = $crate::sources::$source;
        $crate::__tracing::info_span!(
            target: concat!("hexdesk::", stringify!($source)),
            "op",
            op = $crate::next_op_id(),
            name = %$name
        )
    }};
}
