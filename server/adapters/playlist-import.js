// 通用「歌单分享地址」导入框架。
//
// 设计原则（与项目整体一致）：
//   1) 各家平台只负责「从分享地址里取出曲目列表（歌名 + 歌手）」；
//   2) 取出的曲目统一交给 Solara 按名解析为 FLAC（下载永远走 Solara，不碰原平台）。
//
// 平台识别按链接域名，支持扩展到任意平台。当前：
//   - 网易云、汽水：实测可用（免登录/公开接口）。
//   - QQ/酷狗/咪咕：接口形态已实现，但当前运行环境对它们有反爬/鉴权限制，
//     网络受限时返回清晰报错；配代理或登录态后即可解锁。
//
// 解析器约定：返回 { platform, name, owner, cover, count, tracks:[{title,artist,album,duration,cover}] }

import { neteaseAdapter } from './netease.js';
import { parseQishuiShareUrl } from './qishui.js';
import { resolveByName } from './solara.js';

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

async function fetchText(url, headers = {}) {
  const res = await fetch(url, {
    headers: { 'User-Agent': UA, Accept: 'application/json, text/html, */*', ...headers },
    redirect: 'follow',
  });
  if (!res.ok) throw new Error(`HTTP ${res.status}`);
  return res.text();
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

async function parseQQ(url) {
  const id = extractQQId(url);
  if (!id) throw new Error('无法从链接中识别 QQ 歌单 ID。');
  // 公开歌单详情接口（需 Referer；当前环境可能被反爬挡，配 cookie/代理可解）。
  const api =
    'https://c.y.qq.com/v8/fcg-bin/fcg_v8_playlist_cp.fcg?id=' +
    encodeURIComponent(id) +
    '&type=1&json=1&utf8=1&onlysong=0&new_format=1&platform=yqq.json&hostUin=0&needNewCode=0';
  const txt = await fetchText(api, { Referer: 'https://y.qq.com/' });
  const data = JSON.parse(txt);
  const cd = data && data.cdlist && data.cdlist[0];
  if (!cd) throw new Error('QQ 歌单接口未返回数据（可能网络受限或需登录态）。');
  const list = cd.songlist || [];
  return {
    platform: 'qq',
    name: cd.dissname || cd.title || 'QQ 歌单',
    owner: (cd.nickname) || '—',
    cover: cd.logo || '',
    count: list.length,
    tracks: list.map((s) => ({
      title: s.songname || s.title || '',
      artist: (s.singer || []).map((a) => a.name).join('/'),
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

async function parseMigu(url) {
  const id = extractMiguId(url);
  if (!id) throw new Error('无法从链接中识别咪咕歌单 ID。');
  // 咪咕歌单详情接口（当前环境可能返回 SPA 空壳，配代理/UA 可解）。
  const api =
    'https://m.music.migu.cn/migu/remoting/query_playlist_by_id?playListId=' +
    encodeURIComponent(id) +
    '&type=1';
  const txt = await fetchText(api, { Referer: 'https://music.migu.cn/' });
  const data = JSON.parse(txt);
  const list = (data && data.musicList) || (data && data.data && data.data.musicList) || [];
  if (!Array.isArray(list) || !list.length) {
    throw new Error('咪咕歌单未解析到曲目（可能网络受限或需登录态）。');
  }
  return {
    platform: 'migu',
    name: (data && data.title) || '咪咕歌单',
    owner: (data && data.userName) || '—',
    cover: '',
    count: list.length,
    tracks: list.map((s) => ({
      title: s.songName || s.title || '',
      artist: s.singerName || (s.singers || []).map((a) => a.name).join('/') || '',
      album: s.albumName || '',
      duration: (s.length || 0) * 1000,
      cover: s.pic || '',
    })),
  };
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
  let idx = 0;
  async function runner() {
    while (idx < pool.length) {
      const cur = idx++;
      const t = pool[cur];
      try {
        const r = await resolveByName(t.title, t.artist);
        if (r) {
          out[cur] = {
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
            fromPlatform,
          };
        }
      } catch {
        /* 跳过无法解析的曲目 */
      }
    }
  }
  const n = Math.min(8, pool.length || 1);
  await Promise.all(Array.from({ length: n }, () => runner()));
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
  return {
    id: u,
    platform: parsed.platform,
    name: parsed.name || '歌单',
    cover: parsed.cover || '',
    owner: parsed.owner || '—',
    count: parsed.count || parsed.tracks.length,
    resolvedCount: songs.length,
    totalCount: parsed.tracks.length,
    songs,
  };
}

export const playlistImport = { detectPlatformByUrl, isPlaylistUrl, importPlaylist };
export default playlistImport;
