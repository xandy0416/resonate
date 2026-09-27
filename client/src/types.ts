export interface Platform {
  id: string;
  name: string;
  connected: boolean;
}

export interface Song {
  id: string;
  platform: string;
  title: string;
  artist: string;
  album: string;
  duration: number; // 毫秒
  cover: string;
  size: number | null; // 字节
  format: string | null;
  br: number | null; // kbps
  src?: string; // 原始音源（Solara 跳板用，用于取直链）
  flac?: boolean; // 是否为 FLAC 高质量
  fromPlatform?: string; // 发现来源平台（网易云 / 汽水等）
}

export interface Playlist {
  id: string;
  platform: string;
  name: string;
  cover: string;
  owner: string;
  count: number;
  description?: string;
}

export interface Artist {
  id: string;
  platform: string;
  name: string;
  avatar: string;
  alias: string;
  albumCount: number;
  songCount: number;
}

export interface Album {
  id: string;
  platform: string;
  name: string;
  artist: string;
  cover: string;
  publishYear: string;
  count: number;
}

export interface SearchResults {
  songs: Song[];
  playlists: Playlist[];
  artists: Artist[];
  albums: Album[];
}

export interface PlaylistDetail extends Playlist {
  songs: Song[];
  resolvedCount?: number; // 已解析出 FLAC 的曲目数
  totalCount?: number; // 歌单实际曲目数（解析到的）
}

export type ResultTab = 'song' | 'artist' | 'album';
