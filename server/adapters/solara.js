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

// —— Solara 跳板可用性缓存 ───────────────────────────────────────────────
// 该跳板是第三方公共服务，稳定性不可控（偶发超时 / 被墙 / 限流）。一旦探测或
// 实际请求连续失败，就记住「最近 N 分钟内不可用」，期间直接跳过 Solara、走网易云
// 直连兜底（MP3），避免每次播放/解析都白等 6s 超时。
let solaraFailStamp = 0;
const SOLARA_DOWN_TTL = 5 * 60 * 1000; // 5 分钟内视为不可用，过期自动恢复重试
export function isSolaraLikelyDown() {
  return solaraFailStamp > 0 && Date.now() - solaraFailStamp < SOLARA_DOWN_TTL;
}
export function markSolaraUnreachable() {
  solaraFailStamp = Date.now();
}

// —— 请求工具（带超时，不重试） ───────────────────────────────────────────
// 注：Solara 上游限流时，重试只会把「单次阻塞」翻倍放大（最坏 15s×2=30s/请求），
// 对可用性毫无帮助。故改为「单次短超时、不重试」，快速失败交由上层降级/兜底。
function solaraUrl(params) {
  const u = new URL(SOLARA_BASE);
  for (const [k, v] of Object.entries(params)) {
    if (v != null && v !== '') u.searchParams.set(k, String(v));
  }
  return u.toString();
}

async function solaraGet(params, timeoutMs = 6000) {
  const ctrl = new AbortController();
  const timer = setTimeout(() => ctrl.abort(), timeoutMs);
  try {
    const r = await fetch(solaraUrl(params), {
      headers: { 'User-Agent': 'Mozilla/5.0', Accept: 'application/json' },
      signal: ctrl.signal,
    });
    const text = await r.text();
    try {
      solaraFailStamp = 0; // 一次成功即认为跳板恢复可用
      return JSON.parse(text);
    } catch {
      solaraFailStamp = Date.now(); // 返回非 JSON（被拦截/上游崩）→ 记失败
      return null;
    }
  } catch {
    solaraFailStamp = Date.now(); // 超时或网络错 → 记失败
    return null;
  } finally {
    clearTimeout(timer);
  }
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

// 提取“核心歌名”：先去掉括号及其内容（如 (Live)/(伴奏)）、再去掉尾部常见版本词
// （live/acoustic/remix/伴奏/现场…），最后 norm。例：如果你是我的传说(Live) → 如果你是我的传说
// 这一步专门解决“按名回查时，曲库版本标记差异导致全匹配失败”的问题。
function coreTitle(s) {
  let x = String(s || '');
  x = x.replace(/[\(\[（【][^\)\]）】]*[\)\]）】]/g, ' '); // 去掉所有括号内容
  x = x.replace(
    /\b(live|acoustic|demo|remix|clean|radio|album|single|ost|instrumental|伴奏|现场|原唱|翻唱|原版|版)\b/gi,
    ' '
  );
  return norm(x);
}

// 歌名相似度打分：3=完全相等；2=互为前缀（处理 (Live) 等后缀差异）；1=子串包含；0=不相关
function nameScore(qn, cn) {
  if (!qn || !cn) return 0;
  if (qn === cn) return 3;
  if (qn.length >= 4 && cn.length >= 4) {
    if (cn.startsWith(qn) || qn.startsWith(cn)) return 2;
    if (cn.includes(qn) || qn.includes(cn)) return 1;
  }
  return 0;
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
  // Solara 不再搜单曲（已删除 joox/bilibili 慢源，单曲完全由后端并行的网易云直连覆盖），
  // 故此处只取歌手 / 专辑 / 歌单三类返回给上层。
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
  // Solara 的 types=url 能给出 FLAC（br 900+），优先使用；
  // 仅当 Solara 抖动/超时，才回退到「网易云直连接口」拿 MP3，保证歌曲可用（而非被丢弃）。
  // 超时从 15s 收紧到 6s（不重试），限流时快速失败转回退，避免单首阻塞 30s。
  // 已知跳板不可达（isSolaraLikelyDown）时直接跳过 Solara，秒走网易云兜底，免去 6s 等待。
  if (!isSolaraLikelyDown()) {
    const d = await solaraGet({ types: 'url', source, id: String(id) }, 6000);
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
  }
  // 回退：网易云直连接口（快且稳，不经 Solara 跳板），多数情况给 320kbps MP3。
  if (source === 'netease') {
    try {
      const ne = await neteaseAdapter.songUrl(String(id));
      if (ne && ne.url) {
        const neFormat = ne.format && /flac/i.test(ne.format) ? 'FLAC' : 'MP3';
        return { url: ne.url, size: ne.size ?? null, br: ne.br ?? null, format: neFormat };
      }
    } catch { /* 忽略，返回 null */ }
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
// 完整直链（免登录）。【FLAC 优先：直链本就按曲库最高音质返回（无损给 FLAC、
// 标准版给 MP3），故“无 FLAC 自动降级为下一级 MP3”由直链自然满足】。
// 附上 size / format / br，并标记 flac（是否无损）与 resolved（是否拿到直链）。
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
  // 整体截止：上游限流时避免长尾拖死整次搜索。超时的歌直接返回 null
  // （format 为空，前端显示「暂无音源」并可点击重试），不再无限等待。
  const deadline = Date.now() + 10000;
  const resolved = await mapWithConcurrency(capped, async (s) => {
    if (Date.now() > deadline) return null;
    try {
      let info = await songUrl(String(s.id), s.src || 'netease');
      // 带 (Live)/(翻唱版)/(伴奏) 等版本后缀的歌，用 netease id 在 Solara 取直链常失败；
      // 回退到「核心歌名 + 歌手」回查（复用 coreTitle/nameScore 分级匹配），
      // 让「如果你是我的传说(Live)」这类也能解析出直链，而非被过滤掉。
      if (!info || !info.url) {
        if (Date.now() > deadline) return null;
        const alt = await resolveByName(coreTitle(s.title || ''), s.artist);
        if (alt && alt.id) info = await songUrl(String(alt.id), 'netease');
      }
      if (!info || !info.url) return null;
      return {
        ...s,
        platform: 'solara',
        src: 'netease',
        size: info.size,
        format: info.format,
        br: info.br,
        flac: info.format === 'FLAC',
        resolved: true,
        fromPlatform: s.platform || 'netease',
      };
    } catch {
      return null;
    }
  }, 16);
  return resolved.filter(Boolean);
}

// 按“歌名 + 歌手”在 Solara 的 netease 源里回查并解析音频直链，
// 用于汽水歌单等【没有平台曲目 id】的场景（只能靠名回查）。
// 同样：FLAC 优先，无 FLAC 自动接受 MP3 降级；返回实际 format / flac 标记。
//
// 名称匹配采用【分级相似度】而非全等：先对曲库候选做核心歌名匹配
// （去掉 (Live)/(伴奏) 等版本后缀），从而让「如果你是我的传说(Live)」也能命中
// 「如果你是我的传说」。歌手需同时命中，避免同名错配。
export async function resolveByName(name, artist) {
  const qn = norm(name);
  const qc = coreTitle(name); // 去版本后缀的核心歌名
  const qa = String(artist || '').split('/').map(norm).filter(Boolean);
  // 已知跳板不可达时直接跳过 Solara 搜索，走下方网易云兜底链路，避免白等超时。
  let data = isSolaraLikelyDown()
    ? []
    : await solaraGet({ types: 'search', source: 'netease', name, count: '10', pages: '1' }, 6000);
  if (!Array.isArray(data)) data = [];

  // 兜底链路：Solara 抖动/限流时（data 为空），改用「网易云直连接口」按名找候选。
  // 该接口不依赖 Solara（实测快且稳），可避免上游一挂就「整张列表全灰」；
  // 找到的仍是网易云 id，交给 songUrl 时优先试 Solara 拿 FLAC、失败再退直连 MP3。
  if (!data.length) {
    try {
      const ne = await neteaseAdapter.search(name, 'song', 30);
      const list = (ne && ne.songs) || [];
      if (list.length) {
        data = list.map((x) => ({
          id: x.id,
          name: x.title,
          artist: Array.isArray(x.artist) ? x.artist : String(x.artist || '').split('/'),
        }));
      }
    } catch {
      /* 忽略：下方统一返回 null */
    }
  }
  if (!data.length) return null;

  let best = null;
  let bestScore = 0; // 越高越优
  for (const c of data) {
    const cn = norm(c.name || '');
    const cc = coreTitle(c.name || '');
    // 完整名相似度 与 核心名相似度 取较高者（核心名匹配可解决版本后缀差异）
    const score = Math.max(nameScore(qn, cn), nameScore(qc, cc));
    if (score <= 0) continue;
    const ca = (Array.isArray(c.artist) ? c.artist : []).map(norm).filter(Boolean);
    const artistOk =
      qa.length === 0 ||
      ca.length === 0 ||
      qa.some((x) => ca.includes(x)) ||
      ca.some((x) => qa.some((y) => y.length >= 3 && (x.includes(y) || y.includes(x))));
    if (!artistOk) continue; // 歌手须同时命中，避免同名错配
    if (score > bestScore) {
      bestScore = score;
      best = c;
    }
    if (bestScore === 3) break; // 已是精确匹配，无需继续
  }
  if (!best) return null;
  const info = await songUrl(String(best.id), 'netease');
  if (!info || !info.url) return null;
  return {
    id: String(best.id),
    size: info.size,
    format: info.format || 'MP3',
    br: info.br,
    flac: info.format === 'FLAC',
  };
}

// 真实探活：对曲库 API 发一次搜索请求，验证网络与上游可用性（区别于静态的 connected）。
export async function probe() {
  const t0 = Date.now();
  const data = await solaraGet({ types: 'search', source: 'netease', name: 'test', count: 1, pages: 1 }, 8000);
  const ms = Date.now() - t0;
  if (data === null) return { ok: false, ms, error: '无响应或返回非 JSON（超时 / DNS 解析失败 / 网络不可达）' };
  const n = Array.isArray(data) ? data.length : 0;
  return { ok: true, ms, sample: n, error: null };
}

export const solaraAdapter = {
  id: 'solara',
  name: 'Solara 跳板',
  connected: true, // 外部公共服务，无需本地依赖
  async search(keywords, type, limit) {
    // Solara 在此只负责「歌手 / 专辑」委托给网易云直连（delegateSearch）；
    // 单曲召回完全由后端并行的「网易云直连」(neRes) 覆盖（更快且自带封面），
    // 不再经 Solara 跳板搜 joox/bilibili 慢源（每首需回查+封面，阻塞 ~10s 却只补极少独有曲目）。
    // 歌单统一走「分享地址导入」，不再做关键词歌单搜索。
    if (type === 'artist') {
      const rest = await delegateSearch(keywords, 'artist');
      return { songs: [], playlists: [], artists: rest.artists, albums: [] };
    }
    if (type === 'album') {
      const rest = await delegateSearch(keywords, 'album');
      return { songs: [], playlists: [], artists: [], albums: rest.albums };
    }
    if (type === 'all') {
      const rest = await delegateSearch(keywords, 'all');
      return { songs: [], playlists: [], artists: rest.artists, albums: rest.albums };
    }
    // type === 'song' / 'playlist' 等：单曲交给 neRes，关键词不返回歌单
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
