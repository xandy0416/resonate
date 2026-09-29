import { useEffect } from 'react';
import type { Song } from '../types';
import { CloseIcon, MusicIcon, TrashIcon } from './Icons';

export interface HistoryItem {
  key: string;
  song: Song;
  playedAt: number; // 时间戳（毫秒）
  position?: number; // 上次播放到的秒数（断点续播）
  duration?: number; // 曲目总时长（秒）
}

interface HistoryDrawerProps {
  open: boolean;
  items: HistoryItem[];
  playingId: string | null;
  onClose: () => void;
  onPlay: (song: Song, startAt?: number) => void;
  onRemove: (key: string) => void;
  onClear: () => void;
}

function relTime(ts: number): string {
  const diff = Date.now() - ts;
  const min = Math.floor(diff / 60000);
  if (min < 1) return '刚刚';
  if (min < 60) return `${min} 分钟前`;
  const hour = Math.floor(min / 60);
  if (hour < 24) return `${hour} 小时前`;
  const day = Math.floor(hour / 24);
  if (day < 30) return `${day} 天前`;
  return new Date(ts).toLocaleDateString('zh-CN');
}

function fmt(sec?: number): string {
  if (sec == null || !isFinite(sec) || sec < 0) return '0:00';
  const m = Math.floor(sec / 60);
  const s = Math.floor(sec % 60);
  return `${m}:${s.toString().padStart(2, '0')}`;
}

export default function HistoryDrawer({
  open,
  items,
  playingId,
  onClose,
  onPlay,
  onRemove,
  onClear,
}: HistoryDrawerProps) {
  useEffect(() => {
    if (!open) return;
    const onKey = (e: KeyboardEvent) => { if (e.key === 'Escape') onClose(); };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [open, onClose]);

  return (
    <>
      <div className={`scrim${open ? ' open' : ''}`} onClick={onClose} aria-hidden />
      <aside
        className={`drawer${open ? ' open' : ''}`}
        role="dialog"
        aria-modal="true"
        aria-label="播放记录"
        aria-hidden={!open}
      >
        <div className="drawer__head">
          <span className="drawer__title">播放记录</span>
          <div className="drawer__actions">
            {items.length > 0 && (
              <button
                type="button"
                className="icon-btn icon-btn--ghost"
                onClick={onClear}
                aria-label="清空播放记录"
                title="清空播放记录"
              >
                <TrashIcon />
              </button>
            )}
            <button type="button" className="icon-btn icon-btn--ghost" onClick={onClose} aria-label="关闭">
              <CloseIcon />
            </button>
          </div>
        </div>

        <div className="drawer__body">
          {items.length === 0 && (
            <p className="empty__hint">还没有播放记录。播放过的歌曲会按时间倒序记在这里。</p>
          )}
          {items.map((it) => {
            const playing = it.song.id === playingId;
            // 有未播完的进度才续播，否则从头
            const resumePos =
              it.position && it.duration && it.duration > 0 && it.position < it.duration - 2
                ? it.position
                : 0;
            return (
              <div className={`rec-item${playing ? ' rec-item--playing' : ''}`} key={it.key}>
                {it.song.cover ? (
                  <img className="rec-item__cover" src={it.song.cover} alt="" loading="lazy" />
                ) : (
                  <span className="rec-item__cover rec-item__cover--empty"><MusicIcon /></span>
                )}
                <div className="rec-item__main">
                  <span className="rec-item__title">{it.song.title || '未知曲目'}</span>
                  <span className="rec-item__meta">
                    {it.song.artist || '未知歌手'}
                    {it.song.format ? ` · ${it.song.format}` : ''}
                    {resumePos > 0
                      ? ` · 听到 ${fmt(resumePos)} / ${fmt(it.duration)}`
                      : ` · ${relTime(it.playedAt)}`}
                  </span>
                </div>
                <div className="rec-item__ops">
                  <button
                    type="button"
                    className="icon-btn icon-btn--ghost"
                    onClick={() => onPlay(it.song, resumePos)}
                    aria-label={resumePos > 0 ? `续播 ${it.song.title}` : `播放 ${it.song.title}`}
                    title={resumePos > 0 ? `从上次进度续播（${fmt(resumePos)}）` : '播放'}
                  >
                    <MusicIcon />
                  </button>
                  <button
                    type="button"
                    className="icon-btn icon-btn--ghost"
                    onClick={() => onRemove(it.key)}
                    aria-label={`从播放记录移除 ${it.song.title}`}
                    title="移除这条记录"
                  >
                    <CloseIcon />
                  </button>
                </div>
              </div>
            );
          })}
        </div>
      </aside>
    </>
  );
}
