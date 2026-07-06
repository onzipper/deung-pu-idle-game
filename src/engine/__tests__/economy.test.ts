import { describe, it, expect } from "vitest";
import { initGameState, step, heroAtkSpeed, HERO_TYPES, CONFIG } from "@/engine";
import { soloSave, runUntil, worldAutopilot } from "./helpers";

/**
 * M5 solo economy + anti-stall regression. The three purchasable upgrade lines
 * are GONE — gold now only ACCUMULATES (sinks arrive in M6/M7), atk speed is fixed
 * per class, and the lone hero's death is a respawn that must never lock the run.
 */

describe("gold accumulation (no upgrade sink)", () => {
  it("gold only grows during idle play — nothing auto-spends it", () => {
    const s = initGameState(3, soloSave("swordsman", 2));
    s.autoCast = true;
    let prev = s.gold;
    let everDropped = false;
    for (let i = 0; i < 4000; i++) {
      step(s, {});
      if (s.gold < prev) everDropped = true;
      prev = s.gold;
    }
    expect(everDropped).toBe(false);
    expect(s.gold).toBeGreaterThan(0); // kills banked gold
  });
});

describe("heroAtkSpeed is a fixed per-class base (no speed line)", () => {
  it.each(["swordsman", "archer", "mage"] as const)(
    "%s attack interval equals its HERO_TYPES base",
    (cls) => {
      expect(heroAtkSpeed(cls)).toBe(HERO_TYPES[cls].atkSpeed);
    },
  );
});

describe("solo respawn (anti-stall)", () => {
  it("clears the battlefield when the lone hero dies, then revives it at full HP", () => {
    const s = initGameState(1, soloSave("mage", 3));
    const hero = s.heroes[0];
    // Spawn a wave, then kill the hero outright.
    runUntil(s, (st) => st.enemies.length > 0, 2000);
    hero.hp = 1;
    hero.dead = false;
    // One lethal enemy hit or our own force: force death directly.
    hero.hp = 0;
    hero.dead = true;
    hero.reviveTimer = CONFIG.heroReviveTime;
    step(s, {});
    // Field cleared the instant it wiped (no pile-up to respawn into).
    expect(s.enemies.length).toBe(0);
    expect(s.projectiles.every((p) => p.team === "hero")).toBe(true);
    // Revives at FULL HP after the timer (no death penalty).
    const revived = runUntil(s, (st) => !st.heroes[0].dead, 1000);
    expect(revived).toBe(true);
    expect(s.heroes[0].hp).toBe(s.heroes[0].maxHp);
  });

  it("a fresh solo hero left running unattended never permanently stalls (M6)", () => {
    // M6: progress is walking the world (farm a zone to quota -> walk to the next).
    // The autopilot mirrors an idle player; death -> town -> auto-return keeps it
    // farming. It must advance zones (higher stage) AND keep leveling, never freeze.
    const s = initGameState(7, soloSave("archer", 1));
    s.autoCast = true;
    s.autoReturn = true;
    const startStage = s.stage;
    let maxLevel = s.heroes[0].level;
    for (let i = 0; i < 120_000; i++) {
      step(s, worldAutopilot(s));
      maxLevel = Math.max(maxLevel, s.heroes[0].level);
    }
    // Progress happened: it walked into later zones AND kept leveling (never frozen).
    expect(s.stage).toBeGreaterThan(startStage);
    expect(maxLevel).toBeGreaterThan(1);
  });
});
