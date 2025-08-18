import 'dotenv/config';

const {
  VIMEO_ACCESS_TOKEN,
  VIMEO_USER_ID,
  VIMEO_FOLDER_ID,
  VIMEO_API
} = process.env;

if (!VIMEO_ACCESS_TOKEN) {
  throw new Error('[VIMEO] cannot find VIMEO_ACCESS_TOKEN');
}

export function resolveFolderIds() {
  if (VIMEO_USER_ID && VIMEO_FOLDER_ID) {
    return ;
  }

  throw new Error(
    '[VIMEO] cannot find VIMEO_USER_ID and/or VIMEO_FOLDER_ID'
  );
}

async function vimeoGET(path, query = {}) {
  const url = new URL(`${VIMEO_API}${path}`);

  Object.entries(query).forEach(([k, v]) => url.searchParams.set(k, v));
  const res = await fetch(url, {
    headers: {
      Authorization: `bearer ${VIMEO_ACCESS_TOKEN}`,
      Accept: 'application/vnd.vimeo.*+json;version=3.4',
    },
  });

  if (!res.ok) {
    const text = await res.text().catch(() => '');
    throw new Error(`[VIMEO] ${res.status} ${res.statusText} :: ${text}`);
  }
  return res.json();
}

function toIdFromUri(uri) {
  const m = String(uri).match(/\/videos\/(\d+)/);
  return m ? m[1] : null;
}

export function pickDownloadLink(item) {
  const candidates = [
    ...(Array.isArray(item.download) ? item.download : []),
    ...(Array.isArray(item.files) ? item.files : []),
  ];

  for (const f of candidates) {
    const link =
      f?.link_download || f?.link || f?.url || f?.play_link || f?.public_url;
    if (link && /http/.test(link)) return link;
  }

  return item.link || null;
}

export async function listFolderVideoMetadata() {
  const userId = VIMEO_USER_ID;
  const folderId = VIMEO_FOLDER_ID;

  console.log('[VIMEO] starting list');

  const all = [];
  let page = 1;

  while (true) {
    const data = await vimeoGET(
      `/users/${userId}/projects/${folderId}/videos`,
      {
        per_page: '100',
        page: String(page),
        fields:
          'uri,name,link,files,download,resource_key',
        sort: 'date',
        direction: 'desc',
      }
    );

    for (const item of data?.data || []) {
      const id = toIdFromUri(item.uri);
      const name = item.name || `video_${id}`;
      const downloadUrl = pickDownloadLink(item);
      all.push({ id, name, downloadUrl });
    }

    if (!data?.paging?.next) break;
    page += 1;
  }

  console.log('[VIMEO] Total video found in folder:', all.length);
  return all;
}
