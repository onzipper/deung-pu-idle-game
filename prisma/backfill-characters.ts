/**
 * ONE-OFF backfill for the M5 Character Pivot (docs/persistence-m5.md, step 1–2).
 *
 * For every existing SaveState that is not yet linked, create ONE Character from
 * its (migrated) save blob and set `SaveState.characterId` to it. This must run
 * on the ADDITIVE schema (characterId nullable, not yet @unique) BEFORE the
 * constraint-flip push — the flip's `@unique` requires every characterId to be
 * distinct + non-null, which this establishes.
 *
 * Idempotent: only saves with `characterId == null` are processed, so a re-run is
 * safe. Each save is handled in its own transaction (create character + link).
 *
 * Run:  node node_modules/tsx/dist/cli.mjs prisma/backfill-characters.ts
 *       (add --dry to preview without writing)
 *
 * Placeholder name: "ดึ๋งปุ๊#<short>" (short = last 6 of the save id) — deliberately
 * carries a "#" so it is NOT a valid creation-form name; the creation UI can
 * detect + prompt a rename. Real names come from the creation UI.
 */

import { PrismaClient } from "@prisma/client";
import { migrate, type UnknownSave } from "@/engine";
import { powerFromSave } from "@/server/characters";

const DRY = process.argv.includes("--dry");
const prisma = new PrismaClient();

function placeholderName(saveId: string): string {
  return `ดึ๋งปุ๊#${saveId.slice(-6)}`;
}

async function main() {
  const pending = await prisma.saveState.findMany({
    where: { characterId: null },
    select: { id: true, userId: true, data: true, version: true },
  });
  console.log(`[backfill] ${pending.length} unlinked save(s)${DRY ? " (DRY RUN)" : ""}`);

  let created = 0;
  for (const row of pending) {
    const save = migrate(row.data as UnknownSave);
    const name = placeholderName(row.id);
    const level = save.hero.level;
    const power = powerFromSave(save.hero);
    console.log(
      `  save ${row.id} user ${row.userId} -> ${name} [${save.hero.cls} L${level} P${power}]`,
    );
    if (DRY) continue;

    await prisma.$transaction(async (tx) => {
      const character = await tx.character.create({
        data: { userId: row.userId, name, baseClass: save.hero.cls, level, power },
        select: { id: true },
      });
      await tx.saveState.update({
        where: { id: row.id },
        data: { characterId: character.id },
      });
    });
    created++;
  }

  // ── Verify: the flip's @unique needs every characterId distinct + non-null. ──
  const stillNull = await prisma.saveState.count({ where: { characterId: null } });
  const total = await prisma.saveState.count();
  const linked = total - stillNull;
  const distinct = await prisma.saveState.findMany({
    where: { characterId: { not: null } },
    select: { characterId: true },
    distinct: ["characterId"],
  });
  const distinctOk = distinct.length === linked;

  console.log(
    `[backfill] created ${created} · saves total ${total} · linked ${linked} · nullLeft ${stillNull} · distinctCharacterIds ${distinct.length}`,
  );
  if (stillNull > 0) {
    console.warn(`[backfill] WARNING: ${stillNull} save(s) still have characterId=null.`);
  }
  if (!distinctOk) {
    console.error(`[backfill] ERROR: characterId not distinct across linked saves — DO NOT FLIP.`);
    process.exitCode = 1;
  }
  const flipSafe = stillNull === 0 && distinctOk;
  console.log(`[backfill] FLIP-SAFE: ${flipSafe ? "YES" : "NO"}`);
}

main()
  .catch((e) => {
    console.error(e);
    process.exitCode = 1;
  })
  .finally(() => prisma.$disconnect());
