import { Copy } from "lucide-react";
import { useRef, useState } from "react";
import { imageSources, useImageBaseUrl } from "../../api/catalog";
import { useOwnership } from "../../api/inventory";
import { useCatalogByUniqueName } from "../../api/relics";
import { classifyPixels, formatIconReport, ICON_PROBLEM_LABEL, ICON_PROBLEMS, type IconFinding, type IconProblem } from "../../domain/iconCheck";
import type { CatalogItem } from "../../domain/relics";
import { ItemImage } from "../../patterns/ItemImage";
import { Button } from "../../primitives/actions";
import { toast } from "../../primitives/overlay";
import { SettingRow, SettingsGroup } from "./parts";

/** Icons are judged at this size; enough to tell white or black from colour. */
const SAMPLE_SIZE = 48;
/** Images loaded at once, so a whole-catalogue run does not flood the image server. */
const PARALLEL = 8;

/** Loads an image that the canvas may read; rejects when it does not load. */
function loadImage(src: string): Promise<HTMLImageElement> {
  return new Promise((resolve, reject) => {
    const img = new Image();
    img.crossOrigin = "anonymous";
    img.onload = () => {
      resolve(img);
    };
    img.onerror = () => {
      reject(new Error(`Could not load ${src}`));
    };
    img.src = src;
  });
}

/** The problem with one item's icon, or null when it looks fine. Tries the sources in the order the app does. */
async function checkIcon(item: CatalogItem, baseUrl: string | undefined, canvas: HTMLCanvasElement): Promise<IconProblem | null> {
  if (!item.image_name) return "no-image-name";
  let img: HTMLImageElement | null = null;
  for (const src of imageSources(item.image_name, baseUrl)) {
    img = await loadImage(src).catch(() => null);
    if (img) break;
  }
  if (!img) return "not-found";
  const context = canvas.getContext("2d", { willReadFrequently: true });
  if (!context) return "unreadable";
  context.clearRect(0, 0, SAMPLE_SIZE, SAMPLE_SIZE);
  context.drawImage(img, 0, 0, SAMPLE_SIZE, SAMPLE_SIZE);
  try {
    return classifyPixels(context.getImageData(0, 0, SAMPLE_SIZE, SAMPLE_SIZE).data);
  } catch {
    // A source without CORS headers taints the canvas.
    return "unreadable";
  }
}

const finding = (item: CatalogItem, problem: IconProblem): IconFinding => ({
  name: item.name,
  category: item.category,
  uniqueName: item.unique_name,
  imageName: item.image_name ?? null,
  problem,
});

type Run = { scope: string; total: number; done: number; findings: IconFinding[]; finished: boolean };

/**
 * Checks item icons and lists what is missing or hard to see: no image name,
 * no image anywhere, (nearly) empty, nearly all white or all black. Owned
 * items that the catalogue does not know are listed too.
 */
export function IconCheckGroup() {
  const catalog = useCatalogByUniqueName();
  const { ownership } = useOwnership();
  const baseUrl = useImageBaseUrl();
  const [run, setRun] = useState<Run | null>(null);
  const canvas = useRef<HTMLCanvasElement | null>(null);
  const running = run !== null && !run.finished;

  const start = (scope: "owned" | "all") => {
    const owned = (unique: string) => (ownership.quantities[unique] ?? 0) > 0;
    const items = [...catalog.values()].filter((item) => scope === "all" || owned(item.unique_name));
    const unknown: IconFinding[] =
      scope === "owned"
        ? Object.keys(ownership.quantities)
            .filter((unique) => owned(unique) && !catalog.has(unique))
            .map((unique) => ({
              name: unique.split("/").pop() ?? unique,
              category: "?",
              uniqueName: unique,
              imageName: null,
              problem: "not-in-catalogue" as const,
            }))
        : [];
    const label = scope === "owned" ? "owned items" : "catalogue items";
    canvas.current ??= Object.assign(document.createElement("canvas"), { width: SAMPLE_SIZE, height: SAMPLE_SIZE });
    const surface = canvas.current;
    setRun({ scope: label, total: items.length + unknown.length, done: unknown.length, findings: unknown, finished: items.length === 0 });

    let next = 0;
    const worker = async () => {
      while (next < items.length) {
        const item = items[next++];
        if (!item) continue;
        const problem = await checkIcon(item, baseUrl, surface);
        setRun((r) => r && { ...r, done: r.done + 1, findings: problem ? [...r.findings, finding(item, problem)] : r.findings });
      }
    };
    void Promise.all(Array.from({ length: PARALLEL }, worker)).then(() => {
      setRun((r) => r && { ...r, finished: true });
    });
  };

  const copy = () => {
    if (!run) return;
    navigator.clipboard
      .writeText(formatIconReport(run.findings, run.total))
      .then(() => toast({ title: "Icon report copied", tone: "success" }))
      .catch(() => toast({ title: "Could not copy the report", tone: "danger" }));
  };

  return (
    <SettingsGroup title="Item icons">
      <SettingRow
        label="Check item icons"
        description="Loads every icon like the app does and lists the ones that are missing, (nearly) empty, or nearly all white or all black."
        result={
          run && (
            <p role="status" className="text-xs text-muted">
              {run.finished
                ? `${String(run.total)} ${run.scope} checked, ${String(run.findings.length)} with a problem.`
                : `Checking ${String(run.done)} of ${String(run.total)} ${run.scope}…`}
            </p>
          )
        }
      >
        <Button
          size="sm"
          disabled={running}
          onClick={() => {
            start("owned");
          }}
        >
          Owned items
        </Button>
        <Button
          size="sm"
          disabled={running}
          onClick={() => {
            start("all");
          }}
        >
          Whole catalogue
        </Button>
      </SettingRow>
      {run?.finished && run.findings.length > 0 && (
        <div className="flex flex-col gap-4 px-4 py-3">
          <div>
            <Button size="sm" leadingIcon={Copy} onClick={copy}>
              Copy list
            </Button>
          </div>
          {ICON_PROBLEMS.map((problem) => {
            const group = run.findings.filter((f) => f.problem === problem).sort((a, b) => a.name.localeCompare(b.name));
            if (group.length === 0) return null;
            return (
              <section key={problem} aria-label={ICON_PROBLEM_LABEL[problem]} className="flex flex-col gap-1">
                <h4 className="text-xs font-semibold text-muted uppercase">
                  {ICON_PROBLEM_LABEL[problem]} ({group.length})
                </h4>
                <ul className="flex flex-col">
                  {group.map((f) => (
                    <li key={f.uniqueName} className="flex items-center gap-2 py-0.5 text-sm">
                      <ItemImage size="sm" sources={imageSources(f.imageName ?? undefined, baseUrl)} name={f.name} />
                      <span className="font-medium">{f.name}</span>
                      <span className="text-xs text-muted">{f.category}</span>
                      <span className="ms-auto truncate font-mono text-xs text-muted">{f.imageName ?? f.uniqueName}</span>
                    </li>
                  ))}
                </ul>
              </section>
            );
          })}
        </div>
      )}
    </SettingsGroup>
  );
}
