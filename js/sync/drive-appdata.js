// Google Drive AppData transport — find, download, create, update. Four calls,
// no state, `fetch` injected so the whole file is testable in node.
//
// AppData (`spaces=appDataFolder`) is a per-app hidden folder in the user's own
// Drive. It cannot be browsed, shared or reached by another app, which is what
// makes "the project is never a data custodian" true at the technical level
// rather than the policy one (frozen 2026-08-01).

import { FILE_NAME } from "./drive-config.js";

const API    = "https://www.googleapis.com/drive/v3";
const UPLOAD = "https://www.googleapis.com/upload/drive/v3";

// The snapshot's own timestamp, carried as file metadata so that DECIDING
// which way to sync costs one small request instead of downloading the whole
// database to read its first field. On a phone on cellular that difference is
// the feature working or being avoided.
const propsFrom = meta => ({
  backupTime: String(meta?.backupTime ?? ""),
  deviceName: String(meta?.deviceName ?? ""),
});

async function ok(res, what) {
  if (res.ok) return res;
  // Google puts a usable reason in the body; the status alone reads as noise.
  let detail = "";
  try { detail = ((await res.json())?.error?.message) ?? ""; } catch { /* not json */ }
  throw new Error(`Drive ${what} failed (${res.status})${detail ? `: ${detail}` : ""}`);
}

export function createDriveAppData({ accessToken, fetch: doFetch = globalThis.fetch }) {
  const auth = () => ({ Authorization: `Bearer ${accessToken}` });

  // One multipart body for both create and update — metadata part, then the
  // snapshot. Content is JSON text, so a string body is safe; no Blob needed.
  const multipart = (metadata, content) => {
    const b = `wp-${Math.random().toString(36).slice(2)}`;
    const body =
      `--${b}\r\nContent-Type: application/json; charset=UTF-8\r\n\r\n` +
      `${JSON.stringify(metadata)}\r\n` +
      `--${b}\r\nContent-Type: application/json; charset=UTF-8\r\n\r\n` +
      `${content}\r\n` +
      `--${b}--`;
    return { body, headers: { ...auth(), "Content-Type": `multipart/related; boundary=${b}` } };
  };

  return {
    // The one backup, or null. `spaces=appDataFolder` is required on BOTH the
    // query and the listing — without it Drive searches My Drive and returns
    // nothing, silently, which reads exactly like a first run.
    async find() {
      const url = `${API}/files?spaces=appDataFolder&pageSize=10`
        + `&q=${encodeURIComponent(`name='${FILE_NAME}' and trashed=false`)}`
        + `&fields=${encodeURIComponent("files(id,name,modifiedTime,appProperties)")}`;
      const res = await ok(await doFetch(url, { headers: auth() }), "lookup");
      const file = (await res.json())?.files?.[0];
      if (!file) return null;
      return {
        fileId: file.id,
        // modifiedTime is the fallback for a file written before appProperties
        // existed, or by anything else. It is always present.
        backupTime: file.appProperties?.backupTime || file.modifiedTime || null,
        deviceName: file.appProperties?.deviceName || "",
      };
    },

    async download(fileId) {
      const res = await ok(
        await doFetch(`${API}/files/${encodeURIComponent(fileId)}?alt=media`, { headers: auth() }),
        "download");
      return res.text();
    },

    async create(content, meta) {
      const { body, headers } = multipart(
        { name: FILE_NAME, parents: ["appDataFolder"], mimeType: "application/json",
          appProperties: propsFrom(meta) },
        content);
      const res = await ok(
        await doFetch(`${UPLOAD}/files?uploadType=multipart&fields=id`,
          { method: "POST", headers, body }),
        "upload");
      return (await res.json()).id;
    },

    // PATCH, not POST — same file id, new contents. This is what "only keep
    // one backup" means in practice: the previous snapshot is replaced, never
    // accumulated beside.
    async update(fileId, content, meta) {
      const { body, headers } = multipart(
        { appProperties: propsFrom(meta) }, content);
      const res = await ok(
        await doFetch(`${UPLOAD}/files/${encodeURIComponent(fileId)}?uploadType=multipart&fields=id`,
          { method: "PATCH", headers, body }),
        "upload");
      return (await res.json()).id;
    },
  };
}
