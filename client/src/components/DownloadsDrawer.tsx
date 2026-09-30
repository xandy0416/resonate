import { useEffect } from 'react';
import { CloseIcon, TrashIcon } from './Icons';

export interface DownloadItem {
  id: string;
  title: string;
  status: '下载中' | '已完成' | '已保存' | '已存在' | '保存失败';
  at: number; // 时间戳（毫秒）
  songId?: string; // 对应曲目 id，用于批量下载完成后统一标记（旧记录无此字段）
}

interface DownloadsDrawerProps {
  open: boolean;
  items: DownloadItem[];
  onClose: () => void;
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

export default function DownloadsDrawer({ open, items, onClose, onClear }: DownloadsDrawerProps) {
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
        aria-label="下载记录"
        aria-hidden={!open}
      >
        <div className="drawer__head">
          <span className="drawer__title">下载记录</span>
          <div className="drawer__actions">
            {items.length > 0 && (
              <button
                type="button"
                className="icon-btn icon-btn--ghost"
                onClick={onClear}
                aria-label="清空下载记录"
                title="清空下载记录"
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
            <p className="empty__hint">还没有下载任务。在单曲或歌单里点击下载按钮即可加入队列。</p>
          )}
          {items.map((it) => (
            <div className="dl-item" key={it.id}>
              <div className="dl-item__main">
                <span className="dl-item__title">{it.title}</span>
                {/* 旧版本保存的记录没有 at 字段，回退到当前时间，避免出现 Invalid Date */}
                <span className="dl-item__time">{relTime(typeof it.at === 'number' ? it.at : Date.now())}</span>
              </div>
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
