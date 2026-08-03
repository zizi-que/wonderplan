// Which device this is — an id for the snapshot's meta block, and a name for
// the one line that tells a user what they are about to overwrite.
//
// Neither is an account and neither is sent anywhere except into the user's
// own snapshot, inside their own Drive. The name is DERIVED, never asked for.

import { KEYS } from "./prefs.js";

// Same fallback as js/storage/repo.js: randomUUID needs a secure context, and
// a phone on plain http during local testing is not one.
const uuid = () => (globalThis.crypto?.randomUUID?.() ??
  "xxxxxxxx-xxxx-4xxx-yxxx-xxxxxxxxxxxx".replace(/[xy]/g, c => {
    const r = Math.random() * 16 | 0;
    return (c === "x" ? r : (r & 0x3) | 0x8).toString(16);
  }));

// Survives a storage that throws: without this the id would be regenerated on
// every call in a private window, and one sync could write two identities.
let sessionId = null;

// Generated once, then stable forever. Persisted OUTSIDE the backup contract
// (see prefs.js) — this identifies the device, and must not travel with the
// data to the other one.
export function getDeviceId(prefs) {
  const stored = prefs.get(KEYS.deviceId);
  if (stored) return stored;
  if (!sessionId) sessionId = uuid();
  prefs.set(KEYS.deviceId, sessionId);
  return sessionId;
}

const PLATFORMS = [
  [/iPhone/i,            "iPhone"],
  [/iPad/i,              "iPad"],
  [/Android/i,           "Android"],
  [/Macintosh|Mac OS X/i, "Mac"],
  [/Windows/i,           "Windows"],
  [/CrOS/i,              "Chromebook"],
  [/Linux|X11/i,         "Linux"],
];

// Order matters: Edge and Opera both carry "Chrome" in their UA, and every
// iOS browser carries "Safari". Most specific first.
const BROWSERS = [
  [/Edg\//i,          "Edge"],
  [/OPR\/|Opera/i,    "Opera"],
  [/CriOS/i,          "Chrome"],
  [/FxiOS/i,          "Firefox"],
  [/Firefox\//i,      "Firefox"],
  [/Chrome\//i,       "Chrome"],
  [/Safari\//i,       "Safari"],
];

const first = (table, ua) => table.find(([re]) => re.test(ua))?.[1] ?? null;

// A hint on a confirm line, not an identifier — nothing ever DECIDES on this
// value. An unrecognised agent yields "This device" rather than a guess.
export function deviceName(nav = globalThis.navigator) {
  const ua = typeof nav?.userAgent === "string" ? nav.userAgent : "";
  if (!ua) return "This device";

  let platform = first(PLATFORMS, ua);
  // iPadOS 13+ reports itself as a Macintosh. Touch points are the standard
  // way back: a real Mac reports 0, an iPad reports 5.
  if (platform === "Mac" && nav?.maxTouchPoints > 1) platform = "iPad";

  const browser = first(BROWSERS, ua);
  if (!platform) return browser ?? "This device";
  return browser ? `${platform} · ${browser}` : platform;
}
