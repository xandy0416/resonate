import { useEffect, useState } from 'react';
import type { Platform } from '../types';
import { deepHealth, type DeepHealth } from '../api';
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
  downloadMode: 'nas' | 'local';
  onDownloadModeChange: (m: 'nas' | 'local') => void;
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
  downloadMode,
  onDownloadModeChange,
}: SettingsDrawerProps) {
  useEffect(() => {
    if (!open) return;
    const onKey = (e: KeyboardEvent) => { if (e.key === 'Escape') onClose(); };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [open, onClose]);

  // 连接自检：真实请求后端探活，定位「搜不到歌」的网络层原因。
  const [diag, setDiag] = useState<DeepHealth | null>(null);
  const [diagLoading, setDiagLoading] = useState(false);
  const [diagError, setDiagError] = useState('');

  async function runDiag() {
    setDiagLoading(true);
    setDiagError('');
    try {
      setDiag(await deepHealth());
    } catch (e) {
      setDiag(null);
      setDiagError(e instanceof Error ? e.message : '自检请求失败');
    } finally {
      setDiagLoading(false);
    }
  }

  const diagRows: { label: string; ok: boolean; detail: string }[] = [];
  if (diag) {
    const d = diag.deep;
    diagRows.push({
      label: '公网连通',
      ok: d.internet.ok,
      detail: d.internet.ok ? `HTTP ${d.internet.status} · ${d.internet.ms}ms` : d.internet.error || '失败',
    });
    diagRows.push({
      label: '网易云搜索',
      ok: d.adapters.netease.ok,
      detail: d.adapters.netease.ok
        ? `${d.adapters.netease.sample ?? 0} 条命中${d.adapters.netease.total != null ? ` / 共 ${d.adapters.netease.total}` : ''} · ${d.adapters.netease.ms}ms`
        : d.adapters.netease.error || '失败',
    });
    diagRows.push({
      label: '曲库跳板',
      ok: d.adapters.solara.ok,
      detail: d.adapters.solara.ok
        ? `${d.adapters.solara.sample ?? 0} 条命中 · ${d.adapters.solara.ms}ms`
        : d.adapters.solara.error || '失败',
    });
    for (const x of d.dns) {
      diagRows.push({
        label: `DNS ${x.host}`,
        ok: x.ok,
        detail: x.ok ? `${x.address} · ${x.ms}ms` : x.error || '失败',
      });
    }
  }

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
            <h3 className="set-group__title">下载</h3>
            <div className="set-row">
              <div className="set-row__text">
                <span className="set-row__label">下载方式</span>
                <span className="set-row__hint">保存到 NAS：文件直接写入服务器挂载目录（默认 /data/music），可被 SMB / Emby / Plex 直接扫描；下载到本机：由浏览器下载到当前设备。</span>
              </div>
              <div className="set-row__control">
                <select
                  className="set-select"
                  value={downloadMode}
                  onChange={(e) => onDownloadModeChange(e.target.value as 'nas' | 'local')}
                  aria-label="下载方式"
                >
                  <option value="nas">保存到 NAS</option>
                  <option value="local">下载到本机</option>
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

          <section className="set-group">
            <h3 className="set-group__title">连接自检</h3>
            <div className="set-row set-row--stack">
              <div className="set-row__text">
                <span className="set-row__label">音源连通性</span>
                <span className="set-row__hint">真实请求各音乐源（DNS 解析 / 公网连通 / 上游搜索），定位「搜不到歌」是网络还是上游问题。</span>
              </div>
              <div className="set-row__control">
                <button type="button" className="set-btn" onClick={runDiag} disabled={diagLoading}>
                  {diagLoading ? '检测中…' : '开始自检'}
                </button>
              </div>
              {diagError && <p className="set-diag set-diag--bad">自检失败：{diagError}</p>}
              {diag && (
                <div className="set-diag-block">
                  <p className={`set-diag${diag.deep.allOk ? ' set-diag--ok' : ' set-diag--bad'}`}>
                    {diag.deep.allOk ? '全部正常' : '检测到问题'}
                  </p>
                  {diag.deep.verdict.map((v, i) => (
                    <p className="set-diag__line" key={`v${i}`}>{v}</p>
                  ))}
                  <ul className="set-list">
                    {diagRows.map((r) => (
                      <li className="set-list__item" key={r.label}>
                        <span>{r.label}</span>
                        <span className={`set-dot${r.ok ? ' set-dot--ok' : ''}`}>{r.detail}</span>
                      </li>
                    ))}
                  </ul>
                </div>
              )}
            </div>
          </section>
        </div>
      </aside>
    </>
  );
}
