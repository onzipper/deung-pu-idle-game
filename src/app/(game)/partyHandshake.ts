/**
 * M8 party P4b — the zone-boundary re-seed handshake (design §4, protocol §8).
 *
 * PURE state machine: no `WebSocket`/DOM import anywhere in this module (constructor-
 * injected `send`, fed by `receiveOffer`/`receiveAck` — see `PartySession` in
 * `partySession.ts` for the impure transport that drives it). This is what makes it
 * headlessly unit-testable with a fake in-memory relay feed (reordered delivery
 * included), exactly like `engine/lockstep/__tests__/lockstep.test.ts`'s harness.
 *
 * ── What it does ─────────────────────────────────────────────────────────────────
 * On a cohort-membership change (a fresh cohort forms, or a zone-boundary re-seed is
 * needed) every participant exchanges ONE `reseed-offer` (its own per-hero
 * `CohortProgression` +, ONLY from the lowest-slot member, the shared economy slice +
 * a fresh room seed) then, once every offer has been observed, ONE `reseed-ack`. Once
 * every ack has been observed, every client independently calls the exact same pure
 * `buildCohortState()` — same seed + same ordered progressions in ⇒ byte-identical
 * `GameState` out (no snapshot ever crosses the wire, design §4).
 *
 * ── Deviation from the design doc's literal build step (documented, per CLAUDE.md's
 *    "deviations need strong documented reasons") ──────────────────────────────────
 * `docs/party-design-m8.md` §4/P4b's brief describes `s = initGameState(seed,
 * mySoloSave)` — EACH client seeding from its OWN save. Taken literally this would
 * diverge: `gold`/`materials`/`consumables`/`unlockedZones`/`location`/… are SHARED
 * `GameState` scalars (not per-hero — see `stateHash`'s "shared scalars" section), so
 * two real players' own saves almost certainly disagree on them (different gold,
 * different potion counts, …), which would hash-diverge the cohort on its very FIRST
 * turn — exactly the bug the whole lockstep layer exists to prevent. Instead: every
 * client builds from the SAME single `SharedCohortSave` slice (contributed by the
 * lowest-slot member only, `buildCohortState`'s `sharedSave` param) while each hero's
 * OWN per-hero progression (level/xp/tier/stats/equipped/config/quest/…) still comes
 * from ITS OWN owner — this is the byte-identical-safe reading of the same intent.
 * KNOWN LIMITATION (matches the design doc's own "numbers TBD" framing for cohort
 * economy, §§2/11 — not solved here): a non-authority member's SAVED gold/materials/
 * consumables while mid-cohort reflect the authority's shared pool for that session,
 * not their own pre-cohort numbers. Acceptable for v1 (no dupe risk — it's a shared
 * pool credited identically to everyone present, never inflated) but worth a real
 * balance pass before this ships as a headline feature.
 */

import { heroPlaneY, initGameState, makeHero } from "@/engine";
import type {
  EquippedGear,
  GameState,
  Hero,
  HeroClass,
  HeroConfig,
  HeroDailies,
  HeroQuest,
  HeroStats,
  SkillId,
} from "@/engine";

// ── Progression payloads (small, server-authoritative-derived — design §4) ─────────

/** Everything about a hero that's genuinely PER-PLAYER (not shared cohort state) —
 * exactly `makeHero`'s progression-carrying parameters. */
export interface CohortProgression {
  cls: HeroClass;
  level: number;
  xp: number;
  tier: 1 | 2 | 3;
  statPoints: number;
  stats: HeroStats;
  autoSlots: (SkillId | null)[];
  equipped: EquippedGear;
  config: HeroConfig;
  quest: HeroQuest | null;
  mainClaimed: string[];
  dailies: HeroDailies;
}

/** Snapshot a hero's own progression (never aliases the live hero — every field is
 * copied) — this is what a client attaches to its own `reseed-offer`. */
export function progressionFromHero(h: Hero): CohortProgression {
  return {
    cls: h.cls,
    level: h.level,
    xp: h.xp,
    tier: h.tier,
    statPoints: h.statPoints,
    stats: { ...h.stats },
    autoSlots: [...h.autoSlots],
    equipped: {
      weapon: h.equipped.weapon,
      armor: h.equipped.armor,
      refine: { weapon: h.equipped.refine?.weapon ?? 0, armor: h.equipped.refine?.armor ?? 0 },
    },
    config: { ...h.config },
    quest: h.quest ? { id: h.quest.id, accepted: h.quest.accepted, progress: [...h.quest.progress] } : null,
    mainClaimed: [...h.mainClaimed],
    dailies: { serverDay: h.dailies.serverDay, quests: h.dailies.quests.map((q) => ({ ...q })) },
  };
}

/** The SHARED (non-per-hero) slice of `GameState` a cohort rebuild seeds from — see
 * this module's doc for why only ONE member's copy (the seed authority) is used. */
export type SharedCohortSave = Pick<
  GameState,
  | "stage"
  | "gold"
  | "goldEarned"
  | "bossBest"
  | "levelCapAt"
  | "location"
  | "unlockedZones"
  | "lastFarmZone"
  | "consumables"
  | "bot"
  | "autoHunt"
  | "zoneKills"
  | "lootSalt"
  | "lootCounter"
  | "materials"
>;

/** Snapshot the shared slice off a live `GameState` (deep-enough copy — every nested
 * record/object is cloned so the offer never aliases live state). */
export function sharedSaveFromState(s: GameState): SharedCohortSave {
  return {
    stage: s.stage,
    gold: s.gold,
    goldEarned: s.goldEarned,
    bossBest: Object.fromEntries(Object.entries(s.bossBest).map(([k, v]) => [k, { ...v }])),
    levelCapAt: s.levelCapAt,
    location: { ...s.location },
    unlockedZones: { ...s.unlockedZones },
    lastFarmZone: { ...s.lastFarmZone },
    consumables: { ...s.consumables },
    bot: { ...s.bot },
    autoHunt: s.autoHunt,
    zoneKills: { ...s.zoneKills },
    lootSalt: s.lootSalt,
    lootCounter: s.lootCounter,
    materials: s.materials,
  };
}

/** One cohort member's slot + progression, in the canonical ascending-slot order every
 * client derives identically (slot `i` in this array ⇒ `state.heroes[i]`). */
export interface CohortSeat {
  slot: number;
  progression: CohortProgression;
}

/**
 * Build a fresh cohort `GameState`: shared scalars from `sharedSave` (the seed
 * authority's own economy — see module doc), heroes rebuilt in `order`'s slot order
 * from each owner's OWN progression. Deterministic given identical inputs — this is
 * THE single build path every client (and a 1-member "cohort", i.e. a solo rebuild —
 * see `extractSoloState`) calls, mirroring `lockstep.test.ts`'s `buildCohort` helper.
 *
 * `positions` (owner bug batch A #2, "position reset on cohort re-form"): an OPTIONAL
 * slot -> live x map. `makeHero` always places a fresh hero at its formation anchor
 * (`CONFIG.baseAnchor + type.offset`) — correct for a genuinely-new joiner (it has no
 * meaningful position in this cohort/zone yet), but WRONG for a member who was already
 * standing somewhere when a reform was triggered by someone else joining: every seat
 * used to get rebuilt through `makeHero` unconditionally, so an existing member's live
 * x was silently discarded on every re-seed. A slot present in `positions` has its
 * freshly-built hero's `x` overridden to that value post-construction; a slot ABSENT
 * (including every slot when `positions` itself is omitted — old-format offers, or a
 * fresh solo->cohort join) keeps `makeHero`'s anchor default. Backward-compatible: a
 * caller that never passes this argument is byte-identical to before.
 */
export function buildCohortState(
  seed: number,
  sharedSave: SharedCohortSave,
  order: readonly CohortSeat[],
  positions?: ReadonlyMap<number, number>,
): GameState {
  const s = initGameState(seed);
  s.stage = sharedSave.stage;
  s.gold = sharedSave.gold;
  s.goldEarned = sharedSave.goldEarned;
  s.bossBest = Object.fromEntries(Object.entries(sharedSave.bossBest).map(([k, v]) => [k, { ...v }]));
  s.levelCapAt = sharedSave.levelCapAt;
  s.location = { ...sharedSave.location };
  s.unlockedZones = { ...sharedSave.unlockedZones };
  s.lastFarmZone = { ...sharedSave.lastFarmZone };
  s.consumables = { ...sharedSave.consumables };
  s.bot = { ...sharedSave.bot };
  s.autoHunt = sharedSave.autoHunt;
  s.zoneKills = { ...sharedSave.zoneKills };
  s.lootSalt = sharedSave.lootSalt;
  s.lootCounter = sharedSave.lootCounter;
  s.materials = sharedSave.materials;
  const sorted = [...order].sort((a, b) => a.slot - b.slot);
  s.heroClass = sorted[0]?.progression.cls ?? s.heroClass;
  const partySize = sorted.length;
  s.heroes = sorted.map(({ slot, progression: p }, i) => {
    const hero = makeHero(
      i + 1,
      p.cls,
      p.level,
      p.xp,
      p.tier,
      p.statPoints,
      { ...p.stats },
      undefined,
      [...p.autoSlots],
      p.quest ? { id: p.quest.id, accepted: p.quest.accepted, progress: [...p.quest.progress] } : null,
      {
        weapon: p.equipped.weapon,
        armor: p.equipped.armor,
        refine: { weapon: p.equipped.refine?.weapon ?? 0, armor: p.equipped.refine?.armor ?? 0 },
      },
      { ...p.config },
      [...p.mainClaimed],
      { serverDay: p.dailies.serverDay, quests: p.dailies.quests.map((q) => ({ ...q })) },
    );
    // Carry an EXISTING member's live x forward across a re-form (see this function's
    // doc) — a slot absent from `positions` (a genuinely-new joiner, or an old-format
    // caller) keeps `makeHero`'s formation-anchor default untouched.
    const knownX = positions?.get(slot);
    if (knownX !== undefined) hero.x = knownX;
    // R4 Wave B party fan: `makeHero` stamps only the SOLO plane row, so overwrite
    // with the cohort-slot fan (`heroPlaneY(cls, cohortIndex, partySize)`) — the
    // render depth cutover reads this to reproduce today's party fan. Cohort index
    // `i` === the hero's index in `state.heroes` === render's `slot`; a 1-member
    // "cohort" (solo rebuild) gives `heroPlaneY(cls,0,1)` = the solo row, byte-
    // identical to `makeHero`. Deterministic (no RNG/clock), folded into stateHash.
    hero.planeY = heroPlaneY(p.cls, i, partySize);
    return hero;
  });
  s.nextId = sorted.length + 1;
  return s;
}

/**
 * Cohort -> solo (design C: "extract my hero -> rebuild solo via the same
 * machinery"). A solo rebuild is just a 1-member "cohort" build seeded from the
 * cohort's own shared slice + only MY hero's progression — same `buildCohortState`
 * path, so there's exactly one state-construction primitive in this whole layer.
 */
export function extractSoloState(cohort: GameState, mySlot: number, seed: number): GameState {
  const myHero = cohort.heroes[mySlot];
  // Owner bug batch A #1 ("position reset on collapse/re-form"): carry MY hero's live x
  // into the solo rebuild via the `positions` map — without it every collapseToSolo (a
  // warp, a bot town trip, a reconnect) re-spawned me at the formation anchor. Slot 0 is
  // always my (only) hero in this 1-member "cohort".
  return buildCohortState(
    seed,
    sharedSaveFromState(cohort),
    [{ slot: 0, progression: progressionFromHero(myHero) }],
    new Map([[0, myHero.x]]),
  );
}

// ── The offer/ack exchange itself ───────────────────────────────────────────────

export interface ReseedOfferMsg {
  kind: "reseed-offer";
  slot: number;
  progression: CohortProgression;
  /** Present ONLY on the seed authority's (lowest cohort slot) own offer — see the
   * module doc for why the shared slice comes from exactly one member. */
  authority?: { baseSeed: number; sharedSave: SharedCohortSave };
  /** OPTIONAL, owner bug batch A #2: my own hero's CURRENT x, sent ONLY when this
   * offer continues an ALREADY-active cohort (a re-form triggered by someone else
   * joining/leaving my zone) — see `buildCohortState`'s `positions` doc. Omitted for
   * a fresh solo->cohort join (the sender has no meaningful position in this cohort
   * yet — it spawns at the formation anchor, as before) and by any old-format
   * sender (backward-compatible: `receiveOffer` simply won't have an x for that
   * slot, so it keeps the anchor default). */
  x?: number;
}

export interface ReseedAckMsg {
  kind: "reseed-ack";
  slot: number;
  /** The seq at which the sender observed the LAST reseed-offer — an audit/cross-
   * check value, not itself load-bearing: the relay's single ordered stream (protocol
   * §4) makes "all N offers observed" land at the SAME seq position for every client
   * by construction, so every ack in a converged exchange carries the identical value
   * (tests assert this directly — see this module's "start-turn rule" doc below). */
  turn0Seq: number;
}

export type PartyWireMsg = ReseedOfferMsg | ReseedAckMsg;

export type HandshakePhase = "offering" | "acking" | "done" | "aborted";

export interface PartyHandshakeOptions {
  mySlot: number;
  /** The cohort's member slots, ANY order (sorted internally) — the LOWEST value is
   * the seed authority (design: "LOWEST SLOT in cohort = seed authority"). */
  cohortSlots: readonly number[];
  send: (msg: PartyWireMsg) => void;
  myProgression: CohortProgression;
  /** My own shared-slice snapshot — only actually embedded in my outgoing offer if
   * I turn out to be the authority; always passed so the caller never has to know
   * in advance whether it'll be used. */
  mySharedSave: SharedCohortSave;
  /** Mints the fresh room seed — called ONLY if I'm the authority. Injected (not
   * read here) so tests can supply a deterministic fake. */
  mintSeed: () => number;
  /** OPTIONAL, owner bug batch A #2: my hero's CURRENT x, sent on my offer ONLY when
   * set — see `ReseedOfferMsg.x`'s doc. The caller passes this ONLY when re-forming
   * an already-active cohort (omit it on a fresh solo->cohort join). */
  myX?: number;
}

/**
 * ── Start-turn rule (design's "subtlest point") ─────────────────────────────────
 * The freshly built cohort `GameState` always begins its lockstep life at turn 0
 * (matching `LockstepClient`'s own default and the `lockstep.test.ts` re-seed
 * pattern — a brand-new state has no prior turn history to agree on). What actually
 * needs agreement is WHEN every client is allowed to start feeding it real turns
 * without a race: that moment is "I have received a `reseed-ack` from EVERY cohort
 * slot" — and because every client processes the SAME relay-ordered message stream
 * (protocol §4's "all live members observe the same (seq -> message) mapping"), the
 * exchange converges at the IDENTICAL seq position for every client, so this
 * completion event is itself already synchronized — no separate "start turn number"
 * needs to be negotiated over the wire. `ReseedAckMsg.turn0Seq` is carried purely as
 * a cross-check (a converged exchange has every ack agreeing on it byte-for-byte);
 * the actual synchronization is "acks.size === cohortSlots.length", asserted hard in
 * `__tests__/partyHandshake.test.ts`.
 */
export class PartyHandshake {
  private readonly opts: PartyHandshakeOptions;
  private readonly leaderSlot: number;
  private readonly offers = new Map<
    number,
    {
      progression: CohortProgression;
      authority?: { baseSeed: number; sharedSave: SharedCohortSave };
      x?: number;
    }
  >();
  private readonly acks = new Map<number, number>();
  private lastOfferSeq: number | null = null;
  private phaseValue: HandshakePhase = "offering";
  private resultValue: GameState | null = null;

  constructor(opts: PartyHandshakeOptions) {
    this.opts = opts;
    this.leaderSlot = Math.min(...opts.cohortSlots);
  }

  get phase(): HandshakePhase {
    return this.phaseValue;
  }

  /** The rebuilt cohort `GameState`, or `null` until `phase === "done"`. */
  get result(): GameState | null {
    return this.resultValue;
  }

  /** The seq every ack agreed on (see the class doc's start-turn rule) — exposed for
   * tests/diagnostics only, not read by the build itself. */
  get agreedOfferSeq(): number | null {
    return this.lastOfferSeq;
  }

  /** Broadcast my own `reseed-offer`. The relay echoes it back to me too (protocol
   * §4 — "echoed to everyone, incl. sender"), so — deliberately — this does NOT
   * locally register my own offer; `receiveOffer` is the ONLY place any offer
   * (including mine) is recorded, keeping exactly one code path. */
  start(): void {
    if (this.phaseValue !== "offering") return;
    const { mySlot, myProgression, mySharedSave, mintSeed, myX, send } = this.opts;
    const authority =
      mySlot === this.leaderSlot ? { baseSeed: mintSeed(), sharedSave: mySharedSave } : undefined;
    send({ kind: "reseed-offer", slot: mySlot, progression: myProgression, authority, x: myX });
  }

  /** Feed one relay-delivered `reseed-offer` (including my own echo). `seq` is the
   * relay's room-scoped ordering key for this message. */
  receiveOffer(fromSlot: number, msg: ReseedOfferMsg, seq: number): void {
    if (this.phaseValue !== "offering") return;
    if (!this.opts.cohortSlots.includes(fromSlot)) return; // stale/foreign slot — ignore
    this.offers.set(fromSlot, { progression: msg.progression, authority: msg.authority, x: msg.x });
    if (this.offers.size < this.opts.cohortSlots.length) return;
    // All N offers observed. Every client reaches this exact branch at the SAME seq
    // (see the class doc) — record it, move to acking, and ack.
    this.lastOfferSeq = seq;
    this.phaseValue = "acking";
    this.opts.send({ kind: "reseed-ack", slot: this.opts.mySlot, turn0Seq: seq });
  }

  /** Feed one relay-delivered `reseed-ack` (including my own echo). */
  receiveAck(fromSlot: number, msg: ReseedAckMsg): void {
    if (this.phaseValue !== "acking") return;
    if (!this.opts.cohortSlots.includes(fromSlot)) return;
    this.acks.set(fromSlot, msg.turn0Seq);
    if (this.acks.size < this.opts.cohortSlots.length) return;
    const authorityOffer = this.offers.get(this.leaderSlot)?.authority;
    if (!authorityOffer) {
      // Defensive only — the authority always attaches this in `start()`; a missing
      // value means something upstream is broken, not a normal runtime path.
      this.abort();
      return;
    }
    const order: CohortSeat[] = [...this.opts.cohortSlots]
      .slice()
      .sort((a, b) => a - b)
      .map((slot) => ({ slot, progression: this.offers.get(slot)!.progression }));
    // Owner bug batch A #2: fold every offer's OPTIONAL `x` into a slot -> position
    // map — a slot whose offer omitted it (a fresh joiner, or an old-format sender)
    // is simply absent, so `buildCohortState` leaves it at the formation anchor.
    const positions = new Map<number, number>();
    for (const slot of this.opts.cohortSlots) {
      const x = this.offers.get(slot)?.x;
      if (x !== undefined) positions.set(slot, x);
    }
    this.resultValue = buildCohortState(
      authorityOffer.baseSeed,
      authorityOffer.sharedSave,
      order,
      positions,
    );
    this.phaseValue = "done";
  }

  /** Abort (ws drop / member-left / seq-gap mid-handshake, design C) — discards every
   * offer/ack so a stale partial exchange can never half-apply. The caller falls back
   * to `extractSoloState` from its OWN current state, never a partially-built cohort. */
  abort(): void {
    this.phaseValue = "aborted";
    this.offers.clear();
    this.acks.clear();
    this.resultValue = null;
  }
}
