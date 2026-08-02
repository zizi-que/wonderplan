// L0 — CSV dialect inference + parsing (specs/SPEND-CATEGORIZATION.md §1 L0).
// Pure functions, no DOM, no network. ES module: runs in browser and node:test.
// A file is ONE dialect: sniff once against the whole file, then parse.

const DELIMITERS = [",", ";", "\t"];

// RFC-4180-ish tokenizer for one line with a known delimiter.
export function splitLine(line, delim) {
  const out = [];
  let field = "", inQuotes = false;
  for (let i = 0; i < line.length; i++) {
    const ch = line[i];
    if (inQuotes) {
      if (ch === '"') {
        if (line[i + 1] === '"') { field += '"'; i++; }
        else inQuotes = false;
      } else field += ch;
    } else if (ch === '"') inQuotes = true;
    else if (ch === delim) { out.push(field); field = ""; }
    else field += ch;
  }
  out.push(field);
  return out;
}

export function sniffDelimiter(lines) {
  // The right delimiter yields a consistent column count > 1 across lines.
  let best = ",", bestScore = -1;
  for (const d of DELIMITERS) {
    const counts = lines.slice(0, 20).map(l => splitLine(l, d).length);
    const cols = counts[0];
    if (cols < 2) continue;
    const consistent = counts.filter(c => c === cols).length / counts.length;
    const score = consistent * cols;
    if (score > bestScore) { bestScore = score; best = d; }
  }
  return best;
}

// Header synonym map → canonical roles.
const HEADER_ROLES = [
  [/^(transaction |posted |posting )?date$|^posted$/i, "date"],
  [/^amount$|^transaction amount$/i, "amount"],
  [/^debit$|^withdrawals?$/i, "debit"],
  [/^credit$|^deposits?$/i, "credit"],
  [/^(original )?description$|^payee$|^merchant$|^name$|^details$/i, "descriptor"],
  [/^memo$|^notes?$/i, "memo"],
  [/^category$/i, "sourceCategory"], // aggregator exports carry one; kept as hint only
];

export function mapHeaders(headerCells) {
  const roles = {};
  headerCells.forEach((raw, idx) => {
    const cell = raw.trim().replace(/^﻿/, "");
    for (const [re, role] of HEADER_ROLES) {
      if (re.test(cell) && !(role in roles)) { roles[role] = idx; break; }
    }
  });
  return roles;
}

// "$1,234.56" · "(123.45)" · "-123.45" · "123.45-" → signed number (spend = negative).
export function parseAmount(raw) {
  if (raw == null) return null;
  let s = String(raw).trim().replace(/[$,\s]/g, "");
  if (s === "") return null;
  let sign = 1;
  if (/^\(.*\)$/.test(s)) { sign = -1; s = s.slice(1, -1); }
  if (s.endsWith("-")) { sign = -1; s = s.slice(0, -1); }
  if (s.startsWith("-")) { sign = -1; s = s.slice(1); }
  if (s.startsWith("+")) s = s.slice(1);
  const n = Number(s);
  return Number.isFinite(n) ? sign * n : null;
}

// Date-format decision for the whole file: ISO wins; else MDY vs DMY by
// impossible-month test across every row (decide once, not per row).
export function sniffDateFormat(samples) {
  const clean = samples.filter(Boolean).map(s => s.trim());
  if (clean.every(s => /^\d{4}-\d{2}-\d{2}/.test(s))) return "ISO";
  let mdyOk = true, dmyOk = true, allDotted = true;
  for (const s of clean) {
    const m = s.match(/^(\d{1,2})([\/.-])(\d{1,2})[\/.-](\d{2,4})$/);
    if (!m) return null;
    const [a, b] = [Number(m[1]), Number(m[3])];
    if (a > 12) mdyOk = false;
    if (b > 12) dmyOk = false;
    if (m[2] !== ".") allDotted = false;
  }
  if (mdyOk && !dmyOk) return "MDY";
  if (dmyOk && !mdyOk) return "DMY";
  if (!mdyOk) return null;
  // Both readings possible: dotted separators are a European convention → DMY;
  // slash/dash default to US MDY (caller flags the ambiguity either way).
  return allDotted ? "DMY" : "MDY";
}

export function parseDate(raw, format) {
  const s = raw.trim();
  if (format === "ISO") return s.slice(0, 10);
  const m = s.match(/^(\d{1,2})[\/.-](\d{1,2})[\/.-](\d{2,4})$/);
  if (!m) return null;
  let [, a, b, y] = m;
  if (y.length === 2) y = (Number(y) > 68 ? "19" : "20") + y;
  const [mo, d] = format === "DMY" ? [b, a] : [a, b];
  const pad = x => String(x).padStart(2, "0");
  if (Number(mo) < 1 || Number(mo) > 12 || Number(d) < 1 || Number(d) > 31) return null;
  return `${y}-${pad(mo)}-${pad(d)}`;
}

// Whole-file entry point.
// returns { dialect, rows: [{date, amount, descriptor, memo, dedupeKey}], warnings }
export function parseStatementCSV(text) {
  const warnings = [];
  const lines = text.replace(/^﻿/, "").split(/\r\n|\n|\r/).filter(l => l.trim() !== "");
  if (lines.length < 2) return { dialect: null, rows: [], warnings: ["empty or header-only file"] };

  const delim = sniffDelimiter(lines);
  const header = splitLine(lines[0], delim);
  const roles = mapHeaders(header);
  if (!("date" in roles) || !("descriptor" in roles) ||
      !("amount" in roles || "debit" in roles || "credit" in roles)) {
    return { dialect: null, rows: [], warnings: ["unrecognized header: " + header.join(" | ")] };
  }

  const rawRows = lines.slice(1).map(l => splitLine(l, delim));
  const dateFormat = sniffDateFormat(rawRows.map(r => r[roles.date]));
  if (dateFormat === null) warnings.push("undecidable date format");
  const ambiguousDates = dateFormat === "MDY" &&
    rawRows.every(r => { const m = (r[roles.date] || "").match(/^(\d{1,2})[\/.-](\d{1,2})/); return m && Number(m[1]) <= 12 && Number(m[2]) <= 12; });
  if (ambiguousDates) warnings.push("MDY assumed (every day ≤ 12 — could be DMY)");

  const rows = [];
  for (const r of rawRows) {
    const date = dateFormat ? parseDate(r[roles.date], dateFormat) : null;
    let amount = null;
    if ("amount" in roles) amount = parseAmount(r[roles.amount]);
    else {
      const debit = parseAmount(r[roles.debit]);
      const credit = parseAmount(r[roles.credit]);
      amount = debit != null && debit !== 0 ? -Math.abs(debit)
             : credit != null ? Math.abs(credit) : null;
    }
    const descriptor = (r[roles.descriptor] || "").trim();
    if (date == null || amount == null || descriptor === "") continue; // non-data row
    rows.push({
      date, amount, descriptor,
      memo: "memo" in roles ? (r[roles.memo] || "").trim() : "",
      // L1.5 hint (MCC-derived bank category) — captured, never an assignment
      sourceCategory: "sourceCategory" in roles ? (r[roles.sourceCategory] || "").trim() : "",
      refund: amount > 0,
      dedupeKey: `${date}|${amount.toFixed(2)}|${descriptor.toUpperCase().replace(/\s+/g, " ")}`,
    });
  }
  return { dialect: { delim, roles, dateFormat }, rows, warnings };
}
