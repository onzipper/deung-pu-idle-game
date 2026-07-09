"use client";

/**
 * R2-W1 "sweep แผงตาม mockup" — a row of `Tab`s sharing one active id, the
 * strip pattern every panel with sub-sections uses (inventory slot tabs, shop
 * buy/sell/buyback, …). Presentational only: caller owns the active-id state
 * and receives `onChange`; this component never reads the store.
 *
 * Generic over the tab id type so callers keep their own string-literal union
 * (`GearSlot`, `"buy" | "sell" | "buyback"`, …) instead of a bare `string`.
 */

import type { ReactNode } from "react";
import { Tab } from "@/ui/components/primitives/Tab";

export interface TabRowItem<T extends string> {
  id: T;
  label: ReactNode;
  icon?: ReactNode;
  disabled?: boolean;
}

export interface TabRowProps<T extends string> {
  tabs: readonly TabRowItem<T>[];
  active: T;
  onChange: (id: T) => void;
  className?: string;
}

export function TabRow<T extends string>({ tabs, active, onChange, className = "" }: TabRowProps<T>) {
  return (
    <div role="tablist" className={`flex items-center gap-1.5 ${className}`}>
      {tabs.map((tab) => (
        <Tab
          key={tab.id}
          active={active === tab.id}
          icon={tab.icon}
          disabled={tab.disabled}
          onClick={() => onChange(tab.id)}
        >
          {tab.label}
        </Tab>
      ))}
    </div>
  );
}
