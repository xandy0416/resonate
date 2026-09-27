// 平台适配器注册表。
// 真实接入：netease（见 netease.js）、qishui（汽水音乐）、solara（曲库跳板）。
// 占位：qq / kugou / migu —— 接口尚未接入，统一返回“未接入”状态，
// 供前端在平台选择器中以“未接入”标记，搜索时不实际请求。

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

export const adapters = [
  neteaseAdapter,
  solaraAdapter,
  qishuiAdapter,
  makeStub({ id: 'qq', name: 'QQ 音乐' }),
  makeStub({ id: 'kugou', name: '酷狗音乐' }),
  makeStub({ id: 'migu', name: '咪咕音乐' }),
];

export const adapterMap = Object.fromEntries(adapters.map((a) => [a.id, a]));

export function listPlatforms() {
  return adapters.map((a) => ({ id: a.id, name: a.name, connected: a.connected }));
}
