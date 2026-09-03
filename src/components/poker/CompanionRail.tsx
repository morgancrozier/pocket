import type { ReactNode } from "react";

interface CompanionRailProps {
  children: ReactNode;
}

export function CompanionRail({ children }: CompanionRailProps) {
  return (
    <aside
      id="pocket-companion-rail"
      className="companion-rail"
      aria-label="Current hand history"
    >
      {children}
    </aside>
  );
}
