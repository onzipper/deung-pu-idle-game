import { describe, it, expect } from "vitest";
import {
  CONFIG,
  SAVE_VERSION,
  FIXED_DT,
  hallOfFame,
  initGameState,
  migrate,
  step,
  toSaveData,
} from "@/engine";
import { soloSave, forceBoss, runUntil } from "./helpers";

/**
 * M7.95 "Hall of Fame" (engine/SAVE wave): three write-only, deterministic
 * observers — lifetime `goldEarned`, best boss-clear `bossBest`, and the
 * `levelCapAt` tiebreaker. They watch `step()` and never feed back into gameplay.
 */

// ---------------------------------------------------------------------------
// goldEarned — lifetime, spend-proof
// ---------------------------------------------------------------------------
describe("goldEarned (lifetime gold, M7.95)", () => {
  it("starts at 0 on a fresh state and rises in lockstep with farm-kill gold", () => {
    const s = initGameState(1, soloSave("mage", 3));
    expect(s.goldEarned).toBe(0);
    // Run a farm long enough to bank several kills.
    s.autoCast = true;
    s.autoAllocate = true;
    runUntil(s, (st) => st.gold > 0, 20_000);
    expect(s.goldEarned).toBeGreaterThan(0);
    // On a fresh character with no spending, earned === current gold.
    expect(s.goldEarned).toBe(s.gold);
  });

  it("a POSITIVE goldCredit (NPC sale) banks both gold and goldEarned", () => {
    const s = initGameState(1, soloSave("archer", 3));
    const gold0 = s.gold;
    step(s, { goldCredit: 500 });
    expect(s.gold).toBe(gold0 + 500);
    expect(s.goldEarned).toBe(500);
  });

  it("SPENDING never decreases goldEarned (negative goldCredit refine cost)", () => {
    const s = initGameState(1, soloSave("archer", 3));
    step(s, { goldCredit: 1000 }); // earn
    expect(s.goldEarned).toBe(1000);
    step(s, { goldCredit: -400 }); // refine cost debit
    expect(s.gold).toBe(600);
    expect(s.goldEarned).toBe(1000); // untouched
  });

  it("a town potion purchase spends gold but leaves goldEarned intact", () => {
    const s = initGameState(1, soloSave("swordsman", 3));
    step(s, { goldCredit: 100_000 });
    const earned = s.goldEarned;
    // Place the hero in town (map1 idx 0) so the NPC shop is reachable, then buy.
    s.location = { mapId: "map1", zoneIdx: 0 };
    const gold0 = s.gold;
    step(s, { buyShopItem: { item: "hpPotion", qty: 1 } });
    expect(s.gold).toBeLessThan(gold0); // spent
    expect(s.goldEarned).toBe(earned); // never rises on a spend
  });

  it("a boss reward credits goldEarned", () => {
    const s = initGameState(1, soloSave("mage", 5));
    forceBoss(s);
    s.bossFightStart = s.time; // mirror startBossFight for the direct-kill path
    const earned0 = s.goldEarned;
    s.boss!.hp = 0;
    step(s, {}); // onBossKilled
    expect(s.phase).toBe("victory");
    expect(s.goldEarned).toBe(earned0 + CONFIG.goldPerBoss(s.stage));
  });
});

// ---------------------------------------------------------------------------
// bossBest — deterministic durations, fastest kept, unstamped `at`
// ---------------------------------------------------------------------------
describe("bossBest (best boss-clear time, M7.95)", () => {
  /** Walk into map1's boss room via the REAL flow (stamps bossFightStart), fight. */
  function reachBossRoom(seed: number) {
    const s = initGameState(seed, soloSave("mage", 5));
    s.location = { mapId: "map1", zoneIdx: 5 };
    s.stage = 5;
    s.unlockedZones = { map1: 7 };
    step(s, { walkToZone: { mapId: "map1", zoneIdx: 6 } });
    expect(runUntil(s, (st) => st.phase === "boss", 500)).toBe(true);
    return s;
  }

  it("records a clear when the boss dies, with an UNSTAMPED (0) epoch-ms `at`", () => {
    const s = reachBossRoom(1);
    // The real walk-in path stamped bossFightStart via startBossFight.
    expect(s.bossFightStart).not.toBeNull();
    s.boss!.hp = 0;
    step(s, {});
    expect(s.phase).toBe("victory");
    const best = s.bossBest[5];
    expect(best).toBeDefined();
    expect(best.seconds).toBeGreaterThanOrEqual(0);
    expect(best.at).toBe(0); // unstamped — the save boundary stamps the wall-clock
    // bossFightStart is cleared after the kill.
    expect(s.bossFightStart).toBeNull();
  });

  it("measures the duration by deterministic step counting (state.time delta)", () => {
    const s = reachBossRoom(2);
    // Pretend the fight has been running 3s (deterministic, no wall-clock).
    s.bossFightStart = s.time - 3;
    s.boss!.hp = 0;
    step(s, {});
    // onBossKilled reads state.time BEFORE the end-of-step increment, so seconds = 3.
    expect(s.bossBest[5].seconds).toBeCloseTo(3, 6);
  });

  it("keeps the FASTEST clear per stage (a slower re-clear does not overwrite)", () => {
    const s = initGameState(3, soloSave("mage", 5));
    s.bossBest[5] = { seconds: 4, at: 999 };
    forceBoss(s);
    s.bossFightStart = s.time - 9; // a 9s clear — slower than the 4s record
    s.boss!.hp = 0;
    step(s, {});
    expect(s.bossBest[5]).toEqual({ seconds: 4, at: 999 }); // unchanged
  });

  it("a FASTER clear replaces the record and resets `at` to unstamped", () => {
    const s = initGameState(4, soloSave("mage", 5));
    s.bossBest[5] = { seconds: 8, at: 999 };
    forceBoss(s);
    s.bossFightStart = s.time - 2;
    s.boss!.hp = 0;
    step(s, {});
    expect(s.bossBest[5].seconds).toBeCloseTo(2, 6);
    expect(s.bossBest[5].at).toBe(0);
  });

  it("is keyed by boss stage (a stage-10 clear does not touch stage 5)", () => {
    const s = initGameState(5, soloSave("mage", 10));
    forceBoss(s); // stage 10
    s.bossFightStart = s.time - 5;
    s.boss!.hp = 0;
    step(s, {});
    expect(s.bossBest[10]).toBeDefined();
    expect(s.bossBest[5]).toBeUndefined();
  });

  it("a direct onBossKilled with no fight-start (forceBoss only) records nothing", () => {
    const s = initGameState(6, soloSave("mage", 5));
    forceBoss(s); // does NOT stamp bossFightStart
    expect(s.bossFightStart).toBeNull();
    s.boss!.hp = 0;
    step(s, {});
    expect(s.bossBest[5]).toBeUndefined();
  });
});

// ---------------------------------------------------------------------------
// levelCapAt — first cap crossing, once
// ---------------------------------------------------------------------------
describe("levelCapAt (level-cap tiebreaker, M7.95)", () => {
  it("is null until the hero reaches levelCap, then stamps (0 = unstamped)", () => {
    const s = initGameState(1, soloSave("swordsman", 3));
    expect(s.levelCapAt).toBeNull();
    // Poise the hero one XP shy of the final level, then a kill crosses the cap.
    const h = s.heroes[0];
    h.level = CONFIG.leveling.levelCap - 1;
    h.xp = Math.max(0, CONFIG.leveling.xpToLevel(CONFIG.leveling.levelCap - 1) - 1);
    forceBoss(s);
    s.bossFightStart = s.time;
    s.boss!.hp = 0;
    step(s, {}); // boss XP milestone crosses the cap
    expect(s.heroes[0].level).toBe(CONFIG.leveling.levelCap);
    expect(s.levelCapAt).toBe(0); // reached, unstamped
  });

  it("does not re-stamp once set (idempotent across further XP)", () => {
    const s = initGameState(1, soloSave("mage", 5));
    s.levelCapAt = 1_700_000_000_000; // already stamped by a prior save boundary
    const h = s.heroes[0];
    h.level = CONFIG.leveling.levelCap;
    forceBoss(s);
    s.bossFightStart = s.time;
    s.boss!.hp = 0;
    step(s, {});
    expect(s.levelCapAt).toBe(1_700_000_000_000); // untouched
  });
});

// ---------------------------------------------------------------------------
// hallOfFame() read surface + persistence round-trip
// ---------------------------------------------------------------------------
describe("hallOfFame() selector + persistence (M7.95)", () => {
  it("returns the {goldEarned, bossBest, levelCapAt} shape, deep-copying bossBest", () => {
    const s = initGameState(1, soloSave("archer", 5));
    s.goldEarned = 4242;
    s.bossBest = { 5: { seconds: 12.5, at: 0 } };
    s.levelCapAt = null;
    const hof = hallOfFame(s);
    expect(hof).toEqual({
      goldEarned: 4242,
      bossBest: { 5: { seconds: 12.5, at: 0 } },
      levelCapAt: null,
    });
    // Deep copy: mutating the snapshot must not touch state.
    hof.bossBest[5].seconds = 1;
    expect(s.bossBest[5].seconds).toBe(12.5);
  });

  it("round-trips goldEarned / bossBest / levelCapAt through toSaveData -> initGameState", () => {
    const s = initGameState(9, soloSave("mage", 5));
    s.goldEarned = 98_765;
    s.bossBest = { 5: { seconds: 10, at: 111 }, 10: { seconds: 20, at: 0 } };
    s.levelCapAt = 1_699_999_999_000;
    const restored = initGameState(9, toSaveData(s));
    expect(restored.goldEarned).toBe(98_765);
    expect(restored.bossBest).toEqual(s.bossBest);
    expect(restored.levelCapAt).toBe(1_699_999_999_000);
    // bossFightStart is transient — never persisted, always null on boot.
    expect(restored.bossFightStart).toBeNull();
    expect("bossFightStart" in toSaveData(s)).toBe(false);
  });
});

// ---------------------------------------------------------------------------
// Migration v14/v15 -> v16
// ---------------------------------------------------------------------------
describe("SAVE v16 migration (M7.95)", () => {
  const rawHero = (cls: "swordsman" | "archer" | "mage" = "swordsman") => ({
    cls,
    level: 5,
    xp: 0,
    tier: 1 as const,
    statPoints: 0,
    stats: { ...CONFIG.stats.base[cls] },
    mana: 50,
    autoSlots: [null, null, null],
    quest: null,
  });

  it("SAVE_VERSION is 19", () => {
    expect(SAVE_VERSION).toBe(19);
  });

  it("v14 -> v16: goldEarned 0 (not fabricated from gold), empty bossBest, null levelCapAt", () => {
    const m = migrate({ version: 14, stage: 3, gold: 5000, hero: rawHero(), lastSeen: 0 });
    expect(m.version).toBe(SAVE_VERSION);
    expect(m.goldEarned).toBe(0); // retroactive earned totals are unknowable
    expect(m.bossBest).toEqual({});
    expect(m.levelCapAt).toBeNull();
  });

  it("v15 -> v16: same HOF backfill (0 / {} / null)", () => {
    const m = migrate({ version: 15, stage: 8, gold: 12_000, hero: rawHero("mage"), lastSeen: 0 });
    expect(m.version).toBe(SAVE_VERSION);
    expect(m.goldEarned).toBe(0);
    expect(m.bossBest).toEqual({});
    expect(m.levelCapAt).toBeNull();
  });

  it("preserves a v16 save's HOF values and is idempotent (migrate-on-every-save)", () => {
    const once = migrate({
      version: 16,
      stage: 10,
      gold: 3000,
      goldEarned: 250_000,
      bossBest: { 5: { seconds: 14, at: 1_700_000_000_000 }, 10: { seconds: 22, at: 0 } },
      levelCapAt: 1_700_000_000_500,
      hero: rawHero("archer"),
      lastSeen: 0,
    });
    expect(once.goldEarned).toBe(250_000);
    expect(once.bossBest).toEqual({
      5: { seconds: 14, at: 1_700_000_000_000 },
      10: { seconds: 22, at: 0 },
    });
    expect(once.levelCapAt).toBe(1_700_000_000_500);
    expect(migrate(once as never)).toEqual(once);
  });

  it("drops malformed bossBest entries and clamps a bad levelCapAt to null", () => {
    const m = migrate({
      version: 16,
      stage: 5,
      gold: 0,
      goldEarned: -50, // floored to 0
      bossBest: {
        5: { seconds: 9, at: 5 }, // kept
        bad: { seconds: 3, at: 0 }, // non-numeric stage key -> dropped
        10: { seconds: -1, at: 0 }, // negative seconds -> dropped
        15: { seconds: 7, at: -3 }, // bad `at` -> coerced to 0
      } as never,
      levelCapAt: "nope" as never,
      hero: rawHero(),
      lastSeen: 0,
    });
    expect(m.goldEarned).toBe(0);
    expect(m.bossBest).toEqual({ 5: { seconds: 9, at: 5 }, 15: { seconds: 7, at: 0 } });
    expect(m.levelCapAt).toBeNull();
  });
});

// FIXED_DT is imported to document that durations are steps × FIXED_DT.
void FIXED_DT;
