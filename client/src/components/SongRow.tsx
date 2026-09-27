import type { Song } from '../types';
import { PlayIcon, DownloadIcon } from './Icons';
import { formatDuration, formatSize } from '../api';

const SRC_LABEL: Record<string, string> = {
  netease: '网易云',
  joox: 'Joox',
  bilibili: 'B站',
  kuwo: '酷我',
  kugou: '酷狗',
  qishui: '汽水',
};

interface SongRowProps {
  song: Song;
  isPlaying: boolean;
  isDownloading: boolean;
  onPlay: () => void;
  onDownload: () => void;
}

export default function SongRow({
  song,
  isPlaying,
  isDownloading,
  onPlay,
  onDownload,
}: SongRowProps) {
  return (
    <article className={`song-row${isPlaying ? ' song-row--playing' : ''}`}>
      {song.cover ? (
        <img className="song-row__cover" src={song.cover} alt="" loading="lazy" width={48} height={48} />
      ) : (
        <div className="song-row__cover" aria-hidden />
      )}

      <div className="song-row__info">
        <div className="song-row__text">
          <p className="song-row__title">{song.title || '未知标题'}</p>
          <p className="song-row__sub">
            {song.artist || '未知歌手'}
            {song.album ? ` · ${song.album}` : ''}
          </p>
        </div>
        <div className="song-row__meta">
          <span className="meta-chip">{formatDuration(song.duration)}</span>
          <span className="meta-chip meta-chip--muted">{formatSize(song.size)}</span>
          {song.format ? <span className="badge badge--flac">{song.format}</span> : null}
          {song.fromPlatform && song.fromPlatform !== 'netease' ? (
            <span className="badge badge--src">{SRC_LABEL[song.fromPlatform] || song.fromPlatform}</span>
          ) : null}
        </div>
      </div>

      <div className="song-row__actions">
        <button
          type="button"
          className="icon-btn"
          onClick={onPlay}
          aria-label={isPlaying ? `暂停 ${song.title}` : `播放 ${song.title}`}
        >
          {isPlaying ? <PauseGlyph /> : <PlayIcon />}
        </button>
        <button
          type="button"
          className="icon-btn icon-btn--ghost"
          onClick={onDownload}
          disabled={isDownloading}
          aria-label={`下载 ${song.title}`}
        >
          {isDownloading ? <span className="spinner" /> : <DownloadIcon />}
        </button>
      </div>
    </article>
  );
}

function PauseGlyph() {
  return (
    <svg viewBox="0 0 24 24" aria-hidden focusable={false}>
      <rect x="6" y="5" width="4" height="14" rx="1" fill="currentColor" />
      <rect x="14" y="5" width="4" height="14" rx="1" fill="currentColor" />
    </svg>
  );
}
