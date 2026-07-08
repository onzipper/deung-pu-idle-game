"use client";

/**
 * "ตำราตำนาน" craft panel (endgame v1.2/v1.3) — the NEW, standalone main-menu
 * entry's panel (see `AsuraTomeButton.tsx`). Same `ModalPortal` shell
 * convention as every other HUD modal, mobile-first. Four live checklist rows
 * (แก่นอสูร / ศิลาโซน per-zone dots / ตราอสูร + daily claim / ค่าตี
 * gold+materials) + a t10-own-class-weapon picker + the CRAFT button.
 *
 * The ENGINE owns essence/sigils/gold/materials/the-10-zone-stones gate
 * (`craftBlockReason`); the t10 WEAPON sacrifice + the legendary MINT are
 * SERVER-side (`POST /api/asura/craft`, `ui/asura/tomeFlow.ts`) — this panel
 * only picks WHICH owned t10 weapon to sacrifice and fires that flow.
 */

import { useTranslations } from "next-intl";
import { useMemo, useState } from "react";
import { ASURA_MAP_ID, CONFIG, isLegendaryTemplate, lookupTemplate } from "@/engine";
import { Coin, MaterialIcon } from "@/ui/components/icons";
import { ModalPortal } from "@/ui/components/ModalPortal";
import { executeClaimAsuraSigil, executeCraftLegendary } from "@/ui/asura/tomeFlow";
import { executeAwakenLegendary } from "@/ui/asura/awakenFlow";
import { awakenGate } from "@/ui/asura/awakenView";
import { useGameStore } from "@/ui/store/gameStore";

const TOME_COST = CONFIG.asura.tome.craft;
const ZONE_STONE_GOAL = CONFIG.asura.zoneStoneGoal;
const FARM_ZONES = CONFIG.asura.farmZones;

/** One checklist row: label, live progress "n/goal", and a bar — shared shape
 * for the essence/sigil/gold/materials rows (the zone-stone row draws its own
 * 10-dot strip instead, see `ZoneStoneDots`). */
function ChecklistRow({
  icon,
  label,
  have,
  goal,
  complete,
  extra,
}: {
  icon: React.ReactNode;
  label: string;
  have: number;
  goal: number;
  complete: boolean;
  extra?: React.ReactNode;
}) {
  const pct = goal > 0 ? Math.min(100, (have / goal) * 100) : 100;
  return (
    <div className="flex flex-col gap-1.5 rounded-(--ddp-radius-md) border border-ddp-border-soft bg-black/25 px-3 py-2.5">
      <div className="flex items-center justify-between gap-2">
        <span className="flex items-center gap-1.5 text-[12px] font-bold text-ddp-ink">
          {icon}
          <span>{label}</span>
        </span>
        <span
          className={`shrink-0 text-[11px] font-bold tabular-nums ${
            complete ? "text-emerald-400" : "text-ddp-ink-muted"
          }`}
        >
          {have.toLocaleString()}/{goal.toLocaleString()}
        </span>
      </div>
      <div className="h-2 w-full overflow-hidden rounded-full bg-black/40 ring-1 ring-ddp-border-soft ring-inset">
        <div
          className={`h-full rounded-full transition-[width] duration-300 ${
            complete ? "bg-emerald-400" : "bg-fuchsia-400"
          }`}
          style={{ width: `${pct}%` }}
        />
      </div>
      {extra}
    </div>
  );
}

/** ศิลาโซน — 10 dots, one per asura farm zone, lit once that zone's LIFETIME
 * kill counter has crossed `CONFIG.asura.zoneStoneGoal` (the PERMANENT "climb
 * every zone once" gate — `hasAllZoneStones` is the same read, just per-zone
 * here for the dot strip). */
function ZoneStoneDots({
  asuraZoneKills,
  t,
}: {
  asuraZoneKills: Record<string, number>;
  t: ReturnType<typeof useTranslations>;
}) {
  const earned = Array.from({ length: FARM_ZONES }, (_, depth) => {
    const kills = asuraZoneKills[`${ASURA_MAP_ID}:${depth}`] ?? 0;
    return kills >= ZONE_STONE_GOAL;
  });
  const count = earned.filter(Boolean).length;
  return (
    <div className="flex flex-col gap-1.5 rounded-(--ddp-radius-md) border border-ddp-border-soft bg-black/25 px-3 py-2.5">
      <div className="flex items-center justify-between gap-2">
        <span className="flex items-center gap-1.5 text-[12px] font-bold text-ddp-ink">
          <span aria-hidden>🪨</span>
          <span>{t("checklist.stones")}</span>
        </span>
        <span
          className={`shrink-0 text-[11px] font-bold tabular-nums ${
            count === FARM_ZONES ? "text-emerald-400" : "text-ddp-ink-muted"
          }`}
        >
          {count}/{FARM_ZONES}
        </span>
      </div>
      <div className="flex flex-wrap gap-1.5">
        {earned.map((got, i) => (
          <span
            key={i}
            title={t("checklist.zoneDot", { n: i + 1 })}
            className={`flex h-5 w-5 items-center justify-center rounded-full text-[9px] font-black ${
              got
                ? "bg-emerald-400 text-emerald-950"
                : "border border-ddp-border-soft bg-black/40 text-ddp-ink-muted"
            }`}
          >
            {i + 1}
          </span>
        ))}
      </div>
    </div>
  );
}

/**
 * "ปลุกพลัง" AWAKENING section (endgame v1.3) — the post-craft progression path.
 * Lists every owned legendary with its current awaken +N/5, the NEXT step's gold +
 * stone cost, and a guaranteed-success button (100%, never breaks). Hidden until the
 * player actually owns a legendary. `awakenGate` is the shared pure cost/gate logic
 * (same order the server enforces); the toast lands via `pushNotice`.
 */
function AwakenSection({
  legendaries,
  gold,
  materials,
  t,
  tContent,
}: {
  legendaries: { instanceId: string; templateId: string; refineLevel: number }[];
  gold: number;
  materials: number;
  t: ReturnType<typeof useTranslations>;
  tContent: ReturnType<typeof useTranslations>;
}) {
  const pushNotice = useGameStore((s) => s.pushNotice);
  const [busyId, setBusyId] = useState<string | null>(null);

  async function handleAwaken(instanceId: string): Promise<void> {
    if (busyId) return;
    setBusyId(instanceId);
    const res = await executeAwakenLegendary(instanceId);
    setBusyId(null);
    if (res.ok) {
      pushNotice("asuraAwakened", { level: res.refineLevel });
    } else {
      pushNotice("asuraAwakenFailed", { reason: t(`awaken.error.${res.reason}`) });
    }
  }

  if (legendaries.length === 0) return null;

  return (
    <div className="flex flex-col gap-2 rounded-(--ddp-radius-md) border border-fuchsia-400/30 bg-fuchsia-400/5 p-3">
      <h3 className="flex items-center gap-1.5 text-[12px] font-bold text-fuchsia-200">
        <span aria-hidden>🔮</span>
        {t("awaken.title")}
      </h3>
      {legendaries.map((leg) => {
        const gate = awakenGate(leg.templateId, leg.refineLevel, gold, materials);
        const busy = busyId === leg.instanceId;
        return (
          <div
            key={leg.instanceId}
            className="flex flex-col gap-1.5 rounded-(--ddp-radius-md) border border-ddp-border-soft bg-black/30 p-2.5"
          >
            <div className="flex items-center justify-between gap-2">
              <span className="min-w-0 truncate text-[12px] font-bold text-ddp-ink">
                {tContent(`${leg.templateId}.name`)}
              </span>
              <span className="shrink-0 text-[11px] font-black tabular-nums text-fuchsia-300">
                {t("awaken.levelReadout", { current: gate.current, max: gate.max })}
              </span>
            </div>

            {gate.status === "maxed" ? (
              <p className="text-center text-[11px] font-bold text-emerald-300">
                {t("awaken.maxed")}
              </p>
            ) : (
              <>
                <div className="flex items-center justify-center gap-3 text-[11px] font-bold tabular-nums">
                  <span
                    className={`flex items-center gap-1 ${
                      gold >= gate.cost.gold ? "text-ddp-ink-muted" : "text-rose-300"
                    }`}
                  >
                    <Coin className="h-3.5 w-3.5" />
                    {gate.cost.gold.toLocaleString()}
                  </span>
                  <span
                    className={`flex items-center gap-1 ${
                      materials >= gate.cost.stones ? "text-ddp-ink-muted" : "text-rose-300"
                    }`}
                  >
                    <MaterialIcon className="h-3.5 w-3.5" />
                    {gate.cost.stones.toLocaleString()}
                  </span>
                </div>
                <button
                  type="button"
                  disabled={busy || gate.status !== "ready"}
                  onClick={() => void handleAwaken(leg.instanceId)}
                  className="min-h-10 w-full rounded-(--ddp-radius-md) border border-fuchsia-400 bg-fuchsia-400/15 px-3 text-[12px] font-black text-fuchsia-100 transition-transform duration-100 active:scale-[0.98] disabled:cursor-not-allowed disabled:opacity-40"
                >
                  {busy
                    ? t("awaken.awakeningButton")
                    : gate.status === "gold"
                      ? t("awaken.needGold")
                      : gate.status === "stones"
                        ? t("awaken.needStones")
                        : t("awaken.button", { target: gate.target })}
                </button>
              </>
            )}
          </div>
        );
      })}
    </div>
  );
}

export function AsuraTomePanel({ onClose }: { onClose: () => void }) {
  const t = useTranslations("asura.tome");
  const tContent = useTranslations("content.items");
  const asuraEssence = useGameStore((s) => s.asuraEssence);
  const asuraSigils = useGameStore((s) => s.asuraSigils);
  const asuraZoneKills = useGameStore((s) => s.asuraZoneKills);
  const hasAllZoneStones = useGameStore((s) => s.hasAllZoneStones);
  const canCraftLegendary = useGameStore((s) => s.canCraftLegendary);
  const gold = useGameStore((s) => s.gold);
  const materials = useGameStore((s) => s.materials);
  const inventory = useGameStore((s) => s.inventory);
  const heroCls = useGameStore((s) => s.heroes[0]?.cls);

  const [selectedInstanceId, setSelectedInstanceId] = useState<string | null>(null);
  const [claiming, setClaiming] = useState(false);
  const [claimResult, setClaimResult] = useState<"ok" | "fail" | null>(null);
  const [crafting, setCrafting] = useState(false);
  const [craftError, setCraftError] = useState<string | null>(null);
  const [craftedName, setCraftedName] = useState<string | null>(null);

  // The recipe's own-class t10 weapon (any of the 4 class t10 templates — legendary
  // templates themselves are NEVER offered here, `lookupTemplate` already excludes
  // them from `ITEM_TEMPLATES`-tier reads since they carry `LEGENDARY_TIER`, 11).
  const t10Weapons = useMemo(
    () =>
      inventory.filter((i) => {
        if (i.slot !== "weapon") return false;
        const tpl = lookupTemplate(i.templateId);
        return !!tpl && tpl.tier === 10 && (tpl.classReq === null || tpl.classReq === heroCls);
      }),
    [inventory, heroCls],
  );

  // Owned "ตำราตำนาน" legendaries — the awakening ("ปลุกพลัง") targets. One per class,
  // but list any the bag holds (kind-tagged, so distinct from same-rarity epics).
  const legendaries = useMemo(
    () => inventory.filter((i) => isLegendaryTemplate(i.templateId)),
    [inventory],
  );

  async function handleClaimSigil(): Promise<void> {
    setClaiming(true);
    const res = await executeClaimAsuraSigil();
    setClaiming(false);
    setClaimResult(res.ok ? "ok" : "fail");
  }

  async function handleCraft(): Promise<void> {
    if (!selectedInstanceId || crafting) return;
    setCrafting(true);
    setCraftError(null);
    const res = await executeCraftLegendary(selectedInstanceId);
    setCrafting(false);
    if (res.ok && res.item) {
      setCraftedName(tContent(`${res.item.templateId}.name`));
      setSelectedInstanceId(null);
    } else {
      setCraftError(res.reason ?? "unknown");
    }
  }

  const cost = TOME_COST;
  const canPickWeapon = t10Weapons.length > 0;
  const craftDisabled = !canCraftLegendary || !selectedInstanceId || crafting;

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
          aria-label={t("closeButton")}
          onClick={onClose}
          className="absolute inset-0 bg-black/70"
        />
        <div className="animate-onboarding-in relative flex max-h-[85vh] w-full max-w-lg flex-col gap-3 rounded-(--ddp-radius-lg) border border-fuchsia-400/40 bg-ddp-panel-strong p-4 text-ddp-ink shadow-[0_0_30px_6px_rgba(217,70,239,0.15)]">
          <div className="flex items-center justify-between gap-2">
            <h2 className="bg-gradient-to-r from-ddp-gold-bright via-fuchsia-300 to-violet-400 bg-clip-text text-base font-black text-transparent">
              ⚒️ {t("title")}
            </h2>
            <button
              type="button"
              onClick={onClose}
              className="rounded-(--ddp-radius-md) px-2 py-1.5 text-xs font-semibold text-ddp-ink-muted hover:text-ddp-ink"
            >
              ✕ {t("closeButton")}
            </button>
          </div>

          <div className="flex-1 space-y-2.5 overflow-y-auto pr-1">
            <ChecklistRow
              icon={<span aria-hidden>✨</span>}
              label={t("checklist.essence")}
              have={asuraEssence}
              goal={cost.essence}
              complete={asuraEssence >= cost.essence}
            />
            <ZoneStoneDots asuraZoneKills={asuraZoneKills} t={t} />
            <ChecklistRow
              icon={<span aria-hidden>🔥</span>}
              label={t("checklist.sigils")}
              have={asuraSigils}
              goal={cost.sigils}
              complete={asuraSigils >= cost.sigils}
              extra={
                <button
                  type="button"
                  disabled={claiming}
                  onClick={() => void handleClaimSigil()}
                  className="min-h-9 w-full rounded-(--ddp-radius-md) border border-fuchsia-400/60 bg-fuchsia-400/15 px-3 text-[11px] font-bold text-fuchsia-200 transition-transform duration-100 active:scale-[0.98] disabled:opacity-50"
                >
                  {claiming ? t("claimingButton") : t("claimSigilButton")}
                </button>
              }
            />
            {claimResult === "fail" && (
              <p className="text-center text-[11px] text-rose-300">{t("claimSigilFailed")}</p>
            )}
            <ChecklistRow
              icon={<Coin className="h-3.5 w-3.5" />}
              label={t("checklist.gold")}
              have={gold}
              goal={cost.gold}
              complete={gold >= cost.gold}
            />
            <ChecklistRow
              icon={<MaterialIcon className="h-3.5 w-3.5" />}
              label={t("checklist.materials")}
              have={materials}
              goal={cost.materials}
              complete={materials >= cost.materials}
            />

            <div className="flex flex-col gap-2 rounded-(--ddp-radius-md) border border-ddp-border-soft bg-black/25 p-3">
              <h3 className="text-[11px] font-bold text-ddp-ink-muted">{t("weaponPickerLabel")}</h3>
              {canPickWeapon ? (
                <div className="grid grid-cols-3 gap-2">
                  {t10Weapons.map((w) => (
                    <button
                      key={w.instanceId}
                      type="button"
                      onClick={() =>
                        setSelectedInstanceId((cur) => (cur === w.instanceId ? null : w.instanceId))
                      }
                      aria-pressed={selectedInstanceId === w.instanceId}
                      className={`flex min-h-11 flex-col items-center justify-center rounded-(--ddp-radius-md) border-2 bg-black/40 p-1.5 text-center text-[10px] font-bold text-ddp-ink transition-transform duration-100 active:scale-95 ${
                        selectedInstanceId === w.instanceId
                          ? "border-ddp-gold ring-2 ring-ddp-gold-bright"
                          : "border-ddp-border-soft"
                      }`}
                    >
                      <span className="truncate">{tContent(`${w.templateId}.name`)}</span>
                      {w.equippedSlot && (
                        <span className="text-[9px] text-emerald-400">{t("equippedTag")}</span>
                      )}
                    </button>
                  ))}
                </div>
              ) : (
                <p className="text-[11px] text-ddp-ink-muted/70">{t("noWeaponHint")}</p>
              )}
            </div>

            {!hasAllZoneStones && (
              <p className="text-center text-[11px] text-amber-300">{t("blockReason.stones")}</p>
            )}
            {craftError && (
              <p className="text-center text-[11px] text-rose-300">{t(`craftError.${craftError}`)}</p>
            )}
            {craftedName && (
              <p className="text-center text-[12px] font-bold text-emerald-300">
                {t("craftSuccess", { name: craftedName })}
              </p>
            )}

            <button
              type="button"
              disabled={craftDisabled}
              onClick={() => void handleCraft()}
              className="min-h-11 w-full rounded-(--ddp-radius-md) border border-fuchsia-400 bg-gradient-to-r from-ddp-gold/20 via-fuchsia-400/20 to-violet-400/20 px-3 text-sm font-black text-fuchsia-100 transition-transform duration-100 active:scale-[0.98] disabled:cursor-not-allowed disabled:opacity-40"
            >
              {crafting ? t("craftingButton") : t("craftButton")}
            </button>

            <AwakenSection
              legendaries={legendaries}
              gold={gold}
              materials={materials}
              t={t}
              tContent={tContent}
            />
          </div>
        </div>
      </div>
    </ModalPortal>
  );
}
