/**
 * Balance-simulation harness (headless) — M6 WORLD rebaseline tool.
 *
 * M6 "World & Town" regrouped the per-stage content into MAPS of walkable ZONES
 * (farm zones + a boss room). Progression is now WALKING the world: farm a zone to
 * its kill quota (which unlocks the next zone + grants the old per-stage boss
 * reward), walk forward, and enter the map's boss room; beating it unlocks the next
 * map. Combat inside a zone is unchanged (driven by the zone's stage), so this
 * harness runs the pure engine with an idle-player WORLD autopilot per base class
 * and reports per-zone (stage-keyed) time-to-clear so pacing (~unchanged, no new
 * walls, negligible transit) can be verified.
 *
 * Autopilot: auto-cast + auto-allocate + auto-return ON; accept the class-change
 * quest when offered; evolve when it completes; fill auto-slots as skills unlock;
 * walk forward on unlock; enter the boss room; advance to the next map on a
 * boss-room victory. Death -> town -> auto-return is engine behaviour.
 *
 * Run with: `pnpm sim`
 * Knobs (env): SIM_SECONDS, SEEDS, CLASSES (see below).
 */

import {
  initGameState,
  step,
  canEvolveHero,
  isClassChangeQuestOffered,
  learnedSkills,
  unlockedAutoSlotCount,
  worldNav,
  zoneAt,
  SIGNATURE_SKILL,
  ITEM_TEMPLATES,
  SAVE_VERSION,
  FIXED_DT,
  type FrameInput,
  type Hero,
  type GameState,
  type HeroClass,
  type SaveData,
  type ItemTemplate,
} from "@/engine";

const SIM_SECONDS = Number(process.env.SIM_SECONDS ?? 1800);
const STEPS = Math.round(SIM_SECONDS / FIXED_DT);
const SEEDS = (process.env.SEEDS ?? "1,2,3,42,1337")
  .split(",")
  .map((s) => Number(s.trim()))
  .filter((n) => Number.isFinite(n));
const CLASSES: HeroClass[] = (process.env.CLASSES ?? "swordsman,archer,mage")
  .split(",")
  .map((s) => s.trim())
  .filter((s): s is HeroClass => s === "swordsman" || s === "archer" || s === "mage");
// GEAR=1 → the autopilot auto-equips the best-for-class drop it sees (M7 drop-
// equilibrium run). Default (unset) → drops are ignored (NO-GEAR run: must match
// the balance-m6 tables, since unarmored combat is byte-identical to pre-M7).
const GEAR = process.env.GEAR === "1";

// ---------------------------------------------------------------------------
// Per-run metrics — keyed by the zone's STAGE (each farm zone / boss room owns one).
// ---------------------------------------------------------------------------

interface ZoneMetric {
  stage: number;
  mapId: string;
  kind: "farm" | "boss";
  enterTime: number;
  /** Time the zone was CLEARED: farm = its quota met (next unlocked); boss = beaten. */
  clearTime: number | null;
  deaths: number;
  bossAttempts: number;
  bossWipes: number;
  levelAtClear: number;
}

interface SeedResult {
  cls: HeroClass;
  seed: number;
  finalStage: number;
  finalLevel: number;
  finalMap: string;
  evolveStage: number | null;
  totalDeaths: number;
  totalWipes: number;
  zones: ZoneMetric[];
  /** M7: total drops rolled + the final equipped loadout (GEAR run). */
  drops: number;
  finalWeapon: string | null;
  finalArmor: string | null;
  /** M7.7: potions actually consumed (auto-use) over the run — the mana-sink check. */
  hpPotionsUsed: number;
  manaPotionsUsed: number;
}

function makeSave(cls: HeroClass, seed: number): SaveData {
  // A cold-start save at stage 1 (first farm zone). Built directly; the world
  // fields are what initGameState fills for a fresh start, mirrored here.
  return {
    version: SAVE_VERSION,
    stage: 1,
    gold: 0,
    zoneKills: {},
    location: { mapId: "map1", zoneIdx: 1 },
    unlockedZones: { map1: 2 },
    lastFarmZone: { mapId: "map1", zoneIdx: 1 },
    consumables: { hpPotion: 0, manaPotion: 0, returnScroll: 0 },
    // M7.5: idle bots OFF by default (baseline parity — the sim never trips them).
    bot: {
      enabled: false,
      sellTripEnabled: false,
      hpPotionTarget: 15,
      mpPotionTarget: 15,
      scrollReserve: 3,
      goldReserve: 0,
    },
    // M6.6: auto-hunt ON by default (baseline parity — the sim never toggles it).
    autoHunt: true,
    // M7: cold start owns no gear; deterministic salt + zero counter.
    equipped: { weapon: null, armor: null },
    lootSalt: (seed * 2654435761) >>> 0,
    lootCounter: 0,
    // M7.6 ตีบวก: cold start holds no refine materials.
    materials: 0,
    hero: {
      cls,
      level: 1,
      xp: 0,
      tier: 1,
      statPoints: 0,
      stats: { ...baseStatsOf(cls) },
      mana: 60,
      autoSlots: [SIGNATURE_SKILL[cls], null, null],
      quest: null,
    },
    lastSeen: 0,
  };
}

function baseStatsOf(cls: HeroClass) {
  // Kept minimal to avoid importing CONFIG here — the engine re-derives stats on
  // load, and initGameState clamps; these are the RO-flavour class bases.
  return cls === "swordsman"
    ? { str: 8, dex: 4, int: 3, vit: 6 }
    : cls === "archer"
      ? { str: 4, dex: 8, int: 3, vit: 5 }
      : { str: 3, dex: 4, int: 8, vit: 4 };
}

/** Idle-player auto-slot fill (unchanged from the M5 harness). */
function fillAutoSlots(hero: Hero): { slot: number; skillId: string | null }[] {
  const unlocked = unlockedAutoSlotCount(hero.level);
  const learned = learnedSkills(hero).map((s) => s.id);
  const slotted = new Set(hero.autoSlots.filter((id): id is string => id !== null));
  const out: { slot: number; skillId: string | null }[] = [];
  for (let i = 0; i < unlocked && i < hero.autoSlots.length; i++) {
    if (hero.autoSlots[i]) continue;
    const next = learned.find((id) => !slotted.has(id));
    if (!next) break;
    out.push({ slot: i, skillId: next });
    slotted.add(next);
  }
  return out;
}

/**
 * World navigation autopilot: walk forward once the current farm zone's quota is
 * met (bossReady) and the next zone is unlocked, enter the boss room, and walk to
 * the next map on a boss-room victory. Between failed boss-room attempts the death
 * -> town -> auto-return loop farms the last zone, so a real "grind + retry" cadence
 * emerges without special-casing it here.
 */
function navInput(s: GameState): Partial<FrameInput> {
  if (s.traveling) return {};
  const nav = worldNav(s);
  const walkRight = (): Partial<FrameInput> =>
    nav.right?.unlocked
      ? { walkToZone: { mapId: nav.right.zone.mapId, zoneIdx: nav.right.zone.zoneIdx } }
      : {};
  if (s.phase === "victory") return walkRight();
  const kind = nav.current.kind;
  if (kind === "town") return walkRight();
  if (kind === "boss") return {};
  // Move forward on the next zone's UNLOCK (bossReady arms only at the
  // boss-gate zone since 2026-07-07); walkRight no-ops while locked.
  return walkRight();
}

/**
 * Idle-player SHOP autopilot (M6): the ONLY moment the world autopilot passes
 * through town is a death respawn (auto-return pops to town then walks back), so
 * restock potions with surplus gold in that town step — a deterministic "buy on
 * pass-through" rule. Gold is otherwise unused, so spend freely to a target stack;
 * `buyShopItem` is partial (buys as many as gold + stack room allow). One item type
 * per visit (one intent/step); frequent frontier deaths top both over time.
 */
/**
 * M7 gear autopilot (GEAR=1): the hero "owns" whatever drops (the server would
 * mint it) and wears the best-scoring class-compatible item per slot. Weapon score
 * = atk; armor score = def·4 + hp (a rough survivability blend). Desired loadout is
 * the best owned item seen so far; the loop equips toward it one slot per step.
 */
function gearCompatible(t: ItemTemplate, cls: HeroClass): boolean {
  return t.classReq === null || t.classReq === cls;
}
function gearScore(t: ItemTemplate): number {
  return t.slot === "weapon"
    ? (t.stats.atk ?? 0)
    : (t.stats.def ?? 0) * 4 + (t.stats.hp ?? 0);
}
interface OwnedBest {
  weapon: string | null;
  armor: string | null;
}
function considerDrop(best: OwnedBest, templateId: string, cls: HeroClass): void {
  const t = ITEM_TEMPLATES[templateId];
  if (!t || !gearCompatible(t, cls)) return;
  const cur = best[t.slot];
  if (!cur || gearScore(t) > gearScore(ITEM_TEMPLATES[cur])) best[t.slot] = t.id;
}

const RESTOCK_TARGET = 15;
function shopInput(s: GameState): Partial<FrameInput> {
  if (zoneAt(s.location).kind !== "town") return {};
  const hp = s.consumables.hpPotion;
  const mana = s.consumables.manaPotion;
  // Restock the LOWER-stock potion first (one intent/step, short town dwell). Over
  // repeated town passes both converge to the target — so BOTH sinks are exercised for
  // every class (the old hp-first rule starved mana restock on high-death classes).
  const buyHp = (): Partial<FrameInput> => ({
    buyShopItem: { item: "hpPotion", qty: RESTOCK_TARGET - hp },
  });
  const buyMana = (): Partial<FrameInput> => ({
    buyShopItem: { item: "manaPotion", qty: RESTOCK_TARGET - mana },
  });
  // Keep a minimum mana reserve so the mana-sink mechanic is always exercised (a
  // high-death class otherwise spends every town step on hp and never holds a mana
  // potion to auto-use). A real player sets both targets / runs the M7.5 restock bot.
  if (mana < 4) return buyMana();
  if (hp <= mana) {
    if (hp < RESTOCK_TARGET) return buyHp();
    if (mana < RESTOCK_TARGET) return buyMana();
  } else {
    if (mana < RESTOCK_TARGET) return buyMana();
    if (hp < RESTOCK_TARGET) return buyHp();
  }
  return {};
}

function runSeed(cls: HeroClass, seed: number): SeedResult {
  const s = initGameState(seed, makeSave(cls, seed));
  s.autoCast = true;
  s.autoAllocate = true;
  s.autoReturn = true;
  // Auto-use potions at the config defaults (initGameState already seeds these ON
  // with the 35%/25% thresholds) — the idle sustain feature under test.

  const zones: ZoneMetric[] = [];
  const byKey = new Map<string, ZoneMetric>();
  const key = (mapId: string, stage: number, kind: string): string => `${mapId}:${stage}:${kind}`;

  let cur: ZoneMetric = freshZone(s);
  byKey.set(key(cur.mapId, cur.stage, cur.kind), cur);
  zones.push(cur);

  let prevPhase = s.phase;
  let prevDead = s.heroes[0].dead;
  let prevTier = s.heroes[0].tier;
  let evolveStage: number | null = null;
  let totalDeaths = 0;
  let totalWipes = 0;
  const bestOwned: OwnedBest = { weapon: null, armor: null };
  let drops = 0;
  let hpPotionsUsed = 0;
  let manaPotionsUsed = 0;

  for (let i = 0; i < STEPS; i++) {
    const input: FrameInput = { ...navInput(s), ...shopInput(s) };
    if (isClassChangeQuestOffered(s.heroes[0])) input.acceptQuest = 0;
    if (canEvolveHero(s, s.heroes[0])) input.evolveHero = 0;
    const slots = fillAutoSlots(s.heroes[0]);
    if (slots.length) input.setAutoSlots = slots;
    // Equip toward the best owned item (one slot/step). Weapon first, then armor.
    if (GEAR && !input.walkToZone) {
      const eq = s.heroes[0].equipped;
      if (bestOwned.weapon && eq.weapon !== bestOwned.weapon) {
        input.equip = { slot: "weapon", templateId: bestOwned.weapon };
      } else if (bestOwned.armor && eq.armor !== bestOwned.armor) {
        input.equip = { slot: "armor", templateId: bestOwned.armor };
      }
    }

    step(s, input);

    // Zone clear signals (from events, deterministic).
    for (const e of s.events) {
      if (e.type === "itemDrop") {
        drops++;
        if (GEAR) considerDrop(bestOwned, e.templateId, cls);
      }
      if (e.type === "consumableUsed") {
        if (e.item === "hpPotion") hpPotionsUsed++;
        else if (e.item === "manaPotion") manaPotionsUsed++;
      }
      if (e.type === "zoneUnlocked" && cur.kind === "farm" && cur.clearTime === null) {
        cur.clearTime = s.time;
        cur.levelAtClear = s.heroes[0].level;
      }
      if (e.type === "mapUnlocked" && cur.kind === "boss" && cur.clearTime === null) {
        cur.clearTime = s.time;
        cur.levelAtClear = s.heroes[0].level;
      }
      if (e.type === "zoneEntered") {
        const k = key(e.mapId, e.stage, e.kind);
        let zm = byKey.get(k);
        if (!zm && (e.kind === "farm" || e.kind === "boss")) {
          zm = { ...freshZone(s), stage: e.stage, mapId: e.mapId, kind: e.kind, enterTime: s.time };
          byKey.set(k, zm);
          zones.push(zm);
        }
        if (zm && (e.kind === "farm" || e.kind === "boss")) cur = zm;
      }
    }

    // Death edge.
    const nowDead = s.heroes[0].dead;
    if (nowDead && !prevDead) {
      cur.deaths++;
      totalDeaths++;
    }
    // Boss-room attempt / wipe edges.
    if (prevPhase !== s.phase) {
      if (s.phase === "boss") cur.bossAttempts++;
      if (prevPhase === "boss" && s.phase !== "victory") {
        cur.bossWipes++;
        totalWipes++;
      }
    }
    if (prevTier < s.heroes[0].tier) evolveStage = s.stage;

    prevPhase = s.phase;
    prevDead = nowDead;
    prevTier = s.heroes[0].tier;
  }

  return {
    cls,
    seed,
    finalStage: s.stage,
    finalLevel: s.heroes[0].level,
    finalMap: s.location.mapId,
    evolveStage,
    totalDeaths,
    totalWipes,
    zones,
    drops,
    finalWeapon: s.heroes[0].equipped.weapon,
    finalArmor: s.heroes[0].equipped.armor,
    hpPotionsUsed,
    manaPotionsUsed,
  };
}

function freshZone(s: GameState): ZoneMetric {
  const z = zoneAt(s.location);
  return {
    stage: z.stage,
    mapId: z.mapId,
    kind: z.kind === "boss" ? "boss" : "farm",
    enterTime: s.time,
    clearTime: null,
    deaths: 0,
    bossAttempts: 0,
    bossWipes: 0,
    levelAtClear: s.heroes[0].level,
  };
}

// ---------------------------------------------------------------------------
// Aggregation + reporting (per zone, keyed by map:stage).
// ---------------------------------------------------------------------------

const pad = (v: unknown, w: number): string => String(v).padEnd(w);
const mean = (xs: number[]): number => xs.reduce((a, b) => a + b, 0) / xs.length;

interface ZoneAgg {
  mapId: string;
  stage: number;
  kind: "farm" | "boss";
  clears: number;
  meanDur: number | null;
  meanLevel: number | null;
  deaths: number;
  wipes: number;
}

function aggregate(results: SeedResult[]): ZoneAgg[] {
  const keys = new Map<string, { mapId: string; stage: number; kind: "farm" | "boss" }>();
  for (const r of results) {
    for (const z of r.zones) keys.set(`${z.mapId}:${z.stage}:${z.kind}`, z);
  }
  const ordered = [...keys.values()].sort((a, b) => a.stage - b.stage || a.kind.localeCompare(b.kind));
  const out: ZoneAgg[] = [];
  for (const kz of ordered) {
    const all = results.flatMap((r) =>
      r.zones.filter((z) => z.mapId === kz.mapId && z.stage === kz.stage && z.kind === kz.kind),
    );
    const cleared = all.filter((z) => z.clearTime !== null);
    const durs = cleared.map((z) => z.clearTime! - z.enterTime);
    out.push({
      mapId: kz.mapId,
      stage: kz.stage,
      kind: kz.kind,
      clears: cleared.length,
      meanDur: durs.length ? mean(durs) : null,
      meanLevel: cleared.length ? mean(cleared.map((z) => z.levelAtClear)) : null,
      deaths: all.reduce((a, z) => a + z.deaths, 0),
      wipes: all.reduce((a, z) => a + z.bossWipes, 0),
    });
  }
  return out;
}

function printClass(cls: HeroClass, results: SeedResult[], agg: ZoneAgg[]): void {
  const n = results.length;
  console.log(`\n=== ${cls.toUpperCase()} (solo, world) — ${n} seeds ===`);
  console.log(
    "  " +
      pad("zone", 12) +
      pad("kind", 6) +
      pad("clears", 8) +
      pad("meanDur", 9) +
      pad("lvl", 6) +
      pad("deaths", 8) +
      pad("wipes", 7),
  );
  for (const a of agg) {
    console.log(
      "  " +
        pad(`${a.mapId}/s${a.stage}`, 12) +
        pad(a.kind, 6) +
        pad(`${a.clears}/${n}`, 8) +
        pad(a.meanDur === null ? "-" : a.meanDur.toFixed(1), 9) +
        pad(a.meanLevel === null ? "-" : a.meanLevel.toFixed(0), 6) +
        pad(a.deaths, 8) +
        pad(a.wipes, 7),
    );
  }
  console.log(
    `  - reached: ${results.map((r) => `${r.finalMap}/s${r.finalStage}`).join(", ")}`,
  );
  console.log(
    `  - final levels: ${results.map((r) => r.finalLevel).join(",")} | ` +
      `class-change stage: ${results.map((r) => r.evolveStage ?? "-").join(",")} | ` +
      `deaths: ${results.reduce((a, r) => a + r.totalDeaths, 0)} | ` +
      `boss wipes: ${results.reduce((a, r) => a + r.totalWipes, 0)}`,
  );
  // M7.7 mana-sink check: total + per-seed potions consumed (auto-use).
  const hpTot = results.reduce((a, r) => a + r.hpPotionsUsed, 0);
  const mpTot = results.reduce((a, r) => a + r.manaPotionsUsed, 0);
  console.log(
    `  - potions used (${n} seeds): hp ${hpTot} (${(hpTot / n).toFixed(0)}/run) | ` +
      `mana ${mpTot} (${(mpTot / n).toFixed(0)}/run) [per-seed mana: ${results.map((r) => r.manaPotionsUsed).join(",")}]`,
  );
  if (GEAR) {
    console.log(
      `  - drops: ${results.map((r) => r.drops).join(",")} | ` +
        `final gear: ${results.map((r) => `${r.finalWeapon ?? "-"}/${r.finalArmor ?? "-"}`).join(" ")}`,
    );
  }
  // Frontier flag: which zones did NOT clear on every seed (a wall/soft-wall).
  const walls = agg.filter((a) => a.clears < n).map((a) => `${a.mapId}/s${a.stage}(${a.kind})`);
  if (walls.length) console.log(`  - not cleared on every seed (frontier): ${walls.join(", ")}`);
}

function main(): void {
  console.log(
    `[balance-sim ${GEAR ? "M7 GEAR" : "M6 world / M7 no-gear"}] ${SIM_SECONDS}s ` +
      `(${STEPS} steps) per seed, ${SEEDS.length} seeds, classes: ${CLASSES.join("/")}`,
  );
  const byClass = new Map<HeroClass, ZoneAgg[]>();
  for (const cls of CLASSES) {
    const results = SEEDS.map((seed) => runSeed(cls, seed));
    const agg = aggregate(results);
    byClass.set(cls, agg);
    printClass(cls, results, agg);
  }

  // Cross-class farm-zone clear time per stage (pacing comparison).
  console.log(`\n=== FARM-ZONE clear time per stage (mean s) ===`);
  const stages = [...new Set([...byClass.values()].flatMap((a) => a.filter((z) => z.kind === "farm").map((z) => z.stage)))].sort((a, b) => a - b);
  console.log("  " + pad("stage", 6) + CLASSES.map((c) => pad(c, 11)).join(""));
  for (const stage of stages) {
    const row = CLASSES.map((c) => {
      const z = byClass.get(c)?.find((x) => x.stage === stage && x.kind === "farm");
      return pad(z?.meanDur == null ? "-" : z.meanDur.toFixed(0) + "s", 11);
    });
    console.log("  " + pad(stage, 6) + row.join(""));
  }
}

main();
