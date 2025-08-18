import 'dotenv/config';
import { readFile, stat } from 'node:fs/promises';
import path from 'node:path';

const {
  ELEVENLABS_API_KEY,
  ELEVENLABS_SOURCE_LANG,
  ELEVENLABS_TARGET_LANG,
  ELEVENLABS_NUM_SPEAKERS,
  ELEVENLABS_WATERMARK
} = process.env;

if (!ELEVENLABS_API_KEY) {
  throw new Error('[ELEVEN] .env içinde ELEVENLABS_API_KEY yok');
}

export function getDefaults() {
  const num = Number(ELEVENLABS_NUM_SPEAKERS);
  return {
    sourceLang: ELEVENLABS_SOURCE_LANG || undefined,
    targetLang: ELEVENLABS_TARGET_LANG || undefined,
    numSpeakers: Number.isFinite(num) ? num : undefined,
    watermark: String(ELEVENLABS_WATERMARK) === 'true'
  };
}

export function makeDubbingName({ vimeoId, videoName }) {
  const cleanName = String(videoName || '')
    .replace(/[^\p{L}\p{N}\-_ ]+/gu, '')
    .trim()
    .slice(0, 80);
  return `VIMEO_${vimeoId}__${cleanName || 'untitled'}`;
}

function guessMime(filePath) {
  const ext = path.extname(filePath).toLowerCase();
  if (ext === '.mov') return 'video/quicktime';
  if (ext === '.m4a') return 'audio/mp4';
  if (ext === '.mp3') return 'audio/mpeg';
  return 'video/mp4';
}

export async function createDubFromFile({ name, filePath }) {
  const d = getDefaults();

  console.log('[DUB][CREATE][FILE] Starting', {
    name,
    sourceLang: d.sourceLang,
    targetLang: d.targetLang,
    numSpeakers: d.numSpeakers,
    watermark: d.watermark
  });

  const st = await stat(filePath);
  if (!st.size) throw new Error(`Empty file: ${filePath}`);

  const fd = new FormData();
  const buf = await readFile(filePath);
  const mime = guessMime(filePath);
  const blob = new Blob([buf], { type: mime });

  const safeFileName =
    (name || 'upload').replace(/[^A-Za-z0-9._-]/g, '_') +
    (mime === 'video/quicktime' ? '.mov' : '.mp4');

  fd.append('file', blob, safeFileName);
  fd.append('name', name);
  if (d.sourceLang) fd.append('source_lang', d.sourceLang);
  if (d.targetLang) fd.append('target_lang', d.targetLang);
  if (Number.isFinite(d.numSpeakers)) fd.append('num_speakers', String(d.numSpeakers));
  if (d.watermark) fd.append('watermark', 'true');
  fd.append('mode', 'automatic');

  const res = await fetch('https://api.elevenlabs.io/v1/dubbing', {
    method: 'POST',
    headers: { 'xi-api-key': ELEVENLABS_API_KEY }, 
    body: fd
  });

  if (!res.ok) {
    const text = await res.text().catch(() => '');
    throw new Error(`[DUB][CREATE][FILE] ${res.status} ${res.statusText} :: ${text}`);
  }

  const json = await res.json();
  const out = { id: json?.dubbing_id || null, status: 'created', raw: json };

  if (!out.id) console.warn('[DUB][CREATE][FILE] Warning: no dubbing_id');
  else console.log('[DUB][CREATE][FILE] OK', { dubbingId: out.id });

  return out;
}

export async function updateSpeaker() {
  console.log('[SPEAKER][UPDATE] skip (Starter plan, no Studio API)');
  // await client.dubbing.resource.speaker.update(dubbingId, speakerId);
}