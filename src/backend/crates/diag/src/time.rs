//! Time formats that HexDesk writes to logs, the database and exports.
//!
//! Stored and exported times keep one format, so data and exports written by
//! earlier versions read the same as new ones.

use std::fmt::Write;

use jiff::tz::TimeZone;
use jiff::{Timestamp, ZonedDateTime};
use serde::Serializer;

/// The current time in UTC.
pub fn now_utc() -> ZonedDateTime {
    Timestamp::now().to_zoned_datetime(TimeZone::UTC)
}

/// Formats a time as RFC 3339 with its UTC offset, for example
/// `2026-11-18T12:00:00.123+01:00`.
///
/// Fractional seconds are left out when zero and otherwise written with 3, 6
/// or 9 digits, the fewest that hold the value. The offset is always written
/// as `+HH:MM`, also for UTC.
pub fn rfc3339(time: &ZonedDateTime) -> String {
    format(time, false)
}

/// Serializes a time like [`rfc3339`], except that a zero offset is written
/// as `Z`. This is the format of the time fields in diagnostic entries.
pub fn serialize_rfc3339<S: Serializer>(
    time: &ZonedDateTime,
    serializer: S,
) -> Result<S::Ok, S::Error> {
    serializer.serialize_str(&format(time, true))
}

fn format(time: &ZonedDateTime, zero_offset_as_z: bool) -> String {
    let mut out = time.strftime("%Y-%m-%dT%H:%M:%S").to_string();
    let nanos = time.subsec_nanosecond();
    if nanos != 0 {
        if nanos % 1_000_000 == 0 {
            let _ = write!(out, ".{:03}", nanos / 1_000_000);
        } else if nanos % 1_000 == 0 {
            let _ = write!(out, ".{:06}", nanos / 1_000);
        } else {
            let _ = write!(out, ".{nanos:09}");
        }
    }
    let offset = time.offset().seconds();
    if offset == 0 && zero_offset_as_z {
        out.push('Z');
        return out;
    }
    let sign = if offset < 0 { '-' } else { '+' };
    let minutes = offset.unsigned_abs() / 60;
    let _ = write!(out, "{sign}{:02}:{:02}", minutes / 60, minutes % 60);
    out
}

#[cfg(test)]
mod tests {
    use super::*;
    use jiff::civil::date;
    use jiff::tz::{Offset, TimeZone};

    fn at(nanos: i32, offset_hours: i8) -> ZonedDateTime {
        date(2026, 11, 18)
            .at(12, 5, 42, nanos)
            .to_zoned_datetime(TimeZone::fixed(Offset::constant(offset_hours)))
            .unwrap()
    }

    #[test]
    fn fraction_uses_the_fewest_of_three_six_or_nine_digits() {
        assert_eq!(rfc3339(&at(0, 1)), "2026-11-18T12:05:42+01:00");
        assert_eq!(
            rfc3339(&at(120_000_000, 1)),
            "2026-11-18T12:05:42.120+01:00"
        );
        assert_eq!(
            rfc3339(&at(123_456_000, 1)),
            "2026-11-18T12:05:42.123456+01:00"
        );
        assert_eq!(
            rfc3339(&at(123_456_700, 1)),
            "2026-11-18T12:05:42.123456700+01:00"
        );
        assert_eq!(rfc3339(&at(5, 1)), "2026-11-18T12:05:42.000000005+01:00");
    }

    #[test]
    fn offset_is_written_as_hours_and_minutes() {
        assert_eq!(rfc3339(&at(0, 0)), "2026-11-18T12:05:42+00:00");
        assert_eq!(rfc3339(&at(0, -5)), "2026-11-18T12:05:42-05:00");
        let half_hour = date(2026, 11, 18)
            .at(12, 5, 42, 0)
            .to_zoned_datetime(TimeZone::fixed(
                Offset::from_seconds(5 * 3600 + 1800).unwrap(),
            ))
            .unwrap();
        assert_eq!(rfc3339(&half_hour), "2026-11-18T12:05:42+05:30");
    }

    // The patterns HexDesk uses for file names, database values and log
    // lines. A jiff upgrade that changes one of them fails here.
    #[test]
    fn strftime_patterns_keep_their_output() {
        let time = date(2026, 1, 2)
            .at(3, 4, 5, 7_000_000)
            .to_zoned_datetime(TimeZone::fixed(Offset::constant(1)))
            .unwrap();
        for (pattern, expected) in [
            ("%Y-%m-%d", "2026-01-02"),
            ("%Y-%m-%d-%H%M%S", "2026-01-02-030405"),
            ("%Y%m%d-%H%M%S-%3f", "20260102-030405-007"),
            ("%Y%m%dT%H%M%S%3f", "20260102T030405007"),
            ("%Y-%m-%dT%H:%M:%S", "2026-01-02T03:04:05"),
            ("%Y-%m-%dT%H:%M:%SZ", "2026-01-02T03:04:05Z"),
            ("%H:%M:%S", "03:04:05"),
            (
                "%Y-%m-%d %H:%M:%S%.3f %:z",
                "2026-01-02 03:04:05.007 +01:00",
            ),
        ] {
            assert_eq!(time.strftime(pattern).to_string(), expected, "{pattern}");
        }
    }
}
