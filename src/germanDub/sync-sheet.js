import fs from "fs/promises";
import { google } from "googleapis";
import "dotenv/config";
import path from "path";

const ROOT = process.cwd();
const SPREADSHEET_ID = process.env.SPREADSHEET_ID;
const SHEET_TITLE = process.env.GERMAN_SHEET_TITLE || "German Video Progress";
const SA_KEY_PATH = process.env.GOOGLE_APPLICATION_CREDENTIALS;
const KEY_HEADER = "Vimeo Video ID";
const DEFAULT_STATUS = "Not uploaded";

const VIDEOS_JSON = path.join(ROOT, "src", "germanDub", "data", "en_videos.json");
const DUBBINGS_JSON = path.join(ROOT, "src", "germanDub", "data", "dubbings.json");

const CORE_HEADERS = [
  "ElevenLabs Dubbing URL",
  "ElevenLabs Dubbing Name",
  "Dubbed Video URL",
  "Status"
];

const STATUS = {
  NOT_UPLOADED: "Not uploaded",
  NEEDS_REVISION: "Needs revision",
  READY_FOR_RENDER: "Ready for render",
  EXPORTED: "Exported"
};

function colIndexToLetter(i) {
  return String.fromCharCode(65 + i);
}
function norm(v) {
  return String(v ?? "").trim();
}
function digitsOnly(v) {
  return norm(v).replace(/\D/g, "");
}
function extractKeyFromName(name) {
  const s = norm(name);
  if (!s) return "";
  const parts = s.split("_");
  if (parts.length >= 2 && parts[0] === "german") {
    return parts[1];
  }
  return s.split("_", 1)[0];
}

function indexVideosById(videos) {
  const m = new Map();
  for (const v of videos || []) {
    if (!v?.id) continue;
    m.set(norm(v.id), v);
    m.set(digitsOnly(v.id), v);
  }
  return m;
}
function indexDubbingsByKey(dubbings) {
  const m = new Map();
  for (const d of dubbings || []) {
    const kName = extractKeyFromName(d?.name);
    const kNameDigits = digitsOnly(kName);
    const kVid = norm(d?.videoId);
    const kVidDigits = digitsOnly(d?.videoId);
    if (kName) m.set(kName, d);
    if (kNameDigits) m.set(kNameDigits, d);
    if (kVid) m.set(kVid, d);
    if (kVidDigits) m.set(kVidDigits, d);
  }
  return m;
}

function decideNextStatus({ currentStatus, dub }) {
  const cur = currentStatus || STATUS.NOT_UPLOADED;
  const isExported = !!dub?.downloadUrl || dub?.status === "exported";
  
  if (isExported && cur !== STATUS.EXPORTED) {
    return STATUS.EXPORTED;
  }
  
  if (dub?.dubbingId && cur === STATUS.NOT_UPLOADED) {
    return STATUS.NEEDS_REVISION;
  }
  
  return null;
}

async function auth() {
  if (!SPREADSHEET_ID) {
    console.error("Set SPREADSHEET_ID");
    process.exit(1);
  }
  if (process.env.GOOGLE_APPLICATION_CREDENTIALS) {
    try {
      const auth = new google.auth.GoogleAuth({
        scopes: ["https://www.googleapis.com/auth/spreadsheets"],
        keyFilename: process.env.GOOGLE_APPLICATION_CREDENTIALS,
      });
      const client = await auth.getClient();
      console.log("[AUTH] GOOGLE_APPLICATION_CREDENTIALS");
      return google.sheets({ version: "v4", auth: client });
    } catch {
      console.warn(
        "[AUTH] GOOGLE_APPLICATION_CREDENTIALS failed, falling back"
      );
    }
  }
  if (process.env.GCP_SA_KEY_JSON) {
    try {
      const sa = JSON.parse(process.env.GCP_SA_KEY_JSON);
      let key = sa.private_key || "";
      if (key.includes("\\n")) key = key.replace(/\\n/g, "\n");
      if (!sa.client_email || !key) throw new Error("invalid");
      const jwt = new google.auth.JWT(sa.client_email, null, key, [
        "https://www.googleapis.com/auth/spreadsheets",
      ]);
      await jwt.authorize();
      console.log("[AUTH] GCP_SA_KEY_JSON");
      return google.sheets({ version: "v4", auth: jwt });
    } catch {
      console.warn("[AUTH] GCP_SA_KEY_JSON failed, falling back");
    }
  }
  const raw = await fs.readFile(SA_KEY_PATH, "utf8");
  const sa = JSON.parse(raw);
  let key = sa.private_key || "";
  if (key.includes("\\n")) key = key.replace(/\\n/g, "\n");
  if (!sa.client_email || !key) {
    throw new Error("Invalid service account JSON");
  }
  const jwt = new google.auth.JWT(sa.client_email, null, key, [
    "https://www.googleapis.com/auth/spreadsheets",
  ]);
  await jwt.authorize();
  console.log("[AUTH] SA_KEY_PATH");
  return google.sheets({ version: "v4", auth: jwt });
}

async function getHeaderMap(sheets) {
  const { data } = await sheets.spreadsheets.values.get({
    spreadsheetId: SPREADSHEET_ID,
    range: `${SHEET_TITLE}!1:1`,
    majorDimension: "ROWS",
  });
  const headers = (data.values && data.values[0]) || [];
  const map = new Map();
  headers.forEach((h, i) => map.set(norm(h), i));
  const missing = [];
  if (!map.has(norm(KEY_HEADER))) missing.push(KEY_HEADER);
  const hasAnyCore = CORE_HEADERS.some((h) => map.has(norm(h)));
  if (!hasAnyCore) missing.push(...CORE_HEADERS);
  if (missing.length) {
    throw new Error(`Sheet header eksik: ${missing.join(", ")}`);
  }
  return { map, headers };
}

async function getBodyRows(sheets, colCount) {
  const endColLetter = String.fromCharCode(64 + Math.min(26, colCount));
  const range = `${SHEET_TITLE}!A2:${endColLetter}`;
  const { data } = await sheets.spreadsheets.values.get({
    spreadsheetId: SPREADSHEET_ID,
    range,
    majorDimension: "ROWS",
  });
  return { rows: data.values || [], baseRow: 2 };
}

function stripBOM(s) {
  return s.replace(/^\uFEFF/, "");
}
async function readJson(filePath) {
  const txt = stripBOM(await fs.readFile(filePath, "utf8"));
  const data = JSON.parse(txt);
  if (Array.isArray(data)) return data;
  if (data && typeof data === "object") {
    for (const k of [
      "items",
      "data",
      "results",
      "records",
      "dubbings",
      "videos",
    ]) {
      if (Array.isArray(data[k])) return data[k];
    }
    return [data];
  }
  return [];
}

(function main() {
  (async () => {
    try {
      const sheets = await auth();
      const { map: headerMap, headers } = await getHeaderMap(sheets);
      const keyColIdx = headerMap.get(norm(KEY_HEADER));

      const colIdx = {
        dubUrl: headerMap.get(norm("ElevenLabs Dubbing URL")),
        name: headerMap.get(norm("ElevenLabs Dubbing Name")),
        videoUrl: headerMap.get(norm("Dubbed Video URL")),
        status: headerMap.get(norm("Status")),
        vimeoName: headerMap.get(norm("Vimeo Video Name")),
        vimeoUrl: headerMap.get(norm("Vimeo Video URL")),
      };

      const { rows, baseRow } = await getBodyRows(sheets, headers.length);

      const videos = await readJson(VIDEOS_JSON);
      const dubbings = await readJson(DUBBINGS_JSON);

      const videosById = indexVideosById(videos);
      const dubsByKey = indexDubbingsByKey(dubbings);

      const batch = [];
      let updated = 0;
      let skipped = 0;
      let appended = 0;

      const existingVideoIds = new Set();
      const cell = (idx, rowNumber) =>
        `${SHEET_TITLE}!${colIndexToLetter(idx)}${rowNumber}:${colIndexToLetter(
          idx
        )}${rowNumber}`;

      for (let i = 0; i < rows.length; i++) {
        const row = rows[i];
        const rowNumber = baseRow + i;
        const keyRaw = row[keyColIdx];
        const k1 = norm(keyRaw);
        const k2 = digitsOnly(keyRaw);
        
        if (k1) existingVideoIds.add(k1);
        if (k2 && k2 !== k1) existingVideoIds.add(k2);
        
        const video = videosById.get(k1) || videosById.get(k2);
        const keyVal = dubsByKey.has(k1) ? k1 : dubsByKey.has(k2) ? k2 : null;
        const dub = keyVal ? dubsByKey.get(keyVal) : null;

        if (Number.isInteger(colIdx.vimeoName) && video) {
          batch.push({
            range: cell(colIdx.vimeoName, rowNumber),
            values: [[video.name || ""]],
          });
        }

        if (Number.isInteger(colIdx.vimeoUrl) && video?.downloadUrl) {
          batch.push({
            range: cell(colIdx.vimeoUrl, rowNumber),
            values: [[video.downloadUrl]],
          });
        }

        if (!keyVal && !video) {
          skipped++;
          continue;
        }

        if (Number.isInteger(colIdx.dubUrl)) {
          const id = norm(dub?.dubbingId || "");
          const url = id
            ? `https://elevenlabs.io/v1/dubbing/${encodeURIComponent(id)}`
            : "";
          batch.push({
            range: cell(colIdx.dubUrl, rowNumber),
            values: [[url]],
          });
        }

        if (Number.isInteger(colIdx.name)) {
          let name = dub?.name;
          if (!name && video) {
            name = `german_${video.id}_${video.name ?? ""}`;
          }
          if (name) {
            batch.push({ range: cell(colIdx.name, rowNumber), values: [[name]] });
          }
        }

        if (Number.isInteger(colIdx.videoUrl) && dub?.downloadUrl) {
          batch.push({
            range: cell(colIdx.videoUrl, rowNumber),
            values: [[dub.downloadUrl]],
          });
        }

        if (Number.isInteger(colIdx.status)) {
          const currentStatus = norm(row[colIdx.status] || "");
          const next = decideNextStatus({ currentStatus, dub });
          const value = next || currentStatus || DEFAULT_STATUS;
          batch.push({
            range: cell(colIdx.status, rowNumber),
            values: [[value]],
          });
        }

        updated++;
      }

      const newRows = [];
      const nextRowNumber = baseRow + rows.length;

      for (const video of videos) {
        if (!video?.id) continue;
        const videoId = norm(video.id);
        const videoIdDigits = digitsOnly(video.id);
        
        if (existingVideoIds.has(videoId) || existingVideoIds.has(videoIdDigits)) {
          continue;
        }

        const dub = dubsByKey.get(videoId) || dubsByKey.get(videoIdDigits);
        const newRow = new Array(headers.length).fill("");

        if (Number.isInteger(keyColIdx)) {
          newRow[keyColIdx] = videoId;
        }

        if (Number.isInteger(colIdx.vimeoName)) {
          newRow[colIdx.vimeoName] = video.name || "";
        }

        if (Number.isInteger(colIdx.vimeoUrl) && video.downloadUrl) {
          newRow[colIdx.vimeoUrl] = video.downloadUrl;
        }

        if (Number.isInteger(colIdx.dubUrl)) {
          const id = norm(dub?.dubbingId || "");
          const url = id
            ? `https://elevenlabs.io/v1/dubbing/${encodeURIComponent(id)}`
            : "";
          newRow[colIdx.dubUrl] = url;
        }

        if (Number.isInteger(colIdx.name)) {
          let name = dub?.name;
          if (!name) {
            name = `german_${video.id}_${video.name ?? ""}`;
          }
          newRow[colIdx.name] = name;
        }

        if (Number.isInteger(colIdx.videoUrl) && dub?.downloadUrl) {
          newRow[colIdx.videoUrl] = dub.downloadUrl;
        }

        if (Number.isInteger(colIdx.status)) {
          const next = decideNextStatus({ currentStatus: "", dub });
          newRow[colIdx.status] = next || DEFAULT_STATUS;
        }

        newRows.push(newRow);
        appended++;
      }

      if (newRows.length > 0) {
        await sheets.spreadsheets.values.append({
          spreadsheetId: SPREADSHEET_ID,
          range: `${SHEET_TITLE}!A:A`,
          valueInputOption: "RAW",
          insertDataOption: "INSERT_ROWS",
          resource: { values: newRows },
        });
      }

      if (batch.length > 0) {
        await sheets.spreadsheets.values.batchUpdate({
          spreadsheetId: SPREADSHEET_ID,
          requestBody: { valueInputOption: "RAW", data: batch },
        });
      }

      if (batch.length === 0 && newRows.length === 0) {
        console.log("No matches to update");
        process.exit(0);
      }

      console.log(`[SHEET][UPDATE] Updated: ${updated}, Appended: ${appended}, Skipped: ${skipped}`);
    } catch (err) {
      console.error(err?.response?.data || err);
      process.exit(1);
    }
  })();
})();

