# Resonate · 个人音乐收藏管理

一个**跨平台检索、管理与播放个人音乐收藏**的本地工具。当前版本以手写 CSS 设计系统（atmospheric / Midnight 暗色氛围）设计界面，后端采用**平台适配器架构**——网易云音乐已真实接入，其余平台预留接口，可插拔扩展。

## 功能

- 跨平台搜索：**单曲、歌单、歌手、专辑**四个维度，可勾选参与搜索的平台。
- 结果呈现
  - **歌单**：封面、平台来源、名称、创建者、总曲目数。点击歌单可展开曲目列表，逐首播放 / 收藏。
  - **单曲**：封面、名称、歌手、时长、大小、格式，并提供 **播放 / 收藏** 快捷操作。
  - **歌手 / 专辑**：封面（歌手为圆形头像）、名称、歌手、年份、曲目数。
- 内置播放器：底部常驻，支持播放 / 暂停 / 进度拖动 / 本机保存。
- 本机保存：后端代理音源地址并以附件形式落盘，便于离线收听。

## 技术栈

- 前端：`Vite + React + TypeScript`，样式为手写 CSS（自建 token 系统，无 UI 框架）。
- 后端：`Node + Express`，`NeteaseCloudMusicApi` 直连网易云（进程内调用，不起独立服务）。

## 运行

```bash
# 1. 安装依赖
npm run install:all

# 2. 同时启动后端（:8787）与前端（:5173）
npm run dev
```

打开 http://localhost:5173 即可使用。也可分别启动：

```bash
npm --prefix server run dev     # 后端，带 --watch
npm --prefix client run dev     # 前端
```

> 前端开发服务器通过 Vite 代理把 `/api` 转发到 `http://localhost:8787`，因此前端无需关心后端地址。

## 目录结构

```
.
├── client/                # 前端（Vite + React + TS）
│   ├── src/
│   │   ├── styles/        # tokens.css（设计系统 token）+ app.css（组件样式）
│   │   ├── components/    # Nav / Hero / Results / SongRow / 卡片 / PlayerBar / 抽屉 / Footer
│   │   ├── api.ts         # 后端接口封装
│   │   ├── types.ts       # 统一数据类型
│   │   └── App.tsx        # 状态与编排
│   └── vite.config.ts
├── server/                # 后端（Express + 适配器）
│   ├── adapters/
│   │   ├── index.js       # 适配器注册表 + 平台列表
│   │   ├── netease.js     # 网易云真实接入
│   │   └── （qq / kugou / migu 为占位，返回「未接入」）
│   └── index.js           # /api 路由 + 播放/下载代理
└── package.json           # 编排脚本（concurrently）
```

## 如何新增一个平台适配器

1. 在 `server/adapters/` 下新建 `<platform>.js`，导出一个对象：

   ```js
   export const xxxAdapter = {
     id: 'xxx',                       // 唯一标识，与前端选择一致
     name: '某音乐',                   // 展示名
     connected: true,                 // 是否真实接入
     async search(keywords, type) {   // 返回 { songs, playlists, artists, albums }
       // type: 'all' | 'song' | 'playlist' | 'artist' | 'album'
       return { songs: [], playlists: [], artists: [], albums: [] };
     },
     async songUrl(id) {              // 返回 { url, size, br, format } 或 null
       return null;
     },
     async playlistDetail(id) {       // 返回 PlaylistDetail
       return null;
     },
     async rawUrl(id) {               // 播放/下载代理用，返回直链
       return null;
     },
   };
   ```

2. 在 `server/adapters/index.js` 的 `adapters` 数组里引入并注册。
3. 前端 `platformName` 映射与结果渲染已按统一 schema 工作，无需改动。

## 说明

- 音频版权归各权利人所有，本项目仅供个人学习与非商业用途。
- 当前真实接入仅网易云音乐；QQ / 酷狗 / 咪咕为占位适配器，选择后会在结果区以「未接入」提示，不实际请求。
