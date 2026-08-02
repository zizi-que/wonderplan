/* ═══════════════════════════════════════════════════════════════════════
   theme.js — the one place the chosen palette is read and written.

   Loaded as a CLASSIC, BLOCKING script in <head>, before the screen's own
   <style>. That ordering is deliberate and load-bearing: it sets
   <html data-theme="…"> before the first paint, so a reload lands straight
   in the stored theme with no flash of apple. A `defer`, `async` or
   `type="module"` tag would run after layout and the flash comes back.

   Storage is localStorage, not IndexedDB: the theme has to be readable
   synchronously at head time, and IndexedDB is async by construction. It is
   a display preference, not user data, so it is outside the export/import
   contract (operating rule 1 covers records, not chrome).

   Chunk 1, 2026-07-27.
   ═══════════════════════════════════════════════════════════════════════ */
(function () {
  'use strict';

  /* Key named by specs/START-SPEC.md v2 (the design director, 2026-07-19). The unbuilt Start
     screen is the other writer of this value, so the two must agree. */
  var KEY     = 'dt-theme';
  var DEFAULT = 'apple';

  /* Must stay in step with css/theme.css. An id that is not on this list is
     ignored rather than applied, so a stale or hand-edited localStorage
     value can never leave the app with no palette at all. */
  var THEMES = [
    'apple', 'lagoon', 'canyon', 'crimson',
    'coral', 'rose', 'oasis', 'meadow',
    'olive', 'highland', 'heather', 'sky',
    'gold', 'glacier', 'lavender', 'jade'
  ];

  function valid(id) {
    return typeof id === 'string' && THEMES.indexOf(id) !== -1;
  }

  /* Safari in private mode throws on localStorage access rather than
     returning null, so every touch is guarded. A storage failure downgrades
     to "theme does not persist", never to a broken screen. */
  function read() {
    var id = null;
    try { id = window.localStorage.getItem(KEY); } catch (e) { /* no storage */ }
    return valid(id) ? id : DEFAULT;
  }

  function apply(id) {
    document.documentElement.setAttribute('data-theme', valid(id) ? id : DEFAULT);
  }

  /* Commit: persist, then paint. Returns false for an unknown id so a caller
     can tell "rejected" from "saved but storage unavailable". */
  function save(id) {
    if (!valid(id)) return false;
    try { window.localStorage.setItem(KEY, id); } catch (e) { /* no storage */ }
    apply(id);
    return true;
  }

  function current() {
    return document.documentElement.getAttribute('data-theme') || DEFAULT;
  }

  apply(read());   /* before first paint — this is the whole point of the file */

  window.Theme = {
    KEY: KEY,
    DEFAULT: DEFAULT,
    THEMES: THEMES,
    valid: valid,
    read: read,
    apply: apply,
    save: save,
    current: current
  };
})();
