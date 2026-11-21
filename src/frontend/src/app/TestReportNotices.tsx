import { useEvent } from "../api/events";
import { toast } from "../primitives/overlay";

/** Toasts why a flow reported during opt-in testing could not be stored. */
export function TestReportNotices() {
  useEvent("test-report", ({ error }) => {
    toast({ title: "Could not keep the reported flow", description: `${error} Its samples were discarded.`, tone: "danger" });
  });
  return null;
}
