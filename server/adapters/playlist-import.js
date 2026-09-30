// 通用「歌单分享地址」导入框架。
//
// 设计原则（与项目整体一致）：
//   1) 各家平台只负责「从分享地址里取出曲目列表（歌名 + 歌手）」；
//   2) 取出的曲目统一交给 Solara 按名解析为 FLAC（下载永远走 Solara，不碰原平台）。
//
// 平台识别按链接域名，支持扩展到任意平台。当前：
//   - 网易云、汽水、QQ、咪咕：实测可用（QQ/咪咕为直连官方公开歌单接口，免登录）。
//   - 酷狗：公开 web API 已迁移/需签名+登录态，裸接不现实，保留占位。
//
// 解析器约定：返回 { platform, name, owner, cover, count, tracks:[{title,artist,album,duration,cover}] }

import { neteaseAdapter } from './netease.js';
import { parseQishuiShareUrl } from './qishui.js';
import { resolveByName, solaraAdapter } from './solara.js';

const UA =
  'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 ' +
  '(KHTML, like Gecko) Chrome/120.0 Safari/537.36';

// —— 平台识别 ——
export function detectPlatformByUrl(rawUrl) {
  if (!rawUrl) return 'unknown';
  let u = rawUrl.trim();
  if (!/^https?:\/\//i.test(u)) u = 'https://' + u;
  let host = '';
  try {
    host = new URL(u).hostname.toLowerCase();
  } catch {
    return 'unknown';
  }
  if (host.includes('music.163.com')) return 'netease';
  if (host.includes('douyin.com') || host.includes('qishui')) return 'qishui';
  if (host.includes('qq.com')) return 'qq';
  if (host.includes('kugou.com')) return 'kugou';
  if (host.includes('migu.cn') || host.includes('migu.com')) return 'migu';
  if (host.includes('spotify.com')) return 'spotify';
  if (host.includes('music.apple.com') || host.includes('itunes.apple.com')) return 'applemusic';
  if (host.includes('music.youtube.com') || host.includes('youtube.com')) return 'youtubemusic';
  return 'unknown';
}

export function isPlaylistUrl(text) {
  if (!text) return false;
  return /^https?:\/\//i.test(text.trim()) || /\.(com|cn|net|fm)\//i.test(text.trim());
}

async function fetchText(url, headers = {}, timeoutMs = 8000) {
  // 硬超时：fetch 默认无超时，受限网络下单个上游挂起会一直等下去。
  // 关键词歌单搜索会并发打 QQ / 酷狗 / 咪咕，任一挂起都会拖垮整次搜索（触发上层安全网）。
  const ctrl = new AbortController();
  const timer = setTimeout(() => ctrl.abort(), timeoutMs);
  try {
    const res = await fetch(url, {
      headers: { 'User-Agent': UA, Accept: 'application/json, text/html, */*', ...headers },
      redirect: 'follow',
      signal: ctrl.signal,
    });
    if (!res.ok) throw new Error(`HTTP ${res.status}`);
    return res.text();
  } finally {
    clearTimeout(timer);
  }
}

// 处理 QQ 等接口返回的相对协议 / 相对路径图片地址
function normalizeUrl(u) {
  if (!u) return '';
  if (u.startsWith('//')) return 'https:' + u;
  if (u.startsWith('/')) return 'https://y.qq.com' + u;
  return u;
}

// 解码 HTML 数字实体（QQ 歌单名常含 &#NNNNN; 表情）
function decodeEntities(str) {
  if (!str) return '';
  return str
    .replace(/&#(\d+);/g, (_, d) => String.fromCodePoint(Number(d)))
    .replace(/&amp;/g, '&')
    .replace(/&lt;/g, '<')
    .replace(/&gt;/g, '>')
    .replace(/&quot;/g, '"')
    .replace(/&#39;/g, "'");
}

// 防止第三方库个别路由偶发挂起拖垮请求
function withTimeout(promise, ms = 15000) {
  let timer;
  const t = new Promise((_, rej) => { timer = setTimeout(() => rej(new Error('QQ 接口请求超时')), ms); });
  try { return Promise.race([promise, t]); } finally { clearTimeout(timer); }
}

// 咪咕歌单接口所需的渠道标识（公开接口，免登录）。
const MIGU_CHANNEL = '0146953';

// 咪咕接口：自带「重试 + 超时 + JSON 解析」，避免瞬时网络抖动导致解析失败。
async function fetchMiguJson(url, qs, { timeout = 12000, retries = 3 } = {}) {
  const u = new URL(url);
  for (const [k, v] of Object.entries(qs)) u.searchParams.set(k, v);
  let lastErr = null;
  for (let attempt = 1; attempt <= retries; attempt++) {
    try {
      const controller = new AbortController();
      const timer = setTimeout(() => controller.abort(), timeout);
      const res = await fetch(u, {
        headers: { 'User-Agent': UA, channel: MIGU_CHANNEL, Accept: 'application/json' },
        signal: controller.signal,
      });
      clearTimeout(timer);
      if (!res.ok) throw new Error('HTTP ' + res.status);
      const txt = await res.text();
      return JSON.parse(txt);
    } catch (e) {
      lastErr = e;
      if (attempt < retries) {
        await new Promise((r) => setTimeout(r, 400 * attempt));
        continue;
      }
    }
  }
  throw new Error(
    '咪咕接口请求失败：' + (lastErr ? lastErr.message : '无响应') + '（可能网络波动或网关拦截，可稍后重试）'
  );
}

// —— 网易云：分享地址形如 music.163.com/playlist?id=NNN 或 /#/playlist?id=NNN ——
function extractNeteaseId(url) {
  const m = url.match(/[?&]id=(\d+)/i) || url.match(/\/playlist\/(\d+)/i);
  return m ? m[1] : null;
}

async function parseNetease(url) {
  const id = extractNeteaseId(url);
  if (!id) throw new Error('无法从链接中识别网易云歌单 ID。');
  const detail = await neteaseAdapter.playlistDetail(id);
  return {
    platform: 'netease',
    name: detail.name || '网易云歌单',
    owner: detail.owner || '—',
    cover: detail.cover || '',
    count: detail.count || (detail.songs || []).length,
    tracks: (detail.songs || []).map((s) => ({
      title: s.title,
      artist: s.artist,
      album: s.album,
      duration: s.duration,
      cover: s.cover,
    })),
  };
}

// —— 汽水：复用 qishui.js 的分享页解析 ——
async function parseQishui(url) {
  return parseQishuiShareUrl(url);
}

// —— QQ 音乐：分享地址形如 y.qq.com/n/ryqq/playlist/NNN.html 或 c.y.qq.com/.../playlist.html?disstid=NNN ——
function extractQQId(url) {
  const m =
    url.match(/playlist\/(\d+)/i) ||
    url.match(/disstid=(\d+)/i) ||
    url.match(/id=(\d+)/i);
  return m ? m[1] : null;
}

// QQ 音乐：直连官方公开歌单详情接口（c.y.qq.com/qzone/fcg_ucc_getcdinfo_byids_cp.fcg）。
// 该接口免登录、返回 JSONP；我们用自带「重试 + 超时 + 解析」处理，避免依赖第三方库
// 在 fetch 失败时抛未捕获异常拖垮整个进程。仅用于「取出歌单曲目（歌名+歌手）」，
// 下载仍统一走 Solara 按名解析为 FLAC。
async function parseQQ(url) {
  const id = extractQQId(url);
  if (!id) throw new Error('无法从链接中识别 QQ 歌单 ID。');
  const api =
    'http://c.y.qq.com/qzone/fcg-bin/fcg_ucc_getcdinfo_byids_cp.fcg' +
    '?type=1&utf8=1&disstid=' + encodeURIComponent(id) + '&loginUin=0';
  let txt = null;
  let lastErr = null;
  for (let attempt = 1; attempt <= 3; attempt++) {
    try {
      const controller = new AbortController();
      const timer = setTimeout(() => controller.abort(), 12000);
      const res = await fetch(api, {
        headers: {
          'User-Agent': UA,
          Referer: 'https://y.qq.com/n/yqq/playlist',
          Accept: 'application/json',
        },
        redirect: 'follow',
        signal: controller.signal,
      });
      clearTimeout(timer);
      if (!res.ok) throw new Error('HTTP ' + res.status);
      txt = await res.text();
      break;
    } catch (e) {
      lastErr = e;
      if (attempt < 3) {
        await new Promise((r) => setTimeout(r, 500 * attempt));
        continue;
      }
    }
  }
  if (!txt) {
    throw new Error(
      'QQ 歌单接口请求失败：' +
        (lastErr ? lastErr.message : '无响应') +
        '（可能网络波动或网关拦截，可稍后重试）'
    );
  }
  // QQ 返回 JSONP：jsonCallback({...})；剥离外层包裹后再解析。
  let jsonStr = txt.trim();
  const cb = jsonStr.match(/^[\w$]+\(([\s\S]*)\)\s*;?\s*$/);
  if (cb) jsonStr = cb[1];
  let data;
  try {
    data = JSON.parse(jsonStr);
  } catch {
    throw new Error('QQ 歌单接口返回无法解析（可能不是有效的歌单链接）。');
  }
  const cd = data && data.cdlist && data.cdlist[0];
  if (!cd) {
    throw new Error('QQ 歌单接口未返回数据（可能该歌单为私密 / 已下架，或链接无效）。');
  }
  const list = cd.songlist || [];
  return {
    platform: 'qq',
    name: decodeEntities(cd.dissname || cd.title || 'QQ 歌单'),
    owner: cd.nickname || '—',
    cover: normalizeUrl(cd.logo || cd.headurl || ''),
    count: Number(cd.songnum || list.length),
    tracks: list.map((s) => ({
      title: s.songname || s.title || '',
      artist: (s.singer || [])
        .map((a) => (typeof a === 'string' ? a : a.name))
        .filter(Boolean)
        .join('/'),
      album: s.albumname || '',
      duration: (s.interval || 0) * 1000,
      cover: '',
    })),
  };
}

// —— 酷狗：分享地址形如 kugou.com/songlist/NNN.html ——
function extractKugouId(url) {
  const m = url.match(/songlist\/(\d+)/i) || url.match(/id=(\d+)/i);
  return m ? m[1] : null;
}

async function parseKugou(url) {
  const id = extractKugouId(url);
  if (!id) throw new Error('无法从链接中识别酷狗歌单 ID。');
  // 酷狗歌单信息接口（需签名/Referer，当前环境可能被反爬挡）。
  const api =
    'https://www.kugou.com/songlist/index.php?r=playlist&id=' +
    encodeURIComponent(id) +
    '&json=1';
  const txt = await fetchText(api, { Referer: 'https://www.kugou.com/' });
  // 返回可能是 JSON 或 HTML；优先解析 JSON。
  let data;
  try {
    data = JSON.parse(txt);
  } catch {
    throw new Error('酷狗歌单接口未返回 JSON（可能网络受限或需登录态）。');
  }
  const info = (data && data.data && data.data.info) || (data && data.info) || [];
  if (!Array.isArray(info) || !info.length) {
    throw new Error('酷狗歌单未解析到曲目（可能网络受限或需登录态）。');
  }
  return {
    platform: 'kugou',
    name: (data.data && data.data.specialname) || '酷狗歌单',
    owner: (data.data && data.data.nickname) || '—',
    cover: (data.data && data.data.imgurl) || '',
    count: info.length,
    tracks: info.map((s) => {
      // 酷狗歌单条目 filename 常为 “歌手 - 歌名”
      const fn = s.filename || '';
      const parts = fn.split(' - ');
      return {
        title: parts.length > 1 ? parts[1] : fn,
        artist: parts.length > 1 ? parts[0] : '',
        album: s.remark || '',
        duration: (s.duration || 0) * 1000,
        cover: '',
      };
    }),
  };
}

// —— 咪咕：分享地址形如 music.migu.cn/v3/music/playlist/NNN ——
function extractMiguId(url) {
  const m =
    url.match(/\/playlist\/(\d+)/i) ||
    url.match(/playListId=(\d+)/i) ||
    url.match(/id=(\d+)/i);
  return m ? m[1] : null;
}

// 咪咕歌单详情：直连官方公开接口 queryMusicListSongs.do（免登录）。
// 该接口只返回曲目列表（songName / singer / album / albumImgs），不含歌单名称，
// 歌单名以兜底名呈现；下载仍统一走 Solara 按名解析为 FLAC。
// 咪咕时长字段为字符串 "MM:SS" 或 "HH:MM:SS"，需按冒号解析为毫秒。
function parseColonDuration(str) {
  if (!str || typeof str !== 'string') return 0;
  const parts = str.split(':').map((x) => Number(x) || 0);
  let sec = 0;
  if (parts.length === 3) sec = parts[0] * 3600 + parts[1] * 60 + parts[2];
  else if (parts.length === 2) sec = parts[0] * 60 + parts[1];
  else sec = parts[0];
  return sec * 1000;
}

async function parseMigu(url) {
  const id = extractMiguId(url);
  if (!id) throw new Error('无法从链接中识别咪咕歌单 ID。');
  const data = await fetchMiguJson(
    'https://app.c.nf.migu.cn/MIGUM3.0/v1.0/user/queryMusicListSongs.do',
    { musicListId: id, pageNo: '1', pageSize: '100' }
  );
  const list = (data && data.list) || [];
  if (!list.length) {
    throw new Error('咪咕歌单未解析到曲目（可能该歌单不存在或已下架）。');
  }
  // 用首曲封面作为歌单封面兜底（接口本身不返回歌单封面）。
  const cover =
    (list[0].albumImgs && list[0].albumImgs[0] && list[0].albumImgs[0].img) || '';
  return {
    platform: 'migu',
    name: '咪咕歌单',
    owner: '—',
    cover,
    count: Number(data.totalCount || list.length),
    tracks: list.map((s) => ({
      title: s.songName || '',
      artist: (s.singer || '').split('|').filter(Boolean).join('/'),
      album: s.album || '',
      duration: parseColonDuration(s.length),
      cover: '',
    })),
  };
}

// —— 关键词歌单搜索（跨平台聚合） ——
// 设计：各平台只负责「按关键词返回歌单元数据（封面/名称/创建者/曲目数）」，
// 各自带真实 platform 字段；点开歌单后再统一走 parseXxx + resolveByName 出 FLAC。
// 网易云 / QQ / 咪咕：接口实测可用，抛错被 catch 吞掉，优雅降级（不影响其它平台结果）。
// 酷狗：公开接口需签名+登录态，裸接不现实，返回 [] 降级。
function dedupePlaylistById(list) {
  const seen = new Set();
  const out = [];
  for (const x of list) {
    if (!x || !x.id) continue;
    const key = `${x.platform}:${x.id}`;
    if (seen.has(key)) continue;
    seen.add(key);
    out.push(x);
  }
  return out;
}

async function neteaseSearchPlaylists(keywords, limit = 30) {
  const r = await neteaseAdapter.search(keywords, 'playlist');
  return (r.playlists || []).map((p) => ({ ...p, platform: 'netease' }));
}

async function qqSearchPlaylists(keywords, limit = 30) {
  // QQ 歌单搜索：client_music_search_songlist（返回 JSONP 包裹），实测可用、无需登录。
  const url =
    'https://c.y.qq.com/soso/fcgi-bin/client_music_search_songlist?remoteplace=txt.yqq.playlist' +
    '&page_no=0&num_per_page=' + limit + '&query=' + encodeURIComponent(keywords);
  let txt;
  try {
    txt = await fetchText(url, { Referer: 'https://y.qq.com/' }, 6000);
  } catch (e) { return []; }
  // 剥掉 JSONP 外壳：MusicJsonCallback({...})
  const m = txt.match(/^\s*MusicJsonCallback\(([\s\S]*)\)\s*;?\s*$/);
  const jsonStr = m ? m[1] : txt;
  let data;
  try { data = JSON.parse(jsonStr); } catch { return []; }
  const list = (data && data.data && data.data.list) || [];
  return list
    .map((d) => ({
      id: String(d.disstid || d.dissid || d.id || ''),
      platform: 'qq',
      name: decodeEntities(d.dissname || d.name || ''),
      cover: normalizeUrl(d.imgurl || d.cover || ''),
      owner: (d.creator && (d.creator.name || d.creator.nickname)) || '',
      count: Number(d.songnum || d.song_count || 0),
      description: '',
    }))
    .filter((p) => p.id);
}

async function kgSearchPlaylists(keywords, limit = 30) {
  const url =
    'https://msearch.kugou.com/api/search?keyword=' + encodeURIComponent(keywords) +
    '&page=1&pagesize=' + limit + '&type=3&area_code=1&plat=2';
  const txt = await fetchText(url, {
    Referer: 'https://www.kugou.com/',
    Accept: 'application/json',
  }, 5000);
  let data;
  try { data = JSON.parse(txt); } catch { return []; }
  const list = (data && data.data && data.data.lists) || [];
  return list
    .map((d) => ({
      id: String(d.listid || d.id || ''),
      platform: 'kugou',
      name: d.specialname || d.name || '',
      cover: d.imgurl ? (d.imgurl.startsWith('http') ? d.imgurl : 'https:' + d.imgurl) : '',
      owner: d.nickname || '',
      count: Number(d.songcount || 0),
      description: '',
    }))
    .filter((p) => p.id);
}

async function miguSearchPlaylists(keywords, limit = 30) {
  // 咪咕歌单搜索：search_all.do + searchSwitch 仅开 songlist（无需签名，带 channel 即可）。
  try {
    const data = await fetchMiguJson(
      'https://pd.musicapp.migu.cn/MIGUM3.0/v1.0/content/search_all.do',
      {
        text: keywords,
        pageNo: '1',
        pageSize: String(limit),
        searchSwitch: '{"song":0,"album":0,"singer":0,"songlist":1,"mv":0,"lyric":0}',
      },
      // 关键词歌单搜索属次要信息，收紧为 5s/不重试（默认 12s×3 最坏可达 36s+，会拖垮整次搜索）
      { timeout: 5000, retries: 1 }
    );
    const sl = (data && data.songListResultData) || {};
    const list = sl.result || [];
    return list
      .map((d) => ({
        id: String(d.id || ''),
        platform: 'migu',
        name: d.name || '',
        cover: d.musicListPicUrl || '',
        owner: '',
        count: Number(d.musicNum || 0),
        description: '',
      }))
      .filter((p) => p.id);
  } catch {
    return [];
  }
}

export async function searchPlaylists(keywords, limit = 60) {
  const tasks = [
    neteaseSearchPlaylists(keywords, limit),
    qqSearchPlaylists(keywords, limit),
    kgSearchPlaylists(keywords, limit),
    miguSearchPlaylists(keywords, limit),
  ];
  const settled = await Promise.allSettled(tasks);
  const out = [];
  for (const s of settled) {
    if (s.status === 'fulfilled' && Array.isArray(s.value)) out.push(...s.value);
  }
  return dedupePlaylistById(out);
}

// 由「平台 + 歌单 id」合成对应的分享地址，便于复用 importPlaylist 的解析链路。
export function synthesizePlaylistUrl(platform, id) {
  switch (String(platform)) {
    case 'netease': return `https://music.163.com/playlist?id=${id}`;
    case 'qq': return `https://y.qq.com/n/ryqq/playlist/${id}.html`;
    case 'kugou': return `https://www.kugou.com/songlist/${id}.html`;
    case 'migu': return `https://music.migu.cn/v3/music/playlist/${id}`;
    case 'qishui': return String(id);
    default: return String(id);
  }
}

// —— 解析器路由表 ——
const PARSERS = {
  netease: parseNetease,
  qishui: parseQishui,
  qq: parseQQ,
  kugou: parseKugou,
  migu: parseMigu,
};

async function resolveFlacTracks(tracks, fromPlatform, limit = 80) {
  const pool = tracks.slice(0, limit);
  const out = new Array(pool.length);

  // —— 预筛：曲目自带网易云 id 时，先用「一次批量请求」问清哪些 id 真的有音源 ——
  // 大列表（如歌手热门 50~100 首）里常有大量「已下架 / 需 VIP」的曲目，
  // 若不预筛就会对它们逐个打 Solara（每次还要再回退一次网易云），
  // 白白多打上百次请求、拖慢到几十秒，最后仍是无源。
  // 预筛后：有音源的先拿 MP3 保底，再并发尝试用 Solara 升到 FLAC；
  //         无音源的直接跳过（只对它们做一次按名回查兜底）。
  const neMap = new Map();
  const idIdx = [];
  for (let i = 0; i < pool.length; i++) {
    const t = pool[i];
    if (t && t.id && t.platform === 'netease') idIdx.push(i);
  }
  if (idIdx.length) {
    try {
      const m = await neteaseAdapter.songUrls(idIdx.map((i) => String(pool[i].id)));
      if (m && typeof m.forEach === 'function') m.forEach((v, k) => neMap.set(String(k), v));
    } catch {
      /* 预筛失败不影响主流程，退化为逐个解析 */
    }
  }

  // 单首解析：resolveByName 返回 {id,size,format,br,flac}（不含 url），
  // 返回非空即代表已成功取到直链（内部 songUrl 已校验过 url）。
  async function resolveOne(t) {
    try {
      if (t.id && t.platform === 'netease') {
        const ne = neMap.get(String(t.id));
        // 预筛已知无音源（下架/需 VIP）：不再逐个打 Solara，改做一次按名回查兜底。
        if (ne && !ne.url) {
          const alt = await resolveByName(t.title, t.artist);
          return alt && alt.id ? alt : null;
        }
        // 有音源：先尝试 Solara 升 FLAC（能出 FLAC 就用 FLAC）。
        const info = await solaraAdapter.songUrl(String(t.id), 'netease');
        if (info && info.url) {
          return {
            id: String(t.id),
            size: info.size ?? null,
            format: info.format || 'MP3',
            br: info.br ?? null,
            flac: info.format === 'FLAC',
          };
        }
        // Solara 抖动/无 FLAC：用预筛拿到的 MP3 保底，避免整首被判无源。
        if (ne && ne.url) {
          return {
            id: String(t.id),
            size: ne.size ?? null,
            format: (ne.format || 'MP3').toUpperCase(),
            br: ne.br ?? null,
            flac: false,
          };
        }
      }
      // 无 id（如汽水歌单只有歌名）：按「歌名 + 歌手」回查。
      const r = await resolveByName(t.title, t.artist);
      if (r && r.id) return r;
    } catch {
      /* 交给上层重试 */
    }
    return null;
  }

  function hit(t, r) {
    return {
      id: r.id,
      platform: 'solara',
      src: 'netease',
      title: t.title,
      artist: t.artist,
      album: t.album,
      duration: t.duration,
      cover: t.cover,
      size: r.size,
      format: r.format || 'MP3',
      br: r.br,
      flac: !!r.flac,
      resolved: true,
      fromPlatform,
    };
  }

  // 第一阶段：适度并发批量解析。
  // 并发过高会被上游（Solara 跳板）限流，反而导致「整表全灰」，
  // 因此这里用 6 路；漏掉的部分交给第二阶段补。
  let idx = 0;
  const CONC = 6;
  async function runner() {
    while (idx < pool.length) {
      const cur = idx++;
      const r = await resolveOne(pool[cur]);
      if (r) out[cur] = hit(pool[cur], r);
    }
  }
  await Promise.all(Array.from({ length: Math.min(CONC, pool.length || 1) }, () => runner()));

  // 第二阶段：对第一阶段未命中的曲目，低并发（2 路）+ 退避重试一次。
  // 上游偶发抖动/限流时，这一步能把「整表全灰」救回成「个别失败」。
  const failed = [];
  for (let i = 0; i < pool.length; i++) if (!out[i]) failed.push(i);
  if (failed.length) {
    let fi = 0;
    async function retryRunner() {
      while (fi < failed.length) {
        const cur = failed[fi++];
        await new Promise((r) => setTimeout(r, 150 + Math.floor(Math.random() * 200)));
        const r = await resolveOne(pool[cur]);
        if (r) out[cur] = hit(pool[cur], r);
      }
    }
    await Promise.all(Array.from({ length: Math.min(2, failed.length) }, () => retryRunner()));
  }

  // 仍未解析（上游持续限流 / 曲库确实无源）：保留条目并标记，避免列表无声变空。
  for (let i = 0; i < pool.length; i++) {
    if (out[i]) continue;
    const t = pool[i];
    out[i] = {
      id: String(t.id || `t${i}`),
      platform: 'solara',
      src: 'netease',
      title: t.title,
      artist: t.artist,
      album: t.album,
      duration: t.duration,
      cover: t.cover,
      size: null,
      format: null,
      br: null,
      flac: false,
      resolved: false,
      reason: '上游音源暂时不可用（限流或未收录），可点「重新解析」',
      fromPlatform,
    };
  }

  return out.filter(Boolean);
}

async function importPlaylist(rawUrl) {
  let u = rawUrl.trim();
  if (!/^https?:\/\//i.test(u)) u = 'https://' + u;
  const platform = detectPlatformByUrl(u);
  if (platform === 'unknown') {
    throw new Error('无法识别该链接所属平台（目前支持网易云、汽水、QQ、酷狗、咪咕等）。');
  }
  const parser = PARSERS[platform];
  if (!parser) throw new Error(`暂不支持解析 ${platform} 平台的歌单。`);
  const parsed = await parser(u);
  const songs = await resolveFlacTracks(parsed.tracks, parsed.platform);
  const resolvedCount = songs.filter((s) => s.resolved).length;
  const flacCount = songs.filter((s) => s.flac).length;
  return {
    id: u,
    platform: parsed.platform,
    name: parsed.name || '歌单',
    cover: parsed.cover || '',
    owner: parsed.owner || '—',
    count: parsed.count || parsed.tracks.length,
    resolvedCount,
    flacCount,
    totalCount: parsed.tracks.length,
    songs,
  };
}

// 数量上限：控制单次解析耗时（歌手热门曲目可达上百首）
const ARTIST_TRACK_LIMIT = 50;
const ALBUM_TRACK_LIMIT = 100;

// —— 歌手 / 专辑详情：拉取该歌手/专辑的曲目，再统一解析为 FLAC ——
// 平台路由：目前歌手/专辑由网易云提供（搜索即网易云来源），其余平台暂返回空。
async function rawArtistSongs(platform, id) {
  // Solara 本身没有歌手/专辑曲目接口（见 solara.js 顶部注释：这两类委托 netease 适配器完成），
  // 其搜索结果里的歌手 id 就是网易云 id，只是被 remapPlatform 贴上了 'solara' 标签。
  // 若这里只认 'netease'，则点击歌手时 platform=solara 会直接落到 return [] —— 列表恒为空。
  // 因此 netease / solara 一律走网易云直连取曲目。
  return neteaseAdapter.artistSongs(id);
}
async function rawAlbumSongs(platform, id) {
  // 同 rawArtistSongs：专辑曲目也委托 netease，id 即网易云专辑 id。
  return neteaseAdapter.albumSongs(id);
}

export async function getArtistSongs(platform, id, fallbackName = '') {
  const raw = await rawArtistSongs(platform, id);
  // 热门曲目常达上百首，全部解析会让用户等几十秒；这里取前 ARTIST_TRACK_LIMIT 首，
  // 并让 count 与实际解析数量一致（否则会出现「共 100 首」但列表只有 80 条）。
  const pool = raw.slice(0, ARTIST_TRACK_LIMIT);
  const songs = await resolveFlacTracks(pool, platform, ARTIST_TRACK_LIMIT);
  return summarize(fallbackName, songs, raw.length, '热门');
}

// 汇总统计：FLAC / MP3 / 暂无音源 分开呈现（此前只算 FLAC，会低估可用曲目）
function summarize(name, songs, totalRaw, prefix = '共') {
  const flacCount = songs.filter((s) => s.flac).length;
  const mp3Count = songs.filter((s) => s.format && !s.flac).length;
  const noSrcCount = songs.filter((s) => !s.format).length;
  return {
    name: name || '',
    cover: '',
    subtitle: `${prefix} ${songs.length} 首 · FLAC ${flacCount} · MP3 ${mp3Count} · 暂无音源 ${noSrcCount}`,
    count: songs.length,
    resolvedCount: songs.filter((s) => s.resolved).length,
    flacCount,
    mp3Count,
    noSrcCount,
    totalCount: totalRaw,
    songs,
  };
}

export async function getAlbumSongs(platform, id, fallbackName = '') {
  const raw = await rawAlbumSongs(platform, id);
  const pool = raw.slice(0, ALBUM_TRACK_LIMIT);
  const songs = await resolveFlacTracks(pool, platform, ALBUM_TRACK_LIMIT);
  return summarize(fallbackName, songs, raw.length, '共');
}

export const playlistImport = {
  detectPlatformByUrl, isPlaylistUrl, importPlaylist, searchPlaylists, synthesizePlaylistUrl,
  getArtistSongs, getAlbumSongs,
};
export default playlistImport;
