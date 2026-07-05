import { Kanit } from "next/font/google";

/**
 * M6.5 art-direction prototype — Kanit as the body-copy face, loaded via
 * `next/font/google` SCOPED TO THIS ROUTE ONLY (a nested layout, not the root
 * one — see `src/app/layout.tsx`, which is off-limits while other agents are
 * mid-surgery elsewhere in the tree). The header/display face (Chakra Petch)
 * is already loaded app-wide by the root layout as `--font-display`, so it's
 * reused as-is here with zero extra work.
 */
const kanit = Kanit({
  variable: "--font-proto-kanit",
  subsets: ["latin", "thai"],
  weight: ["400", "500", "600"],
});

export default function ProtoLayout({ children }: { children: React.ReactNode }) {
  return (
    <div className={kanit.variable}>
      <style>{`.proto-kanit { font-family: var(--font-proto-kanit), "Noto Sans Thai", sans-serif; }`}</style>
      {children}
    </div>
  );
}
