import { describe, expect, it } from "vitest";
import { CONFIG, createRng, type HeroClass } from "@/engine";
import { stateHash } from "@/engine/lockstep";
import {
  PartyHandshake,
  buildCohortState,
  extractSoloState,
  progressionFromHero,
  sharedSaveFromState,
  type CohortProgression,
  type PartyWireMsg,
  type SharedCohortSave,
} from "../partyHandshake";
import { initGameState, makeHero } from "@/engine";

/**
 * M8 party P4b — headless handshake harness. Mirrors
 * `engine/lockstep/__tests__/lockstep.test.ts`'s in-memory-relay idiom: N
 * `PartyHandshake` instances exchange messages through a fake relay that
 * SHUFFLES same-round deliveries (modeling "whoever the real relay processes
 * first is unpredictable") before assigning each message its OWN, permanently
 * fixed `seq` and delivering it — in ORDER — to every participant including
 * the sender (protocol §4's echo rule). This is pure/no-ws (see the module's
 * own doc), so the harness never touches a socket either.
 */

function prog(cls: HeroClass, level = 5): CohortProgression {
  return {
    cls,
    level,
    xp: 0,
    tier: 1,
    statPoints: 0,
    stats: { ...CONFIG.stats.base[cls] },
    autoSlots: [null, null, null],
    equipped: { weapon: null, armor: null, refine: { weapon: 0, armor: 0 } },
    config: {
      autoCast: false,
      autoAllocate: false,
      autoHunt: true,
      autoHpPotion: true,
      autoManaPotion: true,
      autoHpThreshold: 0.5,
      autoManaThreshold: 0.3,
    },
    quest: null,
    mainClaimed: [],
    dailies: { serverDay: 0, quests: [] },
  };
}

function sharedSave(stage = 3): SharedCohortSave {
  const s = initGameState(999);
  s.stage = stage;
  return sharedSaveFromState(s);
}

/** Drives N `PartyHandshake`s to convergence through a shuffling fake relay.
 * Returns the handshakes (post-run) for assertion. */
function runHandshakeCohort(
  cohortSlots: number[],
  progressionOf: (slot: number) => CohortProgression,
  shuffleSeed: number,
  seedFn: () => number = () => 4242,
): PartyHandshake[] {
  const rng = createRng(shuffleSeed);
  const pending: { fromSlot: number; msg: PartyWireMsg }[] = [];
  let seqCounter = 0;
  const shared = sharedSave();

  const handshakes = new Map<number, PartyHandshake>();
  for (const slot of cohortSlots) {
    handshakes.set(
      slot,
      new PartyHandshake({
        mySlot: slot,
        cohortSlots,
        send: (msg) => pending.push({ fromSlot: slot, msg }),
        myProgression: progressionOf(slot),
        mySharedSave: shared,
        mintSeed: seedFn,
      }),
    );
  }

  function flush(): void {
    while (pending.length > 0) {
      const batch = pending.splice(0, pending.length);
      for (let i = batch.length - 1; i > 0; i--) {
        const j = Math.floor(rng.next() * (i + 1));
        [batch[i], batch[j]] = [batch[j], batch[i]];
      }
      for (const item of batch) {
        const seq = seqCounter++;
        for (const slot of cohortSlots) {
          const h = handshakes.get(slot)!;
          if (item.msg.kind === "reseed-offer") h.receiveOffer(item.fromSlot, item.msg, seq);
          else h.receiveAck(item.fromSlot, item.msg);
        }
      }
    }
  }

  for (const slot of cohortSlots) handshakes.get(slot)!.start();
  flush();
  return cohortSlots.map((slot) => handshakes.get(slot)!);
}

describe("M8 party handshake — happy path convergence", () => {
  it("2-member cohort: every client reaches 'done' with a byte-identical rebuilt state", () => {
    const slots = [0, 1];
    const hs = runHandshakeCohort(slots, (s) => prog(s === 0 ? "swordsman" : "archer", 5 + s), 0xabc);
    for (const h of hs) expect(h.phase).toBe("done");
    const hashes = hs.map((h) => stateHash(h.result!));
    expect(hashes[1]).toBe(hashes[0]);
    // Every hero landed in its canonical slot-order position.
    expect(hs[0].result!.heroes.map((h) => h.cls)).toEqual(["swordsman", "archer"]);
  });

  it("3-member cohort: every client reaches 'done' with a byte-identical rebuilt state", () => {
    const slots = [0, 1, 2];
    const hs = runHandshakeCohort(
      slots,
      (s) => prog(s === 0 ? "swordsman" : s === 1 ? "archer" : "mage", 10 + s),
      0xdef,
    );
    for (const h of hs) expect(h.phase).toBe("done");
    const hashes = hs.map((h) => stateHash(h.result!));
    expect(hashes[1]).toBe(hashes[0]);
    expect(hashes[2]).toBe(hashes[0]);
  });

  it("start-turn rule: every ack agrees on the SAME offer-completion seq, regardless of shuffle timing", () => {
    const slots = [0, 1, 2];
    const hs = runHandshakeCohort(slots, (s) => prog("swordsman", 3 + s), 0x111);
    const seqs = hs.map((h) => h.agreedOfferSeq);
    expect(seqs[1]).toBe(seqs[0]);
    expect(seqs[2]).toBe(seqs[0]);
    expect(seqs[0]).not.toBeNull();
  });

  it("REORDERED delivery timing (different shuffle seeds) never changes the converged result", () => {
    const slots = [0, 1, 2];
    const a = runHandshakeCohort(slots, (s) => prog("archer", 7 + s), 0x1111);
    const b = runHandshakeCohort(slots, (s) => prog("archer", 7 + s), 0x9999);
    const hashA = a.map((h) => stateHash(h.result!));
    const hashB = b.map((h) => stateHash(h.result!));
    expect(hashB).toEqual(hashA);
  });

  it("the seed authority is always the LOWEST cohort slot, whichever slots are present", () => {
    const slots = [1, 2]; // slot 0 is elsewhere — slot 1 is the lowest present
    const mintedBy: number[] = [];
    const hs = slots.map(
      (slot) =>
        new PartyHandshake({
          mySlot: slot,
          cohortSlots: slots,
          send: () => {},
          myProgression: prog("mage"),
          mySharedSave: sharedSave(),
          mintSeed: () => {
            mintedBy.push(slot);
            return 555;
          },
        }),
    );
    for (const h of hs) h.start();
    expect(mintedBy).toEqual([1]); // only slot 1 (the lowest present) minted a seed
  });
});

describe("M8 party handshake — abort path", () => {
  it("abort() discards offers/acks and never produces a result", () => {
    const h = new PartyHandshake({
      mySlot: 0,
      cohortSlots: [0, 1],
      send: () => {},
      myProgression: prog("swordsman"),
      mySharedSave: sharedSave(),
      mintSeed: () => 1,
    });
    h.start();
    h.receiveOffer(0, { kind: "reseed-offer", slot: 0, progression: prog("swordsman"), authority: { baseSeed: 1, sharedSave: sharedSave() } }, 0);
    // Only ONE of the two offers arrived (member drop mid-handshake) — abort before completion.
    h.abort();
    expect(h.phase).toBe("aborted");
    expect(h.result).toBeNull();
    // A late-arriving offer after abort must not resurrect it.
    h.receiveOffer(1, { kind: "reseed-offer", slot: 1, progression: prog("archer") }, 1);
    expect(h.phase).toBe("aborted");
    expect(h.result).toBeNull();
  });

  it("a foreign/stale slot's offer is ignored and never completes the exchange early", () => {
    const h = new PartyHandshake({
      mySlot: 0,
      cohortSlots: [0, 1],
      send: () => {},
      myProgression: prog("swordsman"),
      mySharedSave: sharedSave(),
      mintSeed: () => 1,
    });
    h.start();
    h.receiveOffer(0, { kind: "reseed-offer", slot: 0, progression: prog("swordsman"), authority: { baseSeed: 1, sharedSave: sharedSave() } }, 0);
    // Slot 9 was never part of this cohort (e.g. a stale message from a PRIOR cohort).
    h.receiveOffer(9, { kind: "reseed-offer", slot: 9, progression: prog("mage") }, 1);
    expect(h.phase).toBe("offering"); // still waiting on the REAL slot 1
    h.receiveOffer(1, { kind: "reseed-offer", slot: 1, progression: prog("archer") }, 2);
    expect(h.phase).toBe("acking");
  });
});

describe("M8 party handshake — restart on a shadowed member (D1/D2)", () => {
  it("a formation waiting on a member who never acks stays stuck; a restart over just the LIVE slots completes", () => {
    // Model the deadlock: cohort [0,1,2] but slot 2's socket is dead (a reload / hidden
    // tab) — it never offers or acks. Slots 0 and 1 exchange, but the exchange can NEVER
    // converge because it needs all THREE offers observed. This is exactly the stuck
    // "กำลังเชื่อมต่อปาร์ตี้…" chip (D2: a shadowed slot lingering in the cohort list).
    const cohortSlots = [0, 1, 2];
    const pending: { fromSlot: number; msg: PartyWireMsg }[] = [];
    let seqCounter = 0;
    const shared = sharedSave();
    const live = [0, 1];
    const stuck = new Map<number, PartyHandshake>();
    for (const slot of live) {
      stuck.set(
        slot,
        new PartyHandshake({
          mySlot: slot,
          cohortSlots,
          send: (msg) => pending.push({ fromSlot: slot, msg }),
          myProgression: prog(slot === 0 ? "swordsman" : "archer", 5 + slot),
          mySharedSave: shared,
          mintSeed: () => 4242,
        }),
      );
    }
    for (const slot of live) stuck.get(slot)!.start();
    while (pending.length > 0) {
      const batch = pending.splice(0, pending.length);
      for (const item of batch) {
        const seq = seqCounter++;
        for (const slot of live) {
          const h = stuck.get(slot)!;
          if (item.msg.kind === "reseed-offer") h.receiveOffer(item.fromSlot, item.msg, seq);
          else h.receiveAck(item.fromSlot, item.msg);
        }
      }
    }
    for (const slot of live) expect(stuck.get(slot)!.phase).toBe("offering"); // never all-3

    // GameClient's reconcile: drop the shadowed slot, begin a FRESH handshake over the
    // LIVE pair [0,1] — which converges normally even though slot 2 never returned.
    const hs = runHandshakeCohort(live, (s) => prog(s === 0 ? "swordsman" : "archer", 5 + s), 0x55);
    for (const h of hs) expect(h.phase).toBe("done");
    expect(stateHash(hs[1].result!)).toBe(stateHash(hs[0].result!));
    expect(hs[0].result!.heroes.map((h) => h.cls)).toEqual(["swordsman", "archer"]);
  });
});

describe("M8 party handshake — cohort -> solo extraction (design C)", () => {
  it("extractSoloState rebuilds a valid 1-hero state carrying MY hero's own progression", () => {
    const cohort = buildCohortState(2024, sharedSave(7), [
      { slot: 0, progression: prog("swordsman", 12) },
      { slot: 1, progression: prog("mage", 20) },
    ]);
    const solo = extractSoloState(cohort, 1, 555);
    expect(solo.heroes).toHaveLength(1);
    expect(solo.heroes[0].cls).toBe("mage");
    expect(solo.heroes[0].level).toBe(20);
    expect(solo.stage).toBe(cohort.stage); // shared slice carried through
  });

  it("progressionFromHero never aliases the source hero (deep-enough copy)", () => {
    const h = makeHero(1, "swordsman", 5);
    const p = progressionFromHero(h);
    p.stats.str = 99999;
    p.autoSlots[1] = "mage_meteor";
    expect(h.stats.str).not.toBe(99999);
    expect(h.autoSlots[1]).not.toBe("mage_meteor");
  });
});
