import { mkdirSync, existsSync, readFileSync, writeFileSync, unlinkSync, createWriteStream } from 'node:fs';
import { writeFile } from 'node:fs/promises';
import path from 'node:path';
import { makeDubbingName, createDubFromFile, updateSpeaker } from './eleven.js';

const DATA_DIR   = path.join(process.cwd(), 'data');
const TMP_DIR    = path.join(process.cwd(), '.tmp');
const VIDEOS_JSON= path.join(DATA_DIR, 'videos.json');
const DUBS_JSON  = path.join(DATA_DIR, 'dubs.json');  

function loadJson(pathname, fallback) {
  if (!existsSync(pathname)) return fallback;
  try { return JSON.parse(readFileSync(pathname, 'utf8')); }
  catch { return fallback; }
}

function saveJson(pathname, obj) {
  writeFileSync(pathname, JSON.stringify(obj, null, 2), 'utf8');
}

function safeHost(u) {
  try { return new URL(u).hostname; } catch { return ''; }
}

async function downloadToTemp(url, filenameBase) {
  const outPath = path.join(TMP_DIR, `${filenameBase}.mp4`);
  console.log('[FILE][GET] Downloading', { urlHost: safeHost(url), out: outPath });

  const res = await fetch(url, { redirect: 'follow', headers: { Accept: '*/*' } });
  if (!res.ok) {
    const text = await res.text().catch(() => '');
    throw new Error(`[FILE][GET] ${res.status} ${res.statusText} :: ${text}`);
  }

  if (res.body && typeof res.body.getReader === 'function') {
    const reader = res.body.getReader();
    await new Promise(async (resolve, reject) => {
      const ws = createWriteStream(outPath);
      ws.on('error', reject);
      ws.on('finish', resolve);
      for (;;) {
        const { done, value } = await reader.read();
        if (done) break;
        if (value) ws.write(Buffer.from(value));
      }
      ws.end();
    });
  } else {
    const buf = Buffer.from(await res.arrayBuffer());
    await writeFile(outPath, buf);
  }

  console.log('[FILE][GET] OK', { out: outPath });
  return outPath;
}

async function processVideo(v) {
  const dubName = makeDubbingName({ vimeoId: v.id, videoName: v.name });
  console.log('[DUB] Video processed', { vimeoId: v.id, name: v.name, dubName });

  if (!v.downloadUrl) {
    console.warn('[DUB][SKIP] no downloadUrl', { vimeoId: v.id, name: v.name });
    return null;
  }

  mkdirSync(TMP_DIR, { recursive: true });

  const filenameBase = `VIMEO_${v.id}`; 
  const tmpPath = await downloadToTemp(v.downloadUrl, filenameBase);

  try {
    const created = await createDubFromFile({ name: dubName, filePath: tmpPath });

    if (created?.id) {
      await updateSpeaker(created.id);
    } else {
      console.warn('[DUB][WARN] Dub id not found, could not update speaker', { vimeoId: v.id });
    }

    return { dubbingId: created?.id || null, dubName };
  } finally {
    try {
      unlinkSync(tmpPath);
      console.log('[FILE][CLEANUP] Deleted', { tmpPath });
    } catch {}
  }
}

async function main() {
  mkdirSync(DATA_DIR, { recursive: true });

  const videos = loadJson(VIDEOS_JSON, []);
  if (!videos.length) {
    console.log('[DUB] nothing to process. Run `npm run list` first.');
    return;
  }

  const dubs = loadJson(DUBS_JSON, {});
  let createdCount = 0;
  let skippedCount = 0;

  for (const v of videos) {
    if (!v?.id) continue;

    if (dubs[v.id]?.dubbingId) {
      skippedCount++;
      console.log('[DUB][SKIP] Already processed', { vimeoId: v.id, dubName: dubs[v.id].dubName });
      continue;
    }

    try {
      const res = await processVideo(v);
      dubs[v.id] = {
        dubbingId: res?.dubbingId || null,
        dubName: res?.dubName || null,
        at: new Date().toISOString()
      };
      saveJson(DUBS_JSON, dubs);
      createdCount++;
    } catch (err) {
      console.error('[DUB][ERROR]', { vimeoId: v.id, name: v.name, message: err?.message || String(err) });
    }
  }

  console.log('[DUB] Completed:', JSON.stringify({
    created: createdCount,
    skipped: skippedCount,
    total: videos.length
  }));
}

main().catch((err) => {
  console.error('[DUB][FATAL]', err?.message || String(err));
  process.exit(1);
});
