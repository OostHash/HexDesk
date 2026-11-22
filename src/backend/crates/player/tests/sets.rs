//! The set rules on a small catalogue.

use std::collections::HashMap;

use hexdesk_player::sets::{complete_sets, copies, has_item_or_build, reward_card, set_parts};
use hexdesk_player::{Catalogue, Inventory, Item, RecipeLine};

fn item(path: &str, name: &str, category: &str) -> Item {
    Item {
        path: path.into(),
        name: name.into(),
        category: category.into(),
        vaulted: None,
        ducats: None,
    }
}

fn line(path: &str, name: &str, count: u32) -> RecipeLine {
    RecipeLine {
        path: path.into(),
        name: name.into(),
        count,
    }
}

const FRAME: &str = "/Lotus/Powersuits/RhinoPrime";
const BP: &str = "/Lotus/Recipes/RhinoPrimeBlueprint";
const CHASSIS_BP: &str = "/Lotus/Recipes/RhinoPrimeChassisBlueprint";
const CHASSIS: &str = "/Lotus/Parts/RhinoPrimeChassis";
const SYSTEMS_BP: &str = "/Lotus/Recipes/RhinoPrimeSystemsBlueprint";
const CELL: &str = "/Lotus/Misc/OrokinCell";

fn items() -> Vec<Item> {
    vec![
        item(FRAME, "Rhino Prime", "Warframes"),
        item(BP, "Rhino Prime Blueprint", "Blueprints"),
        item(CHASSIS_BP, "Rhino Prime Chassis Blueprint", "Blueprints"),
        item(CHASSIS, "Rhino Prime Chassis", "Parts"),
        item(SYSTEMS_BP, "Rhino Prime Systems Blueprint", "Blueprints"),
        item(CELL, "Orokin Cell", "Resources"),
    ]
}

fn inventory(counts: &[(&str, i64)], crafting: &[(&str, i64)]) -> Inventory {
    Inventory {
        scan_at: Some(0),
        counts: counts.iter().map(|(p, n)| (p.to_string(), *n)).collect(),
        rewards: Vec::new(),
        crafting: crafting.iter().map(|(p, n)| (p.to_string(), *n)).collect(),
    }
}

#[test]
fn copies_count_the_item_its_other_form_and_foundry_jobs_across_store_paths() {
    let catalogue = Catalogue::new(items(), HashMap::new());
    let inv = inventory(&[(CHASSIS_BP, 1), (CHASSIS, 1)], &[(CHASSIS_BP, 1)]);
    let count = copies(
        &catalogue,
        &inv,
        "/Lotus/StoreItems/Recipes/RhinoPrimeChassisBlueprint",
        "Rhino Prime Chassis Blueprint",
    );
    assert_eq!(count.total, 3);
    assert_eq!(
        copies(
            &catalogue,
            &inventory(&[], &[]),
            SYSTEMS_BP,
            "Rhino Prime Systems Blueprint"
        )
        .total,
        0
    );
}

#[test]
fn a_part_named_after_its_blueprint_in_a_recipe_still_counts_the_blueprint() {
    // The recipe line names the part "Rhino Prime Chassis Blueprint"; the
    // catalogue's name for the path decides.
    let catalogue = Catalogue::new(items(), HashMap::new());
    let inv = inventory(&[(CHASSIS_BP, 1)], &[]);
    assert_eq!(
        copies(&catalogue, &inv, CHASSIS, "Rhino Prime Chassis Blueprint").total,
        1
    );
}

#[test]
fn set_parts_come_from_the_recipe_parts_and_blueprints_only() {
    let recipes = HashMap::from([(
        FRAME.to_string(),
        vec![
            line(BP, "Rhino Prime Blueprint", 1),
            line(CHASSIS, "Rhino Prime Chassis", 1),
            line(CELL, "Orokin Cell", 2),
        ],
    )]);
    let catalogue = Catalogue::new(items(), recipes);
    let parts = set_parts(&catalogue, &inventory(&[], &[]), "Rhino Prime").unwrap();
    assert_eq!(
        parts.iter().map(|p| p.name.as_str()).collect::<Vec<_>>(),
        ["Rhino Prime Blueprint", "Rhino Prime Chassis"]
    );
}

#[test]
fn without_a_recipe_set_parts_are_the_parts_named_after_the_set() {
    let catalogue = Catalogue::new(items(), HashMap::new());
    let parts = set_parts(&catalogue, &inventory(&[], &[]), "Rhino Prime").unwrap();
    assert_eq!(
        parts.iter().map(|p| p.name.as_str()).collect::<Vec<_>>(),
        [
            "Rhino Prime Blueprint",
            "Rhino Prime Chassis Blueprint",
            "Rhino Prime Chassis",
            "Rhino Prime Systems Blueprint"
        ]
    );
    assert!(set_parts(&catalogue, &inventory(&[], &[]), "Nova Prime").is_none());
}

#[test]
fn complete_sets_count_with_an_owned_built_item_as_at_least_one() {
    let recipes = HashMap::from([(
        FRAME.to_string(),
        vec![
            line(BP, "Rhino Prime Blueprint", 1),
            line(CHASSIS, "Rhino Prime Chassis", 2),
        ],
    )]);
    let catalogue = Catalogue::new(items(), recipes);
    let inv = inventory(&[(BP, 2), (CHASSIS, 3)], &[]);
    let parts = set_parts(&catalogue, &inv, "Rhino Prime").unwrap();
    assert_eq!(complete_sets(&parts, false), 1);
    let none = set_parts(&catalogue, &inventory(&[], &[]), "Rhino Prime").unwrap();
    assert_eq!(complete_sets(&none, false), 0);
    assert_eq!(complete_sets(&none, true), 1);
}

#[test]
fn a_part_used_up_in_a_built_item_counts_as_had() {
    let recipes = HashMap::from([(
        FRAME.to_string(),
        vec![line(CHASSIS, "Rhino Prime Chassis", 1)],
    )]);
    let catalogue = Catalogue::new(items(), recipes);
    assert!(has_item_or_build(
        &catalogue,
        &inventory(&[(FRAME, 1)], &[]),
        "Rhino Prime Chassis"
    ));
    assert!(!has_item_or_build(
        &catalogue,
        &inventory(&[], &[]),
        "Rhino Prime Chassis"
    ));
}

#[test]
fn a_reward_card_says_where_each_count_comes_from() {
    let recipes = HashMap::from([(
        FRAME.to_string(),
        vec![
            line(BP, "Rhino Prime Blueprint", 1),
            line(CHASSIS, "Rhino Prime Chassis", 1),
        ],
    )]);
    let catalogue = Catalogue::new(items(), recipes);
    let mut inv = inventory(&[(CHASSIS_BP, 2)], &[]);
    inv.rewards.push((200, CHASSIS_BP.to_string(), 1));
    let card = reward_card(
        &catalogue,
        &inv,
        "/Lotus/StoreItems/Recipes/RhinoPrimeChassisBlueprint",
    );
    assert_eq!(card.set_name.as_deref(), Some("Rhino Prime"));
    assert_eq!(card.complete_sets, Some(0));
    let time = |at: i64| format!("t{at}");
    assert_eq!(
        card.explain(&time),
        "Rhino Prime Chassis Blueprint: 0 complete set(s); Blueprint 0/1 = none listed; \
         Chassis 2/1 = Rhino Prime Chassis Blueprint 1 (scan t0) + Rhino Prime Chassis Blueprint 1 (reward t200); \
         built 0: none listed"
    );
}

#[test]
fn an_unknown_path_is_an_unknown_card() {
    let catalogue = Catalogue::new(items(), HashMap::new());
    let card = reward_card(&catalogue, &inventory(&[], &[]), "/Lotus/Types/Nothing");
    assert!(card.unknown);
    assert_eq!(card.name, "Nothing");
}

#[test]
fn an_item_built_from_its_blueprint_alone_is_no_set() {
    let forma = "/Lotus/Types/Items/MiscItems/Forma";
    let forma_bp = "/Lotus/Types/Recipes/Components/FormaBlueprint";
    let catalogue = Catalogue::new(
        vec![
            item(forma, "Forma", "Resources"),
            item(forma_bp, "Forma Blueprint", "Blueprints"),
        ],
        HashMap::from([(
            forma.to_string(),
            vec![line(forma_bp, "Forma Blueprint", 1)],
        )]),
    );
    let card = reward_card(
        &catalogue,
        &inventory(&[(forma_bp, 3), (forma, 12)], &[]),
        forma_bp,
    );
    assert_eq!(card.set_name, None);
    assert_eq!(card.complete_sets, None);
}
