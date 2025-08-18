import 'dotenv/config';
import { ElevenLabsClient } from '@elevenlabs/elevenlabs-js';

const {
  ELEVEN_API_KEY,
  ELEVEN_SOURCE_LANG = 'tr',
  ELEVEN_TARGET_LANG = 'en',
  ELEVEN_NUM_SPEAKERS = '1',
  ELEVEN_WATERMARK = 'true',
  ELEVEN_SPEAKER_ID,
} = process.env;

if (!ELEVEN_API_KEY) throw new Error('Missing ELEVEN_API_KEY in .env');

export const client = new ElevenLabsClient({ apiKey: ELEVEN_API_KEY });

export function getDefaults() {
  return {
    source_lang: ELEVEN_SOURCE_LANG,
    target_lang: ELEVEN_TARGET_LANG,
    num_speakers: Number(ELEVEN_NUM_SPEAKERS) || 1,
    watermark: String(ELEVEN_WATERMARK) === 'true',
  };
}

export async function createDub({ name, source_url }) {
  const defaults = getDefaults();
  const res = await client.dubbing.create({
    name,
    source_url,
    source_lang: defaults.source_lang,
    target_lang: defaults.target_lang,
    num_speakers: defaults.num_speakers,
    watermark: defaults.watermark,
  });
  return res;
}

export async function updateSpeaker(dubbingId, speakerId = ELEVEN_SPEAKER_ID) {
  if (!speakerId) throw new Error('Missing ELEVEN_SPEAKER_ID in .env');
  await client.dubbing.resource.speaker.update(dubbingId, speakerId);
}
