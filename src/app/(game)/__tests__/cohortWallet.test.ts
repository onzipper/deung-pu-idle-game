import { describe, expect, it } from "vitest";
import {
  desiredHeroConfig,
  dropAssignedIndex,
  heroConfigDiff,
  myAutoHuntDisplay,
  virtualWallet,
  walletSliceFrom,
  type WalletSlice,
} from "../cohortWallet";
import { initGameState, makeHero, step, type GameState, type HeroConfig } from "@/engine";

function wallet(
  gold: number,
  goldEarned: number,
  materials: number,
  consumables: Record<string, number> = {},
): WalletSlice {
  return { gold, goldEarned, materials, consumables };
}

describe("walletSliceFrom", () => {
  it("deep-copies the wallet fields (no aliasing of live state)", () => {
    const s: GameState = initGameState(1);
    s.gold = 500;
    s.goldEarned = 900;
    s.materials = 12;
    s.consumables.hpPotion = 7;
    const slice = walletSliceFrom(s);
    expect(slice).toEqual({
      gold: 500,
      goldEarned: 900,
      materials: 12,
      consumables: { ...s.consumables },
    });
    slice.consumables.hpPotion = 0;
    expect(s.consumables.hpPotion).toBe(7); // clone, not alias
  });
});

describe("virtualWallet", () => {
  it("no-drift identity: now == sharedBase returns the base untouched", () => {
    const base = wallet(1000, 5000, 30, { hpPotion: 8, manaPotion: 3 });
    const sharedBase = wallet(200, 4000, 5, { hpPotion: 1, manaPotion: 1 });
    const out = virtualWallet(base, sharedBase, { ...sharedBase }, 3);
    expect(out.gold).toBe(1000);
    expect(out.goldEarned).toBe(5000);
    expect(out.materials).toBe(30);
    expect(out.consumables).toEqual({ hpPotion: 8, manaPotion: 3 });
  });

  it("positive gold drift splits per head with trunc toward zero", () => {
    const base = wallet(1000, 5000, 30);
    const sharedBase = wallet(200, 4000, 5);
    const now = wallet(200 + 100, 4000 + 100, 5 + 100); // +100 pot drift each
    // 100 / 3 = 33.33 -> trunc 33
    const out = virtualWallet(base, sharedBase, now, 3);
    expect(out.gold).toBe(1033);
    expect(out.materials).toBe(63);
    expect(out.goldEarned).toBe(5033);
  });

  it("negative drift (pot spent) splits and clamps >= 0", () => {
    const base = wallet(10, 5000, 2);
    const sharedBase = wallet(300, 4000, 300);
    const now = wallet(0, 4000, 0); // pot fully spent: -300 drift
    // gold: 10 + trunc(-300/3) = 10 - 100 = -90 -> clamped 0
    const out = virtualWallet(base, sharedBase, now, 3);
    expect(out.gold).toBe(0);
    // materials: 2 + trunc(-300/3) = -98 -> clamped 0
    expect(out.materials).toBe(0);
  });

  it("goldEarned never decreases even if the shared goldEarned regressed", () => {
    const base = wallet(0, 5000, 0);
    const sharedBase = wallet(0, 4000, 0);
    const now = wallet(0, 3000, 0); // regressed by 1000
    const out = virtualWallet(base, sharedBase, now, 2);
    expect(out.goldEarned).toBe(5000); // max(0, floor(-1000/2)) = 0
  });

  it("covers every consumable key incl. a key missing from base", () => {
    const base = wallet(0, 0, 0, { hpPotion: 5 }); // no manaPotion in base
    const sharedBase = wallet(0, 0, 0, { hpPotion: 1, manaPotion: 1 });
    const now = wallet(0, 0, 0, { hpPotion: 1, manaPotion: 1 + 20 }); // +20 mana pots pooled
    const out = virtualWallet(base, sharedBase, now, 2);
    expect(out.consumables.hpPotion).toBe(5); // no drift
    expect(out.consumables.manaPotion).toBe(10); // 0 + trunc(20/2)
  });

  it("size clamps to >= 1 (never divides by zero)", () => {
    const base = wallet(100, 100, 0);
    const sharedBase = wallet(0, 0, 0);
    const now = wallet(60, 60, 0);
    const out = virtualWallet(base, sharedBase, now, 0);
    expect(out.gold).toBe(160); // treated as size 1 => full drift
  });

  it("re-seed settlement composes: settle old cohort, then rebase for 2p -> 3p", () => {
    // Solo pre-cohort wallet.
    const solo = wallet(1000, 8000, 40, { hpPotion: 10 });
    // 2p cohort forms: base = solo, sharedBase = the seeded pot.
    const shared2Base = wallet(200, 6000, 5, { hpPotion: 2 });
    // Pot earns 300 gold / 300 earned / 60 materials / 12 potions across the 2p run.
    const shared2Now = wallet(500, 6300, 65, { hpPotion: 14 });
    const settled = virtualWallet(solo, shared2Base, shared2Now, 2);
    // gold: 1000 + trunc(300/2) = 1150
    expect(settled.gold).toBe(1150);
    expect(settled.goldEarned).toBe(8000 + 150);
    expect(settled.materials).toBe(40 + 30);
    expect(settled.consumables.hpPotion).toBe(10 + 6);

    // 3rd member joins -> re-seed. New base = settled share; new sharedBase = pot at join.
    const shared3Base = { ...shared2Now };
    const shared3Now = wallet(500 + 900, 6300 + 900, 65 + 90, { hpPotion: 14 + 30 });
    const out = virtualWallet(settled, shared3Base, shared3Now, 3);
    // gold: 1150 + trunc(900/3) = 1450
    expect(out.gold).toBe(1450);
    expect(out.goldEarned).toBe(8150 + 300);
    expect(out.materials).toBe(70 + 30);
    expect(out.consumables.hpPotion).toBe(16 + 10);
  });

  it("never mutates its inputs", () => {
    const base = wallet(100, 100, 10, { hpPotion: 5 });
    const sharedBase = wallet(50, 50, 5, { hpPotion: 1 });
    const now = wallet(80, 80, 8, { hpPotion: 3 });
    const baseCopy = structuredClone(base);
    const sharedBaseCopy = structuredClone(sharedBase);
    const nowCopy = structuredClone(now);
    virtualWallet(base, sharedBase, now, 2);
    expect(base).toEqual(baseCopy);
    expect(sharedBase).toEqual(sharedBaseCopy);
    expect(now).toEqual(nowCopy);
  });
});

describe("dropAssignedIndex", () => {
  it("is deterministic for the same rollId", () => {
    expect(dropAssignedIndex("roll-abc-42", 3)).toBe(dropAssignedIndex("roll-abc-42", 3));
  });

  it("size 1 always assigns index 0", () => {
    for (let i = 0; i < 50; i++) {
      expect(dropAssignedIndex(`roll-${i}`, 1)).toBe(0);
    }
    expect(dropAssignedIndex("anything", 0)).toBe(0); // guarded
  });

  it("distributes across all indexes of a size-3 cohort (each gets >= 20 of 100)", () => {
    const counts = [0, 0, 0];
    for (let i = 0; i < 100; i++) {
      const idx = dropAssignedIndex(`roll-${i}`, 3);
      expect(idx).toBeGreaterThanOrEqual(0);
      expect(idx).toBeLessThan(3);
      counts[idx]++;
    }
    for (const c of counts) expect(c).toBeGreaterThanOrEqual(20);
  });

  it("partitions perfectly: exactly one cohort index claims each roll", () => {
    for (let i = 0; i < 100; i++) {
      const rollId = `partition-${i}`;
      const owners = [0, 1, 2].filter((idx) => dropAssignedIndex(rollId, 3) === idx);
      expect(owners).toHaveLength(1);
    }
  });
});

describe("desiredHeroConfig + heroConfigDiff", () => {
  const cfg = (over: Partial<HeroConfig> = {}): HeroConfig => ({
    autoCast: false,
    autoAllocate: false,
    autoHunt: true,
    autoHpPotion: false,
    autoManaPotion: false,
    autoHpThreshold: 0.5,
    autoManaThreshold: 0.3,
    ...over,
  });

  it("ANDs every sub-behavior against the bot master switch (autoHunt)", () => {
    const off = desiredHeroConfig({
      autoHunt: false,
      autoCast: true,
      autoAllocate: true,
      autoHpPotion: true,
      autoManaPotion: true,
      autoHpThreshold: 0.6,
      autoManaThreshold: 0.4,
    });
    expect(off).toEqual(
      cfg({
        autoHunt: false,
        autoCast: false,
        autoAllocate: false,
        autoHpPotion: false,
        autoManaPotion: false,
        autoHpThreshold: 0.6,
        autoManaThreshold: 0.4,
      }),
    );
  });

  it("passes sub-behaviors through when the master is on", () => {
    const on = desiredHeroConfig({
      autoHunt: true,
      autoCast: true,
      autoAllocate: false,
      autoHpPotion: true,
      autoManaPotion: false,
      autoHpThreshold: 0.5,
      autoManaThreshold: 0.3,
    });
    expect(on).toEqual(cfg({ autoCast: true, autoHpPotion: true }));
  });

  it("heroConfigDiff returns null when configs match", () => {
    expect(heroConfigDiff(cfg(), cfg())).toBeNull();
  });

  it("heroConfigDiff returns the full desired config on ANY field change", () => {
    const desired = cfg({ autoCast: true });
    expect(heroConfigDiff(desired, cfg())).toEqual(desired);
    expect(heroConfigDiff(cfg({ autoHpThreshold: 0.9 }), cfg())).toEqual(
      cfg({ autoHpThreshold: 0.9 }),
    );
  });

  it("heroConfigDiff returns the desired config when current is undefined", () => {
    const desired = cfg();
    expect(heroConfigDiff(desired, undefined)).toBe(desired);
  });
});

describe("myAutoHuntDisplay (bot-toggle live bug fix)", () => {
  it("solo: reads heroes[0].config.autoHunt (kept byte-identical to state.autoHunt by syncPrimaryHeroConfig)", () => {
    const s = initGameState(1);
    step(s, { setAutoHunt: false });
    // `syncPrimaryHeroConfig` mirrors the global onto heroes[0].config BEFORE this same
    // step's `setAutoHunt` intent updates `state.autoHunt` (step.ts ordering) — one extra
    // idle step lets the mirror catch up, same as the real per-frame loop would.
    step(s, {});
    expect(s.heroes[0].config.autoHunt).toBe(false);
    expect(s.autoHunt).toBe(false);
    expect(myAutoHuntDisplay(s)).toBe(false);
  });

  it("cohort: my OWN hero's config, NOT the shared state.autoHunt global", () => {
    // Two-hero cohort: lane 1 flips ITS OWN hero off via setHeroConfig; the shared
    // `state.autoHunt` global is never touched by that lane (only lane 0's legacy
    // `setAutoHunt` writes it — see step.ts).
    const s = initGameState(1);
    s.heroes.push(makeHero(2, "swordsman"));
    step(s, [{}, { setHeroConfig: { autoHunt: false } }]);
    expect(s.heroes[1].config.autoHunt).toBe(false);
    expect(s.heroes[0].config.autoHunt).toBe(true);
    expect(s.autoHunt).toBe(true); // shared global untouched

    // "heroes[0] = mine" convention: a snapshot for hero-1's owner reorders heroes so
    // THEIR hero is index 0 (GameClient's per-frame UI-sync) — myAutoHuntDisplay must
    // then report false, independent of the OTHER member's (still-true) hero.
    const snapForHero1Owner = { ...s, heroes: [s.heroes[1], s.heroes[0]] };
    expect(myAutoHuntDisplay(snapForHero1Owner)).toBe(false);
    expect(myAutoHuntDisplay(s)).toBe(true); // hero-0 owner's own view: unaffected
  });

  it("falls back to state.autoHunt when heroes is empty (defensive only)", () => {
    expect(myAutoHuntDisplay({ heroes: [], autoHunt: true })).toBe(true);
    expect(myAutoHuntDisplay({ heroes: [], autoHunt: false })).toBe(false);
  });
});

describe("2-client cohort bot-toggle scenario (regression for the live bug)", () => {
  // Simulates the exact failure mode the owner reported: BEFORE the fix, both clients'
  // "desired" config was derived from the SAME shared `state.autoHunt` (fed by the old
  // `buildSnapshot`), so client A's toggle got replicated onto client B's hero too, and
  // client B's own toggle self-reverted the very next tick. AFTER the fix (this test),
  // each client's desired config is derived from `myAutoHuntDisplay` of ITS OWN
  // reordered snapshot view — independent, and stable (no oscillation) once converged.
  const cfg = (autoHunt: boolean): HeroConfig => ({
    autoCast: false,
    autoAllocate: false,
    autoHunt,
    autoHpPotion: false,
    autoManaPotion: false,
    autoHpThreshold: 0.5,
    autoManaThreshold: 0.3,
  });

  it("client A toggling OFF never touches client B's hero, and never oscillates", () => {
    const s = initGameState(1);
    s.heroes.push(makeHero(2, "swordsman"));
    // Both start ON.
    step(s, [{ setHeroConfig: cfg(true) }, { setHeroConfig: cfg(true) }]);
    expect(s.heroes[0].config.autoHunt).toBe(true);
    expect(s.heroes[1].config.autoHunt).toBe(true);

    // Client A (hero 0 owner) sees ITS OWN view (heroes[0] = mine, unreordered) and
    // decides to turn its bot off; client B's independent view is untouched (still true),
    // so client B's own desired config stays `true` — the replication is a stable no-op.
    const aView = s; // hero 0 owner: heroes[0] already mine
    const bView = { ...s, heroes: [s.heroes[1], s.heroes[0]] }; // hero 1 owner: reordered

    const aDesired = desiredHeroConfig({
      autoHunt: !myAutoHuntDisplay(aView), // A clicks the toggle -> OFF
      autoCast: false,
      autoAllocate: false,
      autoHpPotion: false,
      autoManaPotion: false,
      autoHpThreshold: 0.5,
      autoManaThreshold: 0.3,
    });
    const bDesired = desiredHeroConfig({
      autoHunt: myAutoHuntDisplay(bView), // B does nothing -> unchanged (still true)
      autoCast: false,
      autoAllocate: false,
      autoHpPotion: false,
      autoManaPotion: false,
      autoHpThreshold: 0.5,
      autoManaThreshold: 0.3,
    });
    const aDiff = heroConfigDiff(aDesired, s.heroes[0].config);
    const bDiff = heroConfigDiff(bDesired, s.heroes[1].config);
    expect(aDiff).toEqual(cfg(false));
    expect(bDiff).toBeNull(); // B's own hero is already what B wants — no replication noise

    step(s, [{ setHeroConfig: aDiff! }, {}]);
    expect(s.heroes[0].config.autoHunt).toBe(false);
    expect(s.heroes[1].config.autoHunt).toBe(true); // UNCHANGED by A's toggle

    // Re-derive both clients' desired config against the now-converged state: neither
    // produces a diff (the old bug re-sent a stale shared-derived config forever).
    const aDesired2 = desiredHeroConfig({
      autoHunt: myAutoHuntDisplay(s),
      autoCast: false,
      autoAllocate: false,
      autoHpPotion: false,
      autoManaPotion: false,
      autoHpThreshold: 0.5,
      autoManaThreshold: 0.3,
    });
    const bView2 = { ...s, heroes: [s.heroes[1], s.heroes[0]] };
    const bDesired2 = desiredHeroConfig({
      autoHunt: myAutoHuntDisplay(bView2),
      autoCast: false,
      autoAllocate: false,
      autoHpPotion: false,
      autoManaPotion: false,
      autoHpThreshold: 0.5,
      autoManaThreshold: 0.3,
    });
    expect(heroConfigDiff(aDesired2, s.heroes[0].config)).toBeNull();
    expect(heroConfigDiff(bDesired2, s.heroes[1].config)).toBeNull();
  });
});
