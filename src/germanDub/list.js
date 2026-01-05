import { mkdirSync, existsSync, readFileSync, writeFileSync } from 'fs';
import { listFolderVideoMetadataRecursive } from './vimeo.js';

const DATA_DIR = './src/germanDub/data';
const VIDEOS_JSON = `${DATA_DIR}/en-videos.json`;

function loadJson(path, fallback) {
  if (!existsSync(path)) return fallback;
  try {
    return JSON.parse(readFileSync(path, 'utf8'));
  } catch {
    return fallback;
  }
}

function saveJson(path, obj) {
  writeFileSync(path, JSON.stringify(obj, null, 2), 'utf8');
}

function upsertById(existingArr, incomingArr) {
  const byId = new Map(existingArr.map((v) => [v.id, v]));
  let added = 0;
  let updated = 0;

  for (const v of incomingArr) {
    if (!v?.id) continue;
    if (byId.has(v.id)) {
      const prev = byId.get(v.id);
      const merged = { ...prev, ...v };
      byId.set(v.id, merged);
      updated++;
    } else {
      byId.set(v.id, v);
      added++;
    }
  }
  return { list: Array.from(byId.values()), added, updated };
}

async function main() {
  mkdirSync(DATA_DIR, { recursive: true });

  const prev = loadJson(VIDEOS_JSON, []);
  console.log('[LIST] Available records:', prev.length);

  const fresh = await listFolderVideoMetadataRecursive();
  const { list, added, updated } = upsertById(prev, fresh);

  saveJson(VIDEOS_JSON, list);

  console.log(
    '[LIST] Completed:',
    JSON.stringify({ added, updated, total: list.length })
  );
}

main().catch((err) => {
  console.error('[LIST][ERROR]', err?.message || err);
  process.exit(1);
});
