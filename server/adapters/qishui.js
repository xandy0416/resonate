// 汽水音乐（抖音音乐版）适配器 —— 真实可用，但有两种能力边界：
//
// ① 歌单导入（免登录，稳定）：汽水音乐没有公开的关键词搜索接口，但歌单分享页
//    （qishui.douyin.com/s/xxx）是服务端渲染的 H5，内嵌 _ROUTER_DATA，含完整
//    歌单与曲目信息。本适配器复用「汽水音乐下载」技能中 qishui_export.py 的解析
//    逻辑（移植到 Node，不依赖 Python），把分享链接解析成歌单 + 歌曲。
//
// ② 歌曲播放/下载：汽水本身不暴露音频 CDN，但「免费曲库」(music-api.gdstudio.xyz，
//    即 Solara 播放器用的同一套) 可按「歌名 + 歌手」匹配到网易云/酷狗等真实音频流。
//    本适配器对汽水歌曲做同名歌手匹配，命中即返回可播放/下载的直链。
//
// 限制（诚实说明）：汽水不支持"关键词搜索单曲/歌手/专辑"，只能导入歌单；若搜索框
// 输入的是汽水分享链接，则解析出该歌单；否则返回空结果 + 引导提示。

import { resolveByName } from './solara.js';

const UA_MOBILE =
  'Mozilla/5.0 (iPhone; CPU iPhone OS 17_0 like Mac OS X) ' +
  'AppleWebKit/605.1.15 (KHTML, like Gecko) Version/17.0 Mobile/15E148 Safari/604.1';

const SHARE_RE =
  /https?:\/\/(?:[\w-]+\.)?(?:qishui\.douyin\.com|music\.douyin\.com|douyin\.com)\/[^\s"'`<>）)】\]]*share[^\s"'`<>）)】\]]*|https?:\/\/(?:[\w-]+\.)?qishui\.douyin\.com\/s\/[\w-]+/i;

const LIB_BASE = 'https://music-api.gdstudio.xyz/api.php';

// —— 工具：从整段文字里提取第一个汽水分享链接 ——
function extractShareUrl(text) {
  if (!text) return null;
  const m = text.match(SHARE_RE);
  if (!m) return null;
  let u = m[0].replace(/[.,;、。，）)】\]]+$/, '').trim();
  // 归一化为 qishui.douyin.com/s/<token>/ 形式，便于做歌单 id
  const tok = u.match(/qishui\.douyin\.com\/s\/([\w-]+)/i);
  if (tok) return `https://qishui.douyin.com/s/${tok[1]}/`;
  return u.replace(/\/+$/, '') + '/';
}

// —— 工具：歌曲 id 编码（携带歌名+歌手，供曲库匹配播放）——
function encTrackId(name, artist) {
  const payload = JSON.stringify({ n: name || '', a: artist || '' });
  return 'qs:' + Buffer.from(payload, 'utf8').toString('base64url');
}
function decTrackId(id) {
  if (!id || !id.startsWith('qs:')) return null;
  try {
    const o = JSON.parse(Buffer.from(id.slice(3), 'base64url').toString('utf8'));
    return { n: o.n || '', a: o.a || '' };
  } catch {
    return null;
  }
}

// —— 抓取分享页（带手机 UA）——
async function fetchHtml(url, retries = 3) {
  let last;
  for (let i = 0; i < retries; i++) {
    try {
      const res = await fetch(url, {
        headers: {
          'User-Agent': UA_MOBILE,
          'Accept-Language': 'zh-CN,zh;q=0.9',
          Referer: 'https://qishui.douyin.com/',
        },
        redirect: 'follow',
      });
      const body = await res.text();
      if (body && body.length > 500) return body;
      last = `返回内容过短(${body.length}B)`;
    } catch (e) {
      last = e.message;
    }
    if (i < retries - 1) await new Promise((r) => setTimeout(r, 1500 * (i + 1)));
  }
  throw new Error(`抓取汽水分享页失败：${last}`);
}

// —— 提取并解析 _ROUTER_DATA（括号匹配，容忍尾部 JS）——
function extractRouterData(html) {
  const i = html.indexOf('_ROUTER_DATA');
  if (i < 0) {
    throw new Error('页面里没有找到 _ROUTER_DATA（链接可能已失效或被限制）。');
  }
  const start = html.indexOf('{', i);
  if (start < 0) throw new Error('_ROUTER_DATA 格式异常，未找到起始 { 。');
  let depth = 0;
  let inStr = false;
  let esc = false;
  for (let j = start; j < html.length; j++) {
    const ch = html[j];
    if (inStr) {
      if (esc) esc = false;
      else if (ch === '\\') esc = true;
      else if (ch === '"') inStr = false;
      continue;
    }
    if (ch === '"') inStr = true;
    else if (ch === '{') depth++;
    else if (ch === '}') {
      depth--;
      if (depth === 0) {
        const slice = html.slice(start, j + 1);
        return JSON.parse(slice);
      }
    }
  }
  throw new Error('_ROUTER_DATA 括号不匹配，解析失败。');
}

// —— 曲目字段白名单 ——
const NAME_KEYS = ['name', 'trackName', 'title', 'track_name', 'song_name'];
const ARTIST_KEYS = ['artists', 'artistName', 'artist', 'singers', 'singer'];
const LIST_KEYS = [
  'medias', 'tracks', 'track_list', 'trackList', 'songs', 'song_list',
  'songList', 'items', 'media_list', 'mediaList', 'playlist_tracks',
  'playlistTracks', 'audios', 'musics', 'entities',
];
const EXCLUDE_RE = /(albumTracks|artistTracks|relatedTracks|chartTracks|recommend|similar|hot_?tracks|radio|rank|feed|comment|lyric|searchResult)/i;

function isTrack(d) {
  if (!d || typeof d !== 'object') return false;
  const hasName = NAME_KEYS.some((k) => k in d);
  const hasArtist = ARTIST_KEYS.some((k) => k in d);
  return hasName && hasArtist;
}

function first(d, keys) {
  for (const k of keys) {
    if (k in d && d[k] != null && d[k] !== '') return d[k];
  }
  return null;
}

function mediaKind(item) {
  if (item && typeof item === 'object') {
    const t = String(item.type || '').toLowerCase();
    if (t.includes('video')) return '视频';
    const ent = item.entity;
    if (ent && typeof ent === 'object' && ent.video) return '视频';
  }
  return '歌曲';
}

function unwrap(item) {
  if (!item || typeof item !== 'object') return item;
  if (item.track && typeof item.track === 'object') return item.track;
  const ent = item.entity;
  if (ent && typeof ent === 'object') {
    for (const k of ['track', 'video', 'audio']) {
      if (ent[k] && typeof ent[k] === 'object') return ent[k];
    }
  }
  return item;
}

function fmtArtists(v) {
  if (!v) return '';
  if (typeof v === 'string') return v.trim();
  if (Array.isArray(v)) return v.map(fmtArtists).filter(Boolean).join('/');
  if (typeof v === 'object') {
    for (const k of ['name', 'nickname', 'user_name', 'author_name']) {
      if (v[k]) return String(v[k]).trim();
    }
    const ui = v.user_info;
    if (ui && typeof ui === 'object') return String(ui.nickname || ui.name || '').trim();
  }
  return '';
}

function fmtCover(v) {
  if (!v) return '';
  if (typeof v === 'string') return v.trim();
  if (Array.isArray(v)) return fmtCover(v[0]);
  if (typeof v === 'object') {
    const uri = v.uri || '';
    const urls = Array.isArray(v.urls) ? v.urls : [];
    const tpl = v.template_prefix || '';
    if (urls.length && uri) {
      const base = String(urls[0]).replace(/\/+$/, '') + '/';
      return tpl ? `${base}${uri}~${tpl}-15.webp` : `${base}${uri}`;
    }
    if (urls.length) return String(urls[0]); // 视频：已是完整签名地址
    if (uri) return String(uri);
    if (v.url) return String(v.url);
  }
  return '';
}

function fmtDurationMs(v) {
  if (v == null || v === '' || v === 0) return 0;
  const n = Number(v);
  if (!Number.isFinite(n)) return 0;
  return n > 1000 ? Math.round(n) : Math.round(n * 1000); // 大于 1000 视为毫秒
}

function normalizeTrack(item) {
  const d = unwrap(item);
  if (!isTrack(d)) return null;
  const name = String(first(d, NAME_KEYS) || '').trim();
  if (!name) return null;
  const album = d.album && typeof d.album === 'object' ? d.album : {};
  const cover = fmtCover(
    d.coverURL || album.url_cover || d.cover || d.url_cover ||
    d.cover_url || d.share_cover_url || d.image_url || album.cover || album.coverURL
  );
  return {
    type: mediaKind(item),
    name,
    artist: fmtArtists(first(d, ARTIST_KEYS)),
    album: String(album.name || d.album_name || '').trim() || '—',
    durationMs: fmtDurationMs(first(d, ['duration', 'duration_ms', 'durationMs'])),
    id: String(d.id || d.track_id || d.trackId || d.video_id || ''),
    cover,
  };
}

function collectLists(obj, path = '', out = [], depth = 0) {
  if (depth > 8) return out;
  if (Array.isArray(obj)) {
    for (let i = 0; i < Math.min(obj.length, 20); i++) {
      if (obj[i] && typeof obj[i] === 'object') {
        collectLists(obj[i], `${path}[${i}]`, out, depth + 1);
      }
    }
    return out;
  }
  if (obj && typeof obj === 'object') {
    for (const [k, v] of Object.entries(obj)) {
      if (Array.isArray(v) && v.length && v.slice(0, 8).some((x) => isTrack(unwrap(x)))) {
        out.push([`${path}.${k}`.replace(/^\./, ''), k, v]);
      } else if (v && typeof v === 'object') {
        collectLists(v, `${path}.${k}`.replace(/^\./, ''), out, depth + 1);
      }
    }
  }
  return out;
}

function pickTrackList(page) {
  const all = collectLists(page);
  const clean = all.filter((c) => !EXCLUDE_RE.test(c[0]));
  const cands = clean.length ? clean : all;
  if (!cands.length) throw new Error('没有在页面里找到任何曲目列表。');
  const rank = (c) => [c[1] in LIST_KEYS ? 0 : 1, -c[2].length];
  cands.sort((a, b) => rank(a)[0] - rank(b)[0] || rank(a)[1] - rank(b)[1]);
  return cands[0];
}

function pickMeta(page) {
  for (const key of ['playlistInfo', 'playlist', 'playlist_info', 'info', 'detail']) {
    const v = page[key];
    if (v && typeof v === 'object') return v;
  }
  const marker = ['title', 'public_title', 'count_tracks', 'countTracks', 'track_count', 'trackCount'];
  for (const [, v] of Object.entries(page)) {
    if (v && typeof v === 'object' && marker.some((x) => x in v)) return v;
  }
  return page;
}

function parseShare(html) {
  const data = extractRouterData(html);
  const loader = data.loaderData || {};
  // 选取歌单页
  let page;
  const named = Object.entries(loader).find(([k]) => k.toLowerCase().includes('playlist'));
  if (named) page = named[1];
  else {
    const any = Object.entries(loader).find(([, v]) => v && typeof v === 'object');
    page = any ? any[1] : null;
  }
  if (!page) throw new Error('页面里没有歌单数据，可能不是歌单分享链接。');

  const [, rawList] = pickTrackList(page);
  const tracks = [];
  const seen = new Set();
  for (const item of rawList) {
    const t = normalizeTrack(item);
    if (!t) continue;
    if (t.type === '视频') continue; // 默认排除抖音视频条目
    const fp = `${t.name}|${t.artist}`;
    if (seen.has(fp)) continue;
    seen.add(fp);
    tracks.push(t);
  }

  const meta = pickMeta(page);
  const title = String(
    first(meta, ['title', 'public_title', 'playlist_name', 'playlistName', 'name']) || ''
  ).trim();
  let creator = '';
  for (const ck of ['creator', 'owner', 'author', 'user', 'sharer']) {
    const v = meta[ck];
    if (v && typeof v === 'object') { creator = String(v.name || v.nickname || ''); break; }
    if (typeof v === 'string' && v) { creator = v; break; }
  }
  const declaredRaw = first(meta, [
    'count_tracks', 'countTracks', 'track_count', 'trackCount', 'track_cnt', 'count', 'total',
  ]);
  let declared = null;
  if (declaredRaw != null) {
    const n = parseInt(declaredRaw, 10);
    if (Number.isFinite(n) && n > 0 && n < 100000) declared = n;
  }
  const cover = fmtCover(meta.cover || meta.coverURL || meta.cover_url || '');

  return { title, creator: creator.trim(), declared, count: tracks.length, cover, tracks };
}

function mapTrackToSong(t) {
  return {
    id: encTrackId(t.name, t.artist),
    platform: 'qishui',
    title: t.name,
    artist: t.artist,
    album: t.album,
    duration: t.durationMs,
    cover: t.cover,
    size: null,
    format: null,
    br: null,
  };
}

// —— 免费曲库匹配（按歌名 + 歌手）——
const PUNCT_RE =
  /[\s\-_·・.,，。、!！?？'"“”‘’()（）\[\]【】&+/\\|~～:：;；*@$%^=<>《》]+/;
const BRACKET_RE = /[（(\[【][^）)\]】]*[）)\]】]/;
const FEAT_RE = /\b(?:feat|ft|featuring)\b.*$/i;

function norm(s) {
  if (!s) return '';
  return String(s).toLowerCase().normalize('NFKC').split(PUNCT_RE).join('');
}
function normLoose(s) {
  if (!s) return '';
  let x = String(s).normalize('NFKC');
  x = x.replace(BRACKET_RE, ' ');
  x = x.replace(FEAT_RE, ' ');
  return norm(x);
}
function artistList(v) {
  if (!v) return [];
  if (Array.isArray(v)) return v.map(artistList).flat().filter(Boolean);
  if (typeof v === 'string') {
    return String(v).split(/\s*[/、,，;；&]\s*/).map((x) => x.trim()).filter(Boolean);
  }
  return [];
}

// 候选打分：返回 [歌名分, 歌手分] 或 null（直接淘汰）
async function libSearch(name, source) {
  const url = `${LIB_BASE}?types=search&source=${source}&name=${encodeURIComponent(name)}&count=5&pages=1&s=${Math.random().toString(16).slice(2, 18)}`;
  const res = await fetch(url, { headers: { Accept: 'application/json', 'User-Agent': UA_MOBILE } });
  const data = await res.json();
  return Array.isArray(data) ? data : [];
}

function scoreCandidate(qName, qArtists, cand) {
  const cName = String(cand.name || '');
  if (!cName) return null;
  const cs = norm(qName);
  const cc = norm(cName);
  const csl = normLoose(qName);
  const ccl = normLoose(cName);
  let n;
  if (cs && cs === cc) n = 3;
  else if (csl && csl === ccl) n = 2;
  else if (cs && cs.length >= 4 && (cs.includes(cc) || cc.includes(cs))) n = 1;
  else return null;

  const qset = new Set(qArtists.map(norm).filter(Boolean));
  const cset = new Set(artistList(cand.artist).map(norm).filter(Boolean));
  let a;
  if (!cset.size) a = 1;
  else if ([...qset].some((x) => cset.has(x))) a = 3;
  else {
    a = 0;
    for (const x of qset) {
      for (const y of cset) {
        if (x.length >= 3 && y.length >= 3 && (x.includes(y) || y.includes(x))) { a = 2; break; }
      }
      if (a) break;
    }
  }
  return [n, a];
}

async function resolveTrack(name, artist, sources = ['netease', 'kuwo']) {
  const qArtists = artistList(artist);
  const queries = [name];
  if (qArtists[0]) queries.push(`${name} ${qArtists[0]}`);
  let best = null;
  let bestKey = null;
  let bestSource = null;
  for (const source of sources) {
    for (const q of queries) {
      let got;
      try {
        got = await libSearch(q, source);
      } catch (e) {
        got = [];
      }
      for (let idx = 0; idx < got.length; idx++) {
        const cand = got[idx];
        if (!cand || typeof cand !== 'object') continue;
        const sc = scoreCandidate(name, qArtists, cand);
        if (!sc) continue;
        const [n, a] = sc;
        if (n >= 2 && a >= 1) {
          const k = [n, a, -idx];
          if (!bestKey || k[0] > bestKey[0] || (k[0] === bestKey[0] && k[1] > bestKey[1])) {
            best = cand; bestKey = k; bestSource = source;
          }
        }
      }
      if (bestKey && bestKey[0] === 3 && bestKey[1] >= 2) break;
    }
    if (best) break;
  }
  if (!best || !best.id) return null;
  return { cand: best, source: bestSource || 'netease' };
}

async function trackUrl(name, artist) {
  const r = await resolveTrack(name, artist);
  if (!r) return null;
  const urlApi = `${LIB_BASE}?types=url&source=${r.source}&id=${encodeURIComponent(r.cand.id)}`;
  try {
    const res = await fetch(urlApi, { headers: { Accept: 'application/json', 'User-Agent': UA_MOBILE } });
    const body = await res.json();
    if (!body || !body.url) return null;
    const fmt = (body.url.split('?')[0].split('.').pop() || 'mp3').toUpperCase();
    return {
      url: body.url,
      size: typeof body.size === 'number' ? body.size : null,
      br: typeof body.br === 'number' ? body.br : null, // 曲库返回 kbps
      format: fmt === 'MP3' || fmt === 'FLAC' || fmt === 'M4A' || fmt === 'WAV' ? fmt : 'MP3',
    };
  } catch {
    return null;
  }
}

// 把汽水歌单曲目批量解析为 Solara 的 FLAC 直链（按歌名+歌手回查，限并发）。
async function resolveQishuiTracks(tracks) {
  const result = new Array(tracks.length);
  let idx = 0;
  async function runner() {
    while (idx < tracks.length) {
      const cur = idx++;
      const t = tracks[cur];
      try {
        const r = await resolveByName(t.title, t.artist);
        if (r) {
          result[cur] = {
            id: r.id,
            platform: 'solara',
            src: 'netease',
            title: t.title,
            artist: t.artist,
            album: t.album,
            duration: t.duration,
            cover: t.cover,
            size: r.size,
            format: 'FLAC',
            br: r.br,
            flac: true,
            fromPlatform: 'qishui',
          };
        }
      } catch { /* 跳过无法解析的曲目 */ }
    }
  }
  const n = Math.min(6, tracks.length || 1);
  await Promise.all(Array.from({ length: n }, () => runner()));
  return result.filter(Boolean);
}


// 导出：供 playlist-import 框架复用 —— 解析汽水分享链接为歌单 + 曲目。
export async function parseQishuiShareUrl(text) {
  const url = extractShareUrl(text);
  if (!url) throw new Error('不是有效的汽水分享链接。');
  const html = await fetchHtml(url);
  const parsed = parseShare(html);
  return {
    platform: 'qishui',
    name: parsed.title || '汽水歌单',
    owner: parsed.creator || '—',
    cover: parsed.cover || '',
    count: parsed.count,
    tracks: parsed.tracks.map((t) => ({
      title: t.name,
      artist: t.artist,
      album: t.album,
      duration: t.durationMs,
      cover: t.cover,
    })),
  };
}

export const qishuiAdapter = {
  id: 'qishui',
  name: '汽水音乐',
  connected: true, // 分享页解析免登录即可用

  async search(keywords, type) {
    const url = extractShareUrl(keywords);
    if (!url) {
      return {
        songs: [],
        playlists: [],
        artists: [],
        albums: [],
        notes: [
          '汽水音乐暂不支持关键词搜索，请粘贴汽水歌单分享链接' +
          '（形如 https://qishui.douyin.com/s/xxxx ）以导入歌单。',
        ],
      };
    }
    let parsed;
    try {
      const html = await fetchHtml(url);
      parsed = parseShare(html);
    } catch (e) {
      return {
        songs: [],
        playlists: [],
        artists: [],
        albums: [],
        notes: [`汽水歌单解析失败：${e.message}`],
      };
    }
    const playlistMeta = {
      id: url,
      platform: 'qishui',
      name: parsed.title || '汽水歌单',
      cover: parsed.cover || (parsed.tracks[0] && parsed.tracks[0].cover) || '',
      owner: parsed.creator || '—',
      count: parsed.count,
      description: parsed.declared ? `歌单显示 ${parsed.declared} 首，分享页解析出 ${parsed.count} 首` : '',
    };
    const songs = parsed.tracks.map(mapTrackToSong);
    const out = { songs: [], playlists: [], artists: [], albums: [], notes: [] };
    if (type === 'all' || type === 'playlist') out.playlists.push(playlistMeta);
    if (type === 'all' || type === 'song') out.songs.push(...songs);
    if (parsed.declared && parsed.declared !== parsed.count) {
      out.notes.push(
        `该歌单官方显示 ${parsed.declared} 首，但分享页仅解析出 ${parsed.count} 首` +
        '（汽水分享页可能未渲染全部曲目）。'
      );
    }
    return out;
  },

  async songUrl(id) {
    const dec = decTrackId(String(id));
    if (!dec) return null;
    return trackUrl(dec.n, dec.a);
  },

  async playlistDetail(id) {
    const url = extractShareUrl(String(id)) || String(id);
    const html = await fetchHtml(url);
    const parsed = parseShare(html);
    const tracks = parsed.tracks.map(mapTrackToSong);
    const songs = await resolveQishuiTracks(tracks);
    return {
      id: url,
      platform: 'qishui',
      name: parsed.title || '汽水歌单',
      cover: parsed.cover || (songs[0] && songs[0].cover) || '',
      owner: parsed.creator || '—',
      count: parsed.count,
      description: parsed.declared ? `歌单显示 ${parsed.declared} 首` : '',
      songs,
    };
  },

  async rawUrl(id) {
    const u = await this.songUrl(id);
    return u && u.url ? u.url : null;
  },
};

export default qishuiAdapter;
