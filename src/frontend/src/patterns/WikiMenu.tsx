import { Copy, EllipsisVertical, ExternalLink } from "lucide-react";
import { Menu } from "../primitives/actions";
import { toast } from "../primitives/overlay";

type Props = {
  /** Item name, for the trigger's accessible name ("More for Soma"). */
  name: string;
  url: string;
  /** Opens the link outside the app (api/links `openExternal`). */
  onOpen: (url: string) => void;
  /** Controlled open state, so a right-click on the row can open the menu. */
  open?: boolean;
  onOpenChange?: (open: boolean) => void;
};

/** ⋮ menu per item: open the wiki page or copy its link. Reachable by keyboard. */
export function WikiMenu({ name, url, onOpen, open, onOpenChange }: Props) {
  return (
    <Menu
      trigger={<EllipsisVertical aria-hidden="true" className="size-4" />}
      triggerLabel={`More for ${name}`}
      triggerVariant="ghost"
      triggerSize="sm"
      {...(open === undefined ? {} : { open })}
      {...(onOpenChange ? { onOpenChange } : {})}
      items={[
        {
          id: "wiki",
          label: "Open wiki",
          icon: ExternalLink,
          onAction: () => {
            onOpen(url);
          },
        },
        {
          id: "copy",
          label: "Copy wiki link",
          icon: Copy,
          onAction: () => {
            navigator.clipboard
              .writeText(url)
              .then(() => toast({ title: "Wiki link copied", tone: "success" }))
              .catch(() => toast({ title: "Could not copy the link", tone: "danger" }));
          },
        },
      ]}
    />
  );
}
