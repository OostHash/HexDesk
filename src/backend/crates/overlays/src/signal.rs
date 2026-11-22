//! What the tracker is told: everything that says something about the
//! screen, with the time it happened.

use crate::ee_log::LogEvent;
use crate::screen::Screen;
use crate::tracker::VisitId;

/// How the player hid an overlay.
#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub enum HideBy {
    /// The overlay key, pressed while an overlay was on screen.
    Key,
    /// The overlay's close button.
    CloseButton,
}

/// Milliseconds since the Unix epoch.
pub type Millis = i64;

/// One input for the tracker.
#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub struct Signal {
    /// When it happened. For an EE.log line that is when the game wrote it,
    /// which can be well before the line reaches us.
    pub at: Millis,
    pub kind: SignalKind,
}

/// What a signal says.
#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub enum SignalKind {
    /// A line in EE.log.
    Log(LogEvent),
    /// The overlay key read the screen title. `None` when the title matched
    /// no screen with an overlay.
    Title(Option<Screen>),
    /// Background OCR checked the title while an overlay was visible. `None`
    /// means repeated reads no longer found the expected screen.
    ObservedTitle(Option<Screen>),
    /// The player hid the overlay on screen.
    Hide(HideBy),
    /// A timer set by [`crate::Action::Timer`] ran out.
    Timeout(VisitId),
}

impl Signal {
    pub const fn log(at: Millis, event: LogEvent) -> Signal {
        Signal {
            at,
            kind: SignalKind::Log(event),
        }
    }

    pub const fn title(at: Millis, screen: Option<Screen>) -> Signal {
        Signal {
            at,
            kind: SignalKind::Title(screen),
        }
    }

    pub const fn observed_title(at: Millis, screen: Option<Screen>) -> Signal {
        Signal {
            at,
            kind: SignalKind::ObservedTitle(screen),
        }
    }

    pub const fn hide(at: Millis, by: HideBy) -> Signal {
        Signal {
            at,
            kind: SignalKind::Hide(by),
        }
    }

    pub const fn timeout(at: Millis, visit: VisitId) -> Signal {
        Signal {
            at,
            kind: SignalKind::Timeout(visit),
        }
    }

    /// Where the signal came from, for log lines.
    pub fn source(&self) -> String {
        match self.kind {
            SignalKind::Log(event) => format!("EE.log \"{}\"", event.line()),
            SignalKind::Title(Some(screen)) => format!("overlay key: {} title", screen.name()),
            SignalKind::Title(None) => "overlay key: title not recognised".to_string(),
            SignalKind::ObservedTitle(Some(screen)) => {
                format!("background OCR: {} title", screen.name())
            }
            SignalKind::ObservedTitle(None) => {
                "background OCR: reward title no longer found".to_string()
            }
            SignalKind::Hide(HideBy::Key) => "overlay key: hide".to_string(),
            SignalKind::Hide(HideBy::CloseButton) => "close button".to_string(),
            SignalKind::Timeout(visit) => format!("time limit of visit #{visit}"),
        }
    }
}
