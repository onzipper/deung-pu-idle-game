import { describe, it, expect } from "vitest";
import { SKILLS, initGameState, step } from "@/engine";
import type { FrameInput, GameState } from "@/engine";
import { makeParty, makeStubEnemy, soloSave } from "./helpers";

/**
 * M8 party P2 — SHADOW-BODY ("ร่างเงา", docs/party-design-m8.md §9). A disconnected/
 * offline cohort member's hero keeps playing via the SAME autonomous systems on its
 * frozen config, but manual intents on its lane are dropped deterministically. These
 * headless canaries prove: the shadow keeps FIGHTING (kills advance), manual intents on
 * a shadowed lane are IGNORED while other lanes work, UNSHADOW restores control, the
 * transition emits `heroShadowed` exactly once, the SOLO path can never be shadowed, and
 * a shadow-scripted run stays byte-identical across independent runs. The 3-client
 * lockstep hash-identity proof lives in `lockstep/__tests__/lockstep.test.ts`.
 */

/** A fresh 2-hero party (swordsman + archer) at a burst-ready stage. */
function twoHeroParty(seed = 11, stage = 3): GameState {
  const s = makeParty(seed, stage);
  s.heroes = s.heroes.slice(0, 2);
  s.nextId = 3;
  return s;
}

/** Canonical byte snapshot for the determinism proof (mirrors party.test's snap). */
function snap(s: GameState): string {
  return JSON.stringify({
    t: s.time,
    rng: s.rngState,
    nextId: s.nextId,
    kills: s.kills,
    heroes: s.heroes.map((h) => [
      h.id, h.hp, h.x, h.cd, h.level, h.xp, h.mana, h.dead, h.shadowed,
      h.command?.kind ?? null, h.config.autoCast,
    ]),
    enemies: s.enemies.map((e) => [e.id, e.hp, e.x, e.engaged]),
  });
}

describe("M8 party P2 — a shadow keeps fighting autonomously (kills advance)", () => {
  it("the shadow's auto-hunt reaps a mob while its downed ally sits out", () => {
    const s = twoHeroParty(17);
    s.spawnPaused = true;
    const [shadow, ally] = s.heroes;
    // Shadow the swordsman; sit the ally out so ONLY the shadow can act on the mob.
    ally.dead = true;
    ally.reviveTimer = 1e9; // stays down (not a TOTAL wipe → no town trip)
    // Mark the shadow via the replicated intent on its own lane.
    step(s, [{ setShadowed: { value: true } }, {}]);
    expect(shadow.shadowed).toBe(true);
    // A finishable mob just ahead of the shadow (in front, so melee can close).
    s.enemies = [makeStubEnemy(1, shadow.x + 40, 30)];
    const killsBefore = s.kills;
    const xBefore = shadow.x;
    for (let i = 0; i < 60 * 12 && s.enemies.length; i++) step(s, [{}, {}]);
    expect(s.enemies.length).toBe(0); // the shadow killed it on its own
    expect(s.kills).toBeGreaterThan(killsBefore);
    expect(shadow.dead).toBe(false);
    expect(shadow.shadowed).toBe(true); // still a shadow — fighting doesn't lift it
    expect(shadow.x).not.toBe(xBefore); // it moved to engage (autonomy drove the feet)
  });
});

describe("M8 party P2 — manual intents on a shadowed lane are ignored (other lanes work)", () => {
  it("moveTo is dropped for the shadow but honoured for the live ally", () => {
    const s = twoHeroParty(7);
    s.spawnPaused = true;
    s.enemies = []; // only a command can steer the feet
    const [live, shadow] = s.heroes;
    step(s, [{}, { setShadowed: { value: true } }]);
    expect(shadow.shadowed).toBe(true);
    step(s, [{ moveTo: { x: live.x + 200 } }, { moveTo: { x: shadow.x + 200 } }]);
    expect(live.command?.kind).toBe("move"); // live lane steered
    expect(shadow.command).toBeNull(); // shadow lane's moveTo dropped
  });

  it("allocateStat / setHeroConfig / cancelCommand / useConsumable are all dropped on a shadow", () => {
    const s = twoHeroParty(7);
    s.spawnPaused = true;
    s.enemies = [];
    const [live, shadow] = s.heroes;
    live.statPoints = 5;
    shadow.statPoints = 5;
    shadow.command = { kind: "move", x: shadow.x + 100 }; // a pre-existing command…
    shadow.config.autoCast = false;
    shadow.config.autoHpPotion = false; // isolate the MANUAL-use drop (no autonomy heal)
    shadow.config.autoManaPotion = false;
    s.consumables.hpPotion = 3;
    shadow.hp = shadow.maxHp * 0.4; // low enough that a manual potion WOULD heal
    step(s, [{}, { setShadowed: { value: true } }]);

    const liveStr = live.stats.str;
    const shadowStr = shadow.stats.str;
    const shadowHp = shadow.hp;
    step(s, [
      { allocateStat: { str: 3 } },
      {
        allocateStat: { str: 3 },
        setHeroConfig: { autoCast: true },
        cancelCommand: true,
        useConsumable: "hpPotion",
      },
    ]);
    // Live lane's allocation landed…
    expect(live.stats.str).toBe(liveStr + 3);
    expect(live.statPoints).toBe(2);
    // …shadow's every intent was a no-op:
    expect(shadow.stats.str).toBe(shadowStr); // allocation dropped
    expect(shadow.statPoints).toBe(5);
    expect(shadow.config.autoCast).toBe(false); // config frozen (setHeroConfig dropped)
    expect(shadow.command).not.toBeNull(); // cancelCommand dropped — command survives
    expect(shadow.hp).toBe(shadowHp); // useConsumable dropped — no heal, potion intact
    expect(s.consumables.hpPotion).toBe(3);
  });
});

describe("M8 party P2 — unshadow restores control", () => {
  it("a lifted shadow accepts manual commands again", () => {
    const s = twoHeroParty(23);
    s.spawnPaused = true;
    s.enemies = [];
    const shadow = s.heroes[1];
    step(s, [{}, { setShadowed: { value: true } }]);
    step(s, [{}, { moveTo: { x: shadow.x + 200 } }]);
    expect(shadow.command).toBeNull(); // ignored while shadowed
    // Room lifts the shadow (reconnect).
    step(s, [{}, { setShadowed: { value: false } }]);
    expect(shadow.shadowed).toBe(false);
    step(s, [{}, { moveTo: { x: shadow.x + 200 } }]);
    expect(shadow.command?.kind).toBe("move"); // control restored
  });
});

describe("M8 party P2 — heroShadowed event fires once per real transition", () => {
  it("emits on flip, is silent on a re-assert of the same value", () => {
    const s = twoHeroParty(5);
    s.spawnPaused = true;
    const shadowEvents = (): number =>
      s.events.filter((e) => e.type === "heroShadowed").length;

    step(s, [{}, { setShadowed: { value: true } }]);
    expect(shadowEvents()).toBe(1);
    expect(s.events.find((e) => e.type === "heroShadowed")).toMatchObject({
      heroIdx: 1,
      value: true,
    });

    step(s, [{}, { setShadowed: { value: true } }]); // re-assert → inert
    expect(shadowEvents()).toBe(0);

    step(s, [{}, { setShadowed: { value: false } }]); // real flip back
    expect(shadowEvents()).toBe(1);
    expect(s.events.find((e) => e.type === "heroShadowed")).toMatchObject({
      heroIdx: 1,
      value: false,
    });
  });
});

describe("M8 party P2 — SOLO guard: a 1-hero zone can never be shadowed", () => {
  it("setShadowed no-ops at one hero; manual play still works; no event", () => {
    const s = initGameState(42, soloSave("swordsman", 4));
    expect(s.heroes).toHaveLength(1);
    s.spawnPaused = true;
    s.enemies = [];
    const h = s.heroes[0];
    step(s, [{ setShadowed: { value: true }, moveTo: { x: h.x + 150 } }]);
    expect(h.shadowed).toBe(false); // solo-guarded → flag never set
    expect(s.events.some((e) => e.type === "heroShadowed")).toBe(false);
    expect(h.command?.kind).toBe("move"); // solo manual play unaffected
  });

  it("a solo run fed a setShadowed intent is byte-identical to one never fed it", () => {
    const a = initGameState(99, soloSave("mage", 4));
    const b = initGameState(99, soloSave("mage", 4));
    const out: string[] = [];
    for (let i = 0; i < 600; i++) {
      step(a, i === 100 ? [{ setShadowed: { value: true } }] : [{}]);
      step(b, [{}]);
      out.push(snap(a) === snap(b) ? "=" : "!");
    }
    expect(out.every((c) => c === "=")).toBe(true);
  });
});

describe("M8 party P2 — a shadow-scripted 2-hero run is byte-identical across runs", () => {
  it("two independent runs with the same shadow + intent script match every step", () => {
    const script = (i: number): FrameInput[] => {
      if (i === 20) return [{}, { setShadowed: { value: true } }];
      if (i === 300) return [{}, { setShadowed: { value: false } }];
      // Stale/haunted intents on the shadowed lane (dropped) + live-lane play.
      if (i > 20 && i < 300 && i % 15 === 0)
        return [{ moveTo: { x: 300 + (i % 200) } }, { moveTo: { x: 700 } }];
      return [{}, {}];
    };
    const run = (): string[] => {
      const s = twoHeroParty(3);
      const hs: string[] = [];
      for (let i = 0; i < 500; i++) {
        step(s, script(i));
        hs.push(snap(s));
      }
      return hs;
    };
    expect(run()).toEqual(run());
  });
});

describe("M8 party P2 — a shadow's autoCast keeps casting on its frozen config", () => {
  it("a shadow with autoCast already ON still auto-casts (config isn't dropped, only writes are)", () => {
    const s = twoHeroParty(7);
    s.spawnPaused = true;
    const shadow = s.heroes[0]; // swordsman
    shadow.config.autoCast = true; // frozen ON before it drops
    step(s, [{ setShadowed: { value: true } }, {}]);
    s.enemies = [makeStubEnemy(1, shadow.x + 20)]; // inside whirl radius
    // A setHeroConfig trying to turn it OFF on the shadow lane is DROPPED — cast fires.
    step(s, [{ setHeroConfig: { autoCast: false } }, {}]);
    expect(shadow.config.autoCast).toBe(true); // frozen — the OFF write was ignored
    expect(shadow.skillCds["sword_whirl"]).toBe(SKILLS.sword_whirl.cd); // it cast
  });
});
