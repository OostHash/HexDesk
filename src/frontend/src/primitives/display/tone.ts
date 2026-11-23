import type { CSSProperties } from "react";
import type { DomainColor } from "../../theme/domain";

/**
 * Status tones every tone-aware primitive accepts. "domain" means: use the
 * --hex-tone variable, set via `domainTone()` from a domain colour.
 * The primitive itself never knows rarity, tier or syndicate names.
 */
export type Tone = "neutral" | "accent" | "info" | "success" | "warning" | "danger" | "domain";

/** Style that sets --hex-tone to a domain colour, e.g. domainTone("rarity-gold"). */
export function domainTone(color: DomainColor): CSSProperties {
  return { "--hex-tone": `var(--hex-${color})` } as CSSProperties;
}
