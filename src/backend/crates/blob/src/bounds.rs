/// Fields that can be the last one in the blob. Which of them comes last
/// differs per account.
pub const END_MARKERS: &[&[u8]] = &[b"\"HWIDProtectEnabled\":", b"\"DeathSquadable\":"];

/// Length of the longest entry in [`END_MARKERS`]: how far back a search has
/// to reach to find a marker that straddles two memory regions.
pub const END_MARKER_MAX_LEN: usize = {
    let mut max = 0;
    let mut i = 0;
    while i < END_MARKERS.len() {
        if END_MARKERS[i].len() > max {
            max = END_MARKERS[i].len();
        }
        i += 1;
    }
    max
};

/// Find the end of the FULL_ACCOUNT blob.
///
/// A marker field is the true end of the blob only when its boolean value is
/// immediately followed by `}` (the outer closing brace) with no `,` or further
/// fields between them. This distinguishes a genuine end-of-object occurrence
/// from a mid-blob occurrence where the same field name appears earlier in the
/// JSON with other fields still following it.
///
/// All occurrences of each marker are checked; the rightmost valid one wins.
pub fn find_blob_end(raw: &[u8]) -> Option<usize> {
    const BOOL_VALUES: &[&[u8]] = &[b"true", b"false"];
    let mut best: Option<usize> = None;
    for marker in END_MARKERS {
        let mut search_from = 0;
        while let Some(rel) = memchr::memmem::find(&raw[search_from..], marker) {
            let key_pos = search_from + rel;
            let after_colon = key_pos + marker.len();
            // Skip optional whitespace after the colon.
            let val_start = raw[after_colon..]
                .iter()
                .position(|&b| !matches!(b, b' ' | b'\t' | b'\r' | b'\n'))
                .map_or(raw.len(), |p| after_colon + p);
            // Consume the boolean value.
            if let Some(val_len) = BOOL_VALUES
                .iter()
                .find(|v| raw[val_start..].starts_with(v))
                .map(|v| v.len())
            {
                let val_end = val_start + val_len;
                // Skip optional whitespace after the value.
                let after_val = raw[val_end..]
                    .iter()
                    .position(|&b| !matches!(b, b' ' | b'\t' | b'\r' | b'\n'))
                    .map_or(raw.len(), |p| val_end + p);
                // Only treat this as a blob end when `}` follows directly —
                // meaning no comma or additional fields come after the value.
                if raw.get(after_val) == Some(&b'}') {
                    let end = after_val + 1;
                    if best.is_none_or(|prev| end > prev) {
                        best = Some(end);
                    }
                }
            }
            search_from = key_pos + marker.len();
        }
    }
    best
}

/// The field the blob normally starts with.
pub const START_MARKER: &[u8] = b"\"SubscribedToEmails\"";
/// Fields near the start, for a blob whose [`START_MARKER`] was not found.
pub const ALT_STARTS: &[&[u8]] = &[b"\"RegularCredits\":", b"\"Created\":"];

/// Walk backward from `marker_off` counting braces; return the offset of the
/// outermost `{` that encloses the marker.  Returns `None` when the buffer is
/// inconsistent (freed/partial blob where the opening brace was overwritten).
fn enclosing_object_start(buf: &[u8], marker_off: usize) -> Option<usize> {
    let mut depth: i32 = 0;
    for i in (0..marker_off).rev() {
        match buf[i] {
            b'}' => depth += 1,
            b'{' => {
                depth -= 1;
                if depth < 0 {
                    return Some(i);
                }
            }
            _ => {}
        }
    }
    None
}

/// Locate seed offsets for the FULL_ACCOUNT blob within `buf`.
/// Returns `(marker_off, json_open)`:
///   - `marker_off`: byte position of the chosen start marker
///   - `json_open`:  byte position of the outermost `{` enclosing the marker
///
/// When multiple copies of the start marker exist in `buf` (a freed/stale copy
/// followed by the live one), the copy whose enclosing `{` is immediately followed
/// by a `"` (i.e. a proper JSON object opening `{"`) is preferred.  A stale copy
/// has its `{` overwritten with garbage, so its brace check fails and it is skipped
/// in favour of the live copy.
pub fn blob_seed_offsets(buf: &[u8]) -> (usize, usize) {
    // Scan all START_MARKER occurrences and pick the first that has a clean {"  brace.
    let mut fallback: Option<(usize, usize)> = None;
    for marker_off in memchr::memmem::find_iter(buf, START_MARKER) {
        match enclosing_object_start(buf, marker_off) {
            Some(pos) if buf[pos..].starts_with(b"{\"") => {
                return (marker_off, pos);
            }
            _ => {
                if fallback.is_none() {
                    fallback = Some((marker_off, marker_off));
                }
            }
        }
    }
    if let Some(fb) = fallback {
        return fb;
    }
    // No START_MARKER — try ALT_STARTS
    let marker_off = ALT_STARTS
        .iter()
        .find_map(|a| memchr::memmem::find(buf, a))
        .unwrap_or(buf.len().saturating_sub(1));
    let json_open = enclosing_object_start(buf, marker_off).unwrap_or(marker_off);
    (marker_off, json_open)
}

/// Cut the JSON object out of a stitched memory buffer.
///
/// A scan buffer is whole memory regions glued together, so the blob's last
/// brace is followed by whatever heap bytes happened to sit in the tail of the
/// final region — potentially tens of megabytes of noise. This trims to just
/// the JSON object, so the parser sees only the blob.
pub fn extract_blob_json(raw: &[u8]) -> Option<Vec<u8>> {
    Some(extract_blob_json_ref(raw)?.into_owned())
}

/// Zero-copy variant: borrows when the blob starts with `{`, allocates only when the
/// opening brace was overwritten and must be reinstated.
pub fn extract_blob_json_ref(raw: &[u8]) -> Option<std::borrow::Cow<'_, [u8]>> {
    let end_pos = find_blob_end(raw)?;
    if raw.first() == Some(&b'{') {
        Some(std::borrow::Cow::Borrowed(&raw[..end_pos]))
    } else {
        let start_pos = memchr::memmem::find(raw, START_MARKER)?;
        let mut v = Vec::with_capacity(end_pos - start_pos + 1);
        v.push(b'{');
        v.extend_from_slice(&raw[start_pos..end_pos]);
        Some(std::borrow::Cow::Owned(v))
    }
}

#[cfg(test)]
mod seed_tests {
    use super::{
        blob_seed_offsets, enclosing_object_start, extract_blob_json, extract_blob_json_ref,
        find_blob_end,
    };

    #[test]
    fn enclosing_finds_outer_brace() {
        let buf = b"{\"SubscribedToEmails\":1}";
        let off = buf
            .windows(b"SubscribedToEmails".len())
            .position(|w| w == b"SubscribedToEmails")
            .unwrap();
        assert_eq!(enclosing_object_start(buf, off), Some(0));
    }

    #[test]
    fn enclosing_skips_nested_braces() {
        let buf = b"{\"nested\":{\"a\":1},\"SubscribedToEmails\":1}";
        let off = buf
            .windows(b"SubscribedToEmails".len())
            .position(|w| w == b"SubscribedToEmails")
            .unwrap();
        assert_eq!(enclosing_object_start(buf, off), Some(0));
    }

    #[test]
    fn enclosing_returns_none_when_no_open_brace() {
        // Stale/freed blob — the outer { was overwritten
        let buf = b"x\"SubscribedToEmails\":1}";
        assert_eq!(enclosing_object_start(buf, 0), None);
    }

    #[test]
    fn seed_offsets_with_start_marker() {
        let buf = b"{\"SubscribedToEmails\":1,\"RegularCredits\":100}";
        let (marker_off, json_open) = blob_seed_offsets(buf);
        assert_eq!(json_open, 0);
        // Both markers are present; the primary one must win over the alt-start.
        assert_eq!(marker_off, 1);
    }

    #[test]
    fn seed_offsets_with_alt_start_regular_credits() {
        // No SubscribedToEmails — falls through to RegularCredits alt-start
        let buf = b"{\"RegularCredits\":999}";
        let (marker_off, json_open) = blob_seed_offsets(buf);
        assert_eq!(json_open, 0);
        assert_eq!(marker_off, 1);
    }

    #[test]
    fn seed_offsets_stale_blob_falls_back_to_marker() {
        // The outer { was overwritten — json_open falls back to marker_off
        let buf = b"x\"SubscribedToEmails\":1}";
        let (marker_off, json_open) = blob_seed_offsets(buf);
        assert_eq!(json_open, marker_off);
    }

    #[test]
    fn blob_json_stops_at_the_closing_brace_of_the_object() {
        // A stitched scan buffer: the blob, then the rest of the memory region
        // it happened to end in.
        let mut raw = br#"{"SubscribedToEmails":0,"DeathSquadable":false}"#.to_vec();
        let blob_len = raw.len();
        raw.extend(std::iter::repeat_n(0xABu8, 1_000_000));

        let json = extract_blob_json(&raw).expect("end marker present");
        assert_eq!(json.len(), blob_len);
        assert!(serde_json::from_slice::<serde_json::Value>(&json).is_ok());
    }

    /// A freed copy of the blob can sit ahead of the live one with its marker
    /// intact but its opening brace overwritten. Brace-matching backward from
    /// that copy lands on a stray `{` in binary garbage ("key must be a string
    /// at line 1 column 2"), so the stale occurrence has to be skipped in
    /// favour of the live one.
    #[test]
    fn a_stale_headless_copy_is_skipped_for_the_live_blob() {
        let mut combined = b"\x00{J>\x01\x02 garbage ".to_vec();
        combined.extend_from_slice(br#""SubscribedToEmails":0,"RegularCredits":1,"#);
        combined.extend_from_slice(b"\x03\x04 more garbage ");
        let live_at = combined.len();
        combined.extend_from_slice(br#"{"SubscribedToEmails":0,"RegularCredits":42}"#);

        let (marker_at, seed_at) = blob_seed_offsets(&combined);
        assert_eq!(seed_at, live_at, "seed is the live copy's opening brace");
        assert!(marker_at > live_at, "the marker used is the live copy's");
    }

    /// With only the headless copy in the buffer, seeding at the marker lets
    /// the parser rebuild the object head instead of parsing garbage.
    #[test]
    fn a_lone_headless_copy_seeds_at_its_marker() {
        let mut combined = b"\x00{J>\x01\x02 garbage ".to_vec();
        let marker = combined.len();
        combined.extend_from_slice(br#""SubscribedToEmails":0,"RegularCredits":42,"#);

        let (marker_at, seed_at) = blob_seed_offsets(&combined);
        assert_eq!(marker_at, marker);
        assert_eq!(seed_at, marker, "seed skips the garbage brace");
    }

    #[test]
    fn blob_json_reinstates_the_opening_brace_when_it_was_overwritten() {
        let mut raw = br#"x"SubscribedToEmails":0,"DeathSquadable":false}"#.to_vec();
        let blob_len = raw.len();
        raw.extend(std::iter::repeat_n(0xABu8, 1024));

        let json = extract_blob_json(&raw).expect("end marker present");
        assert_eq!(json.len(), blob_len);
        assert_eq!(json[0], b'{');
        assert!(serde_json::from_slice::<serde_json::Value>(&json).is_ok());
    }

    #[test]
    fn blob_json_ref_borrows_in_the_common_case_and_owns_in_the_fallback() {
        use std::borrow::Cow;
        let intact = br#"{"SubscribedToEmails":0,"DeathSquadable":false}"#;
        assert!(matches!(
            extract_blob_json_ref(intact),
            Some(Cow::Borrowed(_))
        ));

        let overwritten = br#"x"SubscribedToEmails":0,"DeathSquadable":false}"#;
        assert!(matches!(
            extract_blob_json_ref(overwritten),
            Some(Cow::Owned(_))
        ));
    }

    /// A marker that appears mid-blob (followed by `,` and more fields) must not
    /// be treated as the end of the blob — only occurrences directly followed by
    /// `}` are valid end positions.
    #[test]
    fn mid_blob_marker_is_not_treated_as_end() {
        // HWIDProtectEnabled appears mid-blob with fields after it; DeathSquadable is absent.
        // The first `}` after HWIDProtectEnabled's value closes a nested object, not the blob.
        // find_blob_end must return None here — not a position inside the blob.
        let raw = br#"{"SubscribedToEmails":0,"HWIDProtectEnabled":false,"MiscItems":[{"ItemType":"/x","ItemCount":1}]}"#;
        // The outer `}` is the real end; but HWIDProtectEnabled is followed by `,` so it
        // must be skipped. Neither marker appears as a true last field, so result is None.
        assert!(
            find_blob_end(raw).is_none(),
            "mid-blob marker must not be accepted as blob end"
        );
    }

    /// When HWIDProtectEnabled is genuinely the last field (directly followed by `}`),
    /// it must be accepted as the end marker.
    #[test]
    fn hwid_marker_accepted_when_last_field() {
        let raw = br#"{"SubscribedToEmails":0,"MiscItems":[],"HWIDProtectEnabled":false}"#;
        let end = find_blob_end(raw).expect("HWIDProtectEnabled is last field — must be found");
        assert_eq!(
            end,
            raw.len(),
            "end position must be the outer closing brace"
        );
    }

    /// When both markers are present, the rightmost valid one wins.
    #[test]
    fn rightmost_valid_marker_wins() {
        // DeathSquadable comes after HWIDProtectEnabled and is the true last field.
        let raw = br#"{"HWIDProtectEnabled":true,"DeathSquadable":false}"#;
        let end = find_blob_end(raw).expect("DeathSquadable is last — must be found");
        assert_eq!(end, raw.len());
    }
}
