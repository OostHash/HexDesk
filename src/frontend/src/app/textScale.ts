import { getCurrentWebview } from "@tauri-apps/api/webview";
import { isTauri } from "../api/env";

/**
 * Applies the text scale as native WebView2 zoom.
 * Unlike transform: scale() on #root, layout, vh, the top layer (<dialog>,
 * popover) and pointer coordinates all scale consistently, and the scrollbar
 * stays draggable. Every window applies it for itself. In plain browser mode
 * there is no webview: the page stays at 100%.
 */
export async function applyTextScale(scale: number): Promise<void> {
  if (!isTauri()) return;
  await getCurrentWebview().setZoom(scale);
}
