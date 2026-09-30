import { SearchIcon } from './Icons';

interface HeroProps {
  query: string;
  onQueryChange: (v: string) => void;
  onSearch: () => void;
  loading: boolean;
  sources: { id: string; name: string }[];
  selectedSources: string[];
  onToggleSource: (id: string) => void;
}

export default function Hero({
  query,
  onQueryChange,
  onSearch,
  loading,
  sources,
  selectedSources,
  onToggleSource,
}: HeroProps) {
  return (
    <header className="hero shell">
      <h1 className="hero__display">你的音乐收藏，一处汇聚。</h1>
      <p className="hero__sub">
        输入歌曲、歌单、歌手或专辑名称，自动跨平台聚合搜索；也可粘贴任意平台的歌单分享地址，一键导入并解析为可播放音源。
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

        {sources.length > 0 && (
          <div className="source-toggles" role="group" aria-label="选择搜索的音乐源">
            <span className="source-toggles__label">搜索源</span>
            {sources.map((s) => {
              const active = selectedSources.includes(s.id);
              return (
                <button
                  key={s.id}
                  type="button"
                  className={active ? 'source-chip source-chip--on' : 'source-chip'}
                  aria-pressed={active}
                  onClick={() => onToggleSource(s.id)}
                >
                  {s.name}
                </button>
              );
            })}
          </div>
        )}
      </div>
    </header>
  );
}
