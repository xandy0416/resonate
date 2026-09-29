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
        输入歌曲、歌单、歌手或专辑名称，自动跨平台聚合搜索；也可粘贴任意平台的歌单分享地址，一键导入并解析为 FLAC 无损。
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
            placeholder="搜索歌曲 / 歌单 / 歌手 / 专辑，或粘贴歌单分享链接"
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
      </div>
    </header>
  );
}
