import 'dotenv/config';

const {
  VIMEO_ACCESS_TOKEN,
  VIMEO_USER_ID,
  VIMEO_FOLDER_ID_GERMAN,
  VIMEO_API
} = process.env;

if (!VIMEO_ACCESS_TOKEN) {
  throw new Error('[VIMEO] cannot find VIMEO_ACCESS_TOKEN');
}

export function resolveFolderIds() {
  if (VIMEO_USER_ID && VIMEO_FOLDER_ID_GERMAN) {
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

function toVideoIdFromUri(uri) {
  const m = String(uri).match(/\/videos\/(\d+)/);
  return m ? m[1] : null;
}

function toFolderIdFromUri(uri) {
  const m = String(uri).match(/\/projects\/([^/]+)/);
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
  const folderId = VIMEO_FOLDER_ID_GERMAN;

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
        sort: 'alphabetical',
        direction: 'asc',
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

async function listFolderItems(userId, folderId, page) {
  return vimeoGET(`/users/${userId}/projects/${folderId}/items`, {
    per_page: "100",
    page: String(page),
    fields: "type,uri,name,link,files,download,folder.uri,folder.name,project.uri,project.name,resource_key",
    sort: "alphabetical",
    direction: "asc",
  });
}

export async function listFolderVideoMetadataRecursive({
  rootFolderId = VIMEO_FOLDER_ID_GERMAN,
  userId = VIMEO_USER_ID,
} = {}) {
  console.log("[VIMEO] starting recursive list from root:", rootFolderId);

  const visited = new Set(); 
  const allVideos = [];

  async function walk(folderId, folderPath) {
    if (!folderId) return;
    if (visited.has(folderId)) return;
    visited.add(folderId);

    let videoPage = 1;
    while (true) {
      const videoData = await vimeoGET(
        `/users/${userId}/projects/${folderId}/videos`,
        {
          per_page: '100',
          page: String(videoPage),
          fields: 'uri,name,link,files,download,resource_key',
          sort: 'alphabetical',
          direction: 'asc',
        }
      );

      for (const item of videoData?.data || []) {
        const id = toVideoIdFromUri(item.uri);
        if (!id) {
          console.warn(`[VIMEO] Could not extract video ID from URI: ${item.uri}`);
          continue;
        }

        const name = item.name || `video_${id}`;
        const downloadUrl = pickDownloadLink(item);
        console.log(`[VIMEO] Found video: ${name} (${id}) in ${folderPath}`);

        allVideos.push({
          id,
          name,
          downloadUrl,
          folderPath, 
        });
      }

      if (!videoData?.paging?.next) break;
      videoPage += 1;
    }

    let page = 1;
    while (true) {
      const data = await listFolderItems(userId, folderId, page);

      if (!data?.data || data.data.length === 0) {
        break;
      }

      for (const item of data.data) {
        const t = item?.type;

        if (t === "folder" || t === "project") {
          let subUri = item?.uri;
          if (item?.folder?.uri) {
            subUri = item.folder.uri;
          } else if (item?.project?.uri) {
            subUri = item.project.uri;
          }
          
          const subId = toFolderIdFromUri(subUri);
          if (!subId) {
            console.warn(`[VIMEO] Could not extract folder ID from URI: ${subUri}`);
            continue;
          }
          
          const subName = item?.folder?.name || item?.project?.name || item?.name || subId || "subfolder";
          console.log(`[VIMEO] Entering subfolder: ${subName} (${subId}) in ${folderPath}`);

          await walk(subId, folderPath ? `${folderPath}/${subName}` : subName);
        }
      }

      if (!data?.paging?.next) break;
      page += 1;
    }
  }

  await walk(rootFolderId, "root");

  console.log("[VIMEO] Total video found recursively:", allVideos.length);
  return allVideos;
}