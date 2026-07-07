/**
 * Pure per-board value formatting for the Hall of Fame panel (M7.95). No
 * React/i18n dependency here — `HallOfFamePanel.tsx`/`HofProfileModal.tsx`
 * compose the localized "ชม./นาที" vs "h/m" copy around `splitOnlineSeconds`'s
 * plain numbers themselves (that phrasing genuinely differs per locale; the
 * m:ss.s clock format and thousands separators below don't).
 */

/** `level`/`power`/`gold` are plain numbers — `level` stays a bare small
 * integer (max ~90 today, a thousands separator would look odd), `power`/
 * `gold` get locale thousands separators since both can run into the tens of
 * thousands+ (mirrors `StatPanel`'s/`HudBar`'s existing `toLocaleString()`
 * convention). */
export function formatPlainValue(board: "level" | "power" | "gold", value: number): string {
  const rounded = Math.max(0, Math.round(value));
  if (board === "level") return String(rounded);
  return rounded.toLocaleString();
}

/** `m:ss.s` clear-time string for the boss board — locale-independent (a
 * colon-separated clock reads the same in both languages); sub-second
 * precision matters at endgame clear-time margins. */
export function formatBossClearTime(seconds: number): string {
  const clamped = Math.max(0, seconds);
  const whole = Math.floor(clamped);
  const minutes = Math.floor(whole / 60);
  const rest = clamped - minutes * 60;
  const restStr = rest.toFixed(1).padStart(4, "0"); // e.g. "03.4"
  return `${minutes}:${restStr}`;
}

export interface HofDuration {
  hours: number;
  minutes: number;
}

/** Hours/minutes breakdown for the online-time board. */
export function splitOnlineSeconds(seconds: number): HofDuration {
  const clamped = Math.max(0, Math.floor(seconds));
  const hours = Math.floor(clamped / 3600);
  const minutes = Math.floor((clamped % 3600) / 60);
  return { hours, minutes };
}
