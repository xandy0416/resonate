import express from 'express';
import cors from 'cors';
import { Readable } from 'node:stream';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';
import { existsSync, createWriteStream } from 'node:fs';
import { mkdir } from 'node:fs/promises';
import { promises as dnsPromises } from 'node:dns';
import { adapters, adapterMap, listPlatforms } from './adapters/index.js';
import { solaraAdapter, resolveFlac, probe as probeSolara, markSolaraUnreachable, isSolaraLikelyDown } from './adapters/solara.js';
import { neteaseAdapter, probe as probeNetease, probeDetail as probeNeteaseDetail } from './adapters/netease.js';
import { playlistImport, isPlaylistUrl, searchPlaylists, synthesizePlaylistUrl, getArtistSongs, getAlbumSongs } from './adapters/playlist-import.js';

// 全局兜底：各平台适配器都会对外网做 fetch，第三方库/上游偶发异常
// （如未捕获的 unhandledRejection）不应拖垮整个后端。仅记录、不让进程退出。
process.on('unhandledRejection', (reason) => {
  console.error('[unhandledRejection]', reason && (reason.stack || reason.message || reason));
});
process.on('uncaughtException', (err) => {
  console.error('[uncaughtException]', err && (err.stack || err.message || err));
});

const app = express();
app.use(cors());
app.use(express.json());

const PORT = process.env.PORT || 8787;

// 健康检查：默认只返回静态平台状态（轻量、不发外部请求，供容器 HEALTHCHECK 使用）。
// 加 ?deep=1 时执行「真实探活」：DNS 解析 + 公网连通 + netease/solara 实际搜索请求，
// 用于在 NAS 上定位「搜不到歌」究竟卡在 DNS / 容器网络 / 上游风控哪一层。
// 注意：平台的 connected 字段只代表「依赖是否就绪」，并不代表网络可达；只有 deep 探活才发真实请求。
const DNS_TARGETS = [
  ['music.163.com', '网易云 API'],
  ['music-api.gdstudio.xyz', '曲库跳板（Solara / 汽水）'],
  ['qishui.douyin.com', '汽水分享页'],
  ['c.y.qq.com', 'QQ 音乐'],
  ['pd.musicapp.migu.cn', '咪咕音乐'],
];

async function probeDns(host, timeoutMs = 5000) {
  const t0 = Date.now();
  try {
    const r = await Promise.race([
      dnsPromises.lookup(host),
      new Promise((_, rej) =>
        setTimeout(() => rej(Object.assign(new Error('DNS 查询超时'), { code: 'ETIMEOUT' })), timeoutMs),
      ),
    ]);
    return { ok: true, address: r.address, ms: Date.now() - t0 };
  } catch (e) {
    return { ok: false, error: e.code || e.message, ms: Date.now() - t0 };
  }
}

async function probeHttp(url, timeoutMs = 8000) {
  const ctrl = new AbortController();
  const timer = setTimeout(() => ctrl.abort(), timeoutMs);
  const t0 = Date.now();
  try {
    const r = await fetch(url, { signal: ctrl.signal, headers: { 'User-Agent': 'Mozilla/5.0' } });
    return { ok: true, status: r.status, ms: Date.now() - t0 };
  } catch (e) {
    const code =
      (e && e.cause && e.cause.code) || (e && e.code) || (e.name === 'AbortError' ? `ETIMEOUT(>${timeoutMs}ms)` : '');
    return { ok: false, error: `${code ? code + ': ' : ''}${(e && e.message) || String(e)}`, ms: Date.now() - t0 };
  } finally {
    clearTimeout(timer);
  }
}

app.get('/api/health', async (req, res) => {
  const base = { ok: true, platforms: listPlatforms() };
  if (!req.query.deep) return res.json(base);

  const [dns, internet, netease, neteaseDetail, solara] = await Promise.all([
    Promise.all(DNS_TARGETS.map(async ([host, label]) => ({ host, label, ...(await probeDns(host)) }))),
    probeHttp('https://www.baidu.com'),
    probeNetease(),
    probeNeteaseDetail(), // 歌单详情专用探活：整张歌单元数据（返回体大，可能比搜索慢一个数量级）
    probeSolara(),
  ]);

  const verdict = [];
  for (const d of dns) if (!d.ok) verdict.push(`DNS 解析失败：${d.host} → ${d.error}`);
  if (!internet.ok) verdict.push(`容器无法访问公网 → www.baidu.com: ${internet.error}`);
  if (!netease.ok) verdict.push(`网易云搜索不可用 → ${netease.error}`);
  // 搜索可用但详情超时 → 典型「小请求快、大请求慢」的受限网络特征，直接点明，避免与搜索问题混淆。
  if (netease.ok && !neteaseDetail.ok) {
    verdict.push(
      `网易云搜索正常，但歌单详情慢/超时（${neteaseDetail.ms}ms，上限 ${neteaseDetail.timeoutMs}ms）→ ${neteaseDetail.error}。` +
        `多为容器到 music.163.com 带宽/链路受限，可调大 NC_DETAIL_TIMEOUT_MS 重试。`
    );
  }
  if (!solara.ok) {
    verdict.push(`曲库跳板不可用 → ${solara.error}`);
    markSolaraUnreachable(); // 记下跳板不可用，使后续播放/解析秒走网易云兜底
  }

  res.json({
    ...base,
    deep: {
      allOk: verdict.length === 0,
      verdict: verdict.length ? verdict : ['全部正常：域名可解析、公网可达、上游搜索能返回结果。'],
      dns,
      internet,
      adapters: { netease, neteaseDetail, solara },
    },
  });
});

// 平台列表（含接入状态）
app.get('/api/platforms', (_req, res) => {
  res.json(listPlatforms());
});

// 可选「搜索源」列表：前端在搜索前据此渲染多选（可复选）。
// 仅包含真正支持关键词搜索、且能返回可播放 / 可导入结果的源：
//   - 网易云：单曲 / 歌单 / 歌手 / 专辑 全覆盖（直连 cloudsearch，快且稳）；
//   - QQ / 咪咕：歌单关键词搜索（仅作「歌单来源」），单曲直链统一走 Solara。
// 汽水无关键词搜索能力、酷狗公开接口不稳、Joox/哔哩哔哩 经 Solara 召回的曲目无法解析为可播放
// 直链，故不列入。这是「搜索源多选」功能的唯一权威来源，前后端共用同一份 id，避免漂移。
const SEARCH_SOURCES = [
  { id: 'netease', name: '网易云' },
  { id: 'qq', name: 'QQ 音乐' },
  { id: 'migu', name: '咪咕音乐' },
];
const SEARCH_SOURCE_IDS = SEARCH_SOURCES.map((s) => s.id);

app.get('/api/search-sources', (_req, res) => {
  res.json(SEARCH_SOURCES);
});

// 自动全网聚合搜索（关键词）—— 不再需要前端选择平台。
// 流程：后端自动跨平台发现：单曲交给 Solara 解析为 FLAC；歌手 / 专辑委托网易云；
// 歌单走「关键词歌单搜索」跨平台聚合（网易云可用，QQ/酷狗/咪咕 受网络限制时降级）。
// 另：输入若是歌单分享地址，自动转去「分享地址导入」。
function dedupeById(list) {
  const seen = new Set();
  const out = [];
  for (const x of list) {
    const key = `${x.platform}:${x.id}`;
    if (seen.has(key)) continue;
    seen.add(key);
    out.push(x);
  }
  return out;
}

app.get('/api/search', async (req, res) => {
  const q = String(req.query.q || '').trim();
  if (!q) return res.status(400).json({ error: '缺少搜索关键词 q' });

  // 若输入是歌单分享地址，自动转去「分享地址导入」
  if (isPlaylistUrl(q)) {
    return importPlaylistRoute(req, res);
  }

  // 防御性总超时：各上游均已设独立硬超时（netease 10s / Solara 6s / 歌单源 5~6s）
  // 且全部并行，正常搜索约 10s 内返回；此安全网仅防上游极端卡死导致前端无限 loading。
  const safetyTimer = setTimeout(() => {
    if (!res.headersSent) {
      res.status(200).json({ songs: [], playlists: [], artists: [], albums: [], degraded: true, reason: 'timeout' });
    }
  }, 15000);

  const type = String(req.query.type || 'all');
  // 搜索结果数量：前端可选 30/60/100/200，默认 60（上游 Solara 单页上限 30，靠多源+翻页突破）。
  const limit = Math.min(200, Math.max(10, parseInt(String(req.query.limit || ''), 10) || 60));

  // 搜索源多选：sources 为逗号分隔的平台 id（如 netease,qq,joox）；缺省或非法 → 全部源。
  // 这是前端「搜索前选择音乐源」的落地：只召回来被勾选的源，未勾选的完全不打接口。
  const sourcesParam = String(req.query.sources || '').trim();
  const chosen = sourcesParam
    ? Array.from(new Set(sourcesParam.split(',').map((s) => s.trim()).filter((s) => SEARCH_SOURCE_IDS.includes(s))))
    : SEARCH_SOURCE_IDS.slice();
  const sources = chosen.length ? chosen : SEARCH_SOURCE_IDS.slice(); // 空数组兜底为全部

  const needSongs = type === 'all' || type === 'song';
  const needPlaylists = type === 'all' || type === 'playlist';

  // —— 并行召回各选中源 ——
  // 网易云：单曲 / 歌单 / 歌手 / 专辑 四类全覆盖（直接调 cloudsearch，快且稳）。
  // Joox / 哔哩哔哩：仅单曲，经 Solara 按源搜索（这两个源在 Solara 里与 netease 分离，需单独召回）。
  // 歌单：QQ / 咪咕 / 酷狗 由 searchPlaylists 按源聚合（网易云歌单已含在上面的 netease 直连里）。
  // 所有上游并行、互不等待；各自带独立硬超时，整体受下方 15s 安全网兜底。
  const tasks = [];
  if (sources.includes('netease')) {
    tasks.push(
      (async () => {
        try {
          const data = await neteaseAdapter.search(q, type, Math.max(limit, 100));
          return { kind: 'ne', data, error: null };
        } catch (e) {
          console.error('[search] 网易云 失败:', e.message);
          return { kind: 'ne', data: { songs: [], playlists: [], artists: [], albums: [] }, error: e.message };
        }
      })()
    );
  }
  if (needPlaylists) {
    const plSources = ['qq', 'migu'].filter((s) => sources.includes(s));
    if (plSources.length) {
      tasks.push(
        (async () => {
          try {
            // 网易云歌单已含在上面的 netease 直连里，这里只补 QQ/咪咕/酷狗，避免重复拉取。
            const data = await searchPlaylists(q, limit, plSources);
            return { kind: 'playlists', data, error: null };
          } catch (e) {
            console.error('[search] 歌单搜索失败:', e.message);
            return { kind: 'playlists', data: [], error: e.message };
          }
        })()
      );
    } else {
      tasks.push(Promise.resolve({ kind: 'playlists', data: [], error: null }));
    }
  }

  const settled = await Promise.all(tasks);
  const aggregated = { songs: [], playlists: [], artists: [], albums: [] };
  const upstreamErrors = [];
  for (const r of settled) {
    if (r.kind === 'ne') {
      aggregated.songs.push(...(r.data.songs || []));
      aggregated.playlists.push(...(r.data.playlists || []));
      aggregated.artists.push(...(r.data.artists || []));
      aggregated.albums.push(...(r.data.albums || []));
      if (r.error) upstreamErrors.push('网易云: ' + r.error);
    } else if (r.kind === 'joox' || r.kind === 'bilibili') {
      aggregated.songs.push(...(r.data || []));
      if (r.error) upstreamErrors.push((r.kind === 'joox' ? 'Joox' : '哔哩哔哩') + ': ' + r.error);
    } else if (r.kind === 'playlists') {
      aggregated.playlists.push(...(r.data || []));
      if (r.error) upstreamErrors.push('歌单搜索: ' + r.error);
    }
  }

  // 上游降级提示：所有源都失败/为空时，附上真实错误原因返回给前端，
  // 避免与「真的没搜到结果」混淆（此前此类失败被静默吞掉）。
  if (aggregated.songs.length === 0 && upstreamErrors.length) {
    aggregated.degraded = true;
    aggregated.reason = upstreamErrors.join('；');
  }

  // 单曲解析策略：默认「前端按需解析」（resolve=0）——搜索阶段只聚合去重即返回，
  // FLAC 直链在用户点击播放/下载时再经 /api/song/url 实时获取，把首屏从 ~19s 压到 ~4s。
  // 传 resolve=1 才在搜索阶段内联解析（保留旧行为，便于调试或兼容旧调用方）。
  const doResolve = String(req.query.resolve || '0') === '1';
  if (doResolve && aggregated.songs.length) {
    aggregated.songs = await resolveFlac(aggregated.songs, limit);
  } else {
    // 仅按「平台:id」去重并截断到用户选择的数量（不再逐首取直链）
    const seen = new Set();
    aggregated.songs = aggregated.songs
      .filter((s) => {
        const key = `${s.platform}:${s.id}`;
        if (seen.has(key)) return false;
        seen.add(key);
        return true;
      })
      .slice(0, limit);
  }
  aggregated.playlists = dedupeById(aggregated.playlists);
  // 暴露曲库跳板可用性，便于前端展示「已降级为网易云直连（MP3）」提示。
  aggregated.solaraDown = isSolaraLikelyDown();

  clearTimeout(safetyTimer);
  if (res.headersSent) return; // 已被超时安全网返回，主逻辑结果丢弃
  res.json(aggregated);
});

// 歌单分享地址导入：识别平台 → 解析曲目 → 统一交 Solara 解析 FLAC。
async function importPlaylistRoute(req, res) {
  const url = String(req.query.q || req.query.url || '').trim();
  if (!url) return res.status(400).json({ error: '缺少歌单地址' });
  try {
    const detail = await playlistImport.importPlaylist(url);
    res.json(detail);
  } catch (e) {
    res.status(502).json({
      error: e.message,
      hint: '目前网易云、汽水、QQ 的歌单链接可直接解析；酷狗/咪咕 可能因网络反爬或需登录态暂不可用，可稍后配置代理或登录态再试。',
    });
  }
}

// 歌单分享地址导入（独立端点，便于前端显式调用）
app.get('/api/playlist/import', importPlaylistRoute);

// 单曲直链信息
app.get('/api/song/url', async (req, res) => {
  const { platform, id, src } = req.query;
  const adapter = adapterMap[String(platform)];
  if (!adapter || !adapter.connected) return res.status(404).json({ error: '平台未接入' });
  try {
    const info = await adapter.songUrl(String(id), src ? String(src) : undefined);
    if (!info || !info.url) return res.status(404).json({ error: '未获取到直链（可能无版权或需登录）' });
    res.json(info);
  } catch (e) {
    res.status(502).json({ error: e.message });
  }
});

// 歌单详情：由「平台 + id」合成分享地址，复用统一解析链路（解析曲目 → Solara 出 FLAC）。
app.get('/api/playlist/detail', async (req, res) => {
  const { platform, id } = req.query;
  if (!platform || !id) return res.status(400).json({ error: '缺少 platform 或 id' });
  const url = synthesizePlaylistUrl(String(platform), String(id));
  try {
    const detail = await playlistImport.importPlaylist(url);
    res.json(detail);
  } catch (e) {
    res.status(502).json({ error: e.message });
  }
});

// 歌手详情：返回该歌手的曲目（统一解析为 FLAC）
app.get('/api/artist/detail', async (req, res) => {
  const { platform, id, name } = req.query;
  if (!platform || !id) return res.status(400).json({ error: '缺少 platform 或 id' });
  try {
    const detail = await getArtistSongs(String(platform), String(id), String(name || ''));
    res.json(detail);
  } catch (e) {
    res.status(502).json({ error: e.message });
  }
});

// 专辑详情：返回该专辑的曲目（统一解析为 FLAC）
app.get('/api/album/detail', async (req, res) => {
  const { platform, id, name } = req.query;
  if (!platform || !id) return res.status(400).json({ error: '缺少 platform 或 id' });
  try {
    const detail = await getAlbumSongs(String(platform), String(id), String(name || ''));
    res.json(detail);
  } catch (e) {
    res.status(502).json({ error: e.message });
  }
});

// 播放代理（流式）
app.get('/api/play', async (req, res) => {
  await pipeMedia(req, res, false);
});

// 下载代理（附附件头）
app.get('/api/download', async (req, res) => {
  await pipeMedia(req, res, true);
});

// 保存到服务器目录（部署在 NAS 时直接落盘到挂载目录）：把音频流写入 SAVE_DIR，
// 文件名取「歌名 - 歌手.ext」，重名则跳过，返回 saved/skipped/error。
const SAVE_DIR = process.env.SAVE_DIR || '/data/music';

app.get('/api/save', async (req, res) => {
  const { platform, id, src, title, artist } = req.query;
  const adapter = adapterMap[String(platform)];
  if (!adapter || !adapter.connected) {
    return res.status(404).json({ status: 'error', error: '平台未接入' });
  }
  let url;
  try {
    // 与播放/下载一致：netease 自身直链仅为试听片段，统一改走 Solara 跳板取完整 FLAC 直链。
    if (platform === 'netease') {
      url = await solaraAdapter.rawUrl(String(id), src ? String(src) : 'netease');
    } else {
      url = await adapter.rawUrl(String(id), src ? String(src) : undefined);
    }
  } catch {
    url = null;
  }
  if (!url) return res.status(404).json({ status: 'error', error: '未获取到直链' });

  try {
    const safe = (s) => String(s || '未知').replace(/[\\/:*?"<>|]/g, '_').slice(0, 80);
    let ext = '';
    try {
      const um = new URL(url).pathname.match(/\.([a-z0-9]+)$/i);
      if (um) ext = '.' + um[1].toLowerCase();
    } catch {}
    if (!ext) ext = '.flac';
    const base = `${safe(title)} - ${safe(artist)}`;
    const filePath = join(SAVE_DIR, base + ext);
    // 文件名已去除所有路径分隔符，仍做一道越界兜底
    if (!filePath.startsWith(join(SAVE_DIR, '/'))) {
      return res.status(400).json({ status: 'error', error: '非法文件名' });
    }
    if (existsSync(filePath)) {
      return res.json({ status: 'skipped', file: base + ext });
    }
    await mkdir(SAVE_DIR, { recursive: true });
    const upstream = await fetch(url, {
      headers: {
        Referer: 'https://music.163.com/',
        'User-Agent': 'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36',
      },
    });
    if (!upstream.ok && upstream.status !== 206) {
      return res.status(502).json({ status: 'error', error: `上游返回 ${upstream.status}` });
    }
    if (!upstream.body) {
      return res.status(502).json({ status: 'error', error: '上游无响应体' });
    }
    await new Promise((resolve, reject) => {
      const ws = createWriteStream(filePath);
      const rs = Readable.fromWeb(upstream.body);
      rs.on('error', reject);
      ws.on('error', reject);
      ws.on('finish', resolve);
      rs.pipe(ws);
    });
    return res.json({ status: 'saved', file: base + ext });
  } catch (e) {
    return res.status(500).json({ status: 'error', error: e.message || '保存失败' });
  }
});

async function pipeMedia(req, res, asAttachment) {
  const { platform, id, src } = req.query;
  const title = String(req.query.title || 'audio');
  const adapter = adapterMap[String(platform)];
  if (!adapter || !adapter.connected) return res.status(404).json({ error: '平台未接入' });
  let url;
  try {
    // 关键：netease 自身直链仅为试听片段，一律改走 Solara 跳板取完整 FLAC 直链，
    // 避免「前端按需解析」后播放/下载仍拿到试听片段。
    if (platform === 'netease') {
      url = await solaraAdapter.rawUrl(String(id), src ? String(src) : 'netease');
    } else {
      url = await adapter.rawUrl(String(id), src ? String(src) : undefined);
    }
  } catch {
    url = null;
  }
  if (!url) return res.status(404).json({ error: '未获取到直链' });

  try {
    // 支持 HTTP Range：浏览器拖动进度 / 断点续播会带 Range 头，透传给上游；
    // 上游返回 206 时回传 206 + Content-Range + 剩余长度，否则降级全量 200（兼容旧行为）。
    const range = req.headers.range;
    const fwdHeaders = {
      Referer: 'https://music.163.com/',
      'User-Agent': 'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36',
    };
    if (range) fwdHeaders['Range'] = range;
    const upstream = await fetch(url, { headers: fwdHeaders });
    if (!upstream.ok && upstream.status !== 206) {
      return res.status(502).json({ error: `上游返回 ${upstream.status}` });
    }
    if (!upstream.body) {
      return res.status(502).json({ error: '上游无响应体' });
    }
    const contentType = upstream.headers.get('content-type') || 'audio/mpeg';
    res.set('Content-Type', contentType);
    res.set('Accept-Ranges', 'bytes');
    if (upstream.status === 206) {
      res.status(206);
      const cr = upstream.headers.get('content-range');
      if (cr) res.set('Content-Range', cr);
      const len = upstream.headers.get('content-length');
      if (len) res.set('Content-Length', len);
    } else {
      const len = upstream.headers.get('content-length');
      if (len) res.set('Content-Length', len);
    }
    if (asAttachment) {
      const safe = title.replace(/[\\/:*?"<>|]/g, '_').slice(0, 80);
      // 扩展名按上游 URL 后缀或内容类型判定（FLAC/MP3 等），而非写死。
      let ext = '';
      try {
        const um = new URL(url).pathname.match(/\.([a-z0-9]+)$/i);
        if (um) ext = '.' + um[1].toLowerCase();
      } catch { /* ignore */ }
      if (!ext) {
        if (/flac/i.test(contentType)) ext = '.flac';
        else if (/mpeg|mp3/i.test(contentType)) ext = '.mp3';
        else ext = '.mp3';
      }
      // RFC 5987：filename* 用 UTF-8 编码，浏览器才能正确显示中文名；
      // filename 提供 ASCII 兜底。
      const ascii = (safe + ext).replace(/[^\x20-\x7e]/g, '_');
      const encoded = encodeURIComponent(safe + ext);
      res.set('Content-Disposition', `attachment; filename="${ascii}"; filename*=UTF-8''${encoded}`);
    }
    const nodeStream = Readable.fromWeb(upstream.body);
    nodeStream.pipe(res);
    nodeStream.on('error', () => res.destroy());
  } catch (e) {
    if (!res.headersSent) res.status(502).json({ error: '代理失败：' + e.message });
  }
}

// —— 生产形态：同端口托管前端静态产物 ——
// 部署 / Docker 时 client/dist 已存在，则直接由本服务同时提供 SPA 与 /api；
// 本地 dev（无 dist）时此分支不生效，仍走 Vite dev server + 代理，互不影响。
const __dirname = dirname(fileURLToPath(import.meta.url));
const clientDist = join(__dirname, '..', 'client', 'dist');
if (existsSync(clientDist)) {
  app.use(express.static(clientDist));
  // SPA 兜底：非 /api 的请求统一返回 index.html（支撑前端客户端路由）
  app.get(/^(?!\/api\/).*/, (_req, res) => {
    res.sendFile(join(clientDist, 'index.html'));
  });
}

app.listen(PORT, () => {
  console.log(`聚合音乐后端已启动: http://localhost:${PORT}`);
  console.log('平台接入状态:', listPlatforms().map((p) => `${p.name}=${p.connected ? '已接入' : '未接入'}`).join('  '));
});
