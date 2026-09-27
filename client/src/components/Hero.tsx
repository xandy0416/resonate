import { SearchIcon } from './Icons';

interface HeroProps {
  query: string;
  onQueryChange: (v: string) => void;
  onSearch: () => void;
  loading: boolean;
}

export default function Hero({
  query,
  onQueryChange,
  onSearch,
  loading,
}: HeroProps) {
  return (
    <header className="hero shell">
      <h1 className="hero__display">全网音乐，一处搜尽。</h1>
      <p className="hero__sub">
        输入歌曲、歌手或专辑名称，自动跨平台聚合搜索；也可粘贴任意平台的歌单分享地址，一键导入并解析为 FLAC 无损。
      </p>

      <div className="search">
        <form
          className="search__bar"
          onSubmit={(e) => {
            e.preventDefault();
            onSearch();
          }}
        >
          <input
            className="search__input"
            type="search"
            value={query}
            onChange={(e) => onQueryChange(e.target.value)}
            placeholder="搜索歌曲 / 歌手 / 专辑，或粘贴歌单分享链接"
            aria-label="搜索关键词"
            enterKeyHint="search"
          />
          <button
            type="submit"
            className="search__submit"
            disabled={loading || !query.trim()}
          >
            {loading ? <span className="spinner" /> : <SearchIcon />}
            搜索
          </button>
        </form>

        <p className="hero__hint">
          支持粘贴各平台歌单分享地址（网易云、汽水、QQ、酷狗、咪咕等）：系统自动识别平台并解析曲目，
          再统一为你转成 FLAC 无损，提供播放与下载。
        </p>
      </div>
    </header>
  );
}
