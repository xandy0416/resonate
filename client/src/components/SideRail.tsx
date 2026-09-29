import type { ReactElement } from 'react';
import { DownloadIcon, HistoryIcon, SettingsIcon } from './Icons';

export type RailPanel = 'downloads' | 'history' | 'settings';

interface SideRailProps {
  active: RailPanel | null;
  onToggle: (panel: RailPanel) => void;
  downloadCount: number;
  historyCount: number;
}

/**
 * 右侧边缘悬浮图标栏：把所有「记录 / 配置」入口收进一列图标里，
 * 悬浮或聚焦时展开文字说明，避免占用顶部导航和正文宽度。
 */
export default function SideRail({
  active,
  onToggle,
  downloadCount,
  historyCount,
}: SideRailProps) {
  const items: {
    key: RailPanel;
    label: string;
    icon: ReactElement;
    count: number;
  }[] = [
    { key: 'downloads', label: '下载记录', icon: <DownloadIcon />, count: downloadCount },
    { key: 'history', label: '播放记录', icon: <HistoryIcon />, count: historyCount },
    { key: 'settings', label: '设置', icon: <SettingsIcon />, count: 0 },
  ];

  return (
    <aside className="rail" aria-label="侧边工具与设置">
      {items.map((it) => (
        <button
          key={it.key}
          type="button"
          className={`rail__btn${active === it.key ? ' rail__btn--active' : ''}`}
          onClick={() => onToggle(it.key)}
          aria-label={it.label}
          aria-pressed={active === it.key}
        >
          <span className="rail__icon">{it.icon}</span>
          {it.count > 0 && <span className="rail__badge">{it.count > 99 ? '99+' : it.count}</span>}
          <span className="rail__tip">{it.label}</span>
        </button>
      ))}
    </aside>
  );
}
