import { Check, CircleDashed, FileText, Skull } from "lucide-react";
import { ITEM_STATUS_LABEL, type ItemStatus } from "../../domain/completionist";
import { Badge, domainTone } from "../../primitives/display";

/** Completion status as icon + text, never as a symbol alone. */
export function StatusBadge({ status }: { status: ItemStatus }) {
  const label = ITEM_STATUS_LABEL[status];
  switch (status) {
    case "complete":
      return (
        <Badge tone="success" icon={Check}>
          {label}
        </Badge>
      );
    case "blueprint":
      return (
        <Badge tone="warning" icon={FileText}>
          {label}
        </Badge>
      );
    case "subsumed":
      return (
        <Badge tone="domain" style={domainTone("state-void")} icon={Skull}>
          {label}
        </Badge>
      );
    case "none":
      return (
        <Badge tone="neutral" icon={CircleDashed}>
          {label}
        </Badge>
      );
  }
}
