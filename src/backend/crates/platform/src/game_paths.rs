//! Where the game keeps the files HexDesk reads.

use std::path::{Path, PathBuf};

/// The game's log, `EE.log`, which HexDesk tails for screens, squads and
/// trades. `None` when the user's local data directory is unknown.
pub fn ee_log() -> Option<PathBuf> {
    dirs::data_local_dir().map(|dir| ee_log_in(&dir))
}

/// The game writes `EE.log` to a `Warframe` folder in the local application
/// data directory (`%LOCALAPPDATA%` on Windows).
fn ee_log_in(local_data: &Path) -> PathBuf {
    local_data.join("Warframe").join("EE.log")
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn ee_log_is_in_the_warframe_folder_of_local_data() {
        let local = Path::new("C:/Users/Someone/AppData/Local");
        assert_eq!(
            ee_log_in(local),
            Path::new("C:/Users/Someone/AppData/Local/Warframe/EE.log")
        );
    }
}
