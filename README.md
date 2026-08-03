# WonderPlan

A trip planner and spending tracker for Disney trips. Plan a trip, record what
you actually spend, and see a forecast of what the whole thing will cost —
parks, cruises, DVC points and all.

**Live: https://zizi-que.github.io/wonderplan/**

It runs entirely in your browser. There is no account, no sign-in, and no
server holding your data.

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

## Privacy

**Your data stays on your device.** Trips, expenses and DVC contracts are saved
in your browser's own storage (IndexedDB). Nothing you enter is uploaded,
synced, shared, or sent anywhere. There is no account, no analytics, no
tracking, and no third-party scripts.

Everything the app loads at runtime — hotel lists, price benchmarks,
categorization rules — comes from files served alongside the app itself.

**One thing to know, because "nothing leaves your device" should be exact:**
the pages load their typeface (Manrope) from **Google Fonts**. Serving a font
means Google's servers receive the ordinary information any web request carries
— your IP address and browser. That happens on page load and has nothing to do
with what you type into the app; none of your trips, expenses or contract
details are involved. If that matters to you, the font can be self-hosted and
the app will then make no third-party requests at all.

**There is no backup yet.** Because everything is local, clearing your browser
data or switching devices loses what you have entered. Private/Incognito
windows do not keep anything either.

## Running it locally

No build step, no dependencies — it is plain HTML, CSS and JavaScript. It does
need to be served over HTTP rather than opened as a file, because it loads its
datasheets with `fetch`:

```bash
python3 -m http.server 8000
```

Then open `http://localhost:8000`.

## Not affiliated with Disney

WonderPlan is an unofficial, independent fan project. It is **not affiliated
with, endorsed by, sponsored by, or connected to** The Walt Disney Company or
any of its subsidiaries. Resort, hotel and product names are used only to
identify what a trip actually includes.

## License

MIT — see [LICENSE](LICENSE).
