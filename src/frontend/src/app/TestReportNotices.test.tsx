import { emit } from "@tauri-apps/api/event";
import { clearMocks, mockIPC, mockWindows } from "@tauri-apps/api/mocks";
import { afterEach, expect, it, vi } from "vitest";
import { cleanup, render } from "vitest-browser-react";
import { toastQueue } from "../primitives/overlay";
import { TestReportNotices } from "./TestReportNotices";

afterEach(async () => {
  await cleanup();
  clearMocks();
  for (const item of toastQueue.visibleToasts) toastQueue.close(item.key);
});

async function mount() {
  mockWindows("main");
  mockIPC(() => null, { shouldMockEvents: true });
  await render(<TestReportNotices />);
}

const shown = () => toastQueue.visibleToasts.map((item) => item.content);

it("tells a failed flow apart from a failed run report", async () => {
  await mount();

  await vi.waitFor(async () => {
    await emit("test-report", { reason: "flow", path: null, error: "disk full." });
    expect(shown()).toContainEqual(
      expect.objectContaining({ title: "Could not keep the reported flow", description: "disk full. Its samples were discarded." }),
    );
  });
  await emit("test-report", { reason: "run", path: null, error: "disk full." });
  await vi.waitFor(() => {
    expect(shown()).toContainEqual(
      expect.objectContaining({ title: "Could not save test report", description: "disk full. The reported samples were kept locally." }),
    );
  });
});

it("shows where a saved report went", async () => {
  await mount();

  await vi.waitFor(async () => {
    await emit("test-report", { reason: "run", path: "Downloads/report.zip", error: null });
    expect(shown()).toContainEqual(expect.objectContaining({ title: "Test report saved", description: "Downloads/report.zip" }));
  });
});
