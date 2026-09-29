import express from 'express';
import cors from 'cors';
import { Readable } from 'node:stream';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';
import { existsSync } from 'node:fs';
import { adapters, adapterMap, listPlatforms } from './adapters/index.js';
import { solaraAdapter, resolveFlac } from './adapters/solara.js';
import { neteaseAdapter } from './adapters/netease.js';
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

// 健康检查
app.get('/api/health', (_req, res) => {
  res.json({ ok: true, platforms: listPlatforms() });
});

// 平台列表（含接入状态）
app.get('/api/platforms', (_req, res) => {
  res.json(listPlatforms());
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

  // 防御性总超时：内部已对 Solara 请求收紧超时（6s 不重试）+ resolveFlac 设 10s
  // deadline，正常搜索在 ~16s 内返回；此安全网仅防上游极端卡死导致前端无限 loading。
  const safetyTimer = setTimeout(() => {
    if (!res.headersSent) {
      res.status(200).json({ songs: [], playlists: [], artists: [], albums: [], degraded: true, reason: 'timeout' });
    }
  }, 20000);

  const type = String(req.query.type || 'all');
  // 搜索结果数量：前端可选 30/60/100/200，默认 60（上游 Solara 单页上限 30，靠多源+翻页突破）。
  const limit = Math.min(200, Math.max(10, parseInt(String(req.query.limit || ''), 10) || 60));

  const safeSearch = async (adapter, keywords, t, lim) => {
    try {
      return await adapter.search(keywords, t, lim);
    } catch (e) {
      console.error(`[search] ${adapter.id} 失败:`, e.message);
      return { songs: [], playlists: [], artists: [], albums: [] };
    }
  };

  // Solara 编排单曲 / 歌手 / 专辑（关键词歌单单独聚合，见下）。
  // 单曲搜索跨 Solara + 网易云两路召回：Solara 覆盖 joox/bilibili 等源，
  // 网易云 cloudsearch 召回质量更高（经典老歌原唱不易被翻唱淹没），两者合并后
  // 由 resolveFlac 按「歌名+歌手」去重并统一取直链。
  const [solaraRes, neRes] = await Promise.all([
    safeSearch(solaraAdapter, q, type, limit),
    // 网易云直连稳定且快，始终拉满其 100 首曲库池作为可靠底池；
    // 最终由 resolveFlac(limit) 按用户选择的数量截断。这样即便 Solara 抖动，
    // 默认 60 也能稳定返回约 60 首（Solara 不可用时自动用 netease 直连补 MP3）。
    safeSearch(neteaseAdapter, q, type, Math.max(limit, 100)),
  ]);
  const aggregated = { songs: [], playlists: [], artists: [], albums: [] };
  aggregated.songs.push(...(solaraRes.songs || []), ...(neRes.songs || []));
  aggregated.playlists.push(...(solaraRes.playlists || []));
  aggregated.artists.push(...(solaraRes.artists || []));
  aggregated.albums.push(...(solaraRes.albums || []));

  // 关键词歌单搜索：跨平台聚合（仅 all / playlist 类型）。网易云可用；
  // QQ/酷狗/咪咕 受网络反爬限制时各自抛错被吞，不影响其它平台与单曲结果。
  if (type === 'all' || type === 'playlist') {
    try {
      const pls = await searchPlaylists(q, limit);
      aggregated.playlists.push(...pls);
    } catch (e) {
      console.error('[search] 歌单搜索失败:', e.message);
    }
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

async function pipeMedia(req, res, asAttachment) {
  const { platform, id, src } = req.query;
  const title = String(req.query.title || 'audio');
  const adapter = adapterMap[String(platform)];
  if (!adapter || !adapter.connected) return res.status(404).json({ error: '平台未接入' });
  let url;
  try {
    // 关键：netease 平台（游客态无登录 cookie 时仅 30s 试听片段）一律改走 Solara
    // 跳板取完整 FLAC 直链，避免「前端按需解析」后播放/下载仍拿到试听片段。
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
