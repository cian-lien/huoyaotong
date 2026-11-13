# 火药桶

2–5 人网页联机的派对卡牌游戏。海盗们轮流从货舱摸牌，摸到火药桶又没有灭火桶就出局，活到最后的人赢。

玩法借鉴了“摸牌赌运气 + 功能牌坑人”这一类派对卡牌，题材、牌名和牌面都是原创的。

产品需求见 [docs/PRD.md](docs/PRD.md)，技术选型和设计见 [docs/architecture.md](docs/architecture.md)。

## 本地跑起来

需要 Node 22+、pnpm 10+，以及一个 PostgreSQL（下面用 Docker 起）。

```bash
pnpm install

# 1. 起数据库
docker compose -f docker-compose.dev.yml up -d

# 2. 服务端的配置（默认值就能连上面那个数据库）
cp apps/server/.env.example apps/server/.env

# 3. 同时启动服务端（:3000）和前端（:5173）
pnpm dev
```

打开 <http://localhost:5173>。想自己和自己打一局，再开一个无痕窗口进同一个房间号就行。

数据库的表会在服务端启动时自动建好，不用手动跑迁移。

不想起数据库、只想看看规则引擎：

```bash
pnpm play          # 4 个电脑玩家在命令行自动打一局
pnpm play 3 42     # 3 人，随机种子 42（同一个种子每次过程一样）
```

## 常用命令

| 命令 | 作用 |
| --- | --- |
| `pnpm dev` | 启动服务端和前端，改代码自动刷新 |
| `pnpm test` | 跑全部测试 |
| `pnpm typecheck` | 类型检查 |
| `pnpm build` | 构建服务端和前端 |
| `pnpm play` | 命令行自动对局 |

数据库相关的测试默认跳过。要跑的话指定一个**专门用来测试**的库（测试会清空里面的表）：

```bash
docker compose -f docker-compose.dev.yml exec db createdb -U hyt hyt_test
TEST_DATABASE_URL=postgresql://hyt:hyt@localhost:5432/hyt_test pnpm test
```

## 目录

```text
apps/
  web/        React 前端：首页、房间大厅、牌桌、结算、登录、战绩
  server/     Fastify 接口 + Socket.IO 房间服务 + 数据库
packages/
  engine/     规则引擎：纯函数，不碰网络和数据库
  shared/     牌的定义、消息协议、Zod 校验（前后端共用）
deploy/       Caddy 配置
scripts/      数据库备份脚本
docs/         需求文档、技术架构文档
```

依赖方向是单向的：`apps → engine → shared`。任务由 Turborepo 按这个顺序编排（见 `turbo.json`）。

## 它是怎么工作的

- **服务器说了算。** 客户端只发“操作”（出牌、摸牌、驳回……），服务器用规则引擎判断是否合法、算出新状态，再给每个人发一份**他能看到的视图**。货舱的顺序和别人的手牌永远不会发到浏览器，开发者工具里也看不到。
- **规则引擎是纯函数。** `applyAction(状态, 座位, 操作) → 新状态 + 事件`。不联网就能测，`packages/engine/test` 里每张牌都有测试，另外有 800 局随机对局检查“牌不会凭空多出或消失”“火药桶数 = 存活人数 − 1”这些不变量。
- **驳回窗口。** 牌打出后先不生效，开一个 3 秒的计时器；每来一张驳回就重新计时；到时后驳回张数是奇数则取消、偶数则生效。计时器只在服务器上，浏览器里的引线倒计时只是显示。
- **断线重连。** 进房间时拿到一个座位凭证，存在浏览器里。刷新或断网后凭它回到原来的座位；登录用户换设备也能直接接管。掉线超过 60 秒按出局处理。
- **账号。** 邮箱 + 密码，密码用 bcrypt 哈希。登录状态是 httpOnly cookie，数据库里只存 token 的 SHA-256。游客可以直接玩，但不记战绩。

## 改牌、换美术

- 牌的名字、说明、张数都在 `packages/shared/src/cards.ts`，改这一个文件前后端同时生效。
- 现在的牌面是占位的（图标 + 牌框）。正式美术做好后，改 `apps/web/src/components/CardView.tsx` 里的 `.card-art`：把图标换成 `<img>` 即可，牌框和文字不用动。
- 音效是用 Web Audio 现场合成的，在 `apps/web/src/sound.ts`；想换成真实音效只改这个文件。
- 加一种新的功能牌：在 `cards.ts` 里加定义 → 在 `engine.ts` 的 `resolvePending` 里写效果 → 补测试。

## 部署到服务器

一台装了 Docker 的服务器（2 核 2 GB 足够），域名解析到它，放行 80 和 443 端口。

```bash
git clone <你的仓库地址> huoyaotong && cd huoyaotong
cp .env.example .env      # 填 DOMAIN 和 POSTGRES_PASSWORD
docker compose up -d --build
```

Caddy 会自动申请 HTTPS 证书。更新版本：`git pull && docker compose up -d --build`。

> 重启服务端会中断正在进行的对局（房间状态在内存里），挑没人玩的时候更新。

每天备份数据库：把 `scripts/backup.sh` 加到 cron，用法写在脚本开头。

国内访问：大陆服务器绑域名需要 ICP 备案；香港服务器不用，延迟稍高一点，回合制卡牌感觉不出来。

## 还没做的

- 电脑玩家、房间内聊天、房主自定义规则（PRD 里的 P2）
- 正式牌面美术
- 邮箱验证、找回密码
