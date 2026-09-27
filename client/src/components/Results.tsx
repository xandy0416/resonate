import type { ResultTab, SearchResults, Song } from '../types';
import SongRow from './SongRow';
import ArtistCard from './ArtistCard';
import AlbumCard from './AlbumCard';

interface ResultsProps {
  results: SearchResults | null;
  loading: boolean;
  error: string | null;
  query: string;
  activeTab: ResultTab;
  onTabChange: (t: ResultTab) => void;
  playingId: string | null;
  downloadingId: string | null;
  platformName: (id: string) => string;
  onPlaySong: (s: Song) => void;
  onDownloadSong: (s: Song) => void;
}

const TABS: { key: ResultTab; label: string }[] = [
  { key: 'song', label: '单曲' },
  { key: 'artist', label: '歌手' },
  { key: 'album', label: '专辑' },
];

export default function Results(props: ResultsProps) {
  const {
    results, loading, error, query, activeTab, onTabChange,
    playingId, downloadingId, platformName,
    onPlaySong, onDownloadSong,
  } = props;

  const counts = results
    ? {
        song: results.songs.length,
        artist: results.artists.length,
        album: results.albums.length,
      }
    : { song: 0, artist: 0, album: 0 };

  return (
    <section className="results shell" aria-label="搜索结果">
      {!results && !loading && !error && (
        <div className="empty">
          <p className="empty__title">开始你的第一次搜索</p>
          <p className="empty__hint">
            在上方输入歌曲、歌手或专辑名称，自动跨平台聚合搜索（FLAC 无损）。
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

          <TabBody
            tab={activeTab}
            results={results}
            playingId={playingId}
            downloadingId={downloadingId}
            platformName={platformName}
            onPlaySong={onPlaySong}
            onDownloadSong={onDownloadSong}
            query={query}
          />
        </>
      )}
    </section>
  );
}

function TabBody({
  tab, results, playingId, downloadingId, platformName,
  onPlaySong, onDownloadSong, query,
}: {
  tab: ResultTab;
  results: SearchResults;
  playingId: string | null;
  downloadingId: string | null;
  platformName: (id: string) => string;
  onPlaySong: (s: Song) => void;
  onDownloadSong: (s: Song) => void;
  query: string;
}) {
  if (tab === 'song') {
    if (results.songs.length === 0) return <EmptyTab query={query} noun="单曲" />;
    return (
      <div className="song-list">
        {results.songs.map((s) => (
          <SongRow
            key={`${s.platform}-${s.id}`}
            song={s}
            isPlaying={playingId === s.id}
            isDownloading={downloadingId === s.id}
            onPlay={() => onPlaySong(s)}
            onDownload={() => onDownloadSong(s)}
          />
        ))}
      </div>
    );
  }

  if (tab === 'artist') {
    if (results.artists.length === 0) return <EmptyTab query={query} noun="歌手" />;
    return (
      <div className="card-grid">
        {results.artists.map((a) => (
          <ArtistCard key={`${a.platform}-${a.id}`} artist={a} platformName={platformName(a.platform)} />
        ))}
      </div>
    );
  }

  if (tab === 'album') {
    if (results.albums.length === 0) return <EmptyTab query={query} noun="专辑" />;
    return (
      <div className="card-grid">
        {results.albums.map((al) => (
          <AlbumCard key={`${al.platform}-${al.id}`} album={al} platformName={platformName(al.platform)} />
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

function EmptyTab({ query, noun }: { query: string; noun: string }) {
  return (
    <div className="empty">
      <p className="empty__title">没有找到相关{noun}</p>
      <p className="empty__hint">没有与「{query}」匹配的{noun}。换个关键词，或试试其它已接入的平台。</p>
    </div>
  );
}
