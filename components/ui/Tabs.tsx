"use client";

import * as React from "react";

export interface TabItem {
  id: string;
  label: string;
  content: React.ReactNode;
}

/**
 * Keyboard-navigable tabs (WAI-ARIA tab pattern, arrow-key support).
 */
export function Tabs({
  tabs,
  defaultTab,
  className = "",
}: {
  tabs: TabItem[];
  defaultTab?: string;
  className?: string;
}) {
  const [activeId, setActiveId] = React.useState(
    defaultTab ?? tabs[0]?.id ?? ""
  );
  const tabRefs = React.useRef<Record<string, HTMLButtonElement | null>>({});

  const onKeyDown = (e: React.KeyboardEvent, index: number) => {
    let next: number | null = null;
    if (e.key === "ArrowRight") next = (index + 1) % tabs.length;
    else if (e.key === "ArrowLeft")
      next = (index - 1 + tabs.length) % tabs.length;
    else if (e.key === "Home") next = 0;
    else if (e.key === "End") next = tabs.length - 1;
    if (next !== null) {
      e.preventDefault();
      const tab = tabs[next];
      setActiveId(tab.id);
      tabRefs.current[tab.id]?.focus();
    }
  };

  const active = tabs.find((tab) => tab.id === activeId);

  return (
    <div className={className}>
      <div
        role="tablist"
        aria-label="Abas"
        className="flex gap-1 overflow-x-auto border-b border-ink-100"
      >
        {tabs.map((tab, index) => {
          const selected = tab.id === activeId;
          return (
            <button
              key={tab.id}
              ref={(el) => {
                tabRefs.current[tab.id] = el;
              }}
              role="tab"
              id={`tab-${tab.id}`}
              aria-selected={selected}
              aria-controls={`panel-${tab.id}`}
              tabIndex={selected ? 0 : -1}
              onClick={() => setActiveId(tab.id)}
              onKeyDown={(e) => onKeyDown(e, index)}
              className={`whitespace-nowrap border-b-2 px-4 py-2.5 text-sm font-medium transition-colors ${
                selected
                  ? "border-gold-500 text-navy-900"
                  : "border-transparent text-ink-500 hover:border-ink-100 hover:text-ink-900"
              }`}
            >
              {tab.label}
            </button>
          );
        })}
      </div>
      {active && (
        <div
          role="tabpanel"
          id={`panel-${active.id}`}
          aria-labelledby={`tab-${active.id}`}
          tabIndex={0}
          className="pt-4"
        >
          {active.content}
        </div>
      )}
    </div>
  );
}
