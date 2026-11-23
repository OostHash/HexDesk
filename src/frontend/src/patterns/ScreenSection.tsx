import { useId, type ReactNode } from "react";
import { cn } from "../primitives/cn";

type Props = {
  title: ReactNode;
  /** Controls on the right of the header (tabs, buttons). */
  actions?: ReactNode;
  className?: string;
  children: ReactNode;
};

/** A titled section of a screen with a sticky header. The section is a labelled region. */
export function ScreenSection({ title, actions, className, children }: Props) {
  const id = useId();
  return (
    <section aria-labelledby={id} className={cn("flex flex-col", className)}>
      <header className="sticky top-0 z-(--hex-z-sticky) flex min-h-10 items-center gap-3 border-b border-border bg-bg/95 px-4 py-2 backdrop-blur-sm lg:px-6">
        <h2 id={id} className="text-xs font-semibold tracking-wide text-muted uppercase">
          {title}
        </h2>
        {actions && <div className="ms-auto flex items-center gap-2">{actions}</div>}
      </header>
      <div className="p-4 lg:p-6">{children}</div>
    </section>
  );
}
