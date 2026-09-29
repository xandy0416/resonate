import { useEffect, useMemo, useRef, useState } from 'react';
import type { Platform, ResultTab, SearchResults, Song, Playlist, Artist, Album, CollectionDetail, DrawerTab, CollectionKind } from './types';
import {
  fetchPlatforms, search, importPlaylist, fetchPlaylistDetail, fetchArtistSongs, fetchAlbumSongs, playUrl, downloadUrl, resolveSongUrl,
} from './api';
import Nav from './components/Nav';
import Hero from './components/Hero';
import Results from './components/Results';
import PlayerBar from './components/PlayerBar';
import Footer from './components/Footer';
import CollectionDrawer from './components/CollectionDrawer';
import DownloadsDrawer, { type DownloadItem } from './components/DownloadsDrawer';
import SideRail, { type RailPanel } from './components/SideRail';
import HistoryDrawer, { type HistoryItem } from './components/HistoryDrawer';
import SettingsDrawer from './components/SettingsDrawer';
import { usePersistentState } from './hooks/usePersistentState';

interface Toast {
  id: number;
  msg: string;
  tone: 'default' | 'error' | 'ok';
}

export default function App() {
  const [platforms, setPlatforms] = useState<Platform[]>([]);
  const [query, setQuery] = useState('');
  const [results, setResults] = useState<SearchResults | null>(null);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [activeTab, setActiveTab] = useState<ResultTab>('song');
  const [resultLimit, setResultLimit] = useState<number>(60);

  const [currentSong, setCurrentSong] = useState<Song | null>(null);
  const [isPlaying, setIsPlaying] = useState(false);
  const [currentTime, setCurrentTime] = useState(0);
  const [duration, setDuration] = useState(0);

  const [downloadingIds, setDownloadingIds] = useState<Set<string>>(new Set());
  // 下载记录 / 播放记录都持久化到本机，刷新页面不丢。
  const [downloads, setDownloads] = usePersistentState<DownloadItem[]>('resonate.downloads', []);
  const [history, setHistory] = usePersistentState<HistoryItem[]>('resonate.history', []);
  // 右侧图标栏当前打开的面板（三选一，互斥）
  const [railPanel, setRailPanel] = useState<RailPanel | null>(null);

  // 歌单 / 歌手 / 专辑 多标签页：每个标签独立加载、独立选择态，可同时打开多个对照查找。
  const [drawerTabs, setDrawerTabs] = useState<DrawerTab[]>([]);
  const [activeTabId, setActiveTabId] = useState<string | null>(null);
  const tabSeq = useRef(0);
  const drawerTabsRef = useRef<DrawerTab[]>([]);
  useEffect(() => { drawerTabsRef.current = drawerTabs; }, [drawerTabs]);
  // 抽屉是否展开 = 是否还有打开的标签（驱动主内容左推 / 播放条避让）
  const drawerOpen = drawerTabs.length > 0;

  const [toasts, setToasts] = useState<Toast[]>([]);
  const audioRef = useRef<HTMLAudioElement>(null);
  // 断点续播：待定位的起始秒数（仅续播时设置，loadedmetadata 后 seek 再播）
  const pendingSeekRef = useRef<number | null>(null);
  // 当前歌曲引用（供 timeupdate/ended 事件读取，避免闭包拿到旧 state）
  const currentSongRef = useRef<Song | null>(null);
  // 进度持久化节流：最多每 4 秒写一次 localStorage，避免频繁写入
  const lastProgressSaveRef = useRef(0);
  const toastId = useRef(0);

  const platformName = useMemo(() => {
    const map = new Map(platforms.map((p) => [p.id, p.name]));
    return (id: string) => map.get(id) || id;
  }, [platforms]);

  // 初始加载平台列表（仅用于结果卡片的来源标注）
  useEffect(() => {
    fetchPlatforms()
      .then((list) => setPlatforms(list))
      .catch(() => setError('无法连接后端服务，请确认服务已启动（见 README）。'));
  }, []);

  // 播放器出现时为页面底部留出空间
  useEffect(() => {
    document.body.style.paddingBottom = currentSong ? '96px' : '';
    return () => { document.body.style.paddingBottom = ''; };
  }, [currentSong]);

  function pushToast(msg: string, tone: Toast['tone'] = 'default') {
    const id = ++toastId.current;
    setToasts((t) => [...t, { id, msg, tone }]);
    setTimeout(() => setToasts((t) => t.filter((x) => x.id !== id)), 4000);
  }

  // 前端粗判：是否为歌单分享地址（后端会做精确的平台识别与解析）。
  function looksLikeUrl(text: string): boolean {
    const t = text.trim();
    return /^https?:\/\//i.test(t) || /\b[\w-]+\.(?:com|cn|net|fm|co)\b[^\s]*/i.test(t);
  }

  async function handleSearch() {
    const q = query.trim();
    if (!q) return;
    // 输入是歌单分享地址 → 走「分享地址导入」流程
    if (looksLikeUrl(q)) {
      await handleImportPlaylist(q);
      return;
    }
    setLoading(true);
    setError(null);
    try {
      const data = await search(q, 'all', resultLimit);
      setResults(data);
      const order: ResultTab[] = ['song', 'playlist', 'artist', 'album'];
      const first = order.find((k) =>
        k === 'song' ? data.songs.length
          : k === 'artist' ? data.artists.length
          : data.albums.length
      );
      if (first) setActiveTab(first);
    } catch (e) {
      setError(e instanceof Error ? e.message : '搜索失败');
      setResults(null);
    } finally {
      setLoading(false);
    }
  }

  // ── 歌单 / 歌手 / 专辑 多标签抽屉 ──
  function updateTab(id: string, patch: Partial<DrawerTab>) {
    setDrawerTabs((prev) => prev.map((t) => (t.id === id ? { ...t, ...patch } : t)));
  }

  async function loadTab(id: string, explicitLoader?: () => Promise<CollectionDetail>) {
    const tab = drawerTabsRef.current.find((t) => t.id === id);
    const loader = explicitLoader ?? tab?.loader;
    if (!loader) return;
    updateTab(id, { loading: true });
    try {
      const detail = await loader();
      setDrawerTabs((prev) =>
        prev.map((t) =>
          t.id === id
            ? { ...t, loading: false, detail, title: detail.name || t.title, cover: detail.cover || t.cover }
            : t
        )
      );
    } catch (e) {
      updateTab(id, { loading: false });
      pushToast(e instanceof Error ? e.message : '加载失败', 'error');
    }
  }

  // 打开一个集合标签：若同 key 已存在则直接切换到该标签，避免重复打开。
  function openTab(kind: CollectionKind, key: string, title: string, loader: () => Promise<CollectionDetail>) {
    const existing = drawerTabs.find((t) => t.key === key);
    if (existing) {
      setActiveTabId(existing.id);
      return;
    }
    const id = `tab-${++tabSeq.current}`;
    const tab: DrawerTab = { id, kind, key, title, cover: undefined, loading: true, detail: null, loader };
    setDrawerTabs((prev) => [...prev, tab]);
    setActiveTabId(id);
    void loadTab(id, loader);
  }

  function closeTab(id: string) {
    setDrawerTabs((prev) => {
      const idx = prev.findIndex((t) => t.id === id);
      const next = prev.filter((t) => t.id !== id);
      if (activeTabId === id) {
        const fallback = next[idx] || next[idx - 1] || null;
        setActiveTabId(fallback ? fallback.id : null);
      }
      return next;
    });
  }

  function closeAllTabs() {
    setDrawerTabs([]);
    setActiveTabId(null);
  }

  function handleOpenPlaylist(playlist: Playlist) {
    openTab('playlist', `pl-${playlist.platform}-${playlist.id}`, playlist.name, async () => {
      const d = await fetchPlaylistDetail(playlist.platform, playlist.id);
      return {
        name: d.name,
        cover: d.cover,
        subtitle: `创建者 ${d.owner || '未知'} · ${d.count} 首`,
        count: d.count,
        resolvedCount: d.resolvedCount,
        flacCount: d.flacCount,
        totalCount: d.totalCount,
        songs: d.songs,
      };
    });
  }

  function handleOpenArtist(artist: Artist) {
    openTab('artist', `ar-${artist.platform}-${artist.id}`, artist.name, async () => {
      const d = await fetchArtistSongs(artist.platform, artist.id, artist.name);
      return { ...d, name: d.name || artist.name, cover: d.cover || artist.avatar };
    });
  }

  function handleOpenAlbum(album: Album) {
    openTab('album', `al-${album.platform}-${album.id}`, album.name, async () => {
      const d = await fetchAlbumSongs(album.platform, album.id, album.name);
      return { ...d, name: d.name || album.name, cover: d.cover || album.cover };
    });
  }

  function handleImportPlaylist(url: string) {
    openTab('import', `url-${url}`, '歌单导入中…', async () => {
      const detail = await importPlaylist(url);
      pushToast(
        `已导入歌单：${detail.name}（${detail.flacCount ?? detail.resolvedCount ?? detail.songs.length} 首 FLAC）`,
        'ok'
      );
      return detail;
    });
  }

  // 把解析结果写回搜索结果与所有已打开的抽屉标签（按 netease id 匹配，解析前后 id 不变）。
  function mergeSongResolution(updated: Song) {
    setResults((prev) =>
      prev ? { ...prev, songs: prev.songs.map((x) => (x.id === updated.id ? updated : x)) } : prev
    );
    setDrawerTabs((prev) =>
      prev.map((t) =>
        t.detail
          ? { ...t, detail: { ...t.detail, songs: t.detail.songs.map((x) => (x.id === updated.id ? updated : x)) } }
          : t
      )
    );
  }

  // 按需解析单曲直链：把 netease id 经 Solara 跳板解析为完整 FLAC。
  // 已解析（format 有值）或已确认失败（resolveFailed）则直接返回，不再打接口。
  async function resolveSong(song: Song): Promise<Song> {
    if (song.format || song.resolveFailed) return song;
    try {
      const info = await resolveSongUrl(song.id);
      if (!info || !info.url) throw new Error('无可用直链');
      const updated: Song = {
        ...song,
        platform: 'solara',
        src: 'netease',
        size: info.size,
        format: info.format,
        br: info.br,
        flac: info.format === 'FLAC',
        fromPlatform: song.platform || 'netease',
      };
      mergeSongResolution(updated);
      return updated;
    } catch {
      const failed: Song = { ...song, resolveFailed: true };
      mergeSongResolution(failed);
      return failed;
    }
  }

  // 并发受限地按需解析一批曲目（用于批量下载），整体 12s 时限避免长尾拖死。
  async function resolveManyOnDemand(items: Song[], concurrency: number): Promise<Song[]> {
    const out: Song[] = [];
    let idx = 0;
    const deadline = Date.now() + 12000;
    async function runner() {
      while (idx < items.length) {
        if (Date.now() > deadline) return;
        const cur = items[idx++];
        const r = await resolveSong(cur);
        out.push(r);
      }
    }
    const n = Math.min(concurrency, items.length || 1);
    await Promise.all(Array.from({ length: n }, () => runner()));
    return out;
  }

  async function handlePlaySong(song: Song, startAt = 0) {
    const audio = audioRef.current;
    if (!audio) return;
    let s = song;
    // 未解析且无失败记录 → 点击时才实时取完整 FLAC 直链
    if (!song.format && !song.resolveFailed) {
      pushToast('正在解析音源…');
      s = await resolveSong(song);
      if (s.resolveFailed) {
        pushToast('该曲目无可用音源', 'error');
        return;
      }
    }
    if (currentSong && currentSong.id === s.id) {
      if (audio.paused) audio.play().catch(() => {});
      else audio.pause();
      return;
    }
    const startPos = startAt > 0 ? startAt : 0;
    pendingSeekRef.current = startAt > 0 ? startAt : null;
    currentSongRef.current = s;
    setCurrentSong(s);
    setCurrentTime(startPos);
    setDuration(0);
    audio.src = playUrl(s.platform, s.id, s.src);
    // 续播（startAt>0）：不在此立即 play，等 loadedmetadata 后 seek 再播；
    // 从头播放：立即 play。
    if (!pendingSeekRef.current) {
      audio.play().catch(() => pushToast('播放被浏览器拦截，请再次点击播放。', 'error'));
    }
    // 记录播放历史：同一首歌去重后置顶，最多保留 100 条；带续播起点 position。
    const hkey = `${s.platform}-${s.id}`;
    setHistory((h) => [
      { key: hkey, song: s, playedAt: Date.now(), position: startPos },
      ...h.filter((x) => x.key !== hkey),
    ].slice(0, 100));
  }

  // 把当前播放进度写回播放记录（仅更新已存在的项，不影响其它记录）
  function saveHistoryProgress(song: Song, position: number, duration: number) {
    const key = `${song.platform}-${song.id}`;
    setHistory((h) => h.map((x) => (x.key === key ? { ...x, position, duration } : x)));
  }

  // 播放进度推进：更新状态，并节流（≤每 4s）写回播放记录，支撑断点续播
  function handleTimeUpdate(e: React.SyntheticEvent<HTMLAudioElement>) {
    const t = e.currentTarget.currentTime;
    const d = e.currentTarget.duration;
    setCurrentTime(t);
    const now = Date.now();
    if (now - lastProgressSaveRef.current >= 4000 && currentSongRef.current) {
      lastProgressSaveRef.current = now;
      saveHistoryProgress(currentSongRef.current, t, d || 0);
    }
  }

  function handleTogglePlay() {
    const audio = audioRef.current;
    if (!audio || !currentSong) return;
    if (audio.paused) audio.play().catch(() => {});
    else audio.pause();
  }

  function handleSeek(seconds: number) {
    const audio = audioRef.current;
    if (!audio) return;
    audio.currentTime = seconds;
    setCurrentTime(seconds);
  }

  // 触发单首下载：生成 /api/download 直链，用隐藏 <a> 点击交给浏览器保存（原生下载，可暂停/重试）。
  function triggerOneDownload(song: Song) {
    const a = document.createElement('a');
    a.href = downloadUrl(song.platform, song.id, song.title || 'audio', song.src);
    a.rel = 'noopener';
    document.body.appendChild(a);
    a.click();
    a.remove();
  }

  async function handleDownloadSong(song: Song) {
    let s = song;
    // 未解析且无失败记录 → 点击时才实时取完整 FLAC 直链
    if (!song.format && !song.resolveFailed) {
      pushToast('正在解析音源…');
      s = await resolveSong(song);
      if (s.resolveFailed) {
        pushToast('该曲目无可用音源', 'error');
        return;
      }
    }
    if (!s.format) {
      pushToast('该曲目无可用音源', 'error');
      return;
    }
    triggerOneDownload(s);
    const key = `${s.platform}-${s.id}-${Date.now()}`;
    setDownloadingIds((prev) => new Set(prev).add(s.id));
    setDownloads((d) => [
      { id: key, title: s.title || '音频', status: '下载中' as const, at: Date.now(), songId: s.id },
      ...d,
    ].slice(0, 50));
    pushToast(`已开始下载：${s.title || '音频'}`);
    setTimeout(() => {
      setDownloadingIds((prev) => {
        const n = new Set(prev);
        n.delete(s.id);
        return n;
      });
      setDownloads((d) => d.map((it) => (it.songId === s.id ? { ...it, status: '已完成' as const } : it)));
    }, 2500);
  }

  // 批量下载：先对未解析曲目按需并发解析（12s 时限），再下载解析成功的；
  // 串行错峰（每 250ms 一首）触发，避免瞬时打爆上游音源、也缓解浏览器批量拦截。
  async function handleDownloadSongs(songs: Song[]) {
    let list = songs;
    const toResolve = songs.filter((s) => !s.format && !s.resolveFailed);
    if (toResolve.length) {
      pushToast(`正在解析 ${toResolve.length} 首音源…`);
      const resolved = await resolveManyOnDemand(toResolve, 12);
      const map = new Map(resolved.map((r) => [r.id, r]));
      list = songs.map((s) => {
        if (s.format) return s;
        const r = map.get(s.id);
        return r && r.format ? r : s;
      });
    }
    const available = list.filter((s) => !!s.format);
    if (available.length === 0) {
      pushToast('所选曲目暂无可下载音源', 'error');
      return;
    }
    const ids = available.map((s) => s.id);
    const now = Date.now();
    setDownloadingIds((prev) => new Set([...prev, ...ids]));
    setDownloads((d) => [
      ...available.map((s) => ({
        id: `${s.platform}-${s.id}-${now}-${Math.random().toString(36).slice(2, 7)}`,
        title: s.title || '音频',
        status: '下载中' as const,
        at: now,
        songId: s.id,
      })),
      ...d,
    ].slice(0, 50));
    pushToast(`已开始下载 ${available.length} 首（若浏览器询问，请允许批量下载）`, 'ok');
    available.forEach((s, i) => {
      setTimeout(() => triggerOneDownload(s), i * 250);
    });
    setTimeout(() => {
      setDownloadingIds((prev) => {
        const n = new Set(prev);
        ids.forEach((id) => n.delete(id));
        return n;
      });
      setDownloads((d) =>
        d.map((it) => (ids.includes(it.songId as string) ? { ...it, status: '已完成' as const } : it))
      );
    }, 2500);
  }

  return (
    <>
      <Nav drawerOpen={drawerOpen} />

      <main className={drawerOpen ? 'app-main app-main--pushed' : 'app-main'}>
        <Hero
          query={query}
          onQueryChange={setQuery}
          onSearch={handleSearch}
          loading={loading}
        />

        <Results
          results={results}
          loading={loading}
          error={error}
          query={query}
          activeTab={activeTab}
          onTabChange={setActiveTab}
          playingId={currentSong?.id ?? null}
          downloadingIds={downloadingIds}
          platformName={platformName}
          onPlaySong={handlePlaySong}
          onDownloadSong={handleDownloadSong}
          onDownloadSongs={handleDownloadSongs}
          onOpenPlaylist={handleOpenPlaylist}
          onOpenArtist={handleOpenArtist}
          onOpenAlbum={handleOpenAlbum}
        />

        <Footer />
      </main>

      <PlayerBar
        song={currentSong}
        isPlaying={isPlaying}
        currentTime={currentTime}
        duration={duration}
        isDownloading={currentSong != null && downloadingIds.has(currentSong.id)}
        drawerOpen={drawerOpen}
        onTogglePlay={handleTogglePlay}
        onSeek={handleSeek}
        onDownload={() => currentSong && handleDownloadSong(currentSong)}
      />

      <CollectionDrawer
        open={drawerOpen}
        tabs={drawerTabs}
        activeTabId={activeTabId}
        playingId={currentSong?.id ?? null}
        downloadingIds={downloadingIds}
        onSelectTab={setActiveTabId}
        onCloseTab={closeTab}
        onCloseAll={closeAllTabs}
        onPlaySong={handlePlaySong}
        onDownloadSong={handleDownloadSong}
        onDownloadSongs={handleDownloadSongs}
        onRetryActive={() => { if (activeTabId) void loadTab(activeTabId); }}
      />

      {/* 右侧边缘图标栏：下载记录 / 播放记录 / 设置 */}
      <SideRail
        active={railPanel}
        onToggle={(p) => setRailPanel((cur) => (cur === p ? null : p))}
        downloadCount={downloads.length}
        historyCount={history.length}
      />

      <DownloadsDrawer
        open={railPanel === 'downloads'}
        items={downloads}
        onClose={() => setRailPanel(null)}
        onClear={() => {
          setDownloads([]);
          pushToast('已清空下载记录');
        }}
      />

      <HistoryDrawer
        open={railPanel === 'history'}
        items={history}
        playingId={currentSong?.id ?? null}
        onClose={() => setRailPanel(null)}
        onPlay={handlePlaySong}
        onRemove={(key) => setHistory((h) => h.filter((x) => x.key !== key))}
        onClear={() => {
          setHistory([]);
          pushToast('已清空播放记录');
        }}
      />

      <SettingsDrawer
        open={railPanel === 'settings'}
        onClose={() => setRailPanel(null)}
        resultLimit={resultLimit}
        onResultLimitChange={setResultLimit}
        platforms={platforms}
        downloadCount={downloads.length}
        historyCount={history.length}
        onClearDownloads={() => {
          setDownloads([]);
          pushToast('已清空下载记录');
        }}
        onClearHistory={() => {
          setHistory([]);
          pushToast('已清空播放记录');
        }}
      />

      <div className="toasts" aria-live="polite">
        {toasts.map((t) => (
          <div key={t.id} className={`toast toast--${t.tone}`}>{t.msg}</div>
        ))}
      </div>

      <audio
        ref={audioRef}
        onLoadedMetadata={(e) => {
          const d = e.currentTarget.duration;
          setDuration(d);
          // 续播：跳到上次进度后再播
          if (pendingSeekRef.current != null) {
            const t = Math.max(0, Math.min(pendingSeekRef.current, (d || 0) - 0.5));
            e.currentTarget.currentTime = t;
            pendingSeekRef.current = null;
            e.currentTarget.play().catch(() => {});
          }
        }}
        onTimeUpdate={handleTimeUpdate}
        onPlay={() => setIsPlaying(true)}
        onPause={() => setIsPlaying(false)}
        onEnded={() => {
          setIsPlaying(false);
          // 播完：进度归零，下次从头
          if (currentSongRef.current) {
            const d = audioRef.current?.duration || 0;
            saveHistoryProgress(currentSongRef.current, 0, d);
          }
        }}
        hidden
      />
    </>
  );
}
