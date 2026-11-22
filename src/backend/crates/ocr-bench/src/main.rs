//! Measures OCR engines against labelled game screens.
//!
//! ```text
//! cargo run --release -p hexdesk-ocr-bench -- import
//! cargo run --release -p hexdesk-ocr-bench -- label
//! cargo run --release -p hexdesk-ocr-bench -- run [--all] [--runs 3] [--variants windows,windows+ocrs]
//! ```
//!
//! A variant names the engine that reads the whole list, after a `+` the
//! engine that reads refinement tags and count badges again on their own,
//! and after a second `+` a fallback engine for the names and count badges
//! the first could not read: `windows+windows+ocrs`.
//!
//! Screens and labels live in `.hexdesk-dev/ocr-bench/`, outside the
//! repository: recorded screens show player names. Timings only mean
//! something in a release build.

mod bmp;
mod data;
mod relic_list;
mod reward;

use std::path::{Path, PathBuf};

use hexdesk_capture::Provider;

use data::{read_json, write_json, Data};
use relic_list::{Label, Relics, Variant};

const RELIC_LIST: &str = "relic-list";
const RELIC_REWARD: &str = "relic-reward";

fn main() {
    if let Err(error) = run(std::env::args().skip(1).collect()) {
        eprintln!("error: {error}");
        std::process::exit(1);
    }
}

fn run(args: Vec<String>) -> Result<(), String> {
    let flag = |name: &str| args.iter().any(|a| a == name);
    let value = |name: &str| {
        args.iter()
            .position(|a| a == name)
            .and_then(|at| args.get(at + 1))
            .cloned()
    };
    let data = Data {
        dev: value("--dev").map_or_else(|| PathBuf::from(".hexdesk-dev"), PathBuf::from),
    };
    if !data.dev.is_dir() {
        return Err(format!(
            "{} not found; run from the repository root or pass --dev",
            data.dev.display()
        ));
    }
    hexdesk_capture::set_model_dir(data.ocr_models());
    let engines = match value("--engines") {
        Some(list) => list
            .split(',')
            .map(|id| Provider::from_id(id).ok_or_else(|| format!("unknown engine: {id}")))
            .collect::<Result<Vec<_>, _>>()?,
        None => vec![Provider::Windows, Provider::Ocrs],
    };
    let variants = match value("--variants") {
        Some(list) => list
            .split(',')
            .map(|name| Variant::from_name(name).ok_or_else(|| format!("unknown variant: {name}")))
            .collect::<Result<Vec<_>, _>>()?,
        None => [
            "windows",
            "ocrs",
            "windows+windows",
            "ocrs+ocrs",
            "windows+windows+windows",
            "windows+windows+ocrs",
        ]
        .iter()
        .filter_map(|name| Variant::from_name(name))
        .collect(),
    };
    match args.first().map(String::as_str) {
        Some("import") => import(&data, value("--from").map(PathBuf::from)),
        Some("label") => label(&data, &engines),
        Some("explain") => {
            let screen = args.get(1).ok_or("explain needs a screen file name")?;
            let variant = value("--variants").unwrap_or_else(|| "windows+windows".to_string());
            let variant = Variant::from_name(&variant).ok_or_else(|| format!("unknown variant: {variant}"))?;
            explain(&data, screen, variant)
        }
        Some("rewards") => {
            let runs = value("--runs").map_or(Ok(3), |n| n.parse::<usize>().map_err(|e| e.to_string()))?;
            reward_bench(&data, &engines, runs.max(1), flag("--all"))
        }
        Some("rewards-explain") => {
            let screen = args.get(1).ok_or("rewards-explain needs a screen file name")?;
            reward_explain(&data, screen, &engines)
        }
        Some("run") => {
            let runs = value("--runs").map_or(Ok(3), |n| n.parse::<usize>().map_err(|e| e.to_string()))?;
            bench(&data, &variants, runs.max(1), flag("--all"))
        }
        _ => Err("usage: ocr-bench import | label [--engines windows,ocrs] | run [--all] [--runs N] [--variants windows,windows+ocrs] | rewards [--all] [--runs N] [--engines windows,ocrs] | rewards-explain <screen> [--engines windows] [--dev PATH]".to_string()),
    }
}

/// Copies the relic list and reward screens the app saved as captures into
/// the bench.
fn import(data: &Data, from: Option<PathBuf>) -> Result<(), String> {
    let from = from.unwrap_or_else(|| data.captures());
    for reader in [RELIC_LIST, RELIC_REWARD] {
        let to = data.screens(reader);
        std::fs::create_dir_all(&to).map_err(|e| format!("create {}: {e}", to.display()))?;
        let mut copied = 0;
        for path in bmp_files(&from)? {
            let name = file_name(&path);
            if !name.starts_with(&format!("{reader}-")) || to.join(&name).exists() {
                continue;
            }
            std::fs::copy(&path, to.join(&name)).map_err(|e| format!("copy {name}: {e}"))?;
            copied += 1;
        }
        println!("{copied} {reader} screens copied to {}", to.display());
    }
    Ok(())
}

/// Proposes a label for every screen that has none.
fn label(data: &Data, engines: &[Provider]) -> Result<(), String> {
    let mut relics = Relics::new(data);
    let (mut proposed, mut to_review) = (0, 0);
    for path in bmp_files(&data.screens(RELIC_LIST))? {
        let label_path = label_path(&path);
        if label_path.exists() {
            continue;
        }
        let (frame, bytes) = load(&path)?;
        let mut reads = Vec::new();
        for &engine in engines {
            let read = relic_list::read(Variant::plain(engine), &frame, &bytes, &mut relics)?;
            reads.push((engine, read));
        }
        let label = relic_list::propose(&reads);
        if !label.review.is_empty() {
            to_review += 1;
        }
        write_json(&label_path, &label)?;
        proposed += 1;
    }
    println!("{proposed} labels proposed, {to_review} with engine disagreements under \"review\"");
    label_rewards(data, engines)?;
    println!("Check each against its screen, correct it and set \"confirmed\": true.");
    Ok(())
}

/// Shows what one variant read on one screen: every OCR line with its place,
/// every part read again on its own, and the tiles against the label. The
/// parts are saved as pictures under `results/explain/`.
fn explain(data: &Data, screen: &str, variant: Variant) -> Result<(), String> {
    let path = data.screens(RELIC_LIST).join(screen);
    let (frame, bytes) = load(&path)?;
    let mut relics = Relics::new(data);
    let read = relic_list::read(variant, &frame, &bytes, &mut relics)?;
    println!(
        "{} with {}: {:.0} ms, era {:?}
",
        screen,
        variant.name(),
        read.ocr_ms,
        read.era
    );
    for line in &read.text.lines {
        let at = line.words.first().map_or((0.0, 0.0), |w| (w.left, w.top));
        println!("  line x={:.3} y={:.3}  {}", at.0, at.1, line.text);
    }
    let dir = data.results().join("explain");
    std::fs::create_dir_all(&dir).map_err(|e| format!("create {}: {e}", dir.display()))?;
    println!();
    for (i, (part, text)) in read.parts.iter().enumerate() {
        let file = dir.join(format!("{i:02}.bmp"));
        std::fs::write(&file, part.to_bmp())
            .map_err(|e| format!("write {}: {e}", file.display()))?;
        println!("  part {i:02} {}x{}: {:?}", part.width, part.height, text);
    }
    println!();
    for tile in read.tiles() {
        println!("  tile {tile}");
    }
    let label_path = label_path(&path);
    if label_path.exists() {
        let label: Label = read_json(&label_path)?;
        let mut expected = label.tiles.clone();
        expected.sort();
        let tiles = read.tiles();
        println!(
            "
  missed: {}",
            difference(&expected, &tiles).join(", ")
        );
        println!("  wrong: {}", difference(&tiles, &expected).join(", "));
    }
    Ok(())
}

/// Proposes a label for every reward screen that has none.
fn label_rewards(data: &Data, engines: &[Provider]) -> Result<(), String> {
    let dir = data.screens(RELIC_REWARD);
    if !dir.is_dir() {
        return Ok(());
    }
    let catalog = reward::catalog()?;
    let (mut proposed, mut to_review) = (0, 0);
    for path in bmp_files(&dir)? {
        let label_path = label_path(&path);
        if label_path.exists() {
            continue;
        }
        let (frame, bytes) = load(&path)?;
        let mut reads = Vec::new();
        for &engine in engines {
            reads.push((
                engine,
                reward::read(engine, &frame, &bytes, &catalog, None)?,
            ));
        }
        let label = reward::propose(&reads, None);
        if !label.review.is_empty() {
            to_review += 1;
        }
        write_json(&label_path, &label)?;
        proposed += 1;
    }
    println!(
        "{proposed} reward labels proposed, {to_review} with engine disagreements under review"
    );
    Ok(())
}

/// Reads every labelled reward screen with every engine and reports how
/// often and how fast each named the cards right.
fn reward_bench(data: &Data, engines: &[Provider], runs: usize, all: bool) -> Result<(), String> {
    if cfg!(debug_assertions) {
        eprintln!("warning: debug build; timings are not representative, use --release");
    }
    let catalog = reward::catalog()?;
    let mut screens = Vec::new();
    for path in bmp_files(&data.screens(RELIC_REWARD))? {
        let label_path = label_path(&path);
        if !label_path.exists() {
            continue;
        }
        let label: reward::Label = read_json(&label_path)?;
        if label.confirmed || all {
            screens.push((path, label));
        }
    }
    if screens.is_empty() {
        return Err("no confirmed reward labels; pass --all to use unconfirmed ones".to_string());
    }
    let kind = if all {
        "labelled, confirmed or not"
    } else {
        "confirmed"
    };
    println!(
        "Relic reward: {} {kind} screens, median of {runs} runs per screen",
        screens.len()
    );
    println!();
    println!(
        "{:<8} {:>7} {:>8} {:>6} {:>8} {:>8}",
        "engine", "exact", "cards", "wrong", "p50 ms", "p95 ms"
    );
    let mut failures = Vec::new();
    for &engine in engines {
        let (mut exact, mut correct, mut expected, mut wrong) = (0, 0, 0, 0);
        let mut times = Vec::new();
        for (path, label) in &screens {
            let (frame, bytes) = load(path)?;
            let mut runs_ms = Vec::new();
            let mut last = None;
            for _ in 0..runs {
                let read = reward::read(engine, &frame, &bytes, &catalog, label.squad_size)?;
                runs_ms.push(read.ocr_ms);
                last = Some(read);
            }
            let read = last.expect("at least one run");
            times.push(median(&mut runs_ms));
            let score = reward::score(&read, label);
            exact += usize::from(score.exact());
            correct += score.correct;
            expected += score.expected;
            wrong += score.wrong;
            if !score.exact() {
                failures.push(format!(
                    "  {} {}: read {:?}",
                    engine.id(),
                    file_name(path),
                    read.names
                ));
            }
        }
        times.sort_by(f64::total_cmp);
        println!(
            "{:<8} {:>7} {:>8} {:>6} {:>8.0} {:>8.0}",
            engine.id(),
            format!("{exact}/{}", screens.len()),
            format!("{correct}/{expected}"),
            wrong,
            percentile(&times, 0.5),
            percentile(&times, 0.95),
        );
    }
    if !failures.is_empty() {
        println!();
        println!("not exact:");
        for failure in failures {
            println!("{failure}");
        }
    }
    Ok(())
}

/// Shows what each engine read on one reward screen: every OCR line with
/// its place, and the text and reward of each card.
fn reward_explain(data: &Data, screen: &str, engines: &[Provider]) -> Result<(), String> {
    let path = data.screens(RELIC_REWARD).join(screen);
    let (frame, bytes) = load(&path)?;
    let label: Option<reward::Label> = if label_path(&path).exists() {
        Some(read_json(&label_path(&path))?)
    } else {
        None
    };
    let catalog = reward::catalog()?;
    for &engine in engines {
        let squad_size = label.as_ref().and_then(|l| l.squad_size);
        let read = reward::read(engine, &frame, &bytes, &catalog, squad_size)?;
        println!("{} with {}: {:.0} ms", screen, engine.id(), read.ocr_ms);
        for line in &read.text.lines {
            let at = line.words.first().map_or((0.0, 0.0), |w| (w.left, w.top));
            println!("  line x={:.3} y={:.3}  {}", at.0, at.1, line.text);
        }
        for (i, (name, text)) in read.names.iter().zip(&read.texts).enumerate() {
            let want = label.as_ref().and_then(|l| l.cards.get(i));
            println!(
                "  card {}: read {:?} -> {:?}, label {:?}",
                i + 1,
                text,
                name,
                want
            );
        }
        println!();
    }
    Ok(())
}

/// One engine's results over every screen.
#[derive(serde::Serialize)]
struct EngineResult {
    variant: String,
    cases: Vec<CaseResult>,
}

#[derive(serde::Serialize)]
struct CaseResult {
    screen: String,
    confirmed: bool,
    /// Median over the runs.
    ocr_ms: f64,
    score: relic_list::Score,
    /// Tiles the read named that the label does not state.
    #[serde(skip_serializing_if = "Vec::is_empty")]
    wrong: Vec<String>,
    /// Tiles the label states that the read did not name.
    #[serde(skip_serializing_if = "Vec::is_empty")]
    missed: Vec<String>,
}

/// Reads every labelled screen with every engine and reports how often and
/// how fast each read it right.
fn bench(data: &Data, variants: &[Variant], runs: usize, all: bool) -> Result<(), String> {
    if cfg!(debug_assertions) {
        eprintln!("warning: debug build; timings are not representative, use --release");
    }
    let mut screens = Vec::new();
    for path in bmp_files(&data.screens(RELIC_LIST))? {
        let label_path = label_path(&path);
        if !label_path.exists() {
            continue;
        }
        let label: Label = read_json(&label_path)?;
        if label.confirmed || all {
            screens.push((path, label));
        }
    }
    if screens.is_empty() {
        return Err(
            "no confirmed labels; run `label`, confirm some, or pass --all to use proposals"
                .to_string(),
        );
    }
    let mut relics = Relics::new(data);
    let mut results = Vec::new();
    for &variant in variants {
        let mut cases = Vec::new();
        for (path, label) in &screens {
            let (frame, bytes) = load(path)?;
            let mut times = Vec::new();
            let mut last = None;
            for _ in 0..runs {
                let read = relic_list::read(variant, &frame, &bytes, &mut relics)?;
                times.push(read.ocr_ms);
                last = Some(read);
            }
            let read = last.expect("at least one run");
            let mut expected = label.tiles.clone();
            expected.sort();
            let tiles = read.tiles();
            cases.push(CaseResult {
                screen: file_name(path),
                confirmed: label.confirmed,
                ocr_ms: median(&mut times),
                score: relic_list::score(&read, label),
                wrong: difference(&tiles, &expected),
                missed: difference(&expected, &tiles),
            });
        }
        results.push(EngineResult {
            variant: variant.name(),
            cases,
        });
    }
    print_report(&results, screens.len(), runs, all);
    let dir = data.results();
    std::fs::create_dir_all(&dir).map_err(|e| format!("create {}: {e}", dir.display()))?;
    let stamp = std::time::SystemTime::now()
        .duration_since(std::time::UNIX_EPOCH)
        .map_or(0, |d| d.as_secs());
    let path = dir.join(format!("relic-list-{stamp}.json"));
    write_json(&path, &results)?;
    println!("\nPer-screen results: {}", path.display());
    Ok(())
}

fn print_report(results: &[EngineResult], screens: usize, runs: usize, all: bool) {
    let kind = if all {
        "labelled, confirmed or not"
    } else {
        "confirmed"
    };
    println!("Relic list: {screens} {kind} screens, median of {runs} runs per screen\n");
    println!(
        "{:<16} {:>7} {:>6} {:>10} {:>8} {:>8} {:>6} {:>8} {:>8} {:>8}",
        "variant",
        "exact",
        "era",
        "collected",
        "tiles",
        "owned",
        "wrong",
        "owned %",
        "p50 ms",
        "p95 ms"
    );
    for result in results {
        let cases = &result.cases;
        let count = |f: &dyn Fn(&CaseResult) -> bool| cases.iter().filter(|c| f(c)).count();
        let expected: usize = cases.iter().map(|c| c.score.expected).sum();
        let correct: usize = cases.iter().map(|c| c.score.correct).sum();
        let wrong: usize = cases.iter().map(|c| c.score.wrong).sum();
        let expected_owned: usize = cases.iter().map(|c| c.score.expected_owned).sum();
        let correct_owned: usize = cases.iter().map(|c| c.score.correct_owned).sum();
        let mut times: Vec<f64> = cases.iter().map(|c| c.ocr_ms).collect();
        times.sort_by(f64::total_cmp);
        println!(
            "{:<16} {:>7} {:>6} {:>10} {:>8} {:>8} {:>6} {:>7.1}% {:>8.0} {:>8.0}",
            result.variant,
            format!("{}/{}", count(&|c| c.score.exact()), cases.len()),
            count(&|c| c.score.era),
            count(&|c| c.score.collected),
            format!("{correct}/{expected}"),
            format!("{correct_owned}/{expected_owned}"),
            wrong,
            percent(correct_owned, expected_owned),
            percentile(&times, 0.5),
            percentile(&times, 0.95),
        );
    }
    for result in results {
        let failed: Vec<&CaseResult> = result.cases.iter().filter(|c| !c.score.exact()).collect();
        if failed.is_empty() {
            continue;
        }
        println!("\n{} not exact:", result.variant);
        for case in failed {
            let mut why = Vec::new();
            if !case.score.era {
                why.push("era".to_string());
            }
            if !case.score.collected {
                why.push("collected".to_string());
            }
            if !case.missed.is_empty() {
                why.push(format!("missed {}", case.missed.join(", ")));
            }
            if !case.wrong.is_empty() {
                why.push(format!("wrong {}", case.wrong.join(", ")));
            }
            println!("  {}: {}", case.screen, why.join("; "));
        }
    }
}

fn difference(a: &[relic_list::Tile], b: &[relic_list::Tile]) -> Vec<String> {
    let mut rest = b.to_vec();
    a.iter()
        .filter(|t| match rest.iter().position(|r| r == *t) {
            Some(at) => {
                rest.remove(at);
                false
            }
            None => true,
        })
        .map(ToString::to_string)
        .collect()
}

fn percent(part: usize, whole: usize) -> f64 {
    if whole == 0 {
        100.0
    } else {
        part as f64 * 100.0 / whole as f64
    }
}

fn median(values: &mut [f64]) -> f64 {
    values.sort_by(f64::total_cmp);
    percentile(values, 0.5)
}

/// Nearest-rank percentile of sorted values.
fn percentile(sorted: &[f64], p: f64) -> f64 {
    if sorted.is_empty() {
        return 0.0;
    }
    let rank = (p * sorted.len() as f64).ceil() as usize;
    sorted[rank.clamp(1, sorted.len()) - 1]
}

fn load(path: &Path) -> Result<(hexdesk_capture::Frame, Vec<u8>), String> {
    let bytes = std::fs::read(path).map_err(|e| format!("read {}: {e}", path.display()))?;
    let frame = bmp::decode(&bytes).map_err(|e| format!("{}: {e}", path.display()))?;
    Ok((frame, bytes))
}

fn bmp_files(dir: &Path) -> Result<Vec<PathBuf>, String> {
    let entries = std::fs::read_dir(dir).map_err(|e| format!("read {}: {e}", dir.display()))?;
    let mut files: Vec<PathBuf> = entries
        .filter_map(|e| e.ok().map(|e| e.path()))
        .filter(|p| p.extension().is_some_and(|x| x.eq_ignore_ascii_case("bmp")))
        .collect();
    files.sort();
    Ok(files)
}

fn label_path(screen: &Path) -> PathBuf {
    screen.with_extension("label.json")
}

fn file_name(path: &Path) -> String {
    path.file_name()
        .map(|n| n.to_string_lossy().into_owned())
        .unwrap_or_default()
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn nearest_rank_percentiles() {
        let sorted = [10.0, 20.0, 30.0, 40.0];
        assert_eq!(percentile(&sorted, 0.5), 20.0);
        assert_eq!(percentile(&sorted, 0.95), 40.0);
        assert_eq!(percentile(&[], 0.5), 0.0);
    }
}
