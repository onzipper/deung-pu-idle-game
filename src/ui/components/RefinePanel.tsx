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
 * attempt, then calls `ui/gear/refineFlow.ts`'s `executeRefine` (POST first,
 * store-apply on response) and owns the JUICE timing around that call:
 *
 *   click -> ~1s anticipation build-up (hammer-strike ticks, charging glow) —
 *   the network call fires immediately in parallel and is awaited alongside a
 *   minimum suspense timer (`Promise.all`), so a fast response never feels
 *   instant and a slow one never extends past the visual build-up finishing
 *   late -> reveal: success (flash + rising "+N!" + chime), degrade (dull thud
 *   + falling "-1"), break (shatter burst + red screen-edge flash + somber
 *   sting).
 *
 * Audio: a dedicated `AudioEngine` instance (`render/audio/refineSfx.ts`) —
 * this is a UI-initiated action, not a `GameEvent` the engine emitted, so it
 * doesn't go through `AudioController`'s per-frame event consumer; `resume()`
 * is called from the refine button's own click handler (a real user gesture).
 */

import { useTranslations } from "next-intl";
import { useEffect, useMemo, useRef, useState, type CSSProperties } from "react";
import {
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
import { executeRefine, type RefineFlowResult } from "@/ui/gear/refineFlow";
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

/** Visual/audio suspense window (ms) — the network call and this timer run
 * concurrently; the reveal waits for whichever finishes LAST. */
const CHARGE_MS = 1000;
const STRIKE_COUNT = 4;
/** How long the outcome banner (+N! / -1 / shatter) stays up before the panel
 * returns to its idle picker state. */
const OUTCOME_DISPLAY_MS = 1300;

type Phase = "idle" | "charging" | "success" | "degrade" | "safe" | "break";

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
  const inventory = useGameStore((s) => s.inventory);
  const materials = useGameStore((s) => s.materials);
  const gold = useGameStore((s) => s.gold);
  const inTown = useGameStore((s) => s.world.kind === "town");
  const soundMuted = useGameStore((s) => s.soundMuted);

  const [activeTab, setActiveTab] = useState<GearSlot>("weapon");
  const [selectedKey, setSelectedKey] = useState<string | null>(null);
  const [phase, setPhase] = useState<Phase>("idle");
  const [frozenStack, setFrozenStack] = useState<ItemStack | null>(null);
  const [errorReason, setErrorReason] = useState<string | null>(null);
  const [outcomeLevel, setOutcomeLevel] = useState<number | null>(null);

  const audioRef = useRef<AudioEngine | null>(null);
  if (audioRef.current == null) audioRef.current = createRefineAudio();
  useEffect(() => {
    audioRef.current?.setMuted(soundMuted);
  }, [soundMuted]);
  useEffect(() => {
    const audio = audioRef.current;
    return () => audio?.destroy();
  }, []);

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

  const busy = phase === "charging";
  const atMax = displayStack ? displayStack.refineLevel >= REFINE.maxRefine : false;
  const targetLevel = displayStack ? displayStack.refineLevel + 1 : 0;
  const cost = template && !atMax ? refineCost(template.tier, targetLevel) : null;
  const chance = !atMax ? successChanceForLevel(targetLevel) : 0;
  const band = !atMax ? failModeForLevel(targetLevel) : "safe";
  const canAffordMaterials = cost ? materials >= cost.materials : true;
  const canAffordGold = cost ? gold >= cost.gold : true;

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

  async function handleRefine(): Promise<void> {
    if (busy || !displayStack || disabledReason) return;
    const instanceId = displayStack.equippedInstanceId ?? displayStack.unequippedIds[0];
    if (!instanceId) return;

    const snapshot = displayStack;
    const audio = audioRef.current;
    audio?.resume(); // real user gesture — idempotent, cheap to call every time

    setFrozenStack(snapshot);
    setPhase("charging");
    setErrorReason(null);
    setOutcomeLevel(null);

    if (audio) {
      for (let i = 0; i < STRIKE_COUNT; i++) {
        playRefineChargeTick(audio, i, (i * CHARGE_MS) / STRIKE_COUNT / 1000);
      }
    }

    const [result] = await Promise.all([
      executeRefine(instanceId),
      new Promise<void>((resolve) => setTimeout(resolve, CHARGE_MS)),
    ]);

    revealOutcome(result, snapshot);
  }

  function revealOutcome(result: RefineFlowResult, snapshot: ItemStack): void {
    const audio = audioRef.current;
    if (!result.ok) {
      setPhase("idle");
      setFrozenStack(null);
      setErrorReason(result.reason);
      return;
    }

    setOutcomeLevel(result.refineLevel);
    if (result.destroyed) {
      setPhase("break");
      if (audio) playRefineBreak(audio);
    } else if (result.outcome === "success") {
      setPhase("success");
      if (audio) playRefineSuccess(audio);
    } else if (result.outcome === "degrade") {
      setPhase("degrade");
      if (audio) playRefineDegrade(audio);
    } else {
      setPhase("safe"); // fail within the +1-3 band: attempt spent, nothing changed
      if (audio) playRefineDegrade(audio);
    }

    setTimeout(() => {
      setPhase("idle");
      setFrozenStack(null);
      setSelectedKey(result.destroyed ? null : `${snapshot.templateId}:${result.refineLevel}`);
    }, OUTCOME_DISPLAY_MS);
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

      {phase === "break" && (
        <div
          aria-hidden
          className="animate-refine-edge-flash pointer-events-none fixed inset-0 z-80"
          style={{
            background:
              "radial-gradient(120% 90% at 50% 50%, transparent 45%, rgba(190,30,30,0.55) 100%)",
          }}
        />
      )}

      <div className="animate-onboarding-in relative flex max-h-[85vh] w-full max-w-md flex-col gap-3 rounded-(--ddp-radius-lg) border border-ddp-border bg-ddp-panel-strong p-4 text-ddp-ink shadow-(--ddp-shadow-panel)">
        <div className="flex items-center justify-between gap-2">
          <h2 className="flex items-center gap-1.5 text-base font-extrabold text-ddp-gold-bright">
            <span aria-hidden>⚒</span> {t("title")}
          </h2>
          <button
            type="button"
            onClick={onClose}
            className="rounded-(--ddp-radius-md) px-2 py-1.5 text-xs font-semibold text-ddp-ink-muted hover:text-ddp-ink"
          >
            ✕ {tInv("closeButton")}
          </button>
        </div>

        <div className="flex items-center gap-2">
          <span className="flex items-center gap-1 rounded-full border border-violet-400/40 bg-violet-400/10 px-2.5 py-1 text-xs font-bold tabular-nums text-violet-300">
            <MaterialIcon className="h-3.5 w-3.5" />
            {materials.toLocaleString()}
          </span>
          <span className="flex items-center gap-1 rounded-full border border-ddp-gold/30 bg-ddp-gold/10 px-2.5 py-1 text-xs font-bold tabular-nums text-ddp-gold-bright">
            <Coin className="h-3.5 w-3.5" />
            {gold.toLocaleString()}
          </span>
          {!inTown && (
            <span className="text-[11px] font-semibold text-rose-300">{t("townOnlyHint")}</span>
          )}
        </div>

        {/* Tabs */}
        <div className="flex items-center gap-1.5">
          {SLOT_ORDER.map((slot) => (
            <button
              key={slot}
              type="button"
              disabled={busy}
              onClick={() => {
                setActiveTab(slot);
                setSelectedKey(null);
              }}
              className={`flex min-h-11 flex-1 items-center justify-center gap-1.5 rounded-(--ddp-radius-md) border px-2 text-xs font-bold transition-colors disabled:opacity-50 ${
                activeTab === slot
                  ? "border-ddp-gold bg-ddp-gold/20 text-ddp-gold-bright"
                  : "border-ddp-border-soft bg-black/25 text-ddp-ink-muted"
              }`}
            >
              <span aria-hidden>{GEAR_SLOT_ICONS[slot]}</span>
              {tInv(`slot.${slot}`)}
            </button>
          ))}
        </div>

        <div className="flex-1 space-y-3 overflow-y-auto pr-1">
          {stacks.length === 0 ? (
            <p className="text-[11px] text-ddp-ink-muted/70">{t("emptyHint")}</p>
          ) : (
            <div className="grid grid-cols-4 gap-2 sm:grid-cols-5">
              {stacks.map((stack) => {
                const key = stackKey(stack);
                const tpl = ITEM_TEMPLATES[stack.templateId];
                if (!tpl) return null;
                const maxed = stack.refineLevel >= REFINE.maxRefine;
                return (
                  <button
                    key={key}
                    type="button"
                    disabled={busy}
                    onClick={() => setSelectedKey((cur) => (cur === key ? null : key))}
                    aria-pressed={selectedKey === key}
                    aria-label={tContent(`${stack.templateId}.name`)}
                    className={`relative flex min-h-16 flex-col items-center justify-center gap-0.5 rounded-(--ddp-radius-md) border-2 bg-black/40 p-1.5 transition-transform duration-100 active:scale-95 disabled:opacity-60 ${
                      selectedKey === key
                        ? "border-ddp-gold ring-2 ring-ddp-gold-bright"
                        : "border-ddp-border-soft"
                    }`}
                  >
                    <span aria-hidden className="text-xl leading-none">
                      {GEAR_SLOT_ICONS[tpl.slot]}
                    </span>
                    <span className="text-[9px] font-bold text-ddp-ink-muted">
                      {tInv("tierShort", { tier: tpl.tier })}
                      {stack.refineLevel > 0 && (
                        <span className={maxed ? "text-ddp-gold-bright" : "text-emerald-400"}>
                          {" "}
                          {tInv("refinePlus", { level: stack.refineLevel })}
                        </span>
                      )}
                    </span>
                    {stack.count > 1 && (
                      <span className="absolute -top-1.5 -right-1.5 rounded-full bg-ddp-gold px-1.5 py-0.5 text-[9px] font-black text-ddp-panel-strong">
                        ×{stack.count}
                      </span>
                    )}
                    {stack.equippedInstanceId && (
                      <span className="absolute -top-1.5 -left-1.5 rounded-full bg-emerald-400 px-1 text-[9px] font-black text-emerald-950">
                        E
                      </span>
                    )}
                  </button>
                );
              })}
            </div>
          )}

          {displayStack && template && (
            <div className="relative flex flex-col gap-2.5 rounded-(--ddp-radius-md) border border-ddp-border-soft bg-black/40 p-3">
              <div className="flex items-center gap-2">
                <span
                  aria-hidden
                  className={`relative flex h-11 w-11 shrink-0 items-center justify-center rounded-full border-2 border-amber-500/60 bg-black/50 text-xl ${
                    busy ? "animate-refine-charge" : ""
                  }`}
                  style={busy ? { animationDuration: `${CHARGE_MS}ms` } : undefined}
                >
                  {GEAR_SLOT_ICONS[template.slot]}
                  {busy &&
                    Array.from({ length: STRIKE_COUNT }).map((_, i) => (
                      <span
                        key={i}
                        className="animate-refine-strike absolute inset-0"
                        style={{ animationDelay: `${(i * CHARGE_MS) / STRIKE_COUNT}ms` }}
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
                    {statLine(template, displayStack.refineLevel)}
                  </span>
                </div>

                {/* Outcome banner (M4 juice, per spec) */}
                {phase === "success" && outcomeLevel !== null && (
                  <span className="animate-refine-rise absolute top-0 right-1 text-lg font-black text-emerald-400">
                    +{outcomeLevel}!
                  </span>
                )}
                {phase === "degrade" && (
                  <span className="animate-refine-fall absolute top-0 right-1 text-lg font-black text-amber-400">
                    -1
                  </span>
                )}
                {phase === "safe" && (
                  <span className="absolute top-0 right-1 text-xs font-bold text-ddp-ink-muted">
                    {t("outcomeSafeFail")}
                  </span>
                )}
                {phase === "break" && (
                  <span className="absolute top-0 right-1 text-sm font-black text-rose-400">
                    {t("outcomeBreak")}
                  </span>
                )}
              </div>

              {phase === "break" && (
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
                    <div className="flex items-center gap-3 text-xs font-bold">
                      <span
                        className={`flex items-center gap-1 tabular-nums ${
                          canAffordMaterials ? "text-violet-300" : "text-rose-400"
                        }`}
                      >
                        <MaterialIcon className="h-3.5 w-3.5" />
                        {cost.materials.toLocaleString()}
                      </span>
                      <span
                        className={`flex items-center gap-1 tabular-nums ${
                          canAffordGold ? "text-ddp-gold-bright" : "text-rose-400"
                        }`}
                      >
                        <Coin className="h-3.5 w-3.5" />
                        {cost.gold.toLocaleString()}
                      </span>
                    </div>
                  )}

                  <button
                    type="button"
                    disabled={!!disabledReason}
                    title={disabledReason ? t(`disabled.${disabledReason}`) : undefined}
                    onClick={handleRefine}
                    className="min-h-11 rounded-(--ddp-radius-md) border border-ddp-gold/70 bg-ddp-gold/20 px-3 text-sm font-black text-ddp-gold-bright transition-transform active:scale-95 disabled:cursor-not-allowed disabled:opacity-40"
                  >
                    {busy ? t("refiningButton") : t("refineButton")}
                  </button>
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
      </div>
    </div>
    </ModalPortal>
  );
}
