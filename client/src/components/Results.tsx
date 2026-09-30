import { useState } from 'react';
import type { ResultTab, SearchResults, Song, Playlist, Artist, Album } from '../types';
import SongRow from './SongRow';
import ArtistCard from './ArtistCard';
import AlbumCard from './AlbumCard';
import PlaylistCard from './PlaylistCard';

interface ResultsProps {
  results: SearchResults | null;
  loading: boolean;
  error: string | null;
  query: string;
  activeTab: ResultTab;
  onTabChange: (t: ResultTab) => void;
  playingId: string | null;
  downloadingIds: Set<string>;
  platformName: (id: string) => string;
  onPlaySong: (s: Song) => void;
  onDownloadSong: (s: Song) => void;
  onDownloadSongs: (songs: Song[]) => void;
  onOpenPlaylist: (p: Playlist) => void;
  onOpenArtist: (a: Artist) => void;
  onOpenAlbum: (al: Album) => void;
}

const TABS: { key: ResultTab; label: string }[] = [
  { key: 'song', label: '单曲' },
  { key: 'playlist', label: '歌单' },
  { key: 'artist', label: '歌手' },
  { key: 'album', label: '专辑' },
];

export default function Results(props: ResultsProps) {
  const {
    results, loading, error, query, activeTab, onTabChange,
    playingId, downloadingIds, platformName,
    onPlaySong, onDownloadSong, onDownloadSongs, onOpenPlaylist, onOpenArtist, onOpenAlbum,
  } = props;

  const counts = results
    ? {
        song: results.songs.length,
        playlist: results.playlists.length,
        artist: results.artists.length,
        album: results.albums.length,
      }
    : { song: 0, playlist: 0, artist: 0, album: 0 };

  return (
    <section className="results shell" aria-label="搜索结果">
      {!results && !loading && !error && (
        <div className="empty empty--intro">
          <p className="empty__title">开始你的第一次搜索</p>
          <p className="empty__hint">
            在上方输入歌曲、歌单、歌手或专辑名称，自动跨平台聚合搜索（高音质）。
            也可以直接粘贴任意平台的歌单分享地址一键导入。
          </p>
        </div>
      )}

      {error && (
        <div className="empty">
          <p className="empty__title">搜索遇到问题</p>
          <p className="empty__hint">{error}</p>
        </div>
      )}

      {loading && (
        <div>
          <div className="tabs" aria-hidden>
            {TABS.map((t) => (
              <span key={t.key} className="tab" aria-selected="false">{t.label}</span>
            ))}
          </div>
          <SkeletonBody tab={activeTab} />
        </div>
      )}

      {results && !loading && !error && (
        <>
          <div className="tabs" role="tablist" aria-label="结果分类">
            {TABS.map((t) => (
              <button
                key={t.key}
                role="tab"
                className="tab"
                aria-selected={activeTab === t.key}
                onClick={() => onTabChange(t.key)}
              >
                {t.label}
                <span className="tab__count">{counts[t.key]}</span>
              </button>
            ))}
          </div>

          {results.solaraDown && (
            <div className="banner banner--warn">
              FLAC 源（曲库跳板）暂不可达，已自动降级为网易云直连（MP3，320kbps）。歌曲可正常播放与下载，仅音质非无损。
            </div>
          )}

          <TabBody
            tab={activeTab}
            results={results}
            playingId={playingId}
            downloadingIds={downloadingIds}
            platformName={platformName}
            onPlaySong={onPlaySong}
            onDownloadSong={onDownloadSong}
            onDownloadSongs={onDownloadSongs}
            onOpenPlaylist={onOpenPlaylist}
            onOpenArtist={onOpenArtist}
            onOpenAlbum={onOpenAlbum}
            query={query}
          />
        </>
      )}
    </section>
  );
}

function TabBody({
  tab, results, playingId, downloadingIds, platformName,
  onPlaySong, onDownloadSong, onDownloadSongs, onOpenPlaylist, onOpenArtist, onOpenAlbum, query,
}: {
  tab: ResultTab;
  results: SearchResults;
  playingId: string | null;
  downloadingIds: Set<string>;
  platformName: (id: string) => string;
  onPlaySong: (s: Song) => void;
  onDownloadSong: (s: Song) => void;
  onDownloadSongs: (songs: Song[]) => void;
  onOpenPlaylist: (p: Playlist) => void;
  onOpenArtist: (a: Artist) => void;
  onOpenAlbum: (al: Album) => void;
  query: string;
}) {
  if (tab === 'song') {
    if (results.songs.length === 0) return <EmptyTab query={query} noun="单曲" degraded={results.degraded} reason={results.reason} />;
    return (
      <SongList
        songs={results.songs}
        playingId={playingId}
        downloadingIds={downloadingIds}
        onPlaySong={onPlaySong}
        onDownloadSong={onDownloadSong}
        onDownloadSongs={onDownloadSongs}
      />
    );
  }

  if (tab === 'playlist') {
    if (results.playlists.length === 0) return <EmptyTab query={query} noun="歌单" degraded={results.degraded} reason={results.reason} />;
    return (
      <div className="card-grid">
        {results.playlists.map((p) => (
          <PlaylistCard
            key={`${p.platform}-${p.id}`}
            playlist={p}
            platformName={platformName(p.platform)}
            onOpen={() => onOpenPlaylist(p)}
          />
        ))}
      </div>
    );
  }

  if (tab === 'artist') {
    if (results.artists.length === 0) return <EmptyTab query={query} noun="歌手" degraded={results.degraded} reason={results.reason} />;
    return (
      <div className="card-grid">
        {results.artists.map((a) => (
          <ArtistCard
            key={`${a.platform}-${a.id}`}
            artist={a}
            platformName={platformName(a.platform)}
            onOpen={() => onOpenArtist(a)}
          />
        ))}
      </div>
    );
  }

  if (tab === 'album') {
    if (results.albums.length === 0) return <EmptyTab query={query} noun="专辑" degraded={results.degraded} reason={results.reason} />;
    return (
      <div className="card-grid">
        {results.albums.map((al) => (
          <AlbumCard
            key={`${al.platform}-${al.id}`}
            album={al}
            platformName={platformName(al.platform)}
            onOpen={() => onOpenAlbum(al)}
          />
        ))}
      </div>
    );
  }

  return null;
}

function SkeletonBody({ tab }: { tab: ResultTab }) {
  if (tab === 'song') {
    return (
      <div className="song-list">
        {Array.from({ length: 8 }).map((_, i) => (
          <div key={i} className="skeleton sk-row" />
        ))}
      </div>
    );
  }
  return (
    <div className="card-grid">
      {Array.from({ length: 10 }).map((_, i) => (
        <div key={i} className="skeleton sk-card" />
      ))}
    </div>
  );
}

function EmptyTab({ query, noun, degraded, reason }: { query: string; noun: string; degraded?: boolean; reason?: string }) {
  if (degraded) {
    return (
      <div className="empty empty--error">
        <p className="empty__title">上游音乐源暂时不可达</p>
        <p className="empty__hint">搜索请求未能从音乐源返回结果。常见原因：部署容器的网络/DNS 受限，或 music.163.com / music-api.gdstudio.xyz 被拦截。</p>
        <p className="empty__note empty__note--info">错误详情：{reason || '未知（上游无响应）'}</p>
      </div>
    );
  }
  return (
    <div className="empty">
      <p className="empty__title">没有找到相关{noun}</p>
      <p className="empty__hint">没有与「{query}」匹配的{noun}。换个关键词，或试试其它已接入的平台。</p>
    </div>
  );
}

// 搜索结果「单曲」列表：支持勾选 + 一键下载全部 / 下载选中。
function SongList({
  songs, playingId, downloadingIds, onPlaySong, onDownloadSong, onDownloadSongs,
}: {
  songs: Song[];
  playingId: string | null;
  downloadingIds: Set<string>;
  onPlaySong: (s: Song) => void;
  onDownloadSong: (s: Song) => void;
  onDownloadSongs: (songs: Song[]) => void;
}) {
  const [selectedIds, setSelectedIds] = useState<Set<string>>(new Set());
  // 可选 = 尚未确认无音源的曲目：未解析（点击时实时取直链）与已解析的都可勾选、可批量下载；
  // 仅「已确认无音源」(resolveFailed=true) 才真正不可选，避免徒劳请求。
  const selectableSongs = songs.filter((s) => !s.resolveFailed);
  const selectableIds = selectableSongs.map((s) => s.id);
  const allSelected = selectableIds.length > 0 && selectableIds.every((id) => selectedIds.has(id));
  const selectedSongs = songs.filter((s) => selectedIds.has(s.id));
  const toggleSelectOne = (id: string) =>
    setSelectedIds((prev) => {
      const n = new Set(prev);
      if (n.has(id)) n.delete(id);
      else n.add(id);
      return n;
    });
  const toggleAll = () =>
    setSelectedIds((prev) => {
      const n = new Set(prev);
      if (allSelected) selectableIds.forEach((id) => n.delete(id));
      else selectableIds.forEach((id) => n.add(id));
      return n;
    });
  return (
    <>
      <div className="batch-bar">
        <label className="batch-bar__check">
          <input type="checkbox" checked={allSelected} onChange={toggleAll} disabled={selectableIds.length === 0} />
          <span>全选</span>
        </label>
        <span className="batch-bar__count">已选 {selectedSongs.length} / 可选 {selectableSongs.length}</span>
        <div className="batch-bar__actions">
          <button type="button" className="set-btn" onClick={() => onDownloadSongs(selectableSongs)} disabled={selectableSongs.length === 0}>
            下载全部 ({selectableSongs.length})
          </button>
          <button type="button" className="set-btn set-btn--primary" onClick={() => onDownloadSongs(selectedSongs)} disabled={selectedSongs.length === 0}>
            下载选中 ({selectedSongs.length})
          </button>
        </div>
      </div>
      <div className="song-list">
        {songs.map((s) => (
          <SongRow
            key={`${s.platform}-${s.id}`}
            song={s}
            isPlaying={playingId === s.id}
            isDownloading={downloadingIds.has(s.id)}
            selectable
            selected={selectedIds.has(s.id)}
            onToggleSelect={() => toggleSelectOne(s.id)}
            onPlay={() => onPlaySong(s)}
            onDownload={() => onDownloadSong(s)}
          />
        ))}
      </div>
    </>
  );
}
