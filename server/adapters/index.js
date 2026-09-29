// 平台适配器注册表。
// 真实接入：netease（见 netease.js）、qishui（汽水音乐）、solara（曲库跳板）、
//   qq（QQ 音乐，作为「歌单来源」已接入）、
//   migu（咪咕音乐，作为「歌单来源」已接入：见 playlist-import.js 的 parseMigu / miguSearchPlaylists）。
// 占位：kugou —— 接口尚未接入，统一返回“未接入”状态。
// 注：qq / migu 仅提供歌单导入/搜索（曲目来源），单曲直链统一走 Solara。

import { neteaseAdapter } from './netease.js';
import { qishuiAdapter } from './qishui.js';
import { solaraAdapter } from './solara.js';

function makeStub({ id, name }) {
  const notConnected = () => {
    const err = new Error(`平台「${name}」适配器尚未接入`);
    err.code = 'NOT_CONNECTED';
    return err;
  };
  return {
    id,
    name,
    connected: false,
    async search() {
      return { songs: [], playlists: [], artists: [], albums: [], _unavailable: true };
    },
    async songUrl() { throw notConnected(); },
    async playlistDetail() { throw notConnected(); },
    async rawUrl() { throw notConnected(); },
  };
}

// 已接入的「歌单来源」平台：仅提供歌单导入/搜索（曲目来源），
// 单曲直链统一走 Solara，因此 search 返回空、songUrl 显式提示，避免误导。
function makeConnectedSource({ id, name }) {
  const notSupported = (msg) => {
    const err = new Error(msg);
    err.code = 'NOT_SUPPORTED';
    return err;
  };
  return {
    id,
    name,
    connected: true,
    async search() {
      return { songs: [], playlists: [], artists: [], albums: [], _unavailable: true };
    },
    async songUrl() {
      throw notSupported(`${name} 单曲直链由 Solara 统一解析，无需本平台直链`);
    },
    async playlistDetail() {
      throw notSupported(`${name} 歌单请通过「分享链接导入」解析`);
    },
    async rawUrl() {
      throw notSupported(`${name} 暂不支持该操作`);
    },
  };
}

export const adapters = [
  neteaseAdapter,
  solaraAdapter,
  qishuiAdapter,
  makeConnectedSource({ id: 'qq', name: 'QQ 音乐' }),
  makeStub({ id: 'kugou', name: '酷狗音乐' }),
  makeConnectedSource({ id: 'migu', name: '咪咕音乐' }),
];

export const adapterMap = Object.fromEntries(adapters.map((a) => [a.id, a]));

export function listPlatforms() {
  return adapters.map((a) => ({ id: a.id, name: a.name, connected: a.connected }));
}
