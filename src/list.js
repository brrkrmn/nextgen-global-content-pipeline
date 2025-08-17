import 'dotenv/config';
import fs from 'node:fs/promises';
import path from 'node:path';
import { listFolderVideos } from './vimeo.js';

async function main() {
  console.log("Searching folder...")
  const videos = await listFolderVideos();

  console.log(`Found video count: ${videos.length}`);
  console.table(videos.slice(0, videos.length));

  await fs.mkdir('data', { recursive: true });
  const out = path.join('data', 'vimeo_folder_videos.json');
  await fs.writeFile(out, JSON.stringify(videos, null, 2), 'utf8');
  console.log('Saved:', out);
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
