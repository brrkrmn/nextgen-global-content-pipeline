import fs from 'fs/promises';
import path from 'path';
import 'dotenv/config';

const ROOT = process.cwd();
const VIDEOS_PATH = path.join(ROOT, 'src', 'germanDub', 'data', 'batch_videos.json');
const DUBS_OK_PATH = path.join(ROOT, 'src', 'germanDub', 'data', 'dubbings.json');
const DUBS_FAIL_PATH = path.join(ROOT, 'src', 'germanDub', 'data', 'dubbings_failures.json');

const { ELEVENLABS_API_KEY } = process.env;

if (!ELEVENLABS_API_KEY) {
  console.error('Missing ELEVENLABS_API_KEY');
  process.exit(1);
}

function safeName(s) {
  return String(s || '').replace(/[^A-Za-z0-9._ -]/g, '_');
}

async function readJson(p, fallback) {
  try {
    const raw = await fs.readFile(p, 'utf8');
    return JSON.parse(raw);
  } catch {
    return fallback;
  }
}

async function writeJson(p, data) {
  await fs.mkdir(path.dirname(p), { recursive: true });
  await fs.writeFile(p, JSON.stringify(data, null, 2), 'utf8');
}

async function createDubFromDownloadUrl({
  url,
  name,
  sourceLang = 'en',
  targetLang = 'de',
  numSpeakers = 1,
  watermark = false,
  mode = 'automatic',
  dubbingStudio = true,
  voiceId,
}) {
  const getRes = await fetch(url, { redirect: 'follow', headers: { Accept: '*/*' } });
  if (!getRes.ok) {
    const txt = await getRes.text().catch(() => '');
    throw new Error(`[DOWNLOAD] ${getRes.status} ${getRes.statusText} :: ${txt}`);
  }
  const buf = Buffer.from(await getRes.arrayBuffer());

  const fd = new FormData();
  const fileName = `${safeName(name) || 'video'}.mp4`;
  const blob = new Blob([buf], { type: 'video/mp4' });

  fd.append('file', blob, fileName);
  fd.append('name', name);
  fd.append('source_lang', sourceLang);
  fd.append('target_lang', targetLang);
  fd.append('num_speakers', String(numSpeakers));
  fd.append('watermark', String(!!watermark));
  fd.append('mode', mode);
  fd.append('dubbing_studio', String(!!dubbingStudio));
  
  if (voiceId) {
    fd.append('voice_id', voiceId);
  }

  const elRes = await fetch('https://api.elevenlabs.io/v1/dubbing', {
    method: 'POST',
    headers: { 'xi-api-key': ELEVENLABS_API_KEY },
    body: fd,
  });

  if (!elRes.ok) {
    const txt = await elRes.text().catch(() => '');
    throw new Error(`[ELEVEN create] ${elRes.status} ${elRes.statusText} :: ${txt}`);
  }
  const json = await elRes.json();
  const dubbingId = json?.dubbing_id;
  if (!dubbingId) throw new Error('No dubbing_id in response');
  return dubbingId;
}

async function main() {
  const videos = await readJson(VIDEOS_PATH, []);
  const savedOk = await readJson(DUBS_OK_PATH, []);
  const savedFail = await readJson(DUBS_FAIL_PATH, []);
  const existingByName = new Map(savedOk.map(x => [x.name, x]));
  const existingByVideoId = new Map(savedOk.map(x => [x.videoId, x]));

  const results = [];
  let created = 0, skipped = 0, failed = 0;

  for (const v of videos) {
    const videoId = String(v.id);
    const composedName = `german_${videoId}_${v.name}`;

    if (existingByName.has(composedName) || existingByVideoId.has(videoId)) {
      skipped++;
      results.push({ videoId, name: composedName, status: 'skipped => already_exists' });
      continue;
    }

    try {
      const dubbingId = await createDubFromDownloadUrl({
        url: v.downloadUrl,
        name: composedName,
        sourceLang: 'en',
        targetLang: 'de',
        numSpeakers: 1,
        watermark: false,
        dubbingStudio: true,
        mode: 'automatic',
        voiceId: 'X6gteD79PmqmQa3gNkgZ',
      });

      const okRec = {
        dubbingId,
        name: composedName,
        videoId,
        targetLanguages: ['de'],
        createdAt: new Date().toISOString(),
      };

      savedOk.push(okRec);
      await writeJson(DUBS_OK_PATH, savedOk);

      existingByName.set(composedName, okRec);
      existingByVideoId.set(videoId, okRec);

      created++;
      results.push({ videoId, name: composedName, status: 'created', dubbingId });
    } catch (e) {
      const failRec = {
        name: composedName,
        videoId,
        error: String(e?.message || e),
        at: new Date().toISOString(),
      };
      savedFail.push(failRec);
      await writeJson(DUBS_FAIL_PATH, savedFail);

      failed++;
      const shortErr = failRec.error.length > 300 ? failRec.error.slice(0, 300) + '…' : failRec.error;
      results.push({ videoId, name: composedName, status: 'failed', error: shortErr });
    }
  }

  console.table(
    results.map(r => ({
      videoId: r.videoId,
      name: r.name,
      status: r.status,
      dubbingId: r.dubbingId || '',
      error: r.error || '',
    }))
  );
  console.log(JSON.stringify({ total: videos.length, created, skipped, failed, okFile: DUBS_OK_PATH, failFile: DUBS_FAIL_PATH }, null, 2));
}

main().catch(e => {
  console.error(e);
  process.exit(1);
});

