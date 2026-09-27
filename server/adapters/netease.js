// 网易云音乐适配器 —— 真实接口。
// 依赖 NeteaseCloudMusicApi（二进制ify 维护），以编程方式调用其路由函数，
// 不单独起服务，直接在 Express 进程内解析结果。

import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';

// —— 可选：读取 server/.env 注入登录态 ——
// 网易云游客态只能拿到 30s 试听片段；登录后（普通账号可完整播放免费曲，
// 会员曲需会员账号）由 NETEASE_COOKIE 提供 Cookie 即可解除限制。
try {
  const envPath = join(dirname(fileURLToPath(import.meta.url)), '.env');
  const txt = readFileSync(envPath, 'utf8');
  for (const line of txt.split('\n')) {
    const m = line.match(/^\s*([\w.-]+)\s*=\s*(.*)\s*$/);
    if (m && !(m[1] in process.env)) {
      process.env[m[1]] = m[2].replace(/^["']|["']$/g, '');
    }
  }
} catch { /* 无 .env 则保持游客态 */ }

let NC = null;
try {
  // 该包把每个路由导出为 `(options) => Promise<{ status, body, ... }>` 的函数。
  NC = await import('NeteaseCloudMusicApi');
} catch (e) {
  NC = null;
}

const API_BASE = 'https://music.163.com';

function resolveRoute(name) {
  if (!NC) return null;
  if (typeof NC[name] === 'function') return NC[name];
  if (NC.default && typeof NC.default[name] === 'function') return NC.default[name];
  return null;
}

async function call(name, query = {}) {
  const fn = resolveRoute(name);
  if (!fn) throw new Error(`NeteaseCloudMusicApi 路由 ${name} 不可用`);
  // NeteaseCloudMusicApi 的路由函数签名为 (query, request)，直接接收参数对象，
  // 返回 { status, body, cookie }。不要套 { query } 外层，否则会报「参数错误」。
  // 若配置了登录 Cookie，则注入以支持完整播放/下载（游客态仅试听片段）。
  const cookie = process.env.NETEASE_COOKIE || '';
  const fullQuery = cookie ? { ...query, cookie } : query;
  const res = await fn(fullQuery);
  if (res && typeof res === 'object' && 'body' in res) return res.body;
  return res;
}

// br(bps) → 音质等级（v1 接口用 level 而非 br）
function brToLevel(br) {
  if (br >= 999000) return 'lossless';
  if (br >= 320000) return 'exhigh';
  if (br >= 192000) return 'higher';
  return 'standard';
}

// 获取单曲播放/下载直链。支持单 id 或逗号分隔多 id。
// 返回 Map<id, { url, size, br, format }>
async function fetchSongUrls(ids, br = 320000) {
  const idList = Array.isArray(ids) ? ids : [ids];
  if (idList.length === 0) return new Map();
  const idStr = idList.join(',');
  const level = brToLevel(br);
  let data = [];
  try {
    // v1 接口：ids 形如 "[id1,id2]"，用 level 选音质。
    const r = await call('song_url_v1', { id: idStr, level });
    data = r?.data || [];
  } catch {
    // 回退到旧版接口（br 直传）。
    try {
      const r = await call('song_url', { id: idStr, br });
      data = r?.data || [];
    } catch { /* 忽略整体失败 */ }
  }
  const map = new Map();
  for (const item of data) {
    if (!item || !item.id) continue;
    map.set(String(item.id), {
      url: item.url || null,
      size: typeof item.size === 'number' ? item.size : null,
      br: typeof item.br === 'number' ? Math.round(item.br / 1000) : null,
      format: (item.type || '').toUpperCase() || null,
    });
  }
  return map;
}

function artistLine(arr) {
  if (!Array.isArray(arr)) return '';
  return arr.map((a) => a?.name || a).filter(Boolean).join('/');
}

function mapSong(s) {
  return {
    id: String(s.id),
    platform: 'netease',
    title: s.name || '',
    artist: artistLine(s.artists || s.ar || []),
    album: (s.album?.name) || (s.al?.name) || '',
    duration: s.duration || s.dt || 0,
    // cloudsearch 把专辑封面放在 al.picUrl；老 search 在 album 且无 picUrl。
    cover: s.al?.picUrl || s.album?.picUrl || s.album?.blurPicUrl || s.al?.blurPicUrl || '',
    size: null,
    format: null,
    br: null,
  };
}

async function enrichSongs(songs, br) {
  if (songs.length === 0) return songs;
  const urls = await fetchSongUrls(songs.map((s) => s.id), br);
  return songs.map((s) => {
    const u = urls.get(s.id);
    return u ? { ...s, size: u.size, format: u.format, br: u.br } : s;
  });
}

// 统一使用 cloudsearch（PC 搜索接口）：返回结构更完整，单曲封面在 al.picUrl。
async function searchSongs(keywords, limit = 30) {
  const r = await call('cloudsearch', { keywords, type: 1, limit, offset: 0 });
  // 不在此取直链：单曲的播放/下载由 Solara 统一解析为 FLAC（见 solara.resolveFlac）。
  return (r?.result?.songs || []).map(mapSong);
}

async function searchPlaylists(keywords, limit = 30) {
  const r = await call('cloudsearch', { keywords, type: 1000, limit, offset: 0 });
  return (r?.result?.playlists || []).map((p) => ({
    id: String(p.id),
    platform: 'netease',
    name: p.name || '',
    cover: p.coverImgUrl || p.picUrl || '',
    owner: p.creator?.nickname || '',
    count: p.trackCount || 0,
    description: p.description || '',
  }));
}

async function searchArtists(keywords, limit = 30) {
  const r = await call('cloudsearch', { keywords, type: 100, limit, offset: 0 });
  return (r?.result?.artists || []).map((a) => ({
    id: String(a.id),
    platform: 'netease',
    name: a.name || '',
    avatar: a.picUrl || a.img1v1Url || '',
    alias: (a.alias || []).join('/'),
    albumCount: a.albumSize || 0,
    songCount: a.musicSize || 0,
  }));
}

async function searchAlbums(keywords, limit = 30) {
  const r = await call('cloudsearch', { keywords, type: 10, limit, offset: 0 });
  return (r?.result?.albums || []).map((al) => ({
    id: String(al.id),
    platform: 'netease',
    name: al.name || '',
    artist: al.artist?.name || '',
    cover: al.picUrl || al.blurPicUrl || '',
    publishYear: al.publishTime ? String(new Date(al.publishTime).getFullYear()) : '',
    count: al.size || 0,
  }));
}

export const neteaseAdapter = {
  id: 'netease',
  name: '网易云音乐',
  connected: !!NC,
  async search(keywords, type) {
    const tasks = [];
    if (type === 'all' || type === 'song') tasks.push(searchSongs(keywords).then((v) => ['songs', v]));
    if (type === 'all' || type === 'playlist') tasks.push(searchPlaylists(keywords).then((v) => ['playlists', v]));
    if (type === 'all' || type === 'artist') tasks.push(searchArtists(keywords).then((v) => ['artists', v]));
    if (type === 'all' || type === 'album') tasks.push(searchAlbums(keywords).then((v) => ['albums', v]));
    const settled = await Promise.allSettled(tasks);
    const out = { songs: [], playlists: [], artists: [], albums: [] };
    for (const s of settled) {
      if (s.status === 'fulfilled') out[s.value[0]] = s.value[1];
    }
    return out;
  },
  async songUrl(id) {
    const map = await fetchSongUrls([id], 320000);
    return map.get(String(id)) || null;
  },
  async playlistDetail(id) {
    const r = await call('playlist_detail', { id });
    const pl = r?.playlist;
    if (!pl) throw new Error('歌单不存在或已下架');
    const songs = (pl.tracks || []).map((t) => ({
      id: String(t.id),
      platform: 'netease',
      title: t.name || '',
      artist: artistLine(t.ar || t.artists || []),
      album: t.al?.name || '',
      duration: t.dt || t.duration || 0,
      cover: t.al?.picUrl || '',
      size: null,
      format: null,
      br: null,
    }));
    const enriched = await enrichSongs(songs, 320000);
    return {
      id: String(id),
      platform: 'netease',
      name: pl.name || '',
      cover: pl.coverImgUrl || '',
      owner: pl.creator?.nickname || '',
      count: pl.trackCount || enriched.length,
      description: pl.description || '',
      songs: enriched,
    };
  },
  // 给播放/下载代理用的直链（无需额外处理，由 index 统一代理）。
  async rawUrl(id) {
    const u = await this.songUrl(id);
    return u?.url || null;
  },
};

export default neteaseAdapter;
