// Google sign-in, the smallest version that exists.
//
// GIS *token model* — google.accounts.oauth2.initTokenClient. No client secret,
// and NO REFRESH TOKEN IS EVER ISSUED: the access token is short-lived and
// lives in a module variable that dies with the page. That is the frozen
// ruling — "tokens are not persisted anywhere the project controls…
// re-consent instead" (2026-08-01) — honoured literally rather than
// approximated, and it is why a shared desktop cannot leak this account.
//
// What DOES persist is one flag saying the user chose to connect, so the drawn
// connected state survives a reload. A flag is not a credential.

import { CLIENT_ID, SCOPE, isConfigured } from "./drive-config.js";
import { KEYS } from "./prefs.js";

const GIS_SRC = "https://accounts.google.com/gsi/client";

// ⚠ The ONE third-party request this app makes, and it is loaded lazily on the
// Connect tap — never at boot, never for a user who does not sync. That is
// what keeps operating rule 1 ("no normal path may read or write a remote")
// literally true, and keeps the README's same-origin claim true for everyone
// who never connects.
let gisPromise = null;
function loadGis() {
  if (gisPromise) return gisPromise;
  gisPromise = new Promise((resolve, reject) => {
    if (globalThis.google?.accounts?.oauth2) return resolve(globalThis.google);
    const el = document.createElement("script");
    el.src = GIS_SRC;
    el.async = true;
    el.onload = () => globalThis.google?.accounts?.oauth2
      ? resolve(globalThis.google)
      : reject(new Error("Google sign-in loaded but exposed no OAuth client"));
    el.onerror = () => {
      gisPromise = null;                       // a retry must be able to try again
      reject(new Error("Could not reach Google sign-in"));
    };
    document.head.appendChild(el);
  });
  return gisPromise;
}

let client = null;
let token = null;
let expiresAt = 0;

// 30s of slack: a token that expires mid-upload fails the upload, and the cost
// of asking a few seconds early is nothing.
const valid = () => Boolean(token) && Date.now() < expiresAt - 30_000;

async function tokenClient() {
  if (client) return client;
  const google = await loadGis();
  client = google.accounts.oauth2.initTokenClient({
    client_id: CLIENT_ID,
    scope: SCOPE,
    callback: () => {},          // replaced per request below
  });
  return client;
}

// `prompt: ''` asks Google to answer silently when consent already exists, and
// to refuse rather than pop a window when it does not. That refusal is not an
// error — it is the signal to ask the user properly, which only a real tap may
// do (browsers block a popup that no gesture asked for).
function request(tc, prompt) {
  return new Promise((resolve, reject) => {
    tc.callback = res => {
      if (res?.error) return reject(new Error(res.error_description || res.error));
      token = res.access_token;
      expiresAt = Date.now() + (Number(res.expires_in) || 3600) * 1000;
      resolve(token);
    };
    tc.error_callback = err => {
      const type = err?.type || "";
      reject(Object.assign(
        new Error(type === "popup_closed" || type === "popup_failed_to_open"
          ? "Sign-in was cancelled."
          : (err?.message || "Sign-in failed.")),
        { needsInteraction: true }));
    };
    try { tc.requestAccessToken({ prompt }); }
    catch (e) { reject(e); }
  });
}

export const isConnected = prefs => prefs.get(KEYS.connected) === "1";

// Called from a real tap only. `consent` because this IS the moment the user
// is choosing to hand data to Google, and it should be shown, not assumed.
export async function connect(prefs) {
  if (!isConfigured()) throw new Error("Google Drive is not configured yet.");
  const tc = await tokenClient();
  await request(tc, "consent");
  prefs.set(KEYS.connected, "1");
  return true;
}

// Silent first. `interactive` is true only when a user gesture is on the stack.
export async function ensureToken(prefs, { interactive = false } = {}) {
  if (!isConfigured()) throw new Error("Google Drive is not configured yet.");
  if (valid()) return token;
  const tc = await tokenClient();
  try {
    return await request(tc, "");
  } catch (e) {
    if (!interactive) throw e;
    return request(tc, "consent");
  }
}

// Disconnect removes CREDENTIALS, not data. Revoking is the honest reading of
// that — it drops the grant on the Google account, so a shared desktop is left
// with nothing. The snapshot in Drive is deliberately untouched: a user who
// disconnects and reconnects finds it exactly where it was, and on a device
// that has since been wiped it is the only copy.
export function disconnect(prefs) {
  const dead = token;
  token = null;
  expiresAt = 0;
  prefs.remove(KEYS.connected);
  prefs.remove(KEYS.fileId);
  prefs.remove(KEYS.lastSynced);
  try { if (dead) globalThis.google?.accounts?.oauth2?.revoke(dead); } catch { /* already gone */ }
}
