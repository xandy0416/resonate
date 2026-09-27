// Solara 跳板适配器
// ───────────────────────────────────────────────────────────────────────────
// 用 Solara 使用的免费曲库聚合 API（music-api.gdstudio.xyz）作为“跳板”，
// 实现「全网单曲搜索 + 完整直链（免登录）」，并复用网易云适配器补全
// 歌单 / 歌手 / 专辑搜索与歌单详情（其曲目统一走 Solara 的 netease 完整直链）。
//
// 实测能力边界（2026-09-27）：
//   types=search  : 支持 source=netease / joox / bilibili
//                  返回 id / name / artist[] / album / pic_id / url_id / source
//   types=url     : source=netease 返回完整音轨（br 可达 900+ kbps，非 30s 试听）；
//                  joox/bilibili 对 netease id 返回空 —— 故直链统一用 netease 源
//   types=pic     : source=netease&id=<pic_id> 返回封面 URL
//   ❌ 不支持 types=playlist / artist / album —— 这三类委托给 netease 适配器
//
// 设计取舍：Solara 单曲搜索跨 3 源做广度，去重时优先 netease；对 joox/bilibili
// 独有曲目尽力回查 netease id，使其播放/下载也能命中完整直链。

import { neteaseAdapter } from './netease.js';

const SOLARA_BASE = 'https://music-api.gdstudio.xyz/api.php';
const SONG_SOURCES = ['netease', 'joox', 'bilibili'];

// —— 请求工具（带超时 + 一次重试） ─────────────────────────────────────────
function solaraUrl(params) {
  const u = new URL(SOLARA_BASE);
  for (const [k, v] of Object.entries(params)) {
    if (v != null && v !== '') u.searchParams.set(k, String(v));
  }
  return u.toString();
}

async function solaraGet(params, timeoutMs = 12000) {
  for (let attempt = 0; attempt < 2; attempt++) {
    const ctrl = new AbortController();
    const timer = setTimeout(() => ctrl.abort(), timeoutMs);
    try {
      const r = await fetch(solaraUrl(params), {
        headers: { 'User-Agent': 'Mozilla/5.0', Accept: 'application/json' },
        signal: ctrl.signal,
      });
      const text = await r.text();
      try { return JSON.parse(text); } catch { return null; }
    } catch {
      // 超时或网络错 → 重试一次
    } finally {
      clearTimeout(timer);
    }
  }
  return null;
}

// —— 归一化 / 去重 ─────────────────────────────────────────────────────────
const PUNCT_RE = /[\s\-_·・.,，。、!！?？'""''()（）\[\]【】&+/\\|~～:：;；*@$%^=<>《》]+/;
function norm(s) {
  if (!s) return '';
  // 注意：归一化必须是「字符串.split(正则)」，不能写成「正则.split(字符串)」
  return String(s).toLowerCase().normalize('NFKC').split(PUNCT_RE).join('');
}
function uniqKey(name, artist) {
  const a = Array.isArray(artist) ? artist : String(artist || '').split('/');
  return norm(name) + '|' + a.map((x) => norm(x)).filter(Boolean).sort().join(',');
}

// 封面：pic 接口（netease 体系）
async function picUrl(picId) {
  if (!picId) return '';
  const d = await solaraGet({ types: 'pic', source: 'netease', id: String(picId) }, 8000);
  return (d && d.url) || '';
}

function mapSolaraSong(raw, src) {
  const artist = Array.isArray(raw.artist) ? raw.artist.join('/') : String(raw.artist || '');
  return {
    id: String(raw.id),
    platform: 'solara',
    title: raw.name || '',
    artist,
    album: raw.album || '',
    duration: raw.duration || 0,
    cover: '',
    size: null,
    format: null,
    br: null,
    src, // 原始音源（播放/下载直链用）
    _picId: raw.pic_id || '', // 临时：用于批量取封面，返回前删除
  };
}

// 在 Solara 的 netease 源里回查某首歌的 netease id，用于把 joox/bilibili
// 独有曲目也对齐到可下载的 netease 直链。
async function neteaseIdFor(name, artist) {
  const data = await solaraGet(
    { types: 'search', source: 'netease', name, count: '5', pages: '1' },
    8000
  );
  if (!Array.isArray(data)) return null;
  const qn = norm(name);
  const qa = String(artist || '').split('/').map(norm).filter(Boolean);
  for (const c of data) {
    const cn = norm(c.name || '');
    if (!qn || qn !== cn) continue; // 歌名严格相等才认可
    const ca = (Array.isArray(c.artist) ? c.artist : []).map(norm).filter(Boolean);
    const artistOk =
      qa.length === 0 ||
      ca.length === 0 ||
      qa.some((x) => ca.includes(x)) ||
      ca.some((x) => qa.some((y) => y.length >= 3 && (x.includes(y) || y.includes(x))));
    if (artistOk) return String(c.id);
  }
  return null;
}

async function searchSongs(keywords, limit = 30) {
  const settled = await Promise.allSettled(
    SONG_SOURCES.map((src) =>
      solaraGet({ types: 'search', source: src, name: keywords, count: String(limit), pages: '1' })
    )
  );
  const seen = new Map(); // uniqKey -> song（优先 netease）
  for (let i = 0; i < settled.length; i++) {
    const src = SONG_SOURCES[i];
    const data = settled[i].status === 'fulfilled' ? settled[i].value : null;
    if (!Array.isArray(data)) continue;
    for (const raw of data) {
      if (!raw || !raw.id || !raw.name) continue;
      const song = mapSolaraSong(raw, src);
      const key = uniqKey(song.title, song.artist);
      const existing = seen.get(key);
      if (!existing || (existing.src !== 'netease' && src === 'netease')) {
        seen.set(key, song);
      }
    }
  }

  let songs = [...seen.values()].slice(0, limit);

  // 把 joox/bilibili 独有曲目尽力对齐到 netease id，确保可下载完整音轨
  const toRemap = songs.filter((s) => s.src !== 'netease');
  await Promise.all(
    toRemap.map(async (s) => {
      try {
        const nid = await neteaseIdFor(s.title, s.artist);
        if (nid) {
          s.id = nid;
          s.src = 'netease';
        }
      } catch { /* 忽略 */ }
    })
  );

  // 批量补封面（按 pic_id 去重）
  const picIds = [...new Set(songs.map((s) => s._picId).filter(Boolean))];
  const coverMap = {};
  await Promise.all(
    picIds.map(async (pid) => {
      coverMap[pid] = await picUrl(pid);
    })
  );
  for (const s of songs) {
    if (s._picId) s.cover = coverMap[s._picId] || '';
    delete s._picId;
  }
  return songs;
}

// 把 netease 适配器返回的结果重新标 platform='solara'
function remapPlatform(list, setSrc) {
  return (list || []).map((x) => ({
    ...x,
    platform: 'solara',
    ...(setSrc ? { src: 'netease' } : {}),
  }));
}

async function delegateSearch(keywords, type) {
  const r = await neteaseAdapter.search(keywords, type);
  // 单曲也来自 netease（Solara 单曲搜索已单独提供，这里避免重复），故只取其余三类
  return {
    playlists: remapPlatform(r.playlists),
    artists: remapPlatform(r.artists),
    albums: remapPlatform(r.albums),
  };
}

async function playlistDetail(id) {
  const d = await neteaseAdapter.playlistDetail(id);
  // 歌单内曲目统一解析为 Solara 的 FLAC 直链（只保留可获取 FLAC 的）。
  const songs = await resolveFlac((d.songs || []).slice(0, 200), 200);
  return {
    ...d,
    platform: 'solara',
    count: d.count,
    songs,
  };
}

// 直链：统一用 netease 源（可靠完整音轨，免登录）
async function songUrl(id, src) {
  const source = src && src !== 'netease' ? src : 'netease';
  const d = await solaraGet({ types: 'url', source, id: String(id) }, 15000);
  if (d && d.url) {
    const url = d.url;
    const size = d.size || null;
    // 该 API 的 br 字段不稳定（FLAC 有时标成 1），故格式以 URL 后缀优先判定
    const lower = url.toLowerCase();
    let format = 'MP3';
    if (lower.includes('.flac')) format = 'FLAC';
    else if (lower.includes('.mp3')) format = 'MP3';
    else if (typeof d.br === 'number' && d.br >= 700) format = 'FLAC';
    const br = typeof d.br === 'number' && d.br > 1 ? Math.round(d.br / 1000) : null;
    return { url, size, br, format };
  }
  return null;
}

// —— 并发控制 ──────────────────────────────────────────────────────────
async function mapWithConcurrency(items, worker, concurrency = 8) {
  const results = new Array(items.length);
  let idx = 0;
  async function runner() {
    while (idx < items.length) {
      const cur = idx++;
      results[cur] = await worker(items[cur], cur);
    }
  }
  const n = Math.min(concurrency, items.length || 1);
  await Promise.all(Array.from({ length: n }, () => runner()));
  return results;
}

// 把一批单曲（可能来自网易云 / Solara 多源发现）统一解析为 Solara 的 netease
// 完整直链，并【只保留能拿到 FLAC 的】，附上 size / format / br。
// 这是“全部返回 FLAC 高质量”的核心：发现层与音频层在此汇合。
export async function resolveFlac(songs, limit = 40) {
  const seen = new Set();
  const unique = [];
  for (const s of songs) {
    const key = uniqKey(s.title, s.artist);
    if (!key) continue;
    if (seen.has(key)) continue;
    seen.add(key);
    unique.push(s);
  }
  const capped = unique.slice(0, limit);
  const resolved = await mapWithConcurrency(capped, async (s) => {
    try {
      const info = await songUrl(String(s.id), 'netease');
      if (!info || !info.url || info.format !== 'FLAC') return null;
      return {
        ...s,
        platform: 'solara',
        src: 'netease',
        size: info.size,
        format: 'FLAC',
        br: info.br,
        flac: true,
        fromPlatform: s.platform || 'netease',
      };
    } catch {
      return null;
    }
  });
  return resolved.filter(Boolean);
}

// 按“歌名 + 歌手”在 Solara 的 netease 源里回查并解析 FLAC，
// 用于汽水歌单等【没有平台曲目 id】的场景（只能靠名回查）。
export async function resolveByName(name, artist) {
  const qn = norm(name);
  const qa = String(artist || '').split('/').map(norm).filter(Boolean);
  const data = await solaraGet({ types: 'search', source: 'netease', name, count: '5', pages: '1' }, 8000);
  if (!Array.isArray(data)) return null;
  let best = null;
  for (const c of data) {
    const cn = norm(c.name || '');
    if (qn && qn !== cn) continue;
    const ca = (Array.isArray(c.artist) ? c.artist : []).map(norm).filter(Boolean);
    const ok =
      qa.length === 0 ||
      ca.length === 0 ||
      qa.some((x) => ca.includes(x)) ||
      ca.some((x) => qa.some((y) => y.length >= 3 && (x.includes(y) || y.includes(x))));
    if (ok) { best = c; break; }
  }
  if (!best) return null;
  const info = await songUrl(String(best.id), 'netease');
  if (!info || info.format !== 'FLAC') return null;
  return { id: String(best.id), size: info.size, format: 'FLAC', br: info.br };
}

export const solaraAdapter = {
  id: 'solara',
  name: 'Solara 跳板',
  connected: true, // 外部公共服务，无需本地依赖
  async search(keywords, type) {
    // 关键词搜索只覆盖「单曲 / 歌手 / 专辑」；歌单统一走「分享地址导入」，
    // 不再做关键词歌单搜索（各家平台歌单搜索需登录态/反爬，且用户要求以链接导入）。
    if (type === 'song') {
      const songs = await searchSongs(keywords);
      return { songs, playlists: [], artists: [], albums: [] };
    }
    if (type === 'artist') {
      const rest = await delegateSearch(keywords, 'artist');
      return { songs: [], playlists: [], artists: rest.artists, albums: [] };
    }
    if (type === 'album') {
      const rest = await delegateSearch(keywords, 'album');
      return { songs: [], playlists: [], artists: [], albums: rest.albums };
    }
    if (type === 'all') {
      const [songs, rest] = await Promise.all([
        searchSongs(keywords),
        delegateSearch(keywords, 'all'),
      ]);
      return { songs, playlists: [], artists: rest.artists, albums: rest.albums };
    }
    // type === 'playlist' 等：关键词不返回歌单
    return { songs: [], playlists: [], artists: [], albums: [] };
  },
  songUrl,
  playlistDetail,
  async rawUrl(id, src) {
    const u = await songUrl(id, src);
    return u?.url || null;
  },
};

export default solaraAdapter;
