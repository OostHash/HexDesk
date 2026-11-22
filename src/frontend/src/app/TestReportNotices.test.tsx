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

it("says when a screen marked wrong could not be kept", async () => {
  await mount();

  await vi.waitFor(async () => {
    await emit("test-report", { error: "disk full." });
    expect(shown()).toContainEqual(expect.objectContaining({ title: "Could not keep this screen for your report", description: "disk full." }));
  });
});
