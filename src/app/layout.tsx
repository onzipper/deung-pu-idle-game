import type { Metadata } from "next";
import { Chakra_Petch, Geist, Geist_Mono } from "next/font/google";
import "./globals.css";

const geistSans = Geist({
  variable: "--font-geist-sans",
  subsets: ["latin"],
});

const geistMono = Geist_Mono({
  variable: "--font-geist-mono",
  subsets: ["latin"],
});

/**
 * HUD display/body face (task 86d3k2tap — full HUD redesign). Chakra Petch is
 * drawn for BOTH Latin and Thai (not a Latin face with a generic Thai
 * fallback), so headers, tabular numerals, and Thai copy in the HUD all read
 * as one gamey, legible voice. Self-hosted via next/font (bundled at build
 * time, no runtime Google Fonts CDN request) — see globals.css's `body`
 * font-family for where this is consumed, and its Thai system fallbacks.
 */
const chakraPetch = Chakra_Petch({
  variable: "--font-display",
  subsets: ["latin", "thai"],
  weight: ["400", "500", "600", "700"],
});

export const metadata: Metadata = {
  title: "ดึ๋งปุ๊ Idle Game",
  description:
    "เกมไอเดิลผจญภัยฮีโร่ 3 คลาส ปราบเวฟศัตรู ท้าบอส อัพเกรดไม่หยุด",
};

// DEV-ONLY diagnostics: inline (not external-file) client error beacon.
//
// This has to be an *inline* <script> in <head> (not a separate file/module)
// so it still runs even if the main JS bundle fails to parse/load on a device
// we can't attach devtools to (e.g. a phone). It must therefore be ES5-safe
// (var, function(){}, no arrow fns/template literals/optional chaining) so it
// parses on literally any browser, including ones that would choke on the
// modern-syntax main bundle.
//
// Reports window "error" (including resource-load failures for
// script/link/img tags) and "unhandledrejection" events, plus a one-shot
// "boot-ping" fired immediately, to /api/client-log (dev-only sink). Safe to
// delete this whole block (and src/app/api/client-log) once done debugging.
const DEV_CLIENT_BEACON_SCRIPT = `
(function () {
  try {
    var ENDPOINT = "/api/client-log";

    function send(payload) {
      try {
        payload.userAgent = navigator.userAgent;
        payload.url = String(location.href);
        payload.time = new Date().toISOString();
        var body = JSON.stringify(payload);
        var sent = false;
        if (navigator.sendBeacon) {
          try {
            var blob = new Blob([body], { type: "application/json" });
            sent = navigator.sendBeacon(ENDPOINT, blob);
          } catch (e) {
            sent = false;
          }
        }
        if (!sent) {
          fetch(ENDPOINT, {
            method: "POST",
            headers: { "Content-Type": "application/json" },
            body: body,
            keepalive: true,
          }).catch(function () {});
        }
      } catch (e) {
        /* never let the beacon itself throw */
      }
    }

    window.addEventListener("error", function (event) {
      try {
        var target = event && event.target;
        if (
          target &&
          target !== window &&
          (target.tagName === "SCRIPT" ||
            target.tagName === "LINK" ||
            target.tagName === "IMG")
        ) {
          send({
            type: "resource-error",
            tagName: target.tagName,
            src: target.src || target.href || null,
          });
          return;
        }
        send({
          type: "error",
          message: event && event.message,
          filename: event && event.filename,
          lineno: event && event.lineno,
          colno: event && event.colno,
        });
      } catch (e) {
        /* swallow */
      }
    }, true);

    window.addEventListener("unhandledrejection", function (event) {
      try {
        var reason = event && event.reason;
        var reasonMessage = null;
        try {
          reasonMessage = reason && reason.message ? reason.message : String(reason);
        } catch (e) {
          reasonMessage = "<unstringifiable reason>";
        }
        send({ type: "unhandledrejection", reason: reasonMessage });
      } catch (e) {
        /* swallow */
      }
    });

    send({ type: "boot-ping" });
  } catch (e) {
    /* the inline script must never throw and block <head> parsing */
  }
})();
`;

export default function RootLayout({
  children,
}: Readonly<{
  children: React.ReactNode;
}>) {
  return (
    <html
      lang="th"
      className={`${geistSans.variable} ${geistMono.variable} ${chakraPetch.variable} h-full antialiased`}
    >
      <head>
        {process.env.NODE_ENV === "development" && (
          // DEV-ONLY diagnostics: see DEV_CLIENT_BEACON_SCRIPT comment above.
          <script
            dangerouslySetInnerHTML={{ __html: DEV_CLIENT_BEACON_SCRIPT }}
          />
        )}
      </head>
      {/* Background/text color come from globals.css's `body { }` rule
          (--background/--foreground tokens) — not redeclared here so there is
          exactly one source of truth for the app-wide dark theme. */}
      <body className="flex min-h-full flex-col">{children}</body>
    </html>
  );
}
