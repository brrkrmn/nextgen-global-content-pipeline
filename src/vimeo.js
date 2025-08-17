import 'dotenv/config';

const VIMEO_API = process.env.VIMEO_API || 'https://api.vimeo.com';
const { VIMEO_TOKEN, VIMEO_USER_ID, VIMEO_FOLDER_ID } = process.env;

function assertVimeoEnv({ userId = VIMEO_USER_ID, folderId = VIMEO_FOLDER_ID } = {}) {
  const missing = [];
  if (!VIMEO_TOKEN) missing.push('VIMEO_TOKEN');
  if (!userId) missing.push('VIMEO_USER_ID');
  if (!folderId) missing.push('VIMEO_FOLDER_ID');
  if (missing.length) throw new Error('Missing env: ' + missing.join(', '));
}

async function vimeoFetch(url, init = {}) {
  const res = await fetch(url, {
    ...init,
    headers: {
      Authorization: `Bearer ${VIMEO_TOKEN}`,
      Accept: 'application/vnd.vimeo.*+json;version=3.4',
      'Content-Type': 'application/json',
      ...(init.headers || {}),
    },
  });

  if (res.status === 429) {
    const retry = Number(res.headers.get('Retry-After') || 5);
    await new Promise((r) => setTimeout(r, retry * 1000));
    return vimeoFetch(url, init);
  }
  if (!res.ok) {
    const text = await res.text().catch(() => '');
    throw new Error(`Vimeo ${res.status} ${res.statusText} :: ${text}`);
  }
  return res;
}

const idFromUri = (uri) => (uri ? uri.split('/').pop() : null);

export async function listFolderVideos({ userId = VIMEO_USER_ID, folderId = VIMEO_FOLDER_ID } = {}) {
  assertVimeoEnv({ userId, folderId });

  const out = [];
  let page = 1;

  while (true) {
    const url =
      `${VIMEO_API}/users/${userId}/projects/${folderId}/items` +
      `?page=${page}&per_page=50&fields=type,uri,name,link,video,clip`;
    const res = await vimeoFetch(url);
    const data = await res.json();

    for (const item of data.data) {
      const node = item.video || item.clip || item;
      const isVideo =
        item.type === 'video' ||
        (node?.uri && node.uri.includes('/videos/')) ||
        (item?.uri && item.uri.includes('/videos/'));
      if (!isVideo) continue;

      const uri = node?.uri || item.uri;
      const id = idFromUri(uri);

      out.push({
        id,
        name: node?.name || item.name || `Video ${id}`,
        link: node?.link || item.link || null,
      });
    }

    if (!data.paging || !data.paging.next) break;
    page++;
  }

  return out;
}
