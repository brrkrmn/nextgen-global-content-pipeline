import 'dotenv/config';
import fs from 'node:fs/promises';
import path from 'node:path';

import { listFolderVideos } from './vimeo.js';
import { createDub, updateSpeaker } from './eleven.js';

const STATE_PATH = path.join('data', 'state.json');

async function loadState() {
  try { return JSON.parse(await fs.readFile(STATE_PATH, 'utf8')); }
  catch { return { projects: {} }; } 
}
async function saveState(state) {
  await fs.mkdir('data', { recursive: true });
  await fs.writeFile(STATE_PATH, JSON.stringify(state, null, 2), 'utf8');
}

function dubNameFor({ id, name }) {
  const safe = (name || '').replace(/[^\p{L}\p{N}\s\-._]/gu, '').slice(0, 80);
  return `VIMEO_${id}__${safe || id}`;
}

const offset = Number(process.env.SEED_OFFSET || 0);
const limit  = Number(process.env.SEED_LIMIT  || 0); 

async function main() {
  const state = await loadState();

  const allVideos = await listFolderVideos(); 
  const videos = limit ? allVideos.slice(offset, offset + limit) : allVideos.slice(offset);
  console.log(`Dubbing target: ${videos.length} (total=${allVideos.length}, offset=${offset}, limit=${limit||'ALL'})`);

  let created = 0, skipped = 0, patched = 0;

  for (const v of videos) {
    const name = dubNameFor(v);

    if (state.projects[v.id]?.dubbingId) {
      skipped++;
      if (!state.projects[v.id].speakerPatched) {
        try {
          await updateSpeaker(state.projects[v.id].dubbingId);
          state.projects[v.id].speakerPatched = true;
          patched++;
          await saveState(state);
          console.log(`✔ speaker patched (existing) vimeo:${v.id}`);
        } catch (e) {
          console.warn(`! speaker patch failed (existing) vimeo:${v.id}: ${e.message}`);
        }
      }
      continue;
    }

    try {
      const resp = await createDub({ name, source_url: v.link }); 
      const dubbingId = resp?.dubbing_id;
      if (!dubbingId) throw new Error('No dubbing_id in response');

      state.projects[v.id] = { dubbingId, name, speakerPatched: false };
      created++;
      await saveState(state);
      console.log(`+ created: vimeo:${v.id} -> dub:${dubbingId}`);

      try {
        await updateSpeaker(dubbingId);
        state.projects[v.id].speakerPatched = true;
        patched++;
        await saveState(state);
        console.log(`  ↳ speaker patched: ${dubbingId}`);
      } catch (e) {
        console.warn(`  ! speaker patch failed ${dubbingId}: ${e.message}`);
      }
    } catch (e) {
      console.error(`! create failed vimeo:${v.id} (${name}): ${e.message}`);
    }
  }

  console.log(`Done. created=${created} skipped=${skipped} speaker_patched=${patched}`);
}

main().catch(e => { console.error(e); process.exit(1); });
