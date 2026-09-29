import type { Song } from '../types';
import { PlayIcon, DownloadIcon } from './Icons';
import { formatDuration } from '../api';

interface PlayerBarProps {
  song: Song | null;
  isPlaying: boolean;
  currentTime: number;
  duration: number;
  isDownloading: boolean;
  /** 歌单抽屉打开时，播放条左移避让、抬升到遮罩之上，确保进度条始终可见可拖 */
  drawerOpen?: boolean;
  onTogglePlay: () => void;
  onSeek: (seconds: number) => void;
  onDownload: () => void;
}

export default function PlayerBar({
  song, isPlaying, currentTime, duration, isDownloading, drawerOpen,
  onTogglePlay, onSeek, onDownload,
}: PlayerBarProps) {
  if (!song) return null;
  return (
    <div className={`player${drawerOpen ? ' player--shifted' : ''}`} role="region" aria-label="播放器">
      <div className="player__left">
        {song.cover ? (
          <img className="player__cover" src={song.cover} alt="" />
        ) : (
          <div className="player__cover" aria-hidden />
        )}
        <div className="player__text">
          <p className="player__title">{song.title}</p>
          <p className="player__artist">{song.artist}</p>
        </div>
      </div>

      <div className="player__center">
        <button
          type="button"
          className="icon-btn"
          onClick={onTogglePlay}
          aria-label={isPlaying ? '暂停' : '播放'}
        >
          {isPlaying ? <PauseGlyph /> : <PlayIcon />}
        </button>
        <span className="player__time">{formatDuration(currentTime * 1000)}</span>
        <input
          className="seek"
          type="range"
          min={0}
          max={Math.floor(duration || 0)}
          value={Math.floor(currentTime)}
          onChange={(e) => onSeek(Number(e.target.value))}
          aria-label="播放进度"
        />
        <span className="player__time">{formatDuration(duration * 1000)}</span>
      </div>

      <div className="player__right">
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
    </div>
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
