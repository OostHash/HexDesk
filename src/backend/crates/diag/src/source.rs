use serde::Serialize;

macro_rules! define_sources {
    ($($variant:ident => $name:ident),+ $(,)?) => {
        /// The part of the app an entry or error comes from.
        #[derive(Debug, Clone, Copy, PartialEq, Eq, Hash, Serialize)]
        #[serde(rename_all = "snake_case")]
        pub enum Source {
            $($variant),+
        }

        impl Source {
            /// All sources, in display order.
            pub const ALL: &'static [Source] = &[$(Source::$variant),+];

            /// The name used in log lines and filters.
            pub const fn as_str(self) -> &'static str {
                match self {
                    $(Source::$variant => stringify!($name)),+
                }
            }

            /// The tracing target for this source.
            pub const fn target(self) -> &'static str {
                match self {
                    $(Source::$variant => concat!("hexdesk::", stringify!($name))),+
                }
            }

            /// Looks a source up by its name.
            pub fn from_name(name: &str) -> Option<Source> {
                match name {
                    $(stringify!($name) => Some(Source::$variant),)+
                    _ => None,
                }
            }
        }

        /// One marker per source, so the logging macros reject unknown source
        /// names at compile time.
        #[doc(hidden)]
        #[allow(non_upper_case_globals)]
        pub mod sources {
            $(pub const $name: () = ();)+
        }

        /// Emits the tracing event that carries a [`crate::DiagError`].
        /// Tracing targets must be constants, hence one arm per source and
        /// level.
        pub(crate) fn emit_error(source: Source, level: crate::Level, code: &str, message: &str) {
            match source {
                $(Source::$variant => match level {
                    crate::Level::Error => tracing::error!(target: concat!("hexdesk::", stringify!($name)), diag_error = true, code, "{message}"),
                    crate::Level::Warn => tracing::warn!(target: concat!("hexdesk::", stringify!($name)), diag_error = true, code, "{message}"),
                    crate::Level::Info => tracing::info!(target: concat!("hexdesk::", stringify!($name)), diag_error = true, code, "{message}"),
                    crate::Level::Debug => tracing::debug!(target: concat!("hexdesk::", stringify!($name)), diag_error = true, code, "{message}"),
                    crate::Level::Trace => tracing::trace!(target: concat!("hexdesk::", stringify!($name)), diag_error = true, code, "{message}"),
                }),+
            }
        }
    };
}

define_sources! {
    App => app,
    Scanner => scanner,
    Market => market,
    Overlay => overlay,
    OverlayKey => overlay_key,
    RelicPick => relic_pick,
    RelicReward => relic_reward,
    Riven => riven,
    Updater => updater,
    Settings => settings,
    Catalogue => catalogue,
    Worldstate => worldstate,
    Trade => trade,
    Ui => ui,
}

impl std::fmt::Display for Source {
    fn fmt(&self, f: &mut std::fmt::Formatter<'_>) -> std::fmt::Result {
        f.write_str(self.as_str())
    }
}

/// What kind of failure an error is. Together with the source it forms the
/// error code, for example `scanner.not_found`.
#[derive(Debug, Clone, Copy, PartialEq, Eq, Hash, Serialize)]
#[serde(rename_all = "snake_case")]
pub enum Kind {
    /// Something we looked for is not there.
    NotFound,
    /// Something exists but we are kept from using it.
    Blocked,
    /// The OS or a service refused the operation.
    Denied,
    /// A network request failed before an answer arrived.
    Network,
    /// An operation took longer than its limit.
    Timeout,
    /// Data arrived but could not be read.
    Parse,
    /// Reading or writing a file failed.
    Io,
    /// Input or state was not valid for the operation.
    Invalid,
    /// A service answered, but not with what was needed.
    Unavailable,
    /// A bug in HexDesk itself.
    Internal,
}

impl Kind {
    pub const fn as_str(self) -> &'static str {
        match self {
            Kind::NotFound => "not_found",
            Kind::Blocked => "blocked",
            Kind::Denied => "denied",
            Kind::Network => "network",
            Kind::Timeout => "timeout",
            Kind::Parse => "parse",
            Kind::Io => "io",
            Kind::Invalid => "invalid",
            Kind::Unavailable => "unavailable",
            Kind::Internal => "internal",
        }
    }
}

impl std::fmt::Display for Kind {
    fn fmt(&self, f: &mut std::fmt::Formatter<'_>) -> std::fmt::Result {
        f.write_str(self.as_str())
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn names_and_targets_match() {
        for source in Source::ALL {
            assert_eq!(Source::from_name(source.as_str()), Some(*source));
            assert_eq!(source.target(), format!("hexdesk::{}", source.as_str()));
        }
        assert_eq!(Source::from_name("nope"), None);
    }
}
