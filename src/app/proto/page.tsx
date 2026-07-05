import { ProtoScene } from "./ProtoScene";

/**
 * M6.5 art-direction decision prototype, round 2 (locked direction per
 * `docs/GDD.md` "Art Direction": smooth vector rendering, anime/RO-
 * proportioned hero, paper-doll gear + weapon-borne Super-Saiyan aura on the
 * top tier). Throwaway page — self-contained under `src/app/proto/`, imports
 * nothing from `src/render`/`src/engine`/`src/ui` (mid-surgery by other
 * agents). Safe to delete this whole directory once the owner has decided.
 */
export default function ProtoPage() {
  return (
    <main className="flex min-h-screen flex-1 flex-col items-center bg-[#0a0d1a]">
      <ProtoScene />
    </main>
  );
}
