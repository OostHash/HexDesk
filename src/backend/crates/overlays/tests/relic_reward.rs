//! The reward card reader on reward screens recorded in the game, from
//! `tests/fixtures/relic-reward/`: the OCR result (json) and the reward area
//! at a quarter of its size in colour (PPM). Player names are replaced in
//! the json and blacked out in the picture; `rewards.txt` lists every relic
//! reward as path and name.

use hexdesk_capture::{Frame, TextRead};
use hexdesk_overlays::read::reward::{
    read_reward_screen, Confirm, RewardInput, RewardRead, RewardScreen, Verdict,
};

fn dir() -> std::path::PathBuf {
    std::path::Path::new(env!("CARGO_MANIFEST_DIR")).join("tests/fixtures/relic-reward")
}

fn catalog() -> Vec<(String, String)> {
    std::fs::read_to_string(dir().join("rewards.txt"))
        .unwrap()
        .lines()
        .filter_map(|l| l.split_once('\t'))
        .map(|(p, n)| (p.to_string(), n.to_string()))
        .collect()
}

fn fixture(name: &str) -> (TextRead, Frame) {
    let json = std::fs::read_to_string(dir().join(format!("{name}.json"))).unwrap();
    let ppm = std::fs::read(dir().join(format!("{name}.ppm"))).unwrap();
    // "P6\n<width> <height>\n255\n" then red, green and blue per pixel.
    let mut fields = ppm.splitn(5, |b| b.is_ascii_whitespace());
    let _magic = fields.next();
    let number =
        |f: Option<&[u8]>| -> u32 { std::str::from_utf8(f.unwrap()).unwrap().parse().unwrap() };
    let width = number(fields.next());
    let height = number(fields.next());
    let _max = fields.next();
    let rgb = fields.next().unwrap();
    let pixels = rgb
        .chunks_exact(3)
        .flat_map(|p| [p[2], p[1], p[0], 255])
        .collect();
    (
        TextRead::from_json(&json).unwrap(),
        Frame::new(pixels, width, height),
    )
}

/// The names the squad in the fixtures goes by.
fn players() -> Vec<String> {
    ["North420", "Pathfinder0815", "Wander1089", "q7lux242"]
        .iter()
        .map(|s| s.to_string())
        .collect()
}

fn read(name: &str, squad_size: Option<usize>) -> RewardRead {
    let (text, frame) = fixture(name);
    let catalog = catalog();
    let players = players();
    let screen = read_reward_screen(&RewardInput {
        text: &text,
        frame: &frame,
        catalog: &catalog,
        squad_size,
        player_names: &players,
    });
    let RewardScreen::Cards(read) = screen else {
        panic!("{name}: no cards: {screen:?}");
    };
    read
}

fn names(read: &RewardRead) -> Vec<&str> {
    read.cards
        .iter()
        .map(|c| c.name.as_deref().unwrap_or("?"))
        .collect()
}

const FOUR_CARDS: [&str; 4] = [
    "Alternox Prime Receiver",
    "Forma Blueprint",
    "Afentis Prime Barrel",
    "Lex Prime Blueprint",
];

const TWO_FORMA: [&str; 4] = [
    "Forma Blueprint",
    "Bronco Prime Blueprint",
    "Forma Blueprint",
    "Lex Prime Blueprint",
];

#[test]
fn four_cards_are_read_left_to_right() {
    for name in ["four-cards", "four-cards-names-moved"] {
        let read = read(name, Some(4));
        assert_eq!(names(&read), FOUR_CARDS, "{name}: {read:#?}");
        assert!(read.complete() && read.sure(), "{name}");
    }
}

#[test]
fn the_same_reward_twice_is_two_cards() {
    for name in ["two-forma", "two-forma-names-moved"] {
        let read = read(name, Some(4));
        assert_eq!(names(&read), TWO_FORMA, "{name}: {read:#?}");
    }
}

#[test]
fn the_rarity_bars_count_the_cards_without_ee_log() {
    for name in [
        "four-cards",
        "four-cards-names-moved",
        "two-forma",
        "two-forma-names-moved",
    ] {
        let read = read(name, None);
        assert_eq!(read.expected, 4, "{name}: {}", read.bars);
        assert_eq!(read.cards.len(), 4, "{name}: {read:#?}");
    }
}

#[test]
fn player_names_are_never_card_text() {
    let read = read("four-cards-names-moved", Some(4));
    for card in &read.cards {
        assert!(
            !players()
                .iter()
                .any(|p| card.text.contains(&p[..p.len().min(6)])),
            "{}",
            card.text
        );
    }
    assert!(read
        .lines
        .iter()
        .any(|l| l.text.starts_with("Pathfinder") && l.skipped.is_some()));
}

#[test]
fn each_card_says_what_was_read_and_the_next_best_rewards() {
    let read = read("four-cards", Some(4));
    let lex = &read.cards[3];
    assert_eq!(lex.text, "Lex Prime Blueprint");
    assert!(lex.score >= 1.0);
    assert_eq!(lex.alternatives.len(), 3);
    assert!(
        lex.alternatives.iter().all(|(_, s)| *s < lex.score),
        "{:?}",
        lex.alternatives
    );
}

#[test]
fn two_recorded_reads_of_one_screen_are_shown_on_the_second() {
    let mut confirm = Confirm::new();
    assert_eq!(confirm.add(read("two-forma", Some(4))), Verdict::Wait);
    let Verdict::Show { cards, .. } = confirm.add(read("two-forma-names-moved", Some(4))) else {
        panic!("not shown");
    };
    assert!(cards.iter().all(|c| c.sure));
    assert_eq!(cards.len(), 4);
}
