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
  selectable?: boolean;
  selected?: boolean;
  onToggleSelect?: () => void;
}

export default function SongRow({
  song,
  isPlaying,
  isDownloading,
  onPlay,
  onDownload,
  selectable = false,
  selected = false,
  onToggleSelect,
}: SongRowProps) {
  // 按钮是否禁用：仅当「按需解析尝试过且失败（无可用音源）」才置灰禁用。
  // 未解析（format 为空但 resolveFailed 未标记）时按钮可用，点击后实时取完整 FLAC 直链。
  // 注意：MP3 是 FLAC 不可用时的降级结果，仍可正常播放/下载，不能按 flac===false 置灰。
  const unavailable = song.resolveFailed === true;
  return (
    <article className={`song-row${isPlaying ? ' song-row--playing' : ''}${unavailable ? ' song-row--unavailable' : ''}${selectable ? ' song-row--selectable' : ''}`}>
      {selectable && (
        <label className="song-row__check" onClick={(e) => e.stopPropagation()}>
            <input
              type="checkbox"
              checked={selected}
              onChange={() => onToggleSelect?.()}
              disabled={song.resolveFailed}
              aria-label={`选择 ${song.title || '未知标题'}`}
            />
        </label>
      )}
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
          {song.format ? (
            <span className={song.flac ? 'badge badge--flac' : 'badge'}>{song.format}</span>
          ) : song.resolveFailed ? (
            <span className="badge badge--muted">暂无音源</span>
          ) : (
            <span className="badge badge--pending">点击解析</span>
          )}
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
          disabled={unavailable}
          aria-label={isPlaying ? `暂停 ${song.title}` : `播放 ${song.title}`}
        >
          {isPlaying ? <PauseGlyph /> : <PlayIcon />}
        </button>
        <button
          type="button"
          className="icon-btn icon-btn--ghost"
          onClick={onDownload}
          disabled={unavailable || isDownloading}
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
