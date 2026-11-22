import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { invoke } from "./invoke";

/** Opt-in testing reports: the reported flows that wait for an export, and the export itself. */

const flowsKey = ["testing", "flows"] as const;

/** How many reported flows wait for an export; refetched on test-report-flows. */
export const useTestReportFlows = () => useQuery({ queryKey: flowsKey, queryFn: () => invoke("test_report_flows"), staleTime: Infinity }).data ?? 0;

/** Writes every reported flow into one zip in Downloads; resolves to its path. */
export function useExportTestReport() {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: () => invoke("export_test_report"),
    onSettled: () => queryClient.invalidateQueries({ queryKey: flowsKey }),
  });
}

/** Removes every reported flow without writing a report. */
export function useDiscardTestReport() {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: () => invoke("discard_test_report"),
    onSettled: () => queryClient.invalidateQueries({ queryKey: flowsKey }),
  });
}
