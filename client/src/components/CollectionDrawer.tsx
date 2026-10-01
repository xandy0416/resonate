import { useCallback, useEffect, useRef, useState } from 'react';
import type { CollectionDetail, DrawerTab, Song } from '../types';
import SongRow from './SongRow';
import { CloseIcon } from './Icons';

function Chevron({ dir }: { dir: 'left' | 'right' }) {
  return (
    <svg
      viewBox="0 0 24 24"
      fill="none"
      stroke="currentColor"
      strokeWidth={2.4}
      strokeLinecap="round"
      strokeLinejoin="round"
      aria-hidden="true"
    >
      {dir === 'left' ? (
        <polyline points="15 5 8 12 15 19" />
      ) : (
        <polyline points="9 5 16 12 9 19" />
      )}
    </svg>
  );
}

interface DrawerProps {
  open: boolean;
  tabs: DrawerTab[];
  activeTabId: string | null;
  playingId: string | null;
  downloadingIds: Set<string>;
  onSelectTab: (id: string) => void;
  onCloseTab: (id: string) => void;
  onCloseAll: () => void;
  onPlaySong: (s: Song) => void;
  onDownloadSong: (s: Song) => void;
  onDownloadSongs: (songs: Song[]) => void;
  /** 当前标签「重新解析」：上游限流多为偶发，保留一次主动重试入口 */
  onRetryActive?: () => void;
}

export default function CollectionDrawer({
  open, tabs, activeTabId, playingId, downloadingIds,
  onSelectTab, onCloseTab, onCloseAll,
  onPlaySong, onDownloadSong, onDownloadSongs, onRetryActive,
}: DrawerProps) {
  // Esc 关闭整个抽屉（全部标签）
  useEffect(() => {
    if (!open) return;
    const onKey = (e: KeyboardEvent) => { if (e.key === 'Escape') onCloseAll(); };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [open, onCloseAll]);

  // 标签条横向箭头：标签过多时不显示滚动条，改用左右箭头点击切换。
  const viewportRef = useRef<HTMLDivElement>(null);
  const [canLeft, setCanLeft] = useState(false);
  const [canRight, setCanRight] = useState(false);
  const updateArrows = useCallback(() => {
    const vp = viewportRef.current;
    if (!vp) return;
    const maxScroll = vp.scrollWidth - vp.clientWidth;
    setCanLeft(vp.scrollLeft > 1);
    setCanRight(vp.scrollLeft < maxScroll - 1);
  }, []);
  const scrollByLeft = () => {
    const vp = viewportRef.current;
    if (!vp) return;
    vp.scrollBy({ left: -Math.max(140, vp.clientWidth * 0.8), behavior: 'smooth' });
  };
  const scrollByRight = () => {
    const vp = viewportRef.current;
    if (!vp) return;
    vp.scrollBy({ left: Math.max(140, vp.clientWidth * 0.8), behavior: 'smooth' });
  };
  const ensureTabVisible = useCallback((id: string) => {
    const vp = viewportRef.current;
    if (!vp) return;
    const el = vp.querySelector<HTMLElement>(`[data-tab-id="${id}"]`);
    if (!el) return;
    const left = el.offsetLeft;
    const right = left + el.offsetWidth;
    if (left < vp.scrollLeft) vp.scrollTo({ left, behavior: 'smooth' });
    else if (right > vp.scrollLeft + vp.clientWidth) vp.scrollTo({ left: right - vp.clientWidth, behavior: 'smooth' });
  }, []);
  const handleSelectTab = (id: string) => {
    onSelectTab(id);
    requestAnimationFrame(() => ensureTabVisible(id));
  };
  useEffect(() => {
    updateArrows();
    if (activeTabId) ensureTabVisible(activeTabId);
  }, [tabs.length, activeTabId, open, updateArrows, ensureTabVisible]);
  useEffect(() => {
    const onResize = () => updateArrows();
    window.addEventListener('resize', onResize);
    return () => window.removeEventListener('resize', onResize);
  }, [updateArrows]);

  // 每个标签页独立的批量选择态，按 tab id 隔离；切换标签互不干扰。
  const [selection, setSelection] = useState<Record<string, Set<string>>>({});
  const active = tabs.find((t) => t.id === activeTabId) || null;
  const detail: CollectionDetail | null = active?.detail ?? null;
  const loading = active?.loading ?? false;

  const selIds = (activeTabId && selection[activeTabId]) || new Set<string>();
  const setActiveSel = (fn: (prev: Set<string>) => Set<string>) =>
    setSelection((prev) => {
      const id = activeTabId ?? '';
      const n = fn(prev[id] || new Set<string>());
      return { ...prev, [id]: n };
    });

  const songs = detail?.songs || [];
  // 可选 = 尚未确认无音源的曲目：未解析（点击时实时取直链）与已解析的都可勾选、可批量下载；
  // 仅「已确认无音源」(resolveFailed=true) 才真正不可选。
  const selectableSongs = songs.filter((s) => !s.resolveFailed);
  const selectableIds = selectableSongs.map((s) => s.id);
  const allSelected = selectableIds.length > 0 && selectableIds.every((id) => selIds.has(id));
  const selectedSongs = songs.filter((s) => selIds.has(s.id));
  const toggleSelectOne = (id: string) =>
    setActiveSel((prev) => {
      const n = new Set(prev);
      if (n.has(id)) n.delete(id);
      else n.add(id);
      return n;
    });
  const toggleAll = () =>
    setActiveSel((prev) => {
      const n = new Set(prev);
      if (allSelected) selectableIds.forEach((id) => n.delete(id));
      else selectableIds.forEach((id) => n.add(id));
      return n;
    });
  const total = detail?.totalCount ?? detail?.count ?? songs.length;
  const flacCount = detail?.flacCount ?? songs.filter((s) => s.flac).length;
  const mp3Count = songs.filter((s) => !s.flac && !!s.format).length;
  // 待解析（详情整体超时截断，点击播放/下载时再按需解析）与「确认无音源」分开统计，
  // 避免把「没来得及解析」误显示成「没有音源」。
  const pendingCount = detail?.pendingCount ?? songs.filter((s) => s.pending).length;
  const noSource = Math.max(0, total - flacCount - mp3Count - pendingCount);
  const incomplete = !!detail && songs.length > 0 && (flacCount < total || pendingCount > 0);
  const error = active?.error;

  return (
    <aside
      className={`drawer${open ? ' open' : ''}`}
      role="dialog"
      aria-label="歌单 / 歌手 / 专辑"
      aria-hidden={!open}
    >
      {/* 标签条：左右箭头点击切换 + 视口（不显示滚动条）；「关闭全部」用叉叉图标 */}
      <div className="drawer__tabs" role="tablist" aria-label="已打开的歌单 / 歌手 / 专辑">
        <button
          type="button"
          className="dtab__nav dtab__nav--left"
          aria-label="向左切换标签"
          disabled={!canLeft}
          onClick={scrollByLeft}
        >
          <Chevron dir="left" />
        </button>
        <div className="drawer__tabs-viewport" ref={viewportRef} onScroll={updateArrows}>
          {tabs.map((t) => (
            <div
              key={t.id}
              data-tab-id={t.id}
              className={`dtab${t.id === activeTabId ? ' dtab--active' : ''}`}
              role="tab"
              aria-selected={t.id === activeTabId}
              onClick={() => handleSelectTab(t.id)}
              title={t.title}
            >
              {t.cover ? (
                <img
                  className="dtab__cover"
                  src={t.cover}
                  alt=""
                  onError={(e) => { (e.currentTarget as HTMLImageElement).style.visibility = 'hidden'; }}
                />
              ) : (
                <span className="dtab__cover dtab__cover--ph" aria-hidden="true" />
              )}
              <span className="dtab__name">{t.title}</span>
              {t.loading && <span className="dtab__spin" aria-hidden="true" />}
              <button
                type="button"
                className="dtab__close"
                aria-label="关闭此标签"
                onClick={(e) => { e.stopPropagation(); onCloseTab(t.id); }}
              >
                <CloseIcon />
              </button>
            </div>
          ))}
        </div>
        <button
          type="button"
          className="dtab__nav dtab__nav--right"
          aria-label="向右切换标签"
          disabled={!canRight}
          onClick={scrollByRight}
        >
          <Chevron dir="right" />
        </button>
        {tabs.length > 1 && (
          <button type="button" className="dtab__closeall" onClick={onCloseAll} aria-label="关闭全部标签" title="关闭全部标签">
            <CloseIcon />
          </button>
        )}
      </div>

      <div className="drawer__body">
        {loading && <div className="skeleton sk-row" style={{ height: 96 }} />}
        {!loading && !detail && error && (
          <div className="drawer__error">
            <p className="drawer__error-title">加载失败</p>
            <p className="drawer__error-msg">{error}</p>
            {onRetryActive && (
              <button type="button" className="set-btn set-btn--primary" onClick={onRetryActive}>
                重试
              </button>
            )}
          </div>
        )}
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
                <p>{detail.subtitle || `${detail.count} 首`}</p>
              </div>
            </div>

            {incomplete && (
              <div className="drawer__note">
                <span className="drawer__note-text">
                  共 {total} 首：FLAC {flacCount} 首
                  {mp3Count > 0 ? ` · MP3 ${mp3Count} 首` : ''}
                  {pendingCount > 0 ? ` · 待解析 ${pendingCount} 首（点击播放 / 下载时自动解析）` : ''}
                  {noSource > 0 ? ` · 暂无音源 ${noSource} 首（音源限流或曲库未收录）` : ''}。
                </span>
                {onRetryActive && noSource > 0 && (
                  <button type="button" className="drawer__retry" onClick={onRetryActive} disabled={loading}>
                    重新解析
                  </button>
                )}
              </div>
            )}

            <div className="batch-bar">
              <label className="batch-bar__check">
                <input
                  type="checkbox"
                  checked={allSelected}
                  onChange={toggleAll}
                  disabled={selectableIds.length === 0}
                />
                <span>全选</span>
              </label>
              <span className="batch-bar__count">已选 {selectedSongs.length} / 可选 {selectableSongs.length}</span>
              <div className="batch-bar__actions">
                <button
                  type="button"
                  className="set-btn"
                  onClick={() => onDownloadSongs(selectableSongs)}
                  disabled={selectableSongs.length === 0}
                >
                  下载全部 ({selectableSongs.length})
                </button>
                <button
                  type="button"
                  className="set-btn set-btn--primary"
                  onClick={() => onDownloadSongs(selectedSongs)}
                  disabled={selectedSongs.length === 0}
                >
                  下载选中 ({selectedSongs.length})
                </button>
              </div>
            </div>

            <div className="song-list">
              {detail.songs.map((s, i) => (
                <SongRow
                  key={`${s.platform}-${s.id}-${i}`}
                  song={s}
                  isPlaying={playingId === s.id}
                  isDownloading={downloadingIds.has(s.id)}
                  selectable
                  selected={selIds.has(s.id)}
                  onToggleSelect={() => toggleSelectOne(s.id)}
                  onPlay={() => onPlaySong(s)}
                  onDownload={() => onDownloadSong(s)}
                />
              ))}
            </div>
          </>
        )}
      </div>
    </aside>
  );
}
