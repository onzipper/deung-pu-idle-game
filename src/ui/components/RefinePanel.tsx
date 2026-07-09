"use client";

/**
 * M7.6 ตีบวก (Refine) — the town refine station. Same modal shell convention as
 * `InventoryPanel.tsx`/`SettingsPanel.tsx` (fixed overlay, sim never pauses
 * behind it). Pick any owned item (equipped OR unequipped, per spec) and
 * attempt to push its +level up by one.
 *
 * SERVER-AUTHORITATIVE roll (CLAUDE.md — the client never rolls): this panel
 * only reads `@/engine/config/refine`'s pure DISPLAY helpers (`refineCost`,
 * `successChanceForLevel`, `failModeForLevel`) to show cost/odds BEFORE the
 * attempt, then calls `ui/gear/refineFlow.ts`'s `executeRefine` (POST only —
 * no store mutation) and drives `ui/gear/refineReveal.ts`'s pure reveal state
 * machine around it.
 *
 * Reveal redesign (owner: "ผลลัพธ์เผยตอนค้อนลงเท่านั้น" — the result must NEVER be
 * visible before the final hammer strike lands): the network call fires
 * immediately on click, but EVERY visible update (the +N level, gold/stones,
 * item list, equipped stats, outcome text) is withheld in `refineReveal.ts`'s
 * `held` value until the state machine transitions into `{ kind: "reveal" }` —
 * see that module's doc for the exact invariant. Choreography:
 *
 *   click -> locks the button -> `beatPlanFor()` picks a 2/3/4-beat slow->fast
 *   hammer sequence (2 for a guaranteed-success "ใช้แกร่ง" fortify, 3 for the
 *   safe/degrade bands, 4 + a subtle shake for the +8..+10 break band) ->
 *   final strike lands -> white flash -> REVEAL at that exact frame: success
 *   (rising "+N!" + chime), degrade (dull thud + falling "-1"), break (shatter
 *   burst + red screen-edge flash + somber sting). `applyRefineResult` (the
 *   actual store commit) is called from THIS reveal transition, not from the
 *   network response — see the `revealState` effect below.
 *
 * Audio: a dedicated `AudioEngine` instance (`render/audio/refineSfx.ts`) —
 * this is a UI-initiated action, not a `GameEvent` the engine emitted, so it
 * doesn't go through `AudioController`'s per-frame event consumer; `resume()`
 * is called from the refine button's own click handler (a real user gesture).
 */

import { useTranslations } from "next-intl";
import { useEffect, useMemo, useReducer, useRef, useState, type CSSProperties } from "react";
import {
  FORTIFIER_FOR_SLOT,
  ITEM_TEMPLATES,
  REFINE,
  failModeForLevel,
  refineCost,
  refinedStat,
  successChanceForLevel,
  type GearSlot,
  type ItemTemplate,
} from "@/engine";
import { Coin, MaterialIcon } from "@/ui/components/icons";
import { ModalPortal } from "@/ui/components/ModalPortal";
import { Button } from "@/ui/components/primitives/Button";
import { CurrencyChip } from "@/ui/components/primitives/CurrencyChip";
import { ItemTile } from "@/ui/components/primitives/ItemTile";
import { Panel } from "@/ui/components/primitives/Panel";
import { PanelHeader } from "@/ui/components/primitives/PanelHeader";
import { TabRow } from "@/ui/components/primitives/TabRow";
import { applyRefineResult, executeRefine } from "@/ui/gear/refineFlow";
import { IDLE_REVEAL_STATE, beatPlanFor, refineRevealReducer } from "@/ui/gear/refineReveal";
import { groupIntoStacks, type ItemStack } from "@/ui/gear/stacking";
import { useGameStore } from "@/ui/store/gameStore";
import {
  createRefineAudio,
  playRefineBreak,
  playRefineChargeTick,
  playRefineDegrade,
  playRefineSuccess,
  type AudioEngine,
} from "@/render/audio";
import { GEAR_SLOT_ICONS, prestigeNameClass } from "@/ui/labels";

const SLOT_ORDER: readonly GearSlot[] = ["weapon", "armor"];

/** Server/network failure reasons this panel knows how to explain (every
 * possible `postRefine`/`RefineFlowResult` `reason` — see `messages/*.json`'s
 * `refine.apiError.*`, enumerated rather than probed at runtime). Anything
 * else falls back to `apiError.unknown`. */
const KNOWN_API_ERRORS = new Set([
  "not_found",
  "max",
  "insufficient_materials",
  "insufficient_gold",
  "unknown_template",
  "network",
]);

/** How long the outcome banner (+N! / -1 / shatter) stays up before the panel
 * returns to its idle picker state. */
const OUTCOME_DISPLAY_MS = 1300;
/** How long the final-beat shake (break band only) lingers before clearing. */
const SHAKE_MS = 340;

function stackKey(stack: Pick<ItemStack, "templateId" | "refineLevel">): string {
  return `${stack.templateId}:${stack.refineLevel}`;
}

function statLine(template: ItemTemplate, level: number): string {
  const parts: string[] = [];
  if (template.stats.atk) parts.push(`ATK ${refinedStat(template.stats.atk, level)}`);
  if (template.stats.def) parts.push(`DEF ${refinedStat(template.stats.def, level)}`);
  if (template.stats.hp) parts.push(`HP ${refinedStat(template.stats.hp, level)}`);
  return parts.join(" · ");
}

/**
 * R2-W3 mockup addition ("ATK 70 → 77"): the item card's stat delta for the
 * ATTEMPT about to happen (current +level vs. the target +level), computed
 * purely off `refinedStat` — no server call, no roll. Same non-spoiler
 * contract as the success-% line beside it: both are pure functions of the
 * FROZEN `displayStack`/`template`, so this text is stable and never updates
 * mid-strike (see the module doc's reveal-suspense invariant).
 */
function statCompareLine(template: ItemTemplate, currentLevel: number, nextLevel: number): string {
  const parts: string[] = [];
  if (template.stats.atk) {
    parts.push(
      `ATK ${refinedStat(template.stats.atk, currentLevel)} → ${refinedStat(template.stats.atk, nextLevel)}`,
    );
  }
  if (template.stats.def) {
    parts.push(
      `DEF ${refinedStat(template.stats.def, currentLevel)} → ${refinedStat(template.stats.def, nextLevel)}`,
    );
  }
  if (template.stats.hp) {
    parts.push(
      `HP ${refinedStat(template.stats.hp, currentLevel)} → ${refinedStat(template.stats.hp, nextLevel)}`,
    );
  }
  return parts.join(" · ");
}

function shardStyle(i: number): CSSProperties {
  const angle = (i / 6) * Math.PI * 2;
  const dist = 26 + (i % 3) * 6;
  return {
    "--dx": `${Math.round(Math.cos(angle) * dist)}px`,
    "--dy": `${Math.round(Math.sin(angle) * dist)}px`,
    animationDelay: `${i * 0.015}s`,
  } as CSSProperties;
}

export interface RefinePanelProps {
  onClose: () => void;
}

export function RefinePanel({ onClose }: RefinePanelProps) {
  const t = useTranslations("refine");
  const tInv = useTranslations("inventory");
  const tContent = useTranslations("content.items");
  const tLore = useTranslations("asura.tome.lore");
  // R2-W3 reskin: reuses the SAME gold/materials aria copy `HudBar.tsx`'s
  // `CurrencyChip`s already use (no new i18n strings for this reskin).
  const tHud = useTranslations("hud");
  const inventory = useGameStore((s) => s.inventory);
  const materials = useGameStore((s) => s.materials);
  const gold = useGameStore((s) => s.gold);
  const inTown = useGameStore((s) => s.world.kind === "town");
  const soundMuted = useGameStore((s) => s.soundMuted);
  // "ตำราตำนาน" secret-quest breadcrumb (endgame v1.3, owner: discoverable WITHOUT patch
  // notes) — TALKING to ลุงดึ๋ง while pages are held but the tome isn't yet assembled plays
  // a short mysterious lore beat (escalating per page milestone) BEFORE the refine station.
  // `loreDismissed` is local (fresh per NPC-talk mount, see `TownNpcPanelHost.tsx`), so
  // walking away and talking again replays the SAME milestone's lore until it advances or
  // the tome assembles — a deliberate, replayable breadcrumb, not a one-shot toast.
  const tomePagesFound = useGameStore((s) => s.tomePagesFound);
  const tomeUnlocked = useGameStore((s) => s.tomeUnlocked);
  const [loreDismissed, setLoreDismissed] = useState(false);
  const loreStage = tomePagesFound >= 2 ? 2 : tomePagesFound >= 1 ? 1 : 0;
  const showLore = loreStage > 0 && !tomeUnlocked && !loreDismissed;

  const [activeTab, setActiveTab] = useState<GearSlot>("weapon");
  const [selectedKey, setSelectedKey] = useState<string | null>(null);
  const [revealState, dispatch] = useReducer(refineRevealReducer, IDLE_REVEAL_STATE);
  const [frozenStack, setFrozenStack] = useState<ItemStack | null>(null);
  const [errorReason, setErrorReason] = useState<string | null>(null);
  /** Which beat of the CURRENT attempt's hammer sequence has visually landed
   * (0..totalBeats). Deliberately separate from `revealState`'s own gating
   * `beat` counter: a fast network response can transition the state machine
   * straight from "striking" to "reveal" on the SAME beat that lands, but the
   * escalating spark spans below still need to render every beat that fired. */
  const [visualBeat, setVisualBeat] = useState(0);
  /** Final-beat impact shake (break/+8..+10 band only) — plays across the
   * reveal transition too (see `beatPlanFor`'s doc), so it's independent of
   * `revealState.kind`. */
  const [shaking, setShaking] = useState(false);
  /** Whether the CURRENT attempt is a guaranteed-success "ใช้แกร่ง" fortify —
   * combined with `band` (stable while `frozenStack` pins the item) this is
   * enough to recompute the exact plan used to schedule this attempt's
   * timers, purely from render-time state (no refs — reading a ref during
   * render trips `react-hooks/refs`). */
  const [usingFortifier, setUsingFortifier] = useState(false);

  const audioRef = useRef<AudioEngine | null>(null);
  if (audioRef.current == null) audioRef.current = createRefineAudio();
  useEffect(() => {
    audioRef.current?.setMuted(soundMuted);
  }, [soundMuted]);
  useEffect(() => {
    const audio = audioRef.current;
    return () => audio?.destroy();
  }, []);

  // The outcome reveal is tap-to-skip (owner request): a tap during the strike
  // build-up OR the reveal fast-forwards straight to the settled end state
  // instead of forcing the player to wait out the full animation before the
  // next hammer — see the `revealState` effect below (its cleanup does the
  // actual "return to idle picker" reset, so a skip and a natural timeout
  // settle produce an IDENTICAL end state).
  const beatTimersRef = useRef<ReturnType<typeof setTimeout>[]>([]);
  const shakeTimeoutRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  /** The in-flight attempt's target instance + template — stashed here (not
   * `frozenStack` state) so the reveal effect below never needs `frozenStack`
   * in its dependency array. */
  const pendingAttemptRef = useRef<{ instanceId: string; templateId: string } | null>(null);

  function clearBeatTimers(): void {
    beatTimersRef.current.forEach(clearTimeout);
    beatTimersRef.current = [];
  }

  useEffect(
    () => () => {
      clearBeatTimers();
      if (shakeTimeoutRef.current != null) clearTimeout(shakeTimeoutRef.current);
    },
    [],
  );

  const allStacks = useMemo(() => groupIntoStacks(inventory), [inventory]);
  const stacks = useMemo(
    () =>
      allStacks
        .filter((s) => s.slot === activeTab)
        .sort((a, b) => {
          const tierDiff =
            (ITEM_TEMPLATES[b.templateId]?.tier ?? 0) - (ITEM_TEMPLATES[a.templateId]?.tier ?? 0);
          return tierDiff !== 0 ? tierDiff : b.refineLevel - a.refineLevel;
        }),
    [allStacks, activeTab],
  );

  const liveStack = stacks.find((s) => stackKey(s) === selectedKey) ?? null;
  const displayStack = frozenStack ?? liveStack;
  const template = displayStack ? ITEM_TEMPLATES[displayStack.templateId] : null;

  // Non-idle covers the strike build-up AND the outcome reveal window — a tap
  // must not race a second `handleRefine` against the still-frozen stale
  // snapshot (that race is what corrupted the frozenStack/selectedKey handoff
  // and forced a manual re-select). The button re-enables exactly when the
  // reveal finishes and its settle closure has already re-anchored selection
  // to the item's new refine level.
  const busy = revealState.kind !== "idle";
  const isReveal = revealState.kind === "reveal";
  const revealHeld = revealState.kind === "reveal" ? revealState.held : null;
  const isCharging = revealState.kind === "pending" || revealState.kind === "striking";
  const atMax = displayStack ? displayStack.refineLevel >= REFINE.maxRefine : false;
  const targetLevel = displayStack ? displayStack.refineLevel + 1 : 0;
  const cost = template && !atMax ? refineCost(template.tier, targetLevel) : null;
  const chance = !atMax ? successChanceForLevel(targetLevel) : 0;
  const band = !atMax ? failModeForLevel(targetLevel) : "safe";
  const canAffordMaterials = cost ? materials >= cost.materials : true;
  const canAffordGold = cost ? gold >= cost.gold : true;
  // World-boss wave: how many matching-slot "แกร่ง" fortifiers do I own? Fortifiers
  // are fungible (no stat rolls, never equipped) — a plain templateId count is exact.
  const fortifierTemplateId = displayStack ? FORTIFIER_FOR_SLOT[displayStack.slot] : null;
  const fortifierCount = fortifierTemplateId
    ? inventory.filter((i) => i.templateId === fortifierTemplateId).length
    : 0;
  // Pure re-derivation of the CURRENT attempt's beat plan — safe to compute at
  // render time (no refs) since `band` stays stable while `frozenStack` pins
  // the item through the whole striking/reveal window.
  const activePlan = beatPlanFor(usingFortifier ? "fortified" : band);

  const disabledReason: string | null = !displayStack
    ? "pickItem"
    : !inTown
      ? "townOnly"
      : atMax
        ? "maxLevel"
        : !canAffordMaterials
          ? "insufficientMaterials"
          : !canAffordGold
            ? "insufficientGold"
            : null;

  async function handleRefine(useFortifier = false): Promise<void> {
    if (busy || !displayStack || disabledReason) return;
    if (useFortifier && fortifierCount <= 0) return;
    const instanceId = displayStack.equippedInstanceId ?? displayStack.unequippedIds[0];
    if (!instanceId) return;

    const snapshot = displayStack;
    const audio = audioRef.current;
    audio?.resume(); // real user gesture — idempotent, cheap to call every time

    setFrozenStack(snapshot);
    setErrorReason(null);
    setVisualBeat(0);
    setShaking(false);
    setUsingFortifier(useFortifier);
    pendingAttemptRef.current = { instanceId, templateId: snapshot.templateId };

    const plan = beatPlanFor(useFortifier ? "fortified" : band);
    dispatch({ type: "start", totalBeats: plan.totalBeats });

    // Schedule the strike choreography up front (own timers, not the reducer —
    // the reducer stays a pure "what beat are we on" state machine). The
    // network call below fires in parallel and may resolve before or after
    // any of these beats land; either ordering is handled by the reducer.
    clearBeatTimers();
    let elapsedMs = 0;
    plan.beatDelaysMs.forEach((delay, i) => {
      elapsedMs += delay;
      const isFinalBeat = i === plan.totalBeats - 1;
      const timer = setTimeout(() => {
        if (audio) playRefineChargeTick(audio, i);
        setVisualBeat(i + 1);
        if (isFinalBeat && plan.shake) {
          setShaking(true);
          if (shakeTimeoutRef.current != null) clearTimeout(shakeTimeoutRef.current);
          shakeTimeoutRef.current = setTimeout(() => setShaking(false), SHAKE_MS);
        }
        dispatch({ type: "beat" });
      }, elapsedMs);
      beatTimersRef.current.push(timer);
    });

    const result = await executeRefine(instanceId, useFortifier);
    if (!result.ok) {
      clearBeatTimers();
      dispatch({ type: "settle" });
      setFrozenStack(null);
      setErrorReason(result.reason);
      pendingAttemptRef.current = null;
      return;
    }

    dispatch({ type: "resultReady", held: result });
  }

  // The reveal transition (and ONLY the reveal transition) commits the
  // withheld result to the store + plays outcome SFX — the exact enforcement
  // point for "ผลลัพธ์เผยตอนค้อนลงเท่านั้น": nothing above this effect ever touches
  // gold/materials/inventory before the state machine says `reveal`. The
  // cleanup (NOT a one-off closure) does the "return to idle picker" reset,
  // so it runs identically whether reveal ends via the natural timeout below
  // OR an early skip tap (`skipReveal` just dispatches `"skip"`, which flips
  // `revealState` away from `reveal` immediately and lets THIS cleanup fire).
  useEffect(() => {
    if (revealState.kind !== "reveal") return;
    const held = revealState.held;
    const audio = audioRef.current;
    const attempt = pendingAttemptRef.current;
    if (attempt) applyRefineResult(attempt.instanceId, held);

    if (audio) {
      if (held.outcomeKind === "break") playRefineBreak(audio);
      else if (held.outcomeKind === "success") playRefineSuccess(audio);
      else playRefineDegrade(audio); // degrade + safe share the dull-thud sting
    }

    const timer = setTimeout(() => dispatch({ type: "settle" }), OUTCOME_DISPLAY_MS);

    return () => {
      clearTimeout(timer);
      setFrozenStack(null);
      const finished = pendingAttemptRef.current;
      pendingAttemptRef.current = null;
      setSelectedKey(
        held.destroyed || !finished ? null : `${finished.templateId}:${held.refineLevel}`,
      );
    };
  }, [revealState]);

  /** Tap-to-skip (owner: stays): a tap during EITHER the strike build-up or the
   * reveal jumps straight to reveal / retires it early. Never calls
   * `handleRefine` itself, so a skip tap can never double-fire an attempt. */
  function skipReveal(): void {
    if (!busy) return;
    clearBeatTimers();
    dispatch({ type: "skip" });
  }

  return (
    <ModalPortal>
    <div
      className="fixed inset-0 z-70 flex items-center justify-center p-3"
      role="dialog"
      aria-modal="true"
      aria-label={t("title")}
    >
      <button
        type="button"
        aria-label={tInv("closeButton")}
        onClick={onClose}
        className="absolute inset-0 bg-black/70"
      />

      {revealHeld?.outcomeKind === "break" && (
        <div
          aria-hidden
          className="animate-refine-edge-flash pointer-events-none fixed inset-0 z-80"
          style={{
            background:
              "radial-gradient(120% 90% at 50% 50%, transparent 45%, rgba(190,30,30,0.55) 100%)",
          }}
        />
      )}

      <Panel
        variant="gold"
        className="animate-onboarding-in relative flex max-h-[85vh] w-full max-w-md flex-col gap-3"
      >
        <PanelHeader
          title={t("title")}
          icon="⚒"
          actions={
            <Button variant="secondary" className="px-2.5 py-1.5 text-[11px]" onClick={onClose}>
              ✕ {tInv("closeButton")}
            </Button>
          }
        />

        {showLore ? (
          <TomeLoreCard stage={loreStage as 1 | 2} onContinue={() => setLoreDismissed(true)} t={tLore} />
        ) : (
          <>
        <div className="flex items-center gap-2">
          <CurrencyChip
            icon={<MaterialIcon className="h-3.5 w-3.5" />}
            value={materials}
            variant="violet"
            ariaLabel={tHud("materialsAria")}
          />
          <CurrencyChip icon={<Coin className="h-3.5 w-3.5" />} value={gold} variant="gold" ariaLabel={tHud("goldAria")} />
          {!inTown && (
            <span className="text-[11px] font-semibold text-rose-300">{t("townOnlyHint")}</span>
          )}
        </div>

        {/* Tabs */}
        <TabRow
          tabs={SLOT_ORDER.map((slot) => ({
            id: slot,
            label: tInv(`slot.${slot}`),
            icon: GEAR_SLOT_ICONS[slot],
            disabled: busy,
          }))}
          active={activeTab}
          onChange={(slot) => {
            setActiveTab(slot);
            setSelectedKey(null);
          }}
        />

        <div className="flex-1 space-y-3 overflow-y-auto pr-1">
          {stacks.length === 0 ? (
            <p className="text-[11px] text-ddp-ink-muted/70">{t("emptyHint")}</p>
          ) : (
            <div className="grid grid-cols-4 gap-2 sm:grid-cols-5">
              {stacks.map((stack) => {
                const key = stackKey(stack);
                const tpl = ITEM_TEMPLATES[stack.templateId];
                if (!tpl) return null;
                return (
                  <ItemTile
                    key={key}
                    rarity={tpl.rarity}
                    tier={tpl.tier}
                    selected={selectedKey === key}
                    disabled={busy}
                    onClick={() => setSelectedKey((cur) => (cur === key ? null : key))}
                    ariaLabel={tContent(`${stack.templateId}.name`)}
                    glyph={GEAR_SLOT_ICONS[tpl.slot]}
                    subLabel={tInv("tierShort", { tier: tpl.tier })}
                    refineBadge={
                      stack.refineLevel > 0 ? tInv("refinePlus", { level: stack.refineLevel }) : undefined
                    }
                    qty={stack.count}
                    cornerTopLeft={
                      stack.equippedInstanceId ? (
                        <span className="rounded-full bg-emerald-400 px-1 font-black text-emerald-950">
                          E
                        </span>
                      ) : undefined
                    }
                  />
                );
              })}
            </div>
          )}

          {displayStack && template && (
            <div
              className={`relative flex flex-col gap-2.5 rounded-(--ddp-radius-md) border border-ddp-border-soft bg-black/40 p-3 ${
                busy ? "cursor-pointer" : ""
              } ${shaking ? "animate-refine-shake" : ""}`}
              onClick={busy ? skipReveal : undefined}
              role={busy ? "button" : undefined}
            >
              {/* Reveal-frame white flash — plays for every outcome, right before
                  the outcome-specific juice below takes over (owner spec: "final
                  strike -> white flash -> REVEAL at that exact frame"). */}
              {isReveal && (
                <span
                  aria-hidden
                  // Warm amber at reduced peak (0.45 via the keyframe) instead of white @0.85 —
                  // a pure-white flash is painful for players in a dark room and risky for
                  // photosensitive users (owner note 2026-07-08); the reveal beat stays.
                  className="animate-refine-flash pointer-events-none absolute inset-0 rounded-(--ddp-radius-md) bg-amber-200"
                />
              )}
              <div className="flex items-center gap-2">
                <span
                  aria-hidden
                  className={`relative flex h-11 w-11 shrink-0 items-center justify-center rounded-full border-2 border-amber-500/60 bg-black/50 text-xl ${
                    isCharging ? "animate-refine-charge" : ""
                  }`}
                  style={
                    isCharging
                      ? {
                          animationDuration: `${activePlan.beatDelaysMs.reduce((a, b) => a + b, 0)}ms`,
                        }
                      : undefined
                  }
                >
                  {GEAR_SLOT_ICONS[template.slot]}
                  {isCharging &&
                    Array.from({ length: visualBeat }).map((_, i) => (
                      <span
                        key={i}
                        aria-hidden
                        className="animate-refine-strike absolute inset-0"
                        style={{ "--strike-scale": `${1.15 + i * 0.06}` } as CSSProperties}
                      />
                    ))}
                </span>
                <div className="flex min-w-0 flex-1 flex-col leading-tight">
                  <span
                    className={`truncate text-sm ${
                      prestigeNameClass(displayStack.refineLevel) || "font-bold text-ddp-ink"
                    }`}
                  >
                    {tContent(`${displayStack.templateId}.name`)}
                  </span>
                  <span className="text-[11px] tabular-nums text-ddp-ink-muted">
                    {/* R2-W3 mockup addition: "ATK 70 → 77" once there's a next
                        level to attempt — pure `refinedStat` math off the
                        FROZEN `displayStack`/`template`, so this text is stable
                        for the whole strike (same non-spoiler contract as the
                        success-% line below). At max there's no "next", so it
                        falls back to the plain current-stat line. */}
                    {!atMax
                      ? statCompareLine(template, displayStack.refineLevel, targetLevel)
                      : statLine(template, displayStack.refineLevel)}
                  </span>
                </div>

                {/* Outcome banner (M4 juice, per spec) — ONLY ever rendered off
                    `revealHeld`, which is null until the state machine reaches
                    `reveal`, so no number here can leak before the final strike. */}
                {revealHeld?.outcomeKind === "success" && (
                  <span className="animate-refine-rise absolute top-0 right-1 text-lg font-black text-emerald-400">
                    +{revealHeld.refineLevel}!{" "}
                    {revealHeld.fortified && (
                      <span className="text-sm text-violet-300">{t("outcomeFortified")}</span>
                    )}
                  </span>
                )}
                {revealHeld?.outcomeKind === "degrade" && (
                  <span className="animate-refine-fall absolute top-0 right-1 text-lg font-black text-amber-400">
                    -1
                  </span>
                )}
                {revealHeld?.outcomeKind === "safe" && (
                  <span className="absolute top-0 right-1 text-xs font-bold text-ddp-ink-muted">
                    {t("outcomeSafeFail")}
                  </span>
                )}
                {revealHeld?.outcomeKind === "break" && (
                  <span className="absolute top-0 right-1 text-sm font-black text-rose-400">
                    {t("outcomeBreak")}
                  </span>
                )}
              </div>

              {revealHeld?.outcomeKind === "break" && (
                <div aria-hidden className="pointer-events-none absolute inset-0">
                  {Array.from({ length: 7 }).map((_, i) => (
                    <span
                      key={i}
                      className="animate-refine-shatter absolute top-8 left-8 h-2 w-2 rotate-45 bg-rose-400"
                      style={shardStyle(i)}
                    />
                  ))}
                </div>
              )}

              {!atMax ? (
                <>
                  <div className="flex items-center justify-between text-xs">
                    <span className="text-ddp-ink-muted">
                      {t("currentLabel", { level: displayStack.refineLevel })} →{" "}
                      <span className="font-bold text-ddp-gold-bright">
                        {t("nextLabel", { level: targetLevel })}
                      </span>
                    </span>
                    <span
                      className={
                        band === "safe"
                          ? "font-bold text-emerald-400"
                          : band === "degrade"
                            ? "font-bold text-amber-400"
                            : "font-bold text-rose-400"
                      }
                    >
                      {t("successChanceLabel", { pct: Math.round(chance * 100) })}
                    </span>
                  </div>

                  <p
                    className={`text-[11px] ${
                      band === "safe"
                        ? "text-emerald-400"
                        : band === "degrade"
                          ? "text-amber-400"
                          : "text-rose-400"
                    }`}
                  >
                    {t(`band.${band}`)}
                  </p>

                  {cost && (
                    <div className="flex items-center gap-2">
                      <CurrencyChip
                        icon={<MaterialIcon className="h-3.5 w-3.5" />}
                        value={cost.materials}
                        variant="violet"
                        ariaLabel={tHud("materialsAria")}
                      />
                      <CurrencyChip
                        icon={<Coin className="h-3.5 w-3.5" />}
                        value={cost.gold}
                        variant="gold"
                        ariaLabel={tHud("goldAria")}
                      />
                      {(!canAffordMaterials || !canAffordGold) && (
                        <span className="text-[10px] font-bold text-rose-400">
                          {t(`disabled.${!canAffordMaterials ? "insufficientMaterials" : "insufficientGold"}`)}
                        </span>
                      )}
                    </div>
                  )}

                  <div className="flex gap-2">
                    <Button
                      // Only truly inert while genuinely unable to act at idle —
                      // during striking/reveal the button must stay clickable
                      // (native `disabled` blocks click entirely) so a tap on it
                      // can skip straight to reveal / settle.
                      disabled={revealState.kind === "idle" && !!disabledReason}
                      title={disabledReason ? t(`disabled.${disabledReason}`) : undefined}
                      onClick={() => {
                        if (busy) {
                          skipReveal();
                          return;
                        }
                        void handleRefine(false);
                      }}
                      className={`flex-1 text-sm ${isReveal ? "opacity-70" : ""}`}
                    >
                      {busy ? t("refiningButton") : t("refineButton")}
                    </Button>
                    {/* World-boss wave: guaranteed-success fortify — same cost, no roll.
                        Only offered while an owned "แกร่ง" fortifier matches this slot. */}
                    {fortifierCount > 0 && (
                      <Button
                        variant="secondary"
                        disabled={revealState.kind === "idle" && !!disabledReason}
                        title={disabledReason ? t(`disabled.${disabledReason}`) : undefined}
                        onClick={() => {
                          if (busy) {
                            skipReveal();
                            return;
                          }
                          void handleRefine(true);
                        }}
                        className={`flex-1 ${isReveal ? "opacity-70" : ""}`}
                      >
                        {t("fortifyButton", { count: fortifierCount })}
                      </Button>
                    )}
                  </div>
                  {disabledReason && (
                    <p className="text-center text-[11px] text-rose-300">
                      {t(`disabled.${disabledReason}`)}
                    </p>
                  )}
                </>
              ) : (
                <p className="text-center text-xs font-bold text-ddp-gold-bright">
                  {t("disabled.maxLevel")}
                </p>
              )}
            </div>
          )}

          {errorReason && (
            <p className="text-center text-[11px] text-rose-300">
              {t(`apiError.${KNOWN_API_ERRORS.has(errorReason) ? errorReason : "unknown"}`)}
            </p>
          )}
        </div>
          </>
        )}
      </Panel>
    </div>
    </ModalPortal>
  );
}

/**
 * "ตำราตำนาน" secret-quest lore card (endgame v1.3) — RefinePanel's own
 * mysterious-tone breadcrumb, shown INSTEAD of the refine station while
 * `showLore` holds (see `RefinePanel`'s doc). `stage` 1 = first page found
 * (ตำนานช่างตีเหล็กอสูร intro); 2 = second page found (deeper into the
 * legend). Never shown at stage 0/3+ (the caller already gates that).
 */
function TomeLoreCard({
  stage,
  onContinue,
  t,
}: {
  stage: 1 | 2;
  onContinue: () => void;
  t: ReturnType<typeof useTranslations>;
}) {
  return (
    <div className="flex flex-col gap-3 rounded-(--ddp-radius-md) border border-amber-800/40 bg-black/30 p-3">
      <h3 className="text-sm font-black text-amber-300">{t(`stage${stage}.title`)}</h3>
      <div className="space-y-2 text-[12px] leading-snug text-ddp-ink">
        {(["line1", "line2", "line3", "line4"] as const).map((key) => (
          <p key={key} className="rounded-(--ddp-radius-md) bg-black/25 p-2">
            {t(`stage${stage}.${key}`)}
          </p>
        ))}
      </div>
      <button
        type="button"
        onClick={onContinue}
        className="min-h-11 w-full rounded-(--ddp-radius-md) border border-amber-600/60 bg-amber-600/15 px-3 text-xs font-bold text-amber-200 transition-transform duration-100 active:scale-[0.98]"
      >
        {t("continueButton")}
      </button>
    </div>
  );
}
