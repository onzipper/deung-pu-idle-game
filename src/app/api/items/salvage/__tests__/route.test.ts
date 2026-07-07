import { describe, it, expect } from "vitest";
import { POST } from "@/app/api/items/salvage/route";

/**
 * Salvage was removed (หินเสริมพลัง wave): the route is now a 410 Gone stub so a
 * client still deployed mid-session gets a clean "gone" signal (not a 404/500) when
 * it posts an old salvage batch. The UI/bot salvage paths are removed in the UI wave.
 */
describe("POST /api/items/salvage — removed (410 stub)", () => {
  it("returns 410 Gone with code salvage_removed", async () => {
    const res = await POST();
    expect(res.status).toBe(410);
    const body = await res.json();
    expect(body.code).toBe("salvage_removed");
  });
});
