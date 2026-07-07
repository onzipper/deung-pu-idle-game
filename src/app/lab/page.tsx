import type { Metadata } from "next";
import { LabScreen } from "@/lab/LabScreen";

/**
 * Art-experiment sandbox (owner-approved plan: `page-lab-serialized-turing.md`).
 * "Hidden on production" means unlisted, not gated — there is no in-game
 * link to this route and it's marked `noindex`; anyone with the direct URL
 * (including from a phone) can view it. Write access to `public/lab-assets/`
 * (upload/delete) is separately restricted to dev by the API route itself
 * (`src/app/api/lab/assets/route.ts`) — this page has no auth gate.
 */
export const metadata: Metadata = {
  title: "lab",
  robots: { index: false, follow: false },
};

export default function LabPage() {
  return <LabScreen />;
}
