import { fileURLToPath } from 'node:url';
import { buildApp } from './app.ts';
import { PgStore } from './store-pg.ts';

const port = Number(process.env.PORT ?? 3000);
const host = process.env.HOST ?? '0.0.0.0';
const databaseUrl = process.env.DATABASE_URL;
if (!databaseUrl) {
  console.error('缺少环境变量 DATABASE_URL，参考 apps/server/.env.example');
  process.exit(1);
}

const store = new PgStore(databaseUrl);
// 开发时这个文件在 src/，打包后在 dist/，迁移目录都在上一级的 drizzle/
await store.migrate(fileURLToPath(new URL('../drizzle', import.meta.url)));

const app = await buildApp({
  store,
  logger: true,
  secureCookie: process.env.NODE_ENV === 'production',
});
await app.fastify.listen({ port, host });

for (const signal of ['SIGINT', 'SIGTERM'] as const) {
  process.once(signal, () => {
    app.fastify.log.info(`收到 ${signal}，正在关闭`);
    void app
      .close()
      .then(() => store.close())
      .finally(() => process.exit(0));
  });
}
