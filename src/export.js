import fs from 'fs/promises';
import path from 'path';
import 'dotenv/config';

const {
  ELEVENLABS_API_KEY,
  ELEVENLABS_TOKEN,
  ELEVENLABS_READY_KEYWORD,
  ELEVENLABS_EXPORTED_KEYWORD
} = process.env;

if (!ELEVENLABS_API_KEY) throw new Error('Missing ELEVENLABS_API_KEY');
if (!ELEVENLABS_TOKEN) throw new Error('Missing ELEVENLABS_TOKEN');

const PUBLIC_BASE = 'https://api.elevenlabs.io/v1/dubbing';
const STUDIO_BASE = 'https://api.us.elevenlabs.io/v1/dubbing';
const DUBBINGS_JSON = './data/dubbings.json';

const READY = (ELEVENLABS_READY_KEYWORD ?? '#render').trim();
const EXPORTED = (ELEVENLABS_EXPORTED_KEYWORD ?? '#exported').trim();

const SLEEP = (ms) => new Promise(r => setTimeout(r, ms));

function log(...args) {
  console.log('[RENDER]', ...args);
}

async function readJson(p) {
  const raw = await fs.readFile(path.resolve(p), 'utf8');
  return JSON.parse(raw);
}
async function writeJson(p, data) {
  const text = JSON.stringify(data, null, 2);
  await fs.writeFile(path.resolve(p), text, 'utf8');
}

async function patchMetadataName(dubbingId, newName) {
  const url = `${STUDIO_BASE}/${encodeURIComponent(dubbingId)}/metadata`;
  const res = await fetch(url, {
    method: 'POST',
    headers: {
      Authorization: `Bearer ${ELEVENLABS_TOKEN}`,
      'Content-Type': 'application/json',
      Accept: '*/*',
      'xi-api-key': ELEVENLABS_API_KEY,
    },
    body: JSON.stringify({ name: newName }),
  });
  const text = await res.text().catch(() => '');
  if (!res.ok) throw new Error(`METADATA ${url} -> ${res.status} ${res.statusText}\n${text}`);
  if (!text || text.trim() === '' || text.trim() === 'null') return true;
  try { JSON.parse(text); } catch { /* ignore */ }
  return true;
}

async function getDubbingPublic(dubbingId) {
  const url = `${PUBLIC_BASE}/${encodeURIComponent(dubbingId)}`;
  const res = await fetch(url, {
    method: 'GET',
    headers: {
      'xi-api-key': ELEVENLABS_API_KEY,
      'Accept': 'application/json',
    },
  });
  const text = await res.text();
  if (!res.ok) throw new Error(`GET ${url} -> ${res.status} ${res.statusText}\n${text}`);
  return JSON.parse(text);
}

async function getEditorLatest(dubbingId) {
  const url = `${STUDIO_BASE}/${encodeURIComponent(dubbingId)}/editor/latest`;
  const res = await fetch(url, {
    method: 'GET',
    headers: {
      Authorization: `Bearer ${ELEVENLABS_TOKEN}`,
      Accept: 'application/json',
    },
  });
  const text = await res.text();
  if (!res.ok) throw new Error(`EDITOR LATEST ${url} -> ${res.status} ${res.statusText}\n${text}`);
  return JSON.parse(text);
}

function clipToPayload(c) {
  const m = c.media || {};
  return {
    id: c.id,
    media_offset: c.media_offset ?? 0,
    media_duration: c.media_duration ?? m.duration_secs,
    trim: c.trim || { start: 0, end: 1 },
    media: {
      url: m.url,
      src: m.src,
      duration_secs: m.duration_secs,
      content_type: m.content_type,
      random_path_slug: m.random_path_slug ?? '',
      is_audio: !!m.is_audio,
    },
    volume: c.volume ?? 0,
  };
}

function buildTracksFromEditor(editor) {
  const tracks = [];
  const bgTracks = editor.background_tracks || {};
  const bgClips = Object.values(editor.background_clips || {});
  for (const trackId of Object.keys(bgTracks)) {
    const clips = bgClips.filter(c => c.track_id === trackId).map(clipToPayload);
    tracks.push({ id: trackId, clips });
  }
  const fgTracks = editor.foreground_tracks || {};
  const fgClips = Object.values(editor.foreground_clips || {});
  for (const trackId of Object.keys(fgTracks)) {
    const clips = fgClips.filter(c => c.track_id === trackId).map(clipToPayload);
    tracks.push({ id: trackId, clips });
  }
  const targetTracks = editor.target_tracks || {};
  const targetClips = Object.values(editor.target_clips || {}).map(clipToPayload);
  for (const trackId of Object.keys(targetTracks)) {
    tracks.push({ id: trackId, clips: targetClips });
  }
  return tracks;
}

async function postRender(dubbingId, editorFullJson) {
  const project = editorFullJson?.projects?.project;
  if (!project) throw new Error('project not found in editor response');

  const payload = {
    render_type: 'mp4',
    data: {
      dubbing_id: project.dubbing_id,
      user_id: project.user_id,
      language: project.selected_language,
      media: project.media,
      tracks: buildTracksFromEditor({
        background_tracks: editorFullJson.background_tracks,
        background_clips: editorFullJson.background_clips,
        foreground_tracks: editorFullJson.foreground_tracks,
        foreground_clips: editorFullJson.foreground_clips,
        target_tracks: editorFullJson.target_tracks,
        target_clips: editorFullJson.target_clips,
      }),
    },
  };

  const url = `${STUDIO_BASE}/${encodeURIComponent(dubbingId)}/render`;
  const res = await fetch(url, {
    method: 'POST',
    headers: {
      Authorization: `Bearer ${ELEVENLABS_TOKEN}`,
      'Content-Type': 'application/json',
      Accept: 'application/json',
    },
    body: JSON.stringify(payload),
  });

  const text = await res.text();
  if (!res.ok) throw new Error(`RENDER ${url} -> ${res.status} ${res.statusText}\n${text}`);
  try { return JSON.parse(text); } catch { return text; }
}

async function getInternalMetadata(dubbingId) {
  const url = `${STUDIO_BASE}/${encodeURIComponent(dubbingId)}/internal-metadata`;
  const res = await fetch(url, {
    method: 'GET',
    headers: {
      Authorization: `Bearer ${ELEVENLABS_TOKEN}`,
      Accept: 'application/json',
    },
  });
  const text = await res.text();
  if (!res.ok) throw new Error(`INTERNAL ${url} -> ${res.status} ${res.statusText}\n${text}`);
  return JSON.parse(text);
}

async function waitForRenderUrl(dubbingId, renderId, {
  intervalMs = 5000,
  timeoutMs = 15 * 60 * 1000,
} = {}) {
  const start = Date.now();
  let lastProgress = 0;

  while (Date.now() - start < timeoutMs) {
    const meta = await getInternalMetadata(dubbingId);
    const renders = meta?.latest_snapshot?.renders || {};
    const r = renders[renderId];

    let candidate = r;
    if (!candidate) {
      const entries = Object.values(renders);
      if (entries.length > 0) {
        entries.sort((a, b) => (b.created_at_unix || 0) - (a.created_at_unix || 0));
        candidate = entries[0];
      }
    }

    if (candidate?.error) {
      throw new Error(`Render failed: ${JSON.stringify(candidate.error)}`);
    }

    const prog = typeof candidate?.progress === 'number' ? candidate.progress : lastProgress;
    lastProgress = prog;
    log(`progress ${dubbingId}/${renderId}: ${prog?.toFixed?.(1) ?? prog}%`);

    const url = candidate?.media?.url;
    if (url && candidate?.progress >= 100) {
      return { url, render: candidate };
    }

    await SLEEP(intervalMs);
  }
  throw new Error(`Timeout while waiting render ${renderId} for ${dubbingId}`);
}

async function main() {
  const list = await readJson(DUBBINGS_JSON);

  const escapedReady = READY.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
  const readyRegex = new RegExp(`(?<![\\p{L}\\p{N}_])${escapedReady}(?![\\p{L}\\p{N}_])`, 'iu');
  const readyReplaceRegex = new RegExp(`(?<![\\p{L}\\p{N}_])${escapedReady}(?![\\p{L}\\p{N}_])`, 'igu');

  const escapedExported = EXPORTED.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
  const exportedRegex = new RegExp(`(?<![\\p{L}\\p{N}_])${escapedExported}(?![\\p{L}\\p{N}_])`, 'iu');

  let changed = false;

  for (let i = 0; i < list.length; i++) {
    const row = list[i];
    const { dubbingId } = row;
    if (!dubbingId) continue;

    let pub;
    try {
      pub = await getDubbingPublic(dubbingId);
    } catch (e) {
      console.error(`[ERROR] public get ${dubbingId}:`, e.message);
      continue;
    }

    const title = (pub?.name ?? row.name ?? '').trim();
    log(`check ${dubbingId}: "${title}"`);

    if (!readyRegex.test(title)) {
      if (exportedRegex.test(title)) {
        log(`already exported: "${title}"`);
        continue;
      }
      log(`not ready: "${title}" (needs ${READY})`);
      continue;
    }

    let editor;
    try {
      editor = await getEditorLatest(dubbingId);
    } catch (e) {
      console.error(`[ERROR] editor latest ${dubbingId}:`, e.message);
      continue;
    }

    let renderResp;
    try {
      renderResp = await postRender(dubbingId, editor);
      log(`render started ${dubbingId}:`, renderResp);
    } catch (e) {
      console.error(`[ERROR] render ${dubbingId}:`, e.message);
      continue;
    }

    const renderId = renderResp?.render_id || renderResp?.renderId || renderResp?.id;
    if (!renderId) {
      console.error(`[ERROR] renderId missing for ${dubbingId}`, renderResp);
      continue;
    }

    let outcome;
    try {
      outcome = await waitForRenderUrl(dubbingId, renderId, { intervalMs: 5000, timeoutMs: 15 * 60 * 1000 });
    } catch (e) {
      console.error(`[ERROR] polling ${dubbingId}/${renderId}:`, e.message);
      continue;
    }

    const downloadUrl = outcome?.url;
    if (!downloadUrl) {
      console.error(`[ERROR] no downloadUrl produced for ${dubbingId}/${renderId}`);
      continue;
    }

    const oldTitle = title;
    const newTitle = oldTitle.replace(readyReplaceRegex, EXPORTED);

    if (newTitle && newTitle !== oldTitle) {
    try {
        await patchMetadataName(dubbingId, newTitle);
        await SLEEP(1000);
        const metaAfter = await getInternalMetadata(dubbingId);
        const serverName = (metaAfter?.name ?? newTitle).trim();
        row.name = serverName;
        row.status = 'exported';
        log(`renamed ${dubbingId}: "${oldTitle}" -> "${serverName}"`);
    } catch (e) {
        row.name = oldTitle;
        row.status = 'rendered';
    }
    } else {
    row.name = oldTitle;
    row.status = 'rendered';
    }

    row.renderId = renderId;
    row.downloadUrl = downloadUrl;
    row.renderedAt = new Date().toISOString();
    row.renderLanguage = outcome?.render?.language || editor?.projects?.project?.selected_language || null;

    changed = true;
    await writeJson(DUBBINGS_JSON, list);
    log(`saved downloadUrl for ${dubbingId} -> ${downloadUrl}`);
  }

  if (!changed) {
    log('No updates were necessary.');
  } else {
    log('All eligible items processed and saved.');
  }
}

main().catch(err => {
  console.error('[FATAL]', err);
  process.exit(1);
});
