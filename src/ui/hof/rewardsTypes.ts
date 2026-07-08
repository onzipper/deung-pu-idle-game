/**
 * HOF seasonal rewards — wire types for `GET /api/hof/rewards`, `POST
 * /api/hof/claim`, `POST /api/hof/title` (owner-approved
 * docs/hof-rewards-design.md; server contract in `src/server/hofSeason.ts`).
 * Redeclared here rather than imported from server code, same convention as
 * `ui/hof/types.ts` (the legacy `/api/hof` leaderboard route)/`ui/gear/types.ts`.
 */

import type { HofRewardBoard } from "./titles";

export interface HofChampionRow {
  rank: number;
  charName: string;
  cls: string;
  value: number;
  titleId: string;
}

export interface HofMyTitle {
  titleId: string;
  board: string;
  rank: number;
  charName: string;
}

export interface HofUnclaimedAward {
  awardId: string;
  board: string;
  titleId: string;
}

export interface HofBadgeRow {
  titleId: string;
  board: string;
  rank: number;
  month: string;
  charName: string;
}

export interface HofRewardsWire {
  season: string | null;
  champions: Record<HofRewardBoard, HofChampionRow[]>;
  me: {
    titles: HofMyTitle[];
    displayTitle: string | null;
    unclaimedAwards: HofUnclaimedAward[];
  } | null;
  badges: HofBadgeRow[] | null;
}
