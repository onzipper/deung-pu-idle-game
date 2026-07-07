import { describe, expect, it } from "vitest";
import {
  pushClaim,
  takeBatch,
  type ClaimBufferEntry,
  type StoneClaimBufferEntry,
} from "@/ui/gear/claimBuffer";

const e = (rollId: string): ClaimBufferEntry => ({
  rollId,
  templateId: "w_sword_t1_rusty",
  stage: 1,
});

const stoneEntry = (rollId: string, qty = 2): StoneClaimBufferEntry => ({ rollId, qty });

describe("pushClaim", () => {
  it("appends a new entry", () => {
    const buf = pushClaim([], e("0"));
    expect(buf).toEqual([e("0")]);
  });

  it("dedupes by rollId (defensive against a re-dispatch bug)", () => {
    const buf = pushClaim([e("0")], e("0"));
    expect(buf).toHaveLength(1);
  });

  it("never mutates the input array", () => {
    const original: ClaimBufferEntry[] = [e("0")];
    const next = pushClaim(original, e("1"));
    expect(original).toHaveLength(1);
    expect(next).toHaveLength(2);
  });
});

describe("takeBatch", () => {
  it("splits at the cap", () => {
    const buffer = [e("0"), e("1"), e("2")];
    const { batch, remaining } = takeBatch(buffer, 2);
    expect(batch.map((x) => x.rollId)).toEqual(["0", "1"]);
    expect(remaining.map((x) => x.rollId)).toEqual(["2"]);
  });

  it("takes everything when under the cap", () => {
    const buffer = [e("0")];
    const { batch, remaining } = takeBatch(buffer, 64);
    expect(batch).toHaveLength(1);
    expect(remaining).toHaveLength(0);
  });

  it("is a no-op split on an empty buffer", () => {
    const { batch, remaining } = takeBatch([], 64);
    expect(batch).toHaveLength(0);
    expect(remaining).toHaveLength(0);
  });
});

describe("pushClaim/takeBatch generic over หินเสริมพลัง stone entries", () => {
  it("dedupes stone claims by rollId the same way as gear claims", () => {
    const buf = pushClaim(pushClaim([], stoneEntry("0")), stoneEntry("0", 5));
    expect(buf).toHaveLength(1);
    expect(buf[0].qty).toBe(2); // first push wins, second is a no-op dedupe
  });

  it("splits stone-claim buffers at the cap", () => {
    const buffer = [stoneEntry("0"), stoneEntry("1"), stoneEntry("2")];
    const { batch, remaining } = takeBatch(buffer, 2);
    expect(batch.map((x) => x.rollId)).toEqual(["0", "1"]);
    expect(remaining.map((x) => x.rollId)).toEqual(["2"]);
  });
});
