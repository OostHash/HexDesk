use hexdesk_blob::{
    blob_seed_offsets, find_blob_end, read_blob, BlobRead, BlobReject, ALT_STARTS, END_MARKERS,
    END_MARKER_MAX_LEN, START_MARKER,
};
use hexdesk_diag::{debug, info, DiagError, Kind, OptionExt, Source};
use serde::Serialize;

#[derive(Debug, Serialize, Clone)]
pub struct PendingRecipe {
    pub unique_name: String,
    /// Unix timestamp in milliseconds when the craft completes
    pub completion_ms: i64,
}

// ─── Public helpers ──────────────────────────────────────────────────────────

/// `true`, `false` or `unknown`: whether HexDesk runs as administrator.
pub fn elevated_text() -> &'static str {
    use crate::platform::{Platform, ProcessAccess};
    match Platform::is_elevated() {
        Some(true) => "true",
        Some(false) => "false",
        None => "unknown",
    }
}

pub fn find_warframe_pid_pub() -> Option<u32> {
    use crate::platform::{Platform, ProcessAccess};
    Platform::find_warframe_pid()
}

// ─── Blob capture ─────────────────────────────────────────────────────────────

// Cache: remember the region address where the blob was last successfully found.
// On the next cycle the fast path re-reads that address first — if the blob is
// still there we finish in milliseconds instead of walking the full address space.
static LAST_BLOB_REGION: std::sync::atomic::AtomicU64 = std::sync::atomic::AtomicU64::new(0);

/// Clear the region cache. Call when Warframe's PID changes so the next scan
/// doesn't probe a stale address from the previous process instance.
pub fn reset_last_blob_region() {
    LAST_BLOB_REGION.store(0, std::sync::atomic::Ordering::Relaxed);
}

// ─── Shared constants ─────────────────────────────────────────────────────────

const MAX_READ: usize = 64 * 1024 * 1024;
const MAX_SCAN: usize = 20 * 1024 * 1024;
const MISSION_DELTA: &[u8] = b"\"InventoryChanges\":";
const LOTUS_KEY: &[u8] = b"/Lotus/";
const ANCHORS: &[&[u8]] = &[
    b"\"SubscribedToEmails\"",
    b"\"MiscItems\":[",
    b"\"Suits\":[",
    b"\"LongGuns\":[",
    b"\"Melee\":[",
    b"\"Pistols\":[",
];

/// Scans Warframe process memory for the FULL_ACCOUNT inventory blob and sends it
/// through `blob_tx` for the monitor loop to apply.
///
/// Multi-scan strategy: the blob may span many memory regions and multiple copies
/// can exist at different addresses. We track every potential start point as a
/// separate in-flight scan and stitch them all in parallel as the region walk
/// advances. The first scan that produces a valid JSON blob wins; all others are
/// dropped. Following every start point instead of the first one found holds up
/// when the blob is large or when the first start hit leads to a truncated region.
///
/// Algorithm:
///   1. Walk every committed readable region.
///   2. If a region has START_MARKER ("SubscribedToEmails") and is NOT a mission
///      delta ("InventoryChanges"), open a new ActiveScan seeded with that region's
///      data from the START_MARKER offset onwards.
///   3. Every readable region is appended to ALL active scans (stitching).
///   4. After each append, check every scan for the end marker. If found, parse it.
///      On success send the inventory to the monitor loop. On failure drop the scan.
///      The walk always continues through all of memory — every blob start is found.
///   5. Drop any scan that grows past MAX_SCAN_BYTES without finding the end.
///
/// Returns why no blob was found when none was.
pub fn capture_all_blobs(blob_tx: std::sync::mpsc::Sender<BlobRead>) -> Result<(), DiagError> {
    use crate::mem_regions;
    const MIN_REGION: usize = 64_000;

    let pid = find_warframe_pid_pub().or_diag(
        Source::Scanner,
        Kind::NotFound,
        "Warframe process not found",
    )?;
    debug!(scanner, pid, "Reading Warframe memory");
    let mut src = mem_regions::open_region_source(
        pid,
        MIN_REGION,
        MAX_READ,
        MAX_SCAN,
        None, // no deadline — one-shot caller
        Some(Box::new(|r| {
            // Skip executable pages (code, JIT) and file-backed mappings
            // (PE image sections whose string constants false-trigger the
            // anchor check). Only anonymous heap/stack memory is useful.
            !r.is_executable && r.backing != crate::platform::RegionBacking::File
        })),
    )
    .map_err(|e| {
        DiagError::new(
            Source::Scanner,
            Kind::Denied,
            "Warframe memory could not be opened",
        )
        .with("pid", pid)
        .with("hexdesk_elevated", elevated_text())
        .caused_by_text(e)
    })?;

    let cached_addr = LAST_BLOB_REGION.load(std::sync::atomic::Ordering::Relaxed) as usize;
    if cached_addr != 0 && try_cached_blob(&*src, cached_addr, &blob_tx) {
        return Ok(());
    }

    let report = stitch_blobs(&mut *src, blob_tx);
    let stats = src.stats();
    debug!(
        scanner,
        regions_read = report.regions_read,
        regions_skipped = stats.regions_skipped,
        starts_found = report.starts_found,
        candidates = report.candidates,
        bytes_mb = report.bytes_read / 1_000_000,
        vquery_ms = stats.enumerate_ms as u64,
        read_ms = stats.read_ms as u64,
        "Memory walk done"
    );
    report.into_result()
}

/// What one walk over Warframe's memory found.
#[derive(Debug, Default)]
struct StitchReport {
    regions_read: usize,
    starts_found: usize,
    /// Candidates that parsed into an inventory.
    candidates: usize,
    /// Candidates dropped for growing past the size limit without an end.
    too_large: usize,
    /// Candidates that had an end but were rejected, with the reason.
    rejected: Vec<(usize, BlobReject)>,
    bytes_read: u64,
}

impl StitchReport {
    fn into_result(self) -> Result<(), DiagError> {
        if self.candidates > 0 {
            return Ok(());
        }
        if self.starts_found == 0 {
            return Err(DiagError::new(
                Source::Scanner,
                Kind::NotFound,
                "Account blob not found: no start marker in any readable memory region",
            )
            .with("regions_read", self.regions_read)
            .with("bytes_mb", self.bytes_read / 1_000_000));
        }
        let unresolved = self
            .starts_found
            .saturating_sub(self.too_large + self.rejected.len());
        let mut err = DiagError::new(
            Source::Scanner,
            Kind::Parse,
            "Account blob not found: no candidate could be read",
        )
        .with("candidates", self.starts_found)
        .with("too_large", self.too_large)
        .with("rejected", self.rejected.len())
        .with("no_end", unresolved);
        for (id, reason) in &self.rejected {
            err = err.caused_by_text(format!("candidate {id}: {reason}"));
        }
        Err(err)
    }
}

/// Fast path: re-read the cached address from the last successful scan.
/// Returns true if a valid blob was found and sent, false if the fast path missed.
fn try_cached_blob(
    src: &dyn crate::mem_regions::RegionSource,
    cached_addr: usize,
    blob_tx: &std::sync::mpsc::Sender<BlobRead>,
) -> bool {
    // Quick check: is the cached address still mapped? Avoids a costly read_at
    // on a region that has been unmapped since the last scan.
    match src.region_at(cached_addr) {
        Some(r) if r.is_committed && r.is_readable => {}
        _ => {
            debug!(
                scanner,
                addr = format_args!("0x{cached_addr:012x}"),
                "Cached blob address no longer mapped"
            );
            return false;
        }
    }

    let (mut next_addr, first_bytes) = match src.read_at(cached_addr, MAX_SCAN) {
        Some(r) => r,
        None => {
            debug!(
                scanner,
                addr = format_args!("0x{cached_addr:012x}"),
                "Cached blob address could not be read"
            );
            return false;
        }
    };
    if first_bytes.len() < 8 {
        debug!(
            scanner,
            addr = format_args!("0x{cached_addr:012x}"),
            "Cached blob address returned fewer than 8 bytes"
        );
        return false;
    }

    let is_mission = memchr::memmem::find(&first_bytes, MISSION_DELTA).is_some();
    let has_anchor = ANCHORS
        .iter()
        .any(|a| memchr::memmem::find(&first_bytes, a).is_some());
    let has_lotus = memchr::memmem::find(&first_bytes, LOTUS_KEY).is_some();

    if is_mission || (!has_anchor && !has_lotus) || !first_bytes.starts_with(b"{\"") {
        debug!(
            scanner,
            addr = format_args!("0x{cached_addr:012x}"),
            "No blob at the cached address, walking all memory"
        );
        return false;
    }

    let mut stitched = first_bytes;
    while stitched.len() < MAX_SCAN && find_blob_end(&stitched).is_none() {
        let remaining = MAX_SCAN - stitched.len();
        match src.read_at(next_addr, remaining) {
            Some((end, bytes)) => {
                next_addr = end;
                if bytes.is_empty() {
                    break;
                }
                stitched.extend_from_slice(&bytes);
            }
            None => break,
        }
    }

    if memchr::memmem::find(&stitched, START_MARKER).is_some() {
        if let Ok(read) = read_blob(&stitched) {
            let counts = read.item_counts();
            info!(
                scanner,
                addr = format_args!("0x{cached_addr:012x}"),
                sections = counts.sections,
                unique = counts.unique,
                stackable = counts.stackable,
                "Account blob found at the cached address"
            );
            blob_tx.send(read).ok();
            return true;
        }
    }

    debug!(
        scanner,
        addr = format_args!("0x{cached_addr:012x}"),
        "No blob at the cached address, walking all memory"
    );
    false
}

/// Walk all memory regions via `src`, stitch blobs, parse and send them.
/// Returns what the walk found.
fn stitch_blobs(
    src: &mut dyn crate::mem_regions::RegionSource,
    blob_tx: std::sync::mpsc::Sender<BlobRead>,
) -> StitchReport {
    // Cap on how many distinct candidate seeds (start-marker
    // occurrences) we'll open scans for, and how much further (in bytes read)
    // we'll keep walking after the first candidate resolves, looking for a second,
    // competing one. Bounded so the common case (exactly one blob in memory) still
    // exits about as fast as before, while a stale-vs-live pair — which sits in the
    // same general heap area, not scattered across the whole address space — still
    // gets caught. See `candidate_at_bytes`/`completed` below for why this matters.
    const MAX_CANDIDATE_SEEDS: usize = 6;
    const EXTRA_SEED_BUDGET: u64 = 64 * 1024 * 1024;

    struct ActiveScan {
        data: Vec<u8>,
        id: usize,
        /// Absolute address of the JSON opening brace this scan was seeded at
        /// (mid-region, not a region base). Cached in LAST_BLOB_REGION on success.
        seed_addr: usize,
        /// Minimum offset at which the end-marker search should start next append.
        /// Avoids rescanning already-checked data on every region append (O(n²) → O(n)).
        search_from: usize,
    }
    let mut scans: Vec<ActiveScan> = Vec::new();
    let mut next_scan_id = 0usize;

    // Pre-buffer: rolling window of recent regions that have Lotus paths / anchor keys
    // but no SubscribedToEmails yet.  Used to recover the true JSON start when the
    // outer `{` of the FULL_ACCOUNT blob lives in a region that precedes the region
    // containing SubscribedToEmails (field order varies by account).
    struct PreChunk {
        addr: usize,
        end_addr: usize,
        data: Vec<u8>,
    }
    let mut pre_buf: std::collections::VecDeque<PreChunk> = std::collections::VecDeque::new();
    const PRE_BUF_BYTES: usize = 8 * 1024 * 1024; // keep ≤8 MB of prefix history

    let mut regions_read = 0usize;
    let mut starts_found = 0usize;
    let mut t_search = std::time::Duration::ZERO;
    let mut bytes_read: u64 = 0;
    // Multiple copies of the FULL_ACCOUNT blob can be readable in memory at once
    // (e.g. a buffer from before a re-serialize, not yet reclaimed/overwritten —
    // `blob_seed_offsets`'s `{"` check only catches a copy whose brace was already
    // clobbered, not one that's merely stale but still fully intact). Taking
    // whichever candidate happens to finish stitching first is a race that can pick
    // that stale-but-intact copy over the live one, silently rolling the displayed
    // inventory back. So we don't commit to the first candidate: every scan
    // already in flight is left to resolve (succeed or get dropped for growing too
    // large) and the most complete one is chosen once none are left.
    // `candidate_at_bytes` is set the moment the first candidate resolves and drives
    // the EXTRA_SEED_BUDGET window below (see also MAX_CANDIDATE_SEEDS above).
    let mut candidate_at_bytes: Option<u64> = None;
    let mut completed: Vec<(usize, BlobRead)> = Vec::new();
    let mut too_large = 0usize;
    let mut rejected: Vec<(usize, BlobReject)> = Vec::new();

    loop {
        let seed_budget_exhausted =
            candidate_at_bytes.is_some_and(|b| bytes_read.saturating_sub(b) > EXTRA_SEED_BUDGET);
        let no_more_seeds = starts_found >= MAX_CANDIDATE_SEEDS || seed_budget_exhausted;
        // Early exit: we won't open any more candidate seeds and none are still in flight.
        if no_more_seeds && scans.is_empty() {
            break;
        }

        let (region_addr, buf) = match src.next_region() {
            Some(r) => r,
            None => break,
        };
        let n = buf.len();
        bytes_read += n as u64;
        let chunk = buf;
        regions_read += 1;

        // ── Step 1: append this chunk to every active scan and check for completion ──
        // search_from tracks where we left off so we only scan newly-appended bytes
        // (plus a small overlap for markers that straddle a region boundary).
        scans.retain_mut(|scan| {
            // Every scan already in flight is left to run to its own completion (or
            // get dropped below for growing too large) regardless of whether another
            // scan already completed, so the decision between multiple valid candidates (see
            // `completed` above) is made once, after every in-flight scan has
            // resolved, not by which one merely finishes stitching first.
            // Advance the search cursor before appending so the overlap catches split markers.
            let search_from = scan.search_from;
            scan.search_from = scan.data.len().saturating_sub(END_MARKER_MAX_LEN - 1);
            scan.data.extend_from_slice(chunk);
            if scan.data.len() > MAX_SCAN {
                debug!(
                    scanner,
                    candidate = scan.id,
                    max_mb = MAX_SCAN / 1024 / 1024,
                    "Candidate dropped: no end marker within the size limit"
                );
                too_large += 1;
                return false; // drop oversized scan
            }
            // Only search the newly-added window, not the full buffer.
            let window = &scan.data[search_from..];
            let has_end = END_MARKERS
                .iter()
                .any(|m| memchr::memmem::find(window, m).is_some());
            if has_end && find_blob_end(&scan.data).is_some() {
                match read_blob(&scan.data) {
                    Ok(read) => {
                        let counts = read.item_counts();
                        debug!(
                            scanner,
                            candidate = scan.id,
                            addr = %format_args!("0x{:012x}", scan.seed_addr),
                            sections = counts.sections,
                            unique = counts.unique,
                            stackable = counts.stackable,
                            mods = counts.mods,
                            "Candidate read"
                        );
                        if candidate_at_bytes.is_none() {
                            candidate_at_bytes = Some(bytes_read);
                        }
                        completed.push((scan.seed_addr, read));
                    }
                    Err(reason) => {
                        debug!(
                            scanner,
                            candidate = scan.id,
                            addr = %format_args!("0x{:012x}", scan.seed_addr),
                            reason = %reason,
                            "Candidate rejected"
                        );
                        rejected.push((scan.id, reason));
                    }
                }
                false // remove completed (or failed) scan
            } else {
                true // keep waiting for end
            }
        });

        // ── Step 2: check if this chunk opens a new scan ──
        // Reuses `no_more_seeds` computed at the top of the loop (the
        // seed cap, or the post-first-candidate search budget). Deliberately *not*
        // gated on merely having one candidate already — a single realized candidate
        // must not stop us from also opening the one true live copy if it happens to
        // sit at a later address than a stale-but-still-intact one, which is exactly
        // the race this whole restructure exists to close.
        if no_more_seeds {
            continue;
        }

        let t2 = std::time::Instant::now();
        let has_start = memchr::memmem::find(chunk, START_MARKER).is_some();
        let has_alt_start = ALT_STARTS
            .iter()
            .any(|a| memchr::memmem::find(chunk, a).is_some());
        let is_mission = memchr::memmem::find(chunk, MISSION_DELTA).is_some();
        let has_anchor = ANCHORS
            .iter()
            .any(|a| memchr::memmem::find(chunk, a).is_some());
        let has_lotus = memchr::memmem::find(chunk, LOTUS_KEY).is_some();
        let qualifies = (has_start || has_alt_start) && !is_mission && (has_anchor || has_lotus);
        t_search += t2.elapsed();

        // Accumulate regions with Lotus paths (no SubscribedToEmails, no mission delta) into
        // a pre-buffer.  When SubscribedToEmails is found in a later region, we prepend
        // contiguous pre-buffer regions so that the backward {"  search finds the true
        // outermost JSON opening rather than a nested {"$oid":…} inside the blob.
        if !has_start && !is_mission && (has_anchor || has_lotus) {
            // Keep only the tail of large regions in the pre-buffer: a chunk
            // bigger than PRE_BUF_BYTES can never be fully kept, so trim it to
            // PRE_BUF_BYTES before enqueueing and skip the normal eviction loop.
            let chunk_data = if n > PRE_BUF_BYTES {
                chunk[n - PRE_BUF_BYTES..].to_vec()
            } else {
                while pre_buf.iter().map(|p| p.data.len()).sum::<usize>() + n > PRE_BUF_BYTES
                    && !pre_buf.is_empty()
                {
                    pre_buf.pop_front();
                }
                chunk.to_vec()
            };
            let stored_len = chunk_data.len();
            pre_buf.push_back(PreChunk {
                addr: region_addr + (n - stored_len),
                end_addr: region_addr + n,
                data: chunk_data,
            });
        }

        if qualifies {
            // Prepend any contiguous pre-buffer regions that immediately precede this one.
            // This recovers the full blob when the outer { lives in an earlier region and
            // SubscribedToEmails appears later (field order varies per account/build).
            let mut combined: Vec<u8> = Vec::new();
            let mut blob_start_addr = region_addr;
            {
                let mut expect_end = region_addr;
                let mut chain: Vec<usize> = Vec::new();
                for (i, pc) in pre_buf.iter().enumerate().rev() {
                    // Allow ≤4 KB alignment gap between regions.
                    if pc.end_addr <= expect_end && pc.end_addr + 4096 >= expect_end {
                        chain.push(i);
                        expect_end = pc.addr;
                    } else if pc.end_addr < expect_end.saturating_sub(4096) {
                        break;
                    }
                }
                chain.reverse();
                for &i in &chain {
                    let pc = &pre_buf[i];
                    if combined.is_empty() {
                        blob_start_addr = pc.addr;
                    }
                    combined.extend_from_slice(&pc.data);
                }
            }
            combined.extend_from_slice(chunk);

            let (start_off, json_open) = blob_seed_offsets(&combined);

            // Absolute memory address of the seed start (for LAST_BLOB_REGION cache).
            let seed_addr = blob_start_addr + json_open;

            let id = next_scan_id;
            next_scan_id += 1;
            starts_found += 1;
            let pre_bytes = combined.len() - n;
            debug!(
                scanner,
                candidate = id,
                addr = %format_args!("0x{region_addr:012x}"),
                start_off,
                json_open,
                seed = %format_args!("0x{seed_addr:012x}"),
                pre_bytes,
                "Candidate found"
            );
            let seed = combined[json_open..].to_vec();

            let seed_ends = find_blob_end(&seed).is_some();
            if seed_ends {
                match read_blob(&seed) {
                    Ok(read) => {
                        let counts = read.item_counts();
                        debug!(
                            scanner,
                            candidate = id,
                            addr = %format_args!("0x{region_addr:012x}"),
                            sections = counts.sections,
                            unique = counts.unique,
                            stackable = counts.stackable,
                            "Candidate read"
                        );
                        if candidate_at_bytes.is_none() {
                            candidate_at_bytes = Some(bytes_read);
                        }
                        completed.push((seed_addr, read));
                    }
                    Err(reason) => {
                        debug!(
                            scanner,
                            candidate = id,
                            addr = %format_args!("0x{seed_addr:012x}"),
                            reason = %reason,
                            "Candidate rejected"
                        );
                        rejected.push((id, reason));
                    }
                }
            } else {
                scans.push(ActiveScan {
                    data: seed,
                    id,
                    seed_addr,
                    search_from: 0,
                });
            }
        }
    }

    // Among every candidate this pass resolved, keep the most complete one — a
    // still-intact stale copy of the blob is a full, validly-parsing snapshot too,
    // just an older one, so item/mod/riven count (which only grows in the very
    // common case, since players rarely lose most of their account at once) is a
    // far better signal of "current" than "which one finished stitching first".
    // Ties (e.g. a single candidate) keep the last one, which is fine — it's the
    // only one, or an arbitrary but deterministic pick among truly-identical data.
    let candidates = completed.len();
    if let Some((seed_addr, read)) = completed
        .into_iter()
        .max_by_key(|(_, read)| read.item_counts().total())
    {
        LAST_BLOB_REGION.store(seed_addr as u64, std::sync::atomic::Ordering::Relaxed);
        let counts = read.item_counts();
        info!(
            scanner,
            addr = %format_args!("0x{seed_addr:012x}"),
            candidates,
            sections = counts.sections,
            unique = counts.unique,
            stackable = counts.stackable,
            mods = counts.mods,
            "Account blob found"
        );
        blob_tx.send(read).ok();
    }

    debug!(
        scanner,
        search_ms = t_search.as_millis() as u64,
        "Marker search time"
    );
    StitchReport {
        regions_read,
        starts_found,
        candidates,
        too_large,
        rejected,
        bytes_read,
    }
}

#[cfg(test)]
mod stitch_engine_tests {
    use super::stitch_blobs;
    use crate::mem_regions::RecordedRegions;
    use hexdesk_blob::BlobInventory;

    /// Builds a blob with every section in `hexdesk_blob::SECTIONS`, padded
    /// past the parser's minimum size, and one real Suit entry. `fields` is
    /// interpolated last, right before the padding/close, so a test's override
    /// (e.g. `"RegularCredits":42`) wins over the section's default here: JSON
    /// objects with a duplicate key keep the last occurrence's value.
    fn make_blob(fields: &str) -> Vec<u8> {
        let padding = "x".repeat(60_000);
        format!(
            r#"{{"SubscribedToEmails":0,
"RegularCredits":0,"FusionPoints":0,"PremiumCredits":0,"PremiumCreditsFree":0,"PlayerLevel":0,
"FlavourItems":[],"InfestedFoundry":{{}},"PendingRecipes":[],"RawUpgrades":[],"Upgrades":[],"WeaponSkins":[],"XPInfo":[],
"Suits":[{{"ItemType":"/Lotus/Powersuits/Test/Test"}}],"LongGuns":[],"Pistols":[],"Melee":[],"SpaceSuits":[],"SpaceMelee":[],"SpaceGuns":[],"Sentinels":[],"SentinelWeapons":[],"KubrowPets":[],"OperatorAmps":[],"MechSuits":[],
"MiscItems":[],"Recipes":[],"FusionTreasures":[],"CrewShipRawSalvage":[],"ShipDecorations":[],
"_pad":"{padding}",
{fields},
"DeathSquadable":false}}"#
        )
        .into_bytes()
    }

    fn run(regions: Vec<(usize, Vec<u8>)>) -> Option<BlobInventory> {
        let mut src = RecordedRegions::new(regions);
        let (tx, rx) = std::sync::mpsc::channel();
        stitch_blobs(&mut src, tx);
        rx.try_recv().ok().map(|read| read.to_inventory())
    }

    #[test]
    fn single_region_blob_is_parsed() {
        let blob = make_blob(r#""RegularCredits":12345"#);
        let inv = run(vec![(0x1000, blob)]).expect("should parse");
        assert_eq!(inv.credits, 12345);
    }

    #[test]
    fn blob_spanning_two_regions_is_stitched() {
        let blob = make_blob(r#""RegularCredits":999"#);
        let mid = blob.len() / 2;
        let r1 = (0x1000, blob[..mid].to_vec());
        let r2 = (0x1000 + mid, blob[mid..].to_vec());
        let inv = run(vec![r1, r2]).expect("should stitch and parse");
        assert_eq!(inv.credits, 999);
    }

    #[test]
    fn mission_delta_region_is_skipped() {
        let delta = b"\"InventoryChanges\":[{\"Credits\":1}]".to_vec();
        let blob = make_blob(r#""RegularCredits":77"#);
        // Delta at a lower address; real blob follows.
        let inv = run(vec![(0x1000, delta), (0x2000, blob)]).expect("real blob should win");
        assert_eq!(inv.credits, 77);
    }

    #[test]
    fn oversized_scan_is_dropped_and_does_not_panic() {
        // First region qualifies (has start marker) but never closes;
        // second region is the real complete blob.
        let mut open = make_blob(r#""RegularCredits":1"#);
        // Strip the closing brace so it looks like a truncated blob.
        open.pop();
        // Pad it past MAX_SCAN so the engine drops it.
        open.extend(vec![b' '; super::MAX_SCAN + 1]);

        let real = make_blob(r#""RegularCredits":42"#);
        let inv = run(vec![(0x1000, open), (0x9000_0000, real)]).expect("real blob should parse");
        assert_eq!(inv.credits, 42);
    }

    // Regression coverage for: two independently-valid, independently-complete
    // copies of the FULL_ACCOUNT blob exist in memory at once (e.g. a buffer from
    // before a re-serialize, still fully intact and not yet overwritten, alongside
    // the live one). Taking whichever one finishes stitching first is a race that
    // can silently apply the stale, smaller copy over the live one. The fix: every
    // candidate this capture pass finds is left to resolve, and the most complete
    // one (by item/mod count) is the one actually sent — regardless of which
    // address it was found at or which one happened to finish first.

    #[test]
    fn stale_copy_at_a_lower_address_does_not_beat_the_live_one() {
        let stale = make_blob(r#""RegularCredits":1"#); // 1 Suit, from the template default
        let live = make_blob(
            r#""RegularCredits":2,"Suits":[{"ItemType":"/Lotus/Powersuits/A/A"},{"ItemType":"/Lotus/Powersuits/B/B"},{"ItemType":"/Lotus/Powersuits/C/C"}]"#,
        );
        let inv = run(vec![(0x1000, stale), (0x9000, live)]).expect("should pick a candidate");
        assert_eq!(
            inv.credits, 2,
            "the more-complete candidate should win even though the smaller one was found first"
        );
        assert_eq!(inv.unique_items.len(), 3);
    }

    #[test]
    fn stale_copy_at_a_higher_address_does_not_beat_the_live_one() {
        // Same scenario with addresses swapped — the outcome must not depend on
        // which candidate the region walk happens to encounter first.
        let live = make_blob(
            r#""RegularCredits":2,"Suits":[{"ItemType":"/Lotus/Powersuits/A/A"},{"ItemType":"/Lotus/Powersuits/B/B"},{"ItemType":"/Lotus/Powersuits/C/C"}]"#,
        );
        let stale = make_blob(r#""RegularCredits":1"#);
        let inv = run(vec![(0x1000, live), (0x9000, stale)]).expect("should pick a candidate");
        assert_eq!(
            inv.credits, 2,
            "the more-complete candidate should win regardless of scan order"
        );
        assert_eq!(inv.unique_items.len(), 3);
    }
}

#[cfg(test)]
mod failure_reason_tests {
    //! A failed capture must say why in the log, without a raw capture.

    use super::{stitch_blobs, StitchReport};
    use crate::mem_regions::RecordedRegions;

    fn account_blob(extra: &str, suits: &str) -> String {
        let padding = "x".repeat(60_000);
        format!(
            r#"{{"SubscribedToEmails":0,"RegularCredits":5,"PlayerLevel":3,"XPInfo":[],
"Suits":[{suits}],"MiscItems":[],"RawUpgrades":[],{extra}
"_pad":"{padding}","DeathSquadable":false}}"#
        )
    }

    const SUIT: &str = r#"{"ItemType":"/Lotus/Powersuits/Test/Test"}"#;

    fn walk(regions: Vec<(usize, Vec<u8>)>) -> StitchReport {
        let mut src = RecordedRegions::new(regions);
        let (tx, _rx) = std::sync::mpsc::channel();
        stitch_blobs(&mut src, tx)
    }

    #[test]
    fn memory_without_a_start_marker_reports_not_found() {
        let report = walk(vec![
            (0x1000, vec![b'x'; 100_000]),
            (0x30000, vec![b'y'; 100_000]),
        ]);
        let err = report.into_result().unwrap_err();
        assert_eq!(err.code(), "scanner.not_found");
        assert_eq!(
            err.message(),
            "Account blob not found: no start marker in any readable memory region"
        );
        assert!(err
            .fields()
            .iter()
            .any(|(k, v)| k == "regions_read" && v == "2"));
    }

    #[test]
    fn rejected_candidates_report_each_reason() {
        let broken = account_blob(r#""Broken":[1,,2],"#, SUIT);
        let report = walk(vec![(0x1000, broken.into_bytes())]);
        let err = report.into_result().unwrap_err();
        assert_eq!(err.code(), "scanner.parse");
        assert_eq!(
            err.message(),
            "Account blob not found: no candidate could be read"
        );
        let causes = err.causes();
        assert_eq!(causes.len(), 1);
        assert!(
            causes[0].starts_with("candidate 0: JSON could not be read:"),
            "{causes:?}"
        );
        assert!(err
            .fields()
            .iter()
            .any(|(k, v)| k == "rejected" && v == "1"));
    }

    #[test]
    fn a_readable_candidate_is_a_success() {
        let report = walk(vec![(0x1000, account_blob("", SUIT).into_bytes())]);
        assert_eq!(report.candidates, 1);
        assert!(report.into_result().is_ok());
    }
}
