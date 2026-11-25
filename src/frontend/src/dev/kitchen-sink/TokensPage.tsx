import { domainColors, type DomainColor } from "../../theme/domain";
import { densities, semanticTokens, type SemanticToken } from "../../theme/tokens";

/** Dev page: every semantic role, density token and domain colour as a swatch. */

/** Roles meant as readable text on bg/surface. text-faint (disabled only) and on-accent (on accent only) are excluded. */
const TEXT_ROLES: ReadonlySet<SemanticToken> = new Set(["text", "text-muted", "accent", "success", "danger", "warning", "info"]);

function Swatch({ name, cssVar }: { name: string; cssVar: string }) {
  return (
    <li className="flex items-center gap-3 rounded-md border border-border bg-surface p-2">
      <span aria-hidden="true" className="size-8 shrink-0 rounded-sm border border-border-strong" style={{ background: `var(${cssVar})` }} />
      <span className="min-w-0">
        <span className="block text-sm text-text">{name}</span>
        <code className="block truncate text-xs text-muted">{cssVar}</code>
      </span>
    </li>
  );
}

function ShadowSwatch({ level }: { level: 1 | 2 | 3 }) {
  const cls = { 1: "shadow-1", 2: "shadow-2", 3: "shadow-3" }[level];
  return <li className={`rounded-md bg-surface-raised p-4 text-sm text-text ${cls}`}>--hex-shadow-{level}</li>;
}

export function TokensPage() {
  const colorRoles = semanticTokens.filter((t) => !t.startsWith("shadow-"));
  return (
    <main className="flex flex-col gap-8 p-6 text-text">
      <h1 className="text-xl font-semibold">Tokens</h1>

      <section aria-labelledby="tok-roles" className="flex flex-col gap-3">
        <h2 id="tok-roles" className="text-base font-semibold">
          Semantic roles
        </h2>
        <ul className="grid grid-cols-[repeat(auto-fill,minmax(14rem,1fr))] gap-2">
          {colorRoles.map((token) => (
            <Swatch key={token} name={token} cssVar={`--hex-${token}`} />
          ))}
        </ul>
      </section>

      <section aria-labelledby="tok-text" className="flex flex-col gap-3">
        <h2 id="tok-text" className="text-base font-semibold">
          Text on surfaces
        </h2>
        <div className="grid grid-cols-3 gap-2">
          {(["bg", "surface", "surface-raised"] as const).map((surface) => (
            <div key={surface} className="flex flex-col gap-1 rounded-md border border-border p-3" style={{ background: `var(--hex-${surface})` }}>
              <span className="text-xs text-muted">{surface}</span>
              {[...TEXT_ROLES].map((role) => (
                <span key={role} className="text-sm" style={{ color: `var(--hex-${role})` }}>
                  {role}
                </span>
              ))}
            </div>
          ))}
        </div>
        <span className="inline-flex h-control-md w-fit items-center rounded-md bg-accent px-3 text-sm text-on-accent">on-accent on accent</span>
      </section>

      <section aria-labelledby="tok-elevation" className="flex flex-col gap-3">
        <h2 id="tok-elevation" className="text-base font-semibold">
          Elevation
        </h2>
        <ul className="flex gap-6">
          <ShadowSwatch level={1} />
          <ShadowSwatch level={2} />
          <ShadowSwatch level={3} />
        </ul>
      </section>

      <section aria-labelledby="tok-density" className="flex flex-col gap-3">
        <h2 id="tok-density" className="text-base font-semibold">
          Density
        </h2>
        <div className="flex gap-6">
          {Object.keys(densities).map((density) => (
            <div key={density} data-density={density} className="flex flex-col gap-2">
              <span className="text-xs text-muted">{density}</span>
              <span className="inline-flex h-control-sm items-center rounded-md border border-border px-2 text-xs">control-sm</span>
              <span className="inline-flex h-control-md items-center rounded-md border border-border px-3 text-sm">control-md</span>
              <span className="inline-flex h-control-lg items-center rounded-md border border-border px-4 text-sm">control-lg</span>
              <span className="border border-border px-cell-x py-cell-y text-list">list cell / text-list</span>
            </div>
          ))}
        </div>
      </section>

      <section aria-labelledby="tok-domain" className="flex flex-col gap-3">
        <h2 id="tok-domain" className="text-base font-semibold">
          Domain colors (only through --hex-tone)
        </h2>
        <ul className="grid grid-cols-[repeat(auto-fill,minmax(14rem,1fr))] gap-2">
          {(Object.keys(domainColors) as DomainColor[]).map((name) => (
            <Swatch key={name} name={name} cssVar={`--hex-${name}`} />
          ))}
        </ul>
      </section>
    </main>
  );
}
