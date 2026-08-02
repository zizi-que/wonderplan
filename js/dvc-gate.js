// What makes a DVC contract SAVEABLE — one definition, used by the CTA gate
// and matched by repo.saveContract's throws.
//
// Why this file exists (the design director, 2026-08-02): the same ruling that produced
// js/trip-gate.js — "the save button should not be activated until all
// required fields are filled in. it is the design." — applied to Contract
// SetUp, which had the same hole.
//
// The hole it closes: dvc.html's save filtered the draft with
// `points_per_year > 0 && use_year_month > 0` and simply DROPPED anything that
// failed, BEFORE repo.saveContract was reached. So an incomplete contract was
// not rejected, it vanished — no message, and the screen fell back to the zero
// state, which reads as "saving erased my contracts". The console warning that
// exists for a rejected save never fired, because nothing was ever submitted.
//
// The gate and the repository agree by SHARING this predicate rather than each
// keeping a copy. `saveContract` keeps its own throws as the last line of
// defence — a repository that trusts its caller is not a repository — and
// tests/dvc-gate.test.mjs pins the two together so neither can drift. The
// invariant is one-directional: the gate may be STRICTER, never looser.

// EVERY drawn field is required, expiry_year included (the design director, 2026-08-02:
// "a user only has a few contracts — if they don't know the expiry year they
// can look it up. Make them all required.")
//
// This does NOT change the schema, and it must not. DATA-MODEL §5b keeps
// `expiry_year` nullable and repo.saveContract still accepts null, so every
// contract already stored without one stays valid and readable. What changed is
// the FORM: it will not let a new one be entered incomplete. That is the gate
// being stricter than the repository, which is the direction the invariant
// allows — the gate may tighten, never loosen.
//
// ⚠ One consequence, deliberate: reopening Contract SetUp on a contract stored
// before this rule (no expiry_year) leaves SAVE dark until a year is picked.
// The screen is asking for the field it now considers required, rather than
// silently re-saving an incomplete row.

// Returns every reason the contract cannot be saved, in the order the form
// asks for them. Empty array = saveable. Reasons rather than a bare boolean so
// the gate can say WHY the day a state is drawn to say it in — nothing renders
// them today (operating rule 7).
export function whyNotSaveable(contract = {}) {
  const why = [];

  // STRICTER THAN saveContract, deliberately. The repository does not demand a
  // home resort, but js/dvc.js resolves dues and home-resort point matching
  // through `resort_hotel_id` (duesRowsFor, and the allocation card's
  // same-resort grouping), so a contract without one saves cleanly and then
  // silently has no dues and matches no stay. The form draws the field; the
  // gate requires it.
  if (!contract.resort_hotel_id) why.push("home resort");

  // repo.saveContract: "use_year_month must be 1-12"
  if (!(contract.use_year_month >= 1 && contract.use_year_month <= 12))
    why.push("use year");

  // repo.saveContract: "points_per_year must be > 0"
  if (!(contract.points_per_year > 0)) why.push("points per year");

  // STRICTER THAN saveContract, on the design director's instruction: the store accepts a
  // null expiry, the form does not. The range half mirrors saveContract
  // exactly, so a picker that ever offered an out-of-range year could not
  // produce a save the store would then reject.
  if (contract.expiry_year == null) why.push("expiry year");
  else if (!(Number.isInteger(contract.expiry_year) &&
             contract.expiry_year >= 1990 && contract.expiry_year <= 2200))
    why.push("a valid expiry year");

  return why;
}

export const isSaveable = contract => whyNotSaveable(contract).length === 0;

// The CTA covers the whole draft: SAVE writes every row, so one incomplete row
// disables it. An empty draft is not saveable either — the form always carries
// at least one (blank) contract, so "no rows" means nothing has been entered.
export function draftSaveable(draft = []) {
  return draft.length > 0 && draft.every(isSaveable);
}
