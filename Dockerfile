# 一个 Dockerfile 出两个镜像：
#   --target server  游戏服务（Node）
#   --target web     Caddy + 前端静态文件
FROM node:22-alpine AS base
ENV PNPM_HOME=/pnpm
ENV PATH=$PNPM_HOME:$PATH
RUN corepack enable
WORKDIR /repo

# turbo prune 只留下这两个应用用得到的包，依赖没变时后面的安装步骤能命中缓存
FROM base AS pruner
COPY . .
RUN pnpm dlx turbo@2 prune @hyt/server @hyt/web --docker

FROM base AS builder
COPY --from=pruner /repo/out/json/ .
RUN pnpm install --frozen-lockfile
COPY --from=pruner /repo/out/full/ .
# turbo prune 不会带上根目录的 tsconfig，各包的 tsconfig 都继承它
COPY tsconfig.base.json ./
RUN pnpm turbo run build
# 只带运行时依赖，单独放到 /out/server
RUN pnpm --filter @hyt/server deploy --prod --legacy /out/server

FROM node:22-alpine AS server
ENV NODE_ENV=production
WORKDIR /app
COPY --from=builder /out/server/node_modules ./node_modules
COPY --from=builder /repo/apps/server/dist ./dist
COPY --from=builder /repo/apps/server/drizzle ./drizzle
COPY --from=builder /repo/apps/server/package.json ./package.json
USER node
EXPOSE 3000
CMD ["node", "dist/main.js"]

FROM caddy:2-alpine AS web
COPY deploy/Caddyfile /etc/caddy/Caddyfile
COPY --from=builder /repo/apps/web/dist /srv
