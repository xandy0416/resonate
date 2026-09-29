import { useEffect } from 'react';
import type { Platform } from '../types';
import { CloseIcon, TrashIcon } from './Icons';

interface SettingsDrawerProps {
  open: boolean;
  onClose: () => void;
  resultLimit: number;
  onResultLimitChange: (n: number) => void;
  platforms: Platform[];
  downloadCount: number;
  historyCount: number;
  onClearDownloads: () => void;
  onClearHistory: () => void;
}

const LIMIT_OPTIONS = [30, 60, 100, 200];

export default function SettingsDrawer({
  open,
  onClose,
  resultLimit,
  onResultLimitChange,
  platforms,
  downloadCount,
  historyCount,
  onClearDownloads,
  onClearHistory,
}: SettingsDrawerProps) {
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
        aria-label="设置"
        aria-hidden={!open}
      >
        <div className="drawer__head">
          <span className="drawer__title">设置</span>
          <button type="button" className="icon-btn icon-btn--ghost" onClick={onClose} aria-label="关闭">
            <CloseIcon />
          </button>
        </div>

        <div className="drawer__body">
          <section className="set-group">
            <h3 className="set-group__title">搜索</h3>
            <div className="set-row">
              <div className="set-row__text">
                <span className="set-row__label">返回数量</span>
                <span className="set-row__hint">每次搜索最多返回多少条结果（数量越大解析越慢）。</span>
              </div>
              <div className="set-row__control">
                <select
                  className="set-select"
                  value={resultLimit}
                  onChange={(e) => onResultLimitChange(Number(e.target.value))}
                  aria-label="搜索返回数量"
                >
                  {LIMIT_OPTIONS.map((n) => (
                    <option key={n} value={n}>{n} 条</option>
                  ))}
                </select>
              </div>
            </div>
          </section>

          <section className="set-group">
            <h3 className="set-group__title">记录</h3>
            <div className="set-row">
              <div className="set-row__text">
                <span className="set-row__label">播放记录</span>
                <span className="set-row__hint">共 {historyCount} 条，保存在本机浏览器中。</span>
              </div>
              <div className="set-row__control">
                <button
                  type="button"
                  className="set-btn"
                  onClick={onClearHistory}
                  disabled={historyCount === 0}
                >
                  <TrashIcon />
                  清空
                </button>
              </div>
            </div>
            <div className="set-row">
              <div className="set-row__text">
                <span className="set-row__label">下载记录</span>
                <span className="set-row__hint">共 {downloadCount} 条，保存在本机浏览器中。</span>
              </div>
              <div className="set-row__control">
                <button
                  type="button"
                  className="set-btn"
                  onClick={onClearDownloads}
                  disabled={downloadCount === 0}
                >
                  <TrashIcon />
                  清空
                </button>
              </div>
            </div>
          </section>

          <section className="set-group">
            <h3 className="set-group__title">音源接入</h3>
            <div className="set-row set-row--stack">
              <div className="set-row__text">
                <span className="set-row__label">已接入平台</span>
                <span className="set-row__hint">单曲统一由 Solara 解析为 FLAC，歌单/歌手/专辑取自网易云。</span>
              </div>
              <ul className="set-list">
                {platforms.length === 0 && <li className="set-list__item">正在获取…</li>}
                {platforms.filter((p) => p.connected).map((p) => (
                  <li className="set-list__item" key={p.id}>
                    <span>{p.name}</span>
                    <span className={`set-dot${p.connected ? ' set-dot--ok' : ''}`}>
                      {p.connected ? '已接入' : '未接入'}
                    </span>
                  </li>
                ))}
              </ul>
            </div>
          </section>
        </div>
      </aside>
    </>
  );
}
