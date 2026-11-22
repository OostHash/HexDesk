import { expect, it } from "vitest";
import { classifyPixels, formatIconReport, type IconFinding } from "../../src/domain/iconCheck.ts";

/** A square of `count` RGBA pixels, `visible` of them in the given colour, the rest transparent. */
function pixels(count: number, visible: number, [r, g, b]: [number, number, number]): number[] {
  const out: number[] = [];
  for (let i = 0; i < count; i++) out.push(r, g, b, i < visible ? 255 : 0);
  return out;
}

it("flags icons that are nearly all white or all black", () => {
  expect(classifyPixels(pixels(100, 50, [250, 250, 250]))).toBe("mostly-white");
  expect(classifyPixels(pixels(100, 50, [5, 5, 5]))).toBe("mostly-black");
});

it("passes a coloured icon and one with some white detail", () => {
  expect(classifyPixels(pixels(100, 50, [200, 120, 40]))).toBeNull();
  const mixed = [...pixels(50, 40, [250, 250, 250]), ...pixels(50, 50, [60, 90, 160])];
  expect(classifyPixels(mixed)).toBeNull();
});

it("calls an almost transparent icon empty", () => {
  expect(classifyPixels(pixels(100, 1, [200, 120, 40]))).toBe("empty");
  expect(classifyPixels([])).toBe("empty");
});

it("reports findings grouped by problem, in a stable order", () => {
  const findings: IconFinding[] = [
    { name: "Endo", category: "Resources", uniqueName: "/Endo", imageName: null, problem: "no-image-name" },
    { name: "Credits", category: "Resources", uniqueName: "/Credits", imageName: null, problem: "no-image-name" },
    { name: "Void Trace", category: "Resources", uniqueName: "/Trace", imageName: "void-trace.png", problem: "mostly-white" },
  ];
  expect(formatIconReport(findings, 40)).toBe(
    [
      "Item icon check: 40 items checked, 3 with a problem.",
      "",
      "No image name in the catalogue (2)",
      "- Credits [Resources] /Credits",
      "- Endo [Resources] /Endo",
      "",
      "Image is mostly white (1)",
      "- Void Trace [Resources] void-trace.png",
    ].join("\n"),
  );
});
