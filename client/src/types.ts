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
  resolveFailed?: boolean; // 按需解析尝试过且失败（无可用音源）
  pending?: boolean; // 详情整体超时截断，尚未解析（点击播放 / 下载时再按需解析）
  reason?: string; // 未解析 / 无音源的原因说明
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
  // 上游服务不可达时的降级标记与真实原因（避免与「真的没结果」混淆）。
  degraded?: boolean;
  reason?: string;
  // 曲库跳板（FLAC 源）暂不可达，已降级为网易云直连（MP3）。
  solaraDown?: boolean;
}

export interface PlaylistDetail extends Playlist {
  songs: Song[];
  resolvedCount?: number; // 已解析出 FLAC 的曲目数
  totalCount?: number; // 歌单实际曲目数（解析到的）
}

// 通用「曲目集合」详情：歌单 / 歌手 / 专辑 共用，点开后统一展示 FLAC 曲目。
export interface CollectionDetail {
  name: string;
  cover: string;
  subtitle: string; // 副标题，如「创建者 xxx · N 首」或「周杰伦 · 2000」
  count: number;
  resolvedCount?: number; // 已解析出直链的曲目数（含降级为 MP3 的）
  flacCount?: number; // 其中真正拿到 FLAC 的曲目数
  mp3Count?: number; // 降级为 MP3 的曲目数
  pendingCount?: number; // 因整体超时尚未解析的曲目数（点击时再按需解析）
  noSrcCount?: number; // 无可用音源的曲目数
  totalCount?: number;
  owner?: string; // 歌单创建者（仅歌单有）
  songs: Song[];
}

export type ResultTab = 'song' | 'playlist' | 'artist' | 'album';

// 抽屉标签页类型：歌单 / 歌手 / 专辑 / 分享链接导入
export type CollectionKind = 'playlist' | 'artist' | 'album' | 'import';

// 抽屉中的一个标签页：对应一个「曲目集合」详情（歌单/歌手/专辑/导入）。
// 多个标签可同时打开，互不干扰，各自独立加载、各自独立批量选择。
export interface DrawerTab {
  id: string;          // 唯一标签 id
  kind: CollectionKind;
  key: string;         // 去重键：platform-id / url，避免同一集合重复开标签
  title: string;       // 标签标题（加载后用真实名覆盖）
  cover?: string;      // 标签缩略图（加载后填充）
  loading: boolean;
  detail: CollectionDetail | null;
  error?: string; // 加载失败原因（用于抽屉内显示错误态并重试，而非无声空白）
  loader: () => Promise<CollectionDetail>; // 加载函数，retry 时复用
}
