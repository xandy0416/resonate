# syntax=docker/dockerfile:1

# ───────────────────────── 构建阶段 ─────────────────────────
FROM node:22-alpine AS build
WORKDIR /app

# 先拷贝依赖清单，利用 Docker 层缓存（仅依赖变化时重装）
COPY package.json ./
COPY server/package.json ./server/
COPY client/package.json ./client/
RUN npm install --prefix server && npm install --prefix client

# 再拷贝源码并构建前端（输出到 client/dist）
COPY . .
RUN npm run build

# ───────────────────────── 运行阶段 ─────────────────────────
FROM node:22-alpine AS run
WORKDIR /app

ENV NODE_ENV=production
ENV PORT=8787
ENV TZ=Asia/Shanghai

# 运行期只需：server 代码 + 其依赖（含 node_modules） + 已构建的前端
COPY --from=build /app/server ./server
COPY --from=build /app/client/dist ./client/dist

EXPOSE 8787

# fnOS / Docker 健康检查：后端自带 /api/health
HEALTHCHECK --interval=30s --timeout=5s --start-period=10s --retries=3 \
  CMD wget -qO- http://localhost:8787/api/health || exit 1

CMD ["node", "server/index.js"]
