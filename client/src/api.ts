import type {
  Platform,
  SearchResults,
  CollectionDetail,
} from './types';

const BASE = '/api';

async function get<T>(url: string): Promise<T> {
  const res = await fetch(url);
  if (!res.ok) {
    let msg = `请求失败（${res.status}）`;
    try {
      const body = await res.json();
      if (body?.error) msg = body.error;
    } catch { /* ignore */ }
    throw new Error(msg);
  }
  return res.json() as Promise<T>;
}

export function fetchPlatforms(): Promise<Platform[]> {
  return get<Platform[]>(`${BASE}/platforms`);
}

export function search(q: string, type = 'all', limit?: number): Promise<SearchResults> {
  const params = new URLSearchParams({ q, type });
  // 不再传 platforms：后端自动跨平台聚合搜索，并把单曲统一解析为 FLAC。
  if (limit) params.set('limit', String(limit));
  return get<SearchResults>(`${BASE}/search?${params.toString()}`);
}

export function fetchPlaylistDetail(
  platform: string,
  id: string
): Promise<CollectionDetail> {
  return get<CollectionDetail>(
    `${BASE}/playlist/detail?platform=${encodeURIComponent(platform)}&id=${encodeURIComponent(id)}`
  );
}

// 歌手详情：返回该歌手的曲目（统一解析为 FLAC 后展示）。
export function fetchArtistSongs(
  platform: string,
  id: string,
  name = ''
): Promise<CollectionDetail> {
  const params = new URLSearchParams({ platform, id });
  if (name) params.set('name', name);
  return get<CollectionDetail>(`${BASE}/artist/detail?${params.toString()}`);
}

// 专辑详情：返回该专辑的曲目（统一解析为 FLAC 后展示）。
export function fetchAlbumSongs(
  platform: string,
  id: string,
  name = ''
): Promise<CollectionDetail> {
  const params = new URLSearchParams({ platform, id });
  if (name) params.set('name', name);
  return get<CollectionDetail>(`${BASE}/album/detail?${params.toString()}`);
}

// 歌单分享地址导入：识别平台 → 解析曲目 → 统一解析 FLAC。
export function importPlaylist(url: string): Promise<CollectionDetail> {
  return get<CollectionDetail>(`${BASE}/playlist/import?url=${encodeURIComponent(url)}`);
}

// 播放：直接返回可流式播放的地址（后端代理）。
export function playUrl(platform: string, id: string, src?: string): string {
  const p = new URLSearchParams({ platform, id });
  if (src) p.set('src', src);
  return `${BASE}/play?${p.toString()}`;
}

// 按需解析单曲直链信息：把 netease id 经 Solara 跳板解析为完整 FLAC 直链。
// 用于「搜索只聚合、点击时再取链」的按需解析模式。
export interface SongUrlInfo {
  url: string;
  size: number | null;
  br: number | null;
  format: string | null;
}
export function resolveSongUrl(id: string): Promise<SongUrlInfo> {
  return get<SongUrlInfo>(
    `${BASE}/song/url?platform=solara&src=netease&id=${encodeURIComponent(id)}`
  );
}

// 下载：返回带附件头的代理地址，交给浏览器保存。
export function downloadUrl(platform: string, id: string, title: string, src?: string): string {
  const p = new URLSearchParams({ platform, id, title });
  if (src) p.set('src', src);
  return `${BASE}/download?${p.toString()}`;
}

// 工具：毫秒 → m:ss
export function formatDuration(ms: number): string {
  if (!ms || ms < 0) return '—';
  const total = Math.round(ms / 1000);
  const m = Math.floor(total / 60);
  const s = total % 60;
  return `${m}:${s.toString().padStart(2, '0')}`;
}

// 工具：字节 → MB/GB
export function formatSize(bytes: number | null): string {
  if (bytes == null) return '—';
  if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(0)} KB`;
  return `${(bytes / 1024 / 1024).toFixed(1)} MB`;
}
