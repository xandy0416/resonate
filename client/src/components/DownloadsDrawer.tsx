import { useEffect } from 'react';
import { CloseIcon } from './Icons';

export interface DownloadItem {
  id: string;
  title: string;
  status: '下载中' | '已完成';
}

interface DownloadsDrawerProps {
  open: boolean;
  items: DownloadItem[];
  onClose: () => void;
}

export default function DownloadsDrawer({ open, items, onClose }: DownloadsDrawerProps) {
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
        aria-label="下载队列"
        aria-hidden={!open}
      >
        <div className="drawer__head">
          <span className="drawer__title">下载队列</span>
          <button type="button" className="icon-btn icon-btn--ghost" onClick={onClose} aria-label="关闭">
            <CloseIcon />
          </button>
        </div>
        <div className="drawer__body">
          {items.length === 0 && (
            <p className="empty__hint">还没有下载任务。在单曲或歌单里点击下载按钮即可加入队列。</p>
          )}
          {items.map((it) => (
            <div className="dl-item" key={it.id}>
              <span className="dl-item__title">{it.title}</span>
              <span className={`dl-item__status${it.status === '已完成' ? ' dl-item__status--ok' : ''}`}>
                {it.status}
              </span>
            </div>
          ))}
        </div>
      </aside>
    </>
  );
}
