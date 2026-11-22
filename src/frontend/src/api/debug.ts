import type { DiagnosticsParts } from "./commands";
import { invoke } from "./invoke";

/** Diagnostics: the export (Settings → Debugging and Console). */

/** Writes the diagnostics zip with the chosen parts and returns where it was saved. */
export const exportDiagnostics = (parts: DiagnosticsParts) => invoke("export_diagnostics", { parts });

/** Opens Explorer with the exported zip selected. */
export const showDiagnosticsExport = (path: string) => invoke("show_diagnostics_export", { path });
