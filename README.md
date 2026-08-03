# WonderPlan

A trip planner and spending tracker for Disney trips. Plan a trip, record what
you actually spend, and see a forecast of what the whole thing will cost —
parks, cruises, DVC points and all.

**Live: https://zizi-que.github.io/wonderplan/**

It runs entirely in your browser. There is no account, no sign-in, and no
server holding your data. If you want the same trips on your phone *and* your
desktop, you can connect your own Google Drive — optional, off by default, and
explained in [Syncing between devices](#syncing-between-devices).

## Open it on your phone

WonderPlan is built phone-first, and it is worth adding to your Home Screen
rather than leaving it in a browser tab:

- **iPhone / iPad** — open the link in Safari, tap Share, then **Add to Home
  Screen**.
- **Android** — open the link in Chrome, then **Add to Home screen** from the
  browser menu.

**This is not cosmetic.** Safari clears a website's stored data after **7 days
without a visit**, and your trips live in that storage. A site added to the
Home Screen is exempt from that. If you are going to enter real numbers, add it
to your Home Screen first.

## What is in it

| | |
|---|---|
| **Home** | Your next trip, what is coming up, and what you have tracked all time |
| **Trips** | Build a trip — dates, party, hotels (including split stays), parks, cruise, discounts |
| **Spend** | Log what you actually spent, by trip and category |
| **DVC** | Track contracts, points and annual dues |
| **Insights** | Where the money went, by category and by year |

Forecasts are calculated from what you have entered — they are never guessed or
stored. When a trip does not have enough information to price something,
WonderPlan shows `—` instead of inventing a number. Airfare is disclosed as
excluded rather than silently estimated.

## Syncing between devices

WonderPlan can hand your data between your own devices through **your** Google
Drive. It is off until you turn it on, and the app is fully usable forever
without it.

**This is a bridge, not Dropbox.** Nothing syncs in the background, on a timer,
or while you type. You decide when to hand the data over:

```
  Phone  →  Sync Now  →  Google Drive
                              ↓
                      Desktop  →  Sync Now  →  keep working
```

…and back the other way whenever you like.

### How to use it

Open **Settings** (the icon on Home) and scroll to *Synch your data*.

1. **Connect Google Drive** — Google asks you to sign in and approve. It then
   becomes **Sync Now**, with the time of your last sync and a Disconnect link.
2. **Sync Now** compares your last sync with what is in Drive, and asks:
   - Nothing in Drive yet → it just uploads.
   - Drive has something newer → *"A newer backup is available."* → **Download**
     or Cancel.
   - Otherwise → *"Upload local data?"* → **Upload** or Cancel.
3. **Disconnect Google Drive** removes the connection. **It does not delete
   your backup** — reconnect and it is still there.

### What you need to know before you use it

- **Both directions replace everything.** Download replaces this device's data
  with the Drive copy. Upload replaces the Drive copy with this device's data.
  There is no merging, so **whatever you did on the other device since its last
  sync is lost** if you overwrite it. The line under the button names the other
  device and the time, so you can tell what you are about to replace.
- **Sync when you finish on one device, before you start on the other.** That
  is the whole discipline. Working on both at once and syncing afterwards means
  one side wins.
- **One backup exists at a time.** Each sync replaces the previous one. There is
  no version history.

### Where the backup lives

In your Drive's **application data folder** — a private area only WonderPlan can
read. It does not appear in your Drive, does not use quota you can see, and no
other app (or person) can open it. WonderPlan can only ever see the one file it
created; it cannot read the rest of your Drive.

## Privacy

**Your data stays on your device unless you connect Google Drive.** Trips,
expenses and DVC contracts are saved in your browser's own storage (IndexedDB).
There is no WonderPlan account, no analytics, no tracking, and no server of ours
anywhere — there is nothing for us to hold, because we operate nothing.

**If you connect Drive, your data goes to your own Google account and nowhere
else.** We cannot read it. The connection is between your browser and Google.

**Until you tap Connect, WonderPlan makes no third-party requests at all.**
Everything it loads — hotel lists, price benchmarks, categorization rules, and
its two typefaces — is served from the same place as the app itself. No CDN, no
font service, no external host of any kind. You can confirm it in your browser's
Network tab: every request is same-origin. Google's sign-in script is fetched
**only** when you tap Connect Google Drive, never on startup.

**Sign-in is not stored.** WonderPlan keeps no long-lived Google credential —
only a short-lived token that lives in the page and is gone when you close it,
plus a note that you chose to connect. Nothing that could let anyone else reach
your Drive is written to your device.

**If you do not connect Drive, there is no backup.** Clearing your browser data
or switching devices loses what you have entered. Private/Incognito windows do
not keep anything either.

## Running it locally

No build step, no dependencies — it is plain HTML, CSS and JavaScript. It does
need to be served over HTTP rather than opened as a file, because it loads its
datasheets with `fetch`:

```bash
python3 -m http.server 8000
```

Then open `http://localhost:8000`.

## Setting up Google Drive sync (for whoever deploys this)

Drive sync is **inert until an OAuth client id is configured.** Out of the box
the Sync block renders and says *"Google Drive is not configured yet."* — it
never shows a button that looks live and fails. Everything else in the app works
regardless.

Because WonderPlan is a static site, it can hold no client secret. It uses
Google Identity Services' **token model**: the client id is public by design, no
secret exists, and **no refresh token is ever issued** — only a short-lived
access token that lives in the page.

### 1. Create the OAuth client

In the [Google Cloud console](https://console.cloud.google.com/):

1. Create a project, then **APIs & Services → Library → Google Drive API →
   Enable**.
2. **APIs & Services → OAuth consent screen.** Choose **External**, fill in the
   app name, support email and developer email, and give a **privacy policy
   URL** — Google requires one for any app requesting a scope. The `#privacy`
   section of this README works: `https://<user>.github.io/<repo>/#privacy`.
3. Add the scope **`.../auth/drive.appdata`** ("View and manage its own
   configuration data in your Google Drive"). It is a **non-sensitive** scope,
   so it needs only basic verification — not the sensitive-scope review that
   broader Drive scopes trigger.
4. **Credentials → Create credentials → OAuth client ID → Web application.**

### 2. Authorized JavaScript origins

Add the origin the app is served from — **origin only, no path**:

| Where | Value |
|---|---|
| GitHub Pages | `https://<user>.github.io` |
| Local testing | `http://localhost:8000` (match your port) |

> **There is no redirect URI, and you should leave that field empty.** The token
> model never navigates away from the page, so nothing redirects. If you find a
> guide telling you to register `https://<user>.github.io/<repo>/` as a redirect
> URI, it is describing the *authorization code* flow, which is a different
> thing and needs a server.

### 3. Paste the id

In [`js/sync/drive-config.js`](js/sync/drive-config.js):

```js
export const CLIENT_ID = "1234567890-abcdef.apps.googleusercontent.com";
```

That is the only change. The id is meant to be public — it identifies the app,
it authorises nothing on its own.

### 4. While the app is unverified

Until basic verification is granted, Google shows testers a *"Google hasn't
verified this app"* interstitial. Add them under **OAuth consent screen → Test
users** so they can proceed, or complete verification.

## How it is built

No framework, no build step, no dependencies. Plain ES modules loaded straight
by the browser.

| | |
|---|---|
| `js/storage/` | IndexedDB adapter, the domain repository, and the backup envelope |
| `js/sync/` | Google Drive bridge — auth, transport, and the direction decision |
| `js/categorizer/` | Deterministic bank-CSV categorization (no AI, no API keys) |
| `js/forecast.js` | Trip cost forecasting |
| `data/` | Shipped datasheets — hotels, benchmarks, categorization rules |

IndexedDB is the system of record. Drive holds a copy, never the source. The
whole database travels as one validated JSON snapshot — the same one used for
file export/import — so there is no partial state to reason about in either
direction.

## Not affiliated with Disney

WonderPlan is an unofficial, independent fan project. It is **not affiliated
with, endorsed by, sponsored by, or connected to** The Walt Disney Company or
any of its subsidiaries. Resort, hotel and product names are used only to
identify what a trip actually includes.

## License

MIT — see [LICENSE](LICENSE).

The bundled typefaces are not covered by that licence and keep their own:
**Manrope** and **42dot Sans** are both under the SIL Open Font License 1.1
(`fonts/OFL-manrope.txt`, `fonts/OFL-42dotsans.txt`).
