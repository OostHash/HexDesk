use crate::BlobRivenStat;

/// Compute the deterministic riven mod name from its buff stats.
/// Uses the same table as `RIVEN_NAME_PARTS` in `src/frontend/src/domain/rivens.ts`.
/// 1 buff  → coreSuffix       (buff's prefix word + buff's suffix word)
/// 2 buffs → coreSuffix       (higher's prefix + lower's suffix, no dash)
/// 3 buffs → prefix-coreSuffix (highest - second + lowest, with dash)
pub fn compute_riven_mod_name(buffs: &[BlobRivenStat]) -> String {
    fn parts(tag: &str) -> Option<(&'static str, &'static str)> {
        match tag {
            "WeaponMeleeComboBonusOnHitMod" | "WeaponMeleeComboPointsOnHitMod" => {
                Some(("Laci", "Nus"))
            }
            "WeaponAmmoMaxMod" => Some(("Ampi", "Bin")),
            "WeaponMeleeFactionDamageCorpus" | "WeaponFactionDamageCorpus" => {
                Some(("Manti", "Tron"))
            }
            "WeaponMeleeFactionDamageGrineer" | "WeaponFactionDamageGrineer" => {
                Some(("Argi", "Con"))
            }
            "WeaponMeleeFactionDamageInfested" | "WeaponFactionDamageInfested" => {
                Some(("Pura", "Ada"))
            }
            "WeaponFreezeDamageMod" => Some(("Geli", "Do")),
            "ComboDurationMod" => Some(("Tempi", "Nem")),
            "WeaponCritChanceMod" => Some(("Crita", "Cron")),
            "SlideAttackCritChanceMod" => Some(("Pleci", "Nent")),
            "WeaponCritDamageMod" => Some(("Acri", "Tis")),
            "WeaponDamageAmountMod" | "WeaponMeleeDamageMod" => Some(("Visi", "Ata")),
            "WeaponElectricityDamageMod" => Some(("Vexi", "Tio")),
            "WeaponFireDamageMod" => Some(("Igni", "Pha")),
            "WeaponMeleeFinisherDamageMod" => Some(("Exi", "Cta")),
            "WeaponFireRateMod" => Some(("Croni", "Dra")),
            "WeaponProjectileSpeedMod" => Some(("Conci", "Nak")),
            "WeaponMeleeComboInitialBonusMod" => Some(("Para", "Um")),
            "WeaponImpactDamageMod" => Some(("Magna", "Ton")),
            "WeaponClipMaxMod" => Some(("Arma", "Tin")),
            "WeaponMeleeComboEfficiencyMod" => Some(("Forti", "Us")),
            "WeaponFireIterationsMod" => Some(("Sati", "Can")),
            "WeaponToxinDamageMod" => Some(("Toxi", "Tox")),
            "WeaponPunctureDepthMod" => Some(("Lexi", "Nok")),
            "WeaponArmorPiercingDamageMod" => Some(("Insi", "Cak")),
            "WeaponReloadSpeedMod" => Some(("Feva", "Tak")),
            "WeaponMeleeRangeIncMod" => Some(("Locti", "Tor")),
            "WeaponSlashDamageMod" => Some(("Sci", "Sus")),
            "WeaponStunChanceMod" => Some(("Hexa", "Dex")),
            "WeaponProcTimeMod" => Some(("Deci", "Des")),
            "WeaponRecoilReductionMod" => Some(("Zeti", "Mag")),
            "WeaponZoomFovMod" => Some(("Hera", "Lis")),
            _ => None,
        }
    }
    if buffs.is_empty() {
        return String::new();
    }
    let mut sorted: Vec<&BlobRivenStat> = buffs.iter().collect();
    sorted.sort_by_key(|b| std::cmp::Reverse(b.value));
    let Some((hi_p, _)) = parts(&sorted[0].tag) else {
        return String::new();
    };
    let Some((_, lo_s)) = parts(&sorted[sorted.len() - 1].tag) else {
        return String::new();
    };
    if sorted.len() >= 3 {
        if let Some((mid_p, _)) = parts(&sorted[1].tag) {
            return format!(
                "{}-{}{}",
                hi_p.to_lowercase(),
                mid_p.to_lowercase(),
                lo_s.to_lowercase()
            );
        }
    }
    format!("{}{}", hi_p.to_lowercase(), lo_s.to_lowercase())
}
