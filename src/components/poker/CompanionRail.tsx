"use client";

import { useEffect, useRef, useState, type ReactNode } from "react";

const COMPACT_RAIL_QUERY = "(max-width: 899px)";
const FOCUSABLE_SELECTOR =
  'button:not([disabled]), a[href], input:not([disabled]), select:not([disabled]), textarea:not([disabled]), [tabindex]:not([tabindex="-1"])';

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
  const toggleRef = useRef<HTMLButtonElement>(null);
  const railRef = useRef<HTMLElement>(null);

  useEffect(() => {
    const media = window.matchMedia(COMPACT_RAIL_QUERY);
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
    const rail = railRef.current;
    if (!rail) return;

    const previousOverflow = document.body.style.overflow;
    document.body.style.overflow = "hidden";
    const focusableElements = () =>
      Array.from(rail.querySelectorAll<HTMLElement>(FOCUSABLE_SELECTOR)).filter(
        (element) => element.tabIndex >= 0,
      );
    const focusFrame = window.requestAnimationFrame(() => {
      focusableElements()[0]?.focus();
    });

    const handleKeyDown = (event: KeyboardEvent) => {
      if (rail.querySelector('[role="dialog"][aria-modal="true"]')) return;
      if (event.key === "Escape") {
        event.preventDefault();
        setIsOpen(false);
        return;
      }
      if (event.key !== "Tab") return;

      const elements = focusableElements();
      const first = elements[0];
      const last = elements.at(-1);
      if (!first || !last) {
        event.preventDefault();
        return;
      }
      if (event.shiftKey && document.activeElement === first) {
        event.preventDefault();
        last.focus();
      } else if (!event.shiftKey && document.activeElement === last) {
        event.preventDefault();
        first.focus();
      }
    };
    window.addEventListener("keydown", handleKeyDown);
    return () => {
      window.cancelAnimationFrame(focusFrame);
      window.removeEventListener("keydown", handleKeyDown);
      document.body.style.overflow = previousOverflow;
      if (window.matchMedia(COMPACT_RAIL_QUERY).matches) {
        window.requestAnimationFrame(() => toggleRef.current?.focus());
      }
    };
  }, [isOpen]);

  return (
    <>
      <button
        ref={toggleRef}
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
        <svg aria-hidden="true" focusable="false" viewBox="0 0 20 20">
          <path d="M5 12.5 10 7.5l5 5" />
        </svg>
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
        ref={railRef}
        id="pocket-companion-rail"
        className={`companion-rail ${isOpen ? "is-open" : ""}`}
        role={isCompact ? "dialog" : undefined}
        aria-modal={isCompact && isOpen ? true : undefined}
        aria-label="Private copilot and current hand"
        aria-hidden={isCompact && !isOpen}
        inert={isCompact && !isOpen}
      >
        <div className="companion-rail-mobile-header">
          <span>Private copilot</span>
          <button
            type="button"
            aria-label="Close private copilot panel"
            onClick={() => setIsOpen(false)}
          >
            <svg aria-hidden="true" focusable="false" viewBox="0 0 20 20">
              <path d="m6 6 8 8M14 6l-8 8" />
            </svg>
          </button>
        </div>
        {children}
      </aside>
    </>
  );
}
