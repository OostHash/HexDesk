import { useEvent } from "../api/events";
import { toast } from "../primitives/overlay";

/** Toasts the results of opt-in testing: a saved run report, or why a report could not be stored. */
export function TestReportNotices() {
  useEvent("test-report", (report) => {
    if (report.path !== null) {
      toast({ title: "Test report saved", description: report.path, tone: "success" }, { timeout: 10_000 });
    } else if (report.reason === "flow") {
      toast({ title: "Could not keep the reported flow", description: `${report.error} Its samples were discarded.`, tone: "danger" });
    } else {
      toast({ title: "Could not save test report", description: `${report.error} The reported samples were kept locally.`, tone: "danger" });
    }
  });
  return null;
}
