import { describe, expect, it } from "vitest";
import {
  FRIEND_ERROR_KEY_BY_CODE,
  GENERIC_ERROR_KEY,
  friendErrorKey,
  partyErrorKey,
} from "@/ui/friends/partyErrors";

describe("friendErrorKey (NEVER-SILENT: every friend-request-side code -> a th/en toast)", () => {
  it("maps every known friend/party error code to a distinct translation key", () => {
    for (const code of Object.keys(FRIEND_ERROR_KEY_BY_CODE)) {
      expect(friendErrorKey(code)).toBe(FRIEND_ERROR_KEY_BY_CODE[code]);
    }
  });

  it("falls back to the generic key for an unrecognized/network code", () => {
    expect(friendErrorKey("totally_unknown_code")).toBe(GENERIC_ERROR_KEY);
    expect(friendErrorKey("network")).toBe(GENERIC_ERROR_KEY);
  });
});

describe("partyErrorKey (owner-approved informed-manual party-invite UX, case 2)", () => {
  it("maps already_in_party to its clear accept-side toast (never silent)", () => {
    expect(partyErrorKey("already_in_party")).toBe("errorAlreadyInParty");
  });

  it("maps party_full / already_member / already_invited / too_many_pending / self / not_friends / account_required through the shared dictionary", () => {
    expect(partyErrorKey("party_full")).toBe("errorPartyFull");
    expect(partyErrorKey("already_member")).toBe("errorAlreadyMember");
    expect(partyErrorKey("already_invited")).toBe("errorAlreadyInvited");
    expect(partyErrorKey("too_many_pending")).toBe("errorTooManyPending");
    expect(partyErrorKey("self")).toBe("errorSelf");
    expect(partyErrorKey("not_friends")).toBe("errorNotFriends");
    expect(partyErrorKey("account_required")).toBe("errorAccountRequired");
  });

  it("OVERRIDES not_found with a party-invite-specific key distinct from the friend-request meaning", () => {
    expect(partyErrorKey("not_found")).toBe("errorPartyInviteExpired");
    expect(friendErrorKey("not_found")).toBe("errorNotFound");
    expect(partyErrorKey("not_found")).not.toBe(friendErrorKey("not_found"));
  });

  it("falls back to the generic key for an unrecognized code", () => {
    expect(partyErrorKey("totally_unknown_code")).toBe(GENERIC_ERROR_KEY);
  });
});
