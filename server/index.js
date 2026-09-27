import express from 'express';
import cors from 'cors';
import { Readable } from 'node:stream';
import { adapters, adapterMap, listPlatforms } from './adapters/index.js';
import { solaraAdapter, resolveFlac } from './adapters/solara.js';
import { playlistImport, isPlaylistUrl } from './adapters/playlist-import.js';

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
// 流程：后端自动跨平台发现（Solara 编排单曲/歌手/专辑），单曲统一交给
// Solara 解析为 FLAC（仅保留可获取 FLAC 的）。歌单不走关键词搜索，统一走
// 「分享地址导入」接口 /api/playlist/import。
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

  const type = String(req.query.type || 'all');

  const safeSearch = async (adapter, keywords, t) => {
    try {
      return await adapter.search(keywords, t);
    } catch (e) {
      console.error(`[search] ${adapter.id} 失败:`, e.message);
      return { songs: [], playlists: [], artists: [], albums: [] };
    }
  };

  // Solara 编排单曲 / 歌手 / 专辑（歌单委托网易云，但关键词不返回歌单）。
  const parts = await Promise.all([safeSearch(solaraAdapter, q, type)]);
  const aggregated = { songs: [], playlists: [], artists: [], albums: [] };
  for (const p of parts) {
    aggregated.songs.push(...(p.songs || []));
    aggregated.playlists.push(...(p.playlists || []));
    aggregated.artists.push(...(p.artists || []));
    aggregated.albums.push(...(p.albums || []));
  }

  // 单曲：交给 Solara 统一解析为 FLAC（仅保留可获取 FLAC 的）
  if (aggregated.songs.length) {
    aggregated.songs = await resolveFlac(aggregated.songs, 40);
  }
  aggregated.playlists = dedupeById(aggregated.playlists);

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
      hint: '目前网易云、汽水的歌单链接可直接解析；QQ/酷狗/咪咕 可能因网络反爬或需登录态暂不可用，可稍后配置代理或登录态再试。',
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

// 歌单详情
app.get('/api/playlist/detail', async (req, res) => {
  const { platform, id } = req.query;
  const adapter = adapterMap[String(platform)];
  if (!adapter || !adapter.connected) return res.status(404).json({ error: '平台未接入' });
  try {
    const detail = await adapter.playlistDetail(String(id));
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
    url = await adapter.rawUrl(String(id), src ? String(src) : undefined);
  } catch {
    url = null;
  }
  if (!url) return res.status(404).json({ error: '未获取到直链' });

  try {
    const upstream = await fetch(url, {
      headers: {
        Referer: 'https://music.163.com/',
        'User-Agent': 'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36',
      },
    });
    if (!upstream.ok || !upstream.body) {
      return res.status(502).json({ error: `上游返回 ${upstream.status}` });
    }
    const contentType = upstream.headers.get('content-type') || 'audio/mpeg';
    res.set('Content-Type', contentType);
    res.set('Accept-Ranges', 'bytes');
    const len = upstream.headers.get('content-length');
    if (len) res.set('Content-Length', len);
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

app.listen(PORT, () => {
  console.log(`聚合音乐后端已启动: http://localhost:${PORT}`);
  console.log('平台接入状态:', listPlatforms().map((p) => `${p.name}=${p.connected ? '已接入' : '未接入'}`).join('  '));
});
