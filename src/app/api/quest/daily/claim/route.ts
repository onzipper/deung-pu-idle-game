/**
 * Daily-quest claim endpoint (M8 Quest Wave B).
 *
 * POST { questId } -> the SERVER re-validates the claim it cannot trust the client for:
 * it recomputes `serverDay` (Asia/Bangkok UTC+7) + the deterministic roster server-side
 * and rejects a quest that is not in TODAY's roster (`not_in_roster`); it then INSERTs a
 * `DailyClaim` whose unique (character, quest, day) index makes a double-claim impossible
 * (`already_claimed` / 409, refine-endpoint idempotency pattern).
 *
 * NO reward is computed here — daily rewards are engine-side economy (client-authoritative,
 * same trust tier as gold, covered by the M5 re-derive ceilings). On 200 the client fires
 * the engine `claimDaily` intent (which credits the reward once), exactly like the refine
 * flow only mutates after the server confirms.
 *
 * Trust boundary: identity + active character come from httpOnly cookies, never the body.
 */

import { NextResponse } from "next/server";
import { getOrCreateUserId } from "@/server/identity";
import { resolveActiveCharacterId } from "@/server/activeCharacter";
import { recordDailyClaim, dailyClaimSchema } from "@/server/dailyQuests";

export const dynamic = "force-dynamic";

export async function POST(request: Request) {
  let body: unknown;
  try {
    body = await request.json();
  } catch {
    return NextResponse.json({ error: "invalid JSON body" }, { status: 400 });
  }

  const parsed = dailyClaimSchema.safeParse(body);
  if (!parsed.success) {
    const error = parsed.error.issues
      .map((i) => `${i.path.join(".") || "(root)"}: ${i.message}`)
      .join("; ");
    return NextResponse.json({ error }, { status: 400 });
  }

  try {
    const userId = await getOrCreateUserId();
    const characterId = await resolveActiveCharacterId(userId);
    if (!characterId) {
      return NextResponse.json(
        { error: "no active character", code: "no_active_character" },
        { status: 409 },
      );
    }

    const result = await recordDailyClaim(characterId, userId, parsed.data.questId);
    if (!result.ok) {
      // not_in_roster (wrong day / forged id) -> 400; already_claimed -> 409.
      const status = result.code === "already_claimed" ? 409 : 400;
      return NextResponse.json({ error: result.code, code: result.code }, { status });
    }
    return NextResponse.json({ ok: true, serverDay: result.serverDay });
  } catch (err) {
    console.error("[api/quest/daily/claim] POST failed:", err);
    return NextResponse.json({ error: "internal error" }, { status: 500 });
  }
}
