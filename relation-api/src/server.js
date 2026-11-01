/**
 * 人脉关系网 API 服务入口
 */
import 'dotenv/config';
import express from 'express';
import cors from 'cors';
import compression from 'compression';
import { existsSync } from 'node:fs';
import { join } from 'node:path';

import { initDBAsync, createSchema, getDriver, closeDB, ROOT } from './db/driver.js';
import { ENUMS } from './lib/enums.js';
import { initCrypto } from './lib/crypto.js';

import personsRouter from './routes/persons.js';
import resourcesRouter from './routes/resources.js';
import eventsRouter from './routes/events.js';
import orgsRouter from './routes/orgs.js';
import relationsRouter from './routes/relations.js';
import graphRouter from './routes/graph.js';

const PORT = Number(process.env.PORT) || 3100;
const HOST = process.env.HOST || '0.0.0.0';

async function bootstrap() {
  initCrypto(); // 先确保加密密钥就绪并落盘
  const driver = await initDBAsync();
  createSchema();
  console.log(`[db] 驱动: ${driver} · 已就绪`);

  const app = express();

  app.use(compression());
  app.use(cors());
  app.use(express.json({ limit: '2mb' }));

  // 简单请求日志
  app.use((req, res, next) => {
    const start = Date.now();
    res.on('finish', () => {
      const ms = Date.now() - start;
      if (!req.url.startsWith('/api/health')) {
        console.log(`${res.statusCode} ${req.method} ${decodeURIComponent(req.originalUrl)} ${ms}ms`);
      }
    });
    next();
  });

  app.get('/api/health', (req, res) => {
    res.json({ ok: true, driver: getDriver(), time: new Date().toISOString() });
  });

  app.get('/api/enums', (req, res) => {
    res.json(ENUMS);
  });

  app.use('/api/persons', personsRouter);
  app.use('/api/resources', resourcesRouter);
  app.use('/api/events', eventsRouter);
  app.use('/api/orgs', orgsRouter);
  app.use('/api/relations', relationsRouter);
  app.use('/api/graph', graphRouter);

  // 生产环境托管前端静态文件
  const webDist = join(ROOT, '../relation-web/dist');
  if (existsSync(webDist)) {
    app.use(express.static(webDist));
    app.get(/^(?!\/api).*/, (req, res) => {
      res.sendFile(join(webDist, 'index.html'));
    });
  }

  // 统一错误处理
  app.use((err, req, res, next) => {
    const status = err.status || 500;
    if (status >= 500) console.error('[error]', err);
    res.status(status).json({ error: err.message || '服务器内部错误' });
  });

  app.use((req, res) => res.status(404).json({ error: '接口不存在' }));

  const server = app.listen(PORT, HOST, () => {
    console.log(`[api] 已启动 http://${HOST}:${PORT}`);
  });

  const shutdown = (sig) => {
    console.log(`\n[api] 收到 ${sig}，正在关闭…`);
    server.close(() => {
      closeDB();
      process.exit(0);
    });
    setTimeout(() => process.exit(1), 5000);
  };
  process.on('SIGINT', () => shutdown('SIGINT'));
  process.on('SIGTERM', () => shutdown('SIGTERM'));
}

bootstrap().catch((e) => {
  console.error('启动失败:', e);
  process.exit(1);
});
