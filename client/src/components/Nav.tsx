interface NavProps {
  downloadCount: number;
  onToggleDownloads: () => void;
}

export default function Nav({ downloadCount, onToggleDownloads }: NavProps) {
  return (
    <nav className="nav-pill" aria-label="主导航">
      <span className="wordmark">
        聚合音乐
        <span className="wordmark__kicker">Resonate</span>
      </span>
      <span className="nav-pill__spacer" />
      <button
        type="button"
        className="nav-pill__btn"
        onClick={onToggleDownloads}
        aria-label={`打开下载队列，共 ${downloadCount} 项`}
      >
        下载队列
        {downloadCount > 0 && <span className="nav-pill__count">{downloadCount}</span>}
      </button>
    </nav>
  );
}
