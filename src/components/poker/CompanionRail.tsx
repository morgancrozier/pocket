"use client";

import { useEffect, useState, type ReactNode } from "react";

interface CompanionRailProps {
  statusLabel: string;
  recommendationLabel: string;
  children: ReactNode;
}

export function CompanionRail({
  statusLabel,
  recommendationLabel,
  children,
}: CompanionRailProps) {
  const [isOpen, setIsOpen] = useState(false);
  const [isCompact, setIsCompact] = useState(false);

  useEffect(() => {
    const media = window.matchMedia("(max-width: 1180px)");
    const update = () => {
      setIsCompact(media.matches);
      if (!media.matches) setIsOpen(false);
    };
    update();
    media.addEventListener("change", update);
    return () => media.removeEventListener("change", update);
  }, []);

  useEffect(() => {
    if (!isOpen) return;
    const closeOnEscape = (event: KeyboardEvent) => {
      if (event.key === "Escape") setIsOpen(false);
    };
    window.addEventListener("keydown", closeOnEscape);
    return () => window.removeEventListener("keydown", closeOnEscape);
  }, [isOpen]);

  return (
    <>
      <button
        className="companion-rail-toggle"
        type="button"
        aria-hidden={!isCompact}
        tabIndex={isCompact ? 0 : -1}
        aria-expanded={isOpen}
        aria-controls="pocket-companion-rail"
        onClick={() => setIsOpen(true)}
      >
        <span className="status-dot" />
        <span>
          <strong>{recommendationLabel}</strong>
          <small>{statusLabel}</small>
        </span>
        <span aria-hidden="true">↑</span>
      </button>

      {isOpen ? (
        <button
          className="companion-rail-scrim"
          type="button"
          aria-label="Close private copilot panel"
          onClick={() => setIsOpen(false)}
        />
      ) : null}

      <aside
        id="pocket-companion-rail"
        className={`companion-rail ${isOpen ? "is-open" : ""}`}
        aria-label="Private copilot and current hand"
        aria-hidden={isCompact && !isOpen}
        inert={isCompact && !isOpen}
      >
        <div className="companion-rail-mobile-header">
          <span>Private copilot</span>
          <button
            type="button"
            aria-label="Close private copilot panel"
            autoFocus={isOpen}
            onClick={() => setIsOpen(false)}
          >
            ×
          </button>
        </div>
        {children}
      </aside>
    </>
  );
}
