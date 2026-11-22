import { ModularPopoutPage } from "../screens/modular/ModularPopoutPage";
import { OverlayStatus } from "../screens/overlays/OverlayStatus";
import { RelicPickOverlay } from "../screens/overlays/RelicPickOverlay";
import { RelicRewardOverlay } from "../screens/overlays/RelicRewardOverlay";
import { RivenOverlay } from "../screens/overlays/RivenOverlay";
import { AppShell } from "./AppShell";
import { ChangeLogPopoutPage } from "./ChangeLogPopoutPage";
import type { WindowKind } from "./windowKind";

type Props = { kind: WindowKind };

/** Picks what a window renders: the main window, the modular pop-out or an overlay. */
export function WindowRoot({ kind }: Props) {
  switch (kind) {
    case "main":
      return <AppShell />;
    case "modular":
      return <ModularPopoutPage />;
    case "changelog":
      return <ChangeLogPopoutPage />;
    case "overlay":
      return <RelicRewardOverlay />;
    case "relic-pick-overlay":
      return <RelicPickOverlay />;
    case "riven-overlay":
      return <RivenOverlay />;
    case "overlay-status":
      return <OverlayStatus />;
  }
}
