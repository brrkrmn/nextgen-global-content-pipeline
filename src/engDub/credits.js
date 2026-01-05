import 'dotenv/config';

const { ELEVENLABS_API_KEY } = process.env;

if (!ELEVENLABS_API_KEY) {
  console.error('Missing ELEVENLABS_API_KEY');
  process.exit(1);
}

async function getCredits() {
  const url = 'https://api.elevenlabs.io/v1/user';
  
  const res = await fetch(url, {
    method: 'GET',
    headers: {
      'xi-api-key': ELEVENLABS_API_KEY,
      'Accept': 'application/json',
    },
  });

  if (!res.ok) {
    const text = await res.text().catch(() => '');
    throw new Error(`[CREDITS] ${res.status} ${res.statusText} :: ${text}`);
  }

  const data = await res.json();
  return data?.subscription || data;
}

async function main() {
  try {
    const credits = await getCredits();

    console.log('\n=== 🎙️ ELEVENLABS CREDIT STATUS ===');
    console.log(`Plan: ${credits?.tier || 'Unknown'}`);
    console.log(`Total: ${credits?.character_limit || 'Unknown'}`);
    console.log(`Used: ${credits?.character_count || 'Unknown'}`);
    console.log(`Remaining: ${
      credits?.character_limit && credits?.character_count
        ? credits.character_limit - credits.character_count
        : 'Unknown'
    }`);
    console.log('====================================\n');
  } catch (err) {
    console.error('[ERROR]', err.message);
  }
}

main();
