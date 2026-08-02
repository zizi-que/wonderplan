// ADD-button gate for Data Entry (specs/SPEND-SPEC.md §D.1). Pure predicate
// — no UI, no storage, no DOM. Bound directly by the Data Entry screen.
//
// batch shape: { trip_id, csvFile, manualRows }
//   manualRows: [{ date, merchant, amount, category }]
//
// A field is blank when it holds no value the user entered. We accept every
// representation a form binding might produce for an untouched field: "" (the
// canonical empty), null/undefined (an unbound field), and NaN (a blank
// `<input type="number">` read via valueAsNumber). A user-typed 0 is NOT
// blank — it is a real, distinct amount — so it reads as touched.
function isBlank(v) {
  return v == null || v === "" || (typeof v === "number" && Number.isNaN(v));
}

// A row is touched once any field carries a value. An untouched row is the
// empty affordance waiting to be used — it neither satisfies "at least one
// input" nor blocks "every touched row is complete".
export function isTouched(row) {
  return !isBlank(row.date) || !isBlank(row.merchant) ||
    !isBlank(row.amount) || !isBlank(row.category);
}

// A touched row is complete once ALL four fields are filled, not just the
// category — a row half-typed by hand (e.g. only a category picked) is not
// yet a real expense and must not enable ADD.
export function isComplete(row) {
  return !isBlank(row.date) && !isBlank(row.merchant) &&
    !isBlank(row.amount) && !isBlank(row.category);
}

export function canAdd(batch) {
  const { trip_id, csvFile, manualRows = [] } = batch;
  if (!trip_id) return false;

  const touched = manualRows.filter(isTouched);
  const hasInput = Boolean(csvFile) || touched.length > 0;
  if (!hasInput) return false;

  return touched.every(isComplete);
}
