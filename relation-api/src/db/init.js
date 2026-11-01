/**
 * 初始化数据库：建库建表
 * 用法：npm run init-db
 */
import 'dotenv/config';
import { initDBAsync, createSchema, getDriver, closeDB, DB_PATH } from './driver.js';

const driver = await initDBAsync();
createSchema();
console.log(`✅ 数据库已初始化`);
console.log(`   路径: ${DB_PATH}`);
console.log(`   驱动: ${driver}`);
closeDB();
