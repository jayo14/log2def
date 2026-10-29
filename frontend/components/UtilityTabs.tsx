'use client';

import React from 'react';

export interface UtilityTabItem {
  key: string;
  label: string;
  /** Material Symbols ligature name. */
  icon: string;
  /** Optional accessible name; used to surface counts without widening the strip. */
  ariaLabel?: string;
}

interface UtilityTabsProps {
  ariaLabel: string;
  items: UtilityTabItem[];
  /** Currently active utility key, or null when a primary tab is active. */
  activeKey: string | null;
  onSelect: (item: UtilityTabItem) => void;
  /**
   * 'dashboard' emdash styled by `.seg.tools` in dashboard.css (the mobile app shell).
   * 'workspace' emdash Tailwind variant matching the projects workspace sub-header tabs.
   */
  variant?: 'dashboard' | 'workspace';
}

/**
 * Compact secondary-action strip (versions, export, voice tools...).
 * Keeps primary tab labels readable on small screens instead of squeezing
 * five labels into one segmented control.
 */
export default function UtilityTabs({
  ariaLabel,
  items,
  activeKey,
  onSelect,
  variant = 'dashboard',
}: UtilityTabsProps) {
  if (variant === 'workspace') {
    return (
      <div className="flex items-center gap-1.5 mt-2" role="tablist" aria-label={ariaLabel}>
        {items.map((item) => {
          const selected = activeKey === item.key;
          return (
            <button
              key={item.key}
              role="tab"
              type="button"
              aria-selected={selected}
              aria-label={item.ariaLabel}
              onClick={() => onSelect(item)}
              className={`flex items-center gap-1.5 px-3 py-1.5 rounded-lg text-xs font-medium transition-colors shrink-0 focus-visible:ring-2 focus-visible:ring-emerald-700 focus-visible:outline-none cursor-pointer border ${
                selected
                  ? 'bg-emerald-800 text-white border-transparent font-semibold shadow-sm'
                  : 'bg-white border-border text-muted-foreground hover:text-foreground hover:bg-muted'
              }`}
            >
              <span
                className="material-symbols-rounded shrink-0 select-none"
                style={{ fontSize: '15px' }}
                aria-hidden="true"
              >
                {item.icon}
              </span>
              {item.label}
            </button>
          );
        })}
      </div>
    );
  }

  return (
    <div className="seg tools" role="tablist" aria-label={ariaLabel}>
      {items.map((item) => (
        <button
          key={item.key}
          role="tab"
          type="button"
          aria-selected={activeKey === item.key}
          aria-label={item.ariaLabel}
          onClick={() => onSelect(item)}
        >
          <span className="ms" aria-hidden="true">
            {item.icon}
          </span>
          {item.label}
        </button>
      ))}
    </div>
  );
}
