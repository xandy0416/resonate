import { useEffect, useMemo, useRef, useState } from 'react';
import type { Platform, ResultTab, SearchResults, Song, Playlist } from './types';
import {
  fetchPlatforms, search, importPlaylist, playUrl, downloadUrl,
} from './api';
import Nav from './components/Nav';
import Hero from './components/Hero';
import Results from './components/Results';
import PlayerBar from './components/PlayerBar';
import Footer from './components/Footer';
import PlaylistDetailDrawer from './components/PlaylistDetailDrawer';
import DownloadsDrawer, { type DownloadItem } from './components/DownloadsDrawer';

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

  const [currentSong, setCurrentSong] = useState<Song | null>(null);
  const [isPlaying, setIsPlaying] = useState(false);
  const [currentTime, setCurrentTime] = useState(0);
  const [duration, setDuration] = useState(0);

  const [downloadingId, setDownloadingId] = useState<string | null>(null);
  const [downloads, setDownloads] = useState<DownloadItem[]>([]);
  const [downloadsOpen, setDownloadsOpen] = useState(false);

  const [drawerOpen, setDrawerOpen] = useState(false);
  const [drawerLoading, setDrawerLoading] = useState(false);
  const [drawerDetail, setDrawerDetail] = useState<(Playlist & { songs: Song[] }) | null>(null);

  const [toasts, setToasts] = useState<Toast[]>([]);
  const audioRef = useRef<HTMLAudioElement>(null);
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
      const data = await search(q, 'all');
      setResults(data);
      const order: ResultTab[] = ['song', 'artist', 'album'];
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

  async function handleImportPlaylist(url: string) {
    setLoading(true);
    setError(null);
    setDrawerOpen(true);
    setDrawerLoading(true);
    setDrawerDetail(null);
    try {
      const detail = await importPlaylist(url);
      setDrawerDetail(detail);
      pushToast(
        `已导入歌单：${detail.name}（${detail.resolvedCount ?? detail.songs.length} 首 FLAC）`,
        'ok'
      );
    } catch (e) {
      const msg = e instanceof Error ? e.message : '歌单导入失败';
      setError(msg);
      pushToast(msg, 'error');
    } finally {
      setLoading(false);
      setDrawerLoading(false);
    }
  }

  function handlePlaySong(song: Song) {
    const audio = audioRef.current;
    if (!audio) return;
    if (currentSong && currentSong.id === song.id) {
      if (audio.paused) audio.play().catch(() => {});
      else audio.pause();
      return;
    }
    setCurrentSong(song);
    setCurrentTime(0);
    setDuration(0);
    audio.src = playUrl(song.platform, song.id, song.src);
    audio.play().catch(() => pushToast('播放被浏览器拦截，请再次点击播放。', 'error'));
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

  function handleDownloadSong(song: Song) {
    const url = downloadUrl(song.platform, song.id, song.title || 'audio', song.src);
    const a = document.createElement('a');
    a.href = url;
    a.rel = 'noopener';
    document.body.appendChild(a);
    a.click();
    a.remove();

    const key = `${song.platform}-${song.id}-${Date.now()}`;
    setDownloadingId(song.id);
    setDownloads((d) => [{ id: key, title: song.title || '音频', status: '下载中' as const }, ...d].slice(0, 50));
    pushToast(`已开始下载：${song.title || '音频'}`);
    setTimeout(() => {
      setDownloadingId(null);
      setDownloads((d) =>
        d.map((it) => (it.id === key ? { ...it, status: '已完成' as const } : it))
      );
    }, 2500);
  }

  return (
    <>
      <Nav downloadCount={downloads.length} onToggleDownloads={() => setDownloadsOpen((v) => !v)} />

      <main>
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
          downloadingId={downloadingId}
          platformName={platformName}
          onPlaySong={handlePlaySong}
          onDownloadSong={handleDownloadSong}
        />

        <Footer />
      </main>

      <PlayerBar
        song={currentSong}
        isPlaying={isPlaying}
        currentTime={currentTime}
        duration={duration}
        isDownloading={downloadingId !== null && currentSong != null && downloadingId === currentSong.id}
        onTogglePlay={handleTogglePlay}
        onSeek={handleSeek}
        onDownload={() => currentSong && handleDownloadSong(currentSong)}
      />

      <PlaylistDetailDrawer
        open={drawerOpen}
        loading={drawerLoading}
        detail={drawerDetail}
        playingId={currentSong?.id ?? null}
        downloadingId={downloadingId}
        onClose={() => setDrawerOpen(false)}
        onPlaySong={handlePlaySong}
        onDownloadSong={handleDownloadSong}
      />

      <DownloadsDrawer
        open={downloadsOpen}
        items={downloads}
        onClose={() => setDownloadsOpen(false)}
      />

      <div className="toasts" aria-live="polite">
        {toasts.map((t) => (
          <div key={t.id} className={`toast toast--${t.tone}`}>{t.msg}</div>
        ))}
      </div>

      <audio
        ref={audioRef}
        onLoadedMetadata={(e) => setDuration(e.currentTarget.duration)}
        onTimeUpdate={(e) => setCurrentTime(e.currentTarget.currentTime)}
        onPlay={() => setIsPlaying(true)}
        onPause={() => setIsPlaying(false)}
        onEnded={() => setIsPlaying(false)}
        hidden
      />
    </>
  );
}
