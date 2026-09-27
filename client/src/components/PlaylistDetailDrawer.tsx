import { useEffect } from 'react';
import type { PlaylistDetail as PlaylistDetailType, Song } from '../types';
import SongRow from './SongRow';
import { CloseIcon } from './Icons';

interface DrawerProps {
  open: boolean;
  loading: boolean;
  detail: PlaylistDetailType | null;
  playingId: string | null;
  downloadingId: string | null;
  onClose: () => void;
  onPlaySong: (s: Song) => void;
  onDownloadSong: (s: Song) => void;
}

export default function PlaylistDetailDrawer({
  open, loading, detail, playingId, downloadingId,
  onClose, onPlaySong, onDownloadSong,
}: DrawerProps) {
  useEffect(() => {
    if (!open) return;
    const onKey = (e: KeyboardEvent) => { if (e.key === 'Escape') onClose(); };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [open, onClose]);

  return (
    <>
      <div
        className={`scrim${open ? ' open' : ''}`}
        onClick={onClose}
        aria-hidden
      />
      <aside
        className={`drawer${open ? ' open' : ''}`}
        role="dialog"
        aria-modal="true"
        aria-label={detail?.name || '歌单详情'}
        aria-hidden={!open}
      >
        <div className="drawer__head">
          <span className="drawer__title">{detail?.name || '歌单详情'}</span>
          <button type="button" className="icon-btn icon-btn--ghost" onClick={onClose} aria-label="关闭">
            <CloseIcon />
          </button>
        </div>

        <div className="drawer__body">
          {loading && <div className="skeleton sk-row" style={{ height: 96 }} />}
          {!loading && detail && (
            <>
              <div className="drawer__hero">
                <img
                  className="drawer__cover"
                  src={detail.cover || ''}
                  alt=""
                  onError={(e) => { (e.currentTarget as HTMLImageElement).style.visibility = 'hidden'; }}
                />
                <div className="drawer__meta">
                  <h3>{detail.name}</h3>
                  <p>创建者 {detail.owner || '未知'} · {detail.count} 首</p>
                  {detail.description && <p className="drawer__desc">{detail.description}</p>}
                </div>
              </div>

              <div className="song-list">
                {detail.songs.map((s) => (
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
            </>
          )}
        </div>
      </aside>
    </>
  );
}
