"use client";

/**
 * Top-level character roster + creation screen (M5 Character Pivot), mounted
 * by `src/app/characters/page.tsx`. Owns all the interactivity: fetching the
 * account's roster from `GET /api/characters`, switching between the roster
 * and creation views, selecting (`POST /api/characters/:id/select`) and
 * deleting (`DELETE /api/characters/:id`) — every mutation goes through the
 * live API contract in docs/persistence-m5.md, never a direct DB/engine call
 * (this file only talks to `@/app/api/characters*` over `fetch`, same
 * boundary `GameClient` uses for `/api/save`).
 *
 * A newly created OR newly selected character always lands the player in the
 * game (`router.push("/")`) — the game page's own server-side gate
 * (`src/app/characterGate.ts`) will resolve it as soon as `GameClient`'s
 * `GET /api/save` call persists the `activeCharacterId` cookie.
 */

import { useTranslations } from "next-intl";
import { useRouter } from "next/navigation";
import { useEffect, useState } from "react";
import { MAX_LIVE_CHARACTERS_CLIENT } from "@/ui/characters/constants";
import { CharacterCard } from "@/ui/components/characters/CharacterCard";
import { CreateCharacterForm } from "@/ui/components/characters/CreateCharacterForm";
import { DeleteCharacterDialog } from "@/ui/components/characters/DeleteCharacterDialog";
import type { CharacterDTO, NinjaUnlockDTO } from "@/ui/components/characters/types";

type LoadStatus = "loading" | "error" | "ready";
type View = "roster" | "create";

export function CharactersScreen() {
  const t = useTranslations("characters");
  const router = useRouter();

  const [status, setStatus] = useState<LoadStatus>("loading");
  const [characters, setCharacters] = useState<CharacterDTO[]>([]);
  const [ninjaUnlock, setNinjaUnlock] = useState<NinjaUnlockDTO | null>(null);
  const [view, setView] = useState<View>("roster");
  const [selectingId, setSelectingId] = useState<string | null>(null);
  const [selectError, setSelectError] = useState<string | null>(null);
  const [deleteTarget, setDeleteTarget] = useState<CharacterDTO | null>(null);

  // No sync `setStatus("loading")` at the top: the initial state is already
  // "loading", and the retry button (a real event handler, not an effect)
  // resets it explicitly.
  async function fetchCharacters() {
    try {
      const res = await fetch("/api/characters");
      if (!res.ok) throw new Error("load failed");
      const data = (await res.json()) as {
        characters: CharacterDTO[];
        ninjaUnlock: NinjaUnlockDTO;
      };
      setCharacters(data.characters);
      setNinjaUnlock(data.ninjaUnlock);
      setView(data.characters.length === 0 ? "create" : "roster");
      setStatus("ready");
    } catch {
      setStatus("error");
    }
  }

  useEffect(() => {
    // The React Compiler's `set-state-in-effect` rule flags this because
    // `fetchCharacters` eventually calls `setState` after its `await` — but
    // that's exactly the standard "fetch once on mount" pattern (there's no
    // reactive dependency to resync on; a data-fetching library like SWR/
    // React Query would do the same thing under the hood). No stale-response
    // race is possible either: this effect never re-runs with a changing key.
    // eslint-disable-next-line react-hooks/set-state-in-effect -- one-shot mount fetch, see above
    void fetchCharacters();
  }, []);

  function retry() {
    setStatus("loading");
    void fetchCharacters();
  }

  async function selectAndEnter(characterId: string) {
    setSelectError(null);
    setSelectingId(characterId);
    try {
      const res = await fetch(`/api/characters/${characterId}/select`, { method: "POST" });
      if (!res.ok) throw new Error("select failed");
      router.push("/");
    } catch {
      setSelectError(t("card.selectError"));
      setSelectingId(null);
    }
  }

  function handleCreated(character: CharacterDTO) {
    setCharacters((prev) => [character, ...prev]);
    void selectAndEnter(character.id);
  }

  function handleDeleted(characterId: string) {
    setCharacters((prev) => {
      const next = prev.filter((c) => c.id !== characterId);
      if (next.length === 0) setView("create");
      return next;
    });
    setDeleteTarget(null);
  }

  const atLimit = characters.length >= MAX_LIVE_CHARACTERS_CLIENT;

  return (
    <div className="flex w-full max-w-3xl flex-1 flex-col gap-4 px-3 py-6 sm:px-4">
      <div className="flex flex-col gap-1">
        <h1 className="text-xl font-extrabold text-ddp-gold-bright">{t("pageTitle")}</h1>
        <p className="text-[13px] text-ddp-ink-muted">{t("pageSubtitle")}</p>
      </div>

      {status === "loading" && (
        <div className="rounded-(--ddp-radius-lg) border border-ddp-border bg-ddp-panel px-4 py-6 text-center text-sm text-ddp-ink-muted">
          {t("loading")}
        </div>
      )}

      {status === "error" && (
        <div className="flex flex-col items-center gap-3 rounded-(--ddp-radius-lg) border border-ddp-bad/50 bg-ddp-bad/10 px-4 py-6 text-center">
          <span className="text-sm font-semibold text-ddp-bad">{t("loadError")}</span>
          <button
            type="button"
            onClick={retry}
            className="min-h-11 rounded-(--ddp-radius-md) border border-ddp-border bg-ddp-panel-strong px-4 py-2 text-xs font-bold text-ddp-ink"
          >
            {t("retryButton")}
          </button>
        </div>
      )}

      {status === "ready" && view === "create" && (
        <CreateCharacterForm
          onCreated={handleCreated}
          onCancel={() => setView("roster")}
          ninjaUnlock={ninjaUnlock}
        />
      )}

      {status === "ready" && view === "roster" && (
        <div className="flex flex-col gap-4">
          <div className="flex items-center justify-between gap-2">
            <span className="rounded-full border border-ddp-border-soft bg-black/40 px-2.5 py-1 text-[11px] font-bold text-ddp-ink-muted tabular-nums">
              {t("slotCount", { count: characters.length })}
            </span>
            {!atLimit && (
              <button
                type="button"
                onClick={() => setView("create")}
                className="min-h-11 rounded-(--ddp-radius-md) border border-emerald-400/60 bg-emerald-400/10 px-3 py-2 text-xs font-bold text-emerald-300 transition-all duration-100 hover:brightness-110 active:translate-y-0.5 active:scale-[0.98]"
              >
                {t("createButton")}
              </button>
            )}
          </div>

          {selectError && (
            <span className="rounded-(--ddp-radius-md) border border-ddp-bad/50 bg-ddp-bad/10 px-3 py-2 text-[12px] font-semibold text-ddp-bad">
              {selectError}
            </span>
          )}

          {characters.length === 0 ? (
            <div className="flex flex-col items-center gap-1 rounded-(--ddp-radius-lg) border border-ddp-border bg-ddp-panel px-4 py-8 text-center">
              <span className="text-sm font-bold text-ddp-ink">{t("emptyTitle")}</span>
              <span className="text-[12px] text-ddp-ink-muted">{t("emptyBody")}</span>
            </div>
          ) : (
            <div className="grid grid-cols-1 gap-3 sm:grid-cols-2">
              {characters.map((c) => (
                <CharacterCard
                  key={c.id}
                  character={c}
                  selecting={selectingId === c.id}
                  onSelect={() => void selectAndEnter(c.id)}
                  onRequestDelete={() => setDeleteTarget(c)}
                />
              ))}
            </div>
          )}
        </div>
      )}

      {deleteTarget && (
        <DeleteCharacterDialog
          character={deleteTarget}
          onCancel={() => setDeleteTarget(null)}
          onDeleted={handleDeleted}
        />
      )}
    </div>
  );
}
