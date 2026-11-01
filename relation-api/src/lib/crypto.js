/**
 * 涉敏字段加密：AES-256-GCM
 * 存储格式：enc1:<base64(iv|tag|cipher)>
 *
 * 密钥策略（重要）：
 * 1. 优先读 .env 里的 APP_ENC_KEY
 * 2. 若未配置，首次启动自动生成并写回 .env（避免重启后旧数据解不开）
 * 3. 文件系统只读等极端情况下才退化为进程内临时密钥，并打警告
 */
import crypto from 'node:crypto';
import { existsSync, readFileSync, writeFileSync, appendFileSync } from 'node:fs';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const PREFIX = 'enc1:';
const __dirname = dirname(fileURLToPath(import.meta.url));
const ROOT = resolve(__dirname, '../..');
const ENV_PATH = join(ROOT, '.env');

let keyCache = null;

/** 生成密钥并持久化到 .env */
function ensureKeyFile() {
  const hex = crypto.randomBytes(32).toString('hex');
  try {
    if (!existsSync(ENV_PATH)) {
      writeFileSync(ENV_PATH, `# 涉敏字段加密密钥，请勿泄露、勿提交到仓库\nAPP_ENC_KEY=${hex}\nPORT=3100\n`, 'utf8');
    } else {
      const content = readFileSync(ENV_PATH, 'utf8');
      if (/^\s*APP_ENC_KEY\s*=/m.test(content)) {
        // 已有行但为空，补上值
        const next = content.replace(/^\s*APP_ENC_KEY\s*=.*$/m, `APP_ENC_KEY=${hex}`);
        writeFileSync(ENV_PATH, next, 'utf8');
      } else {
        appendFileSync(ENV_PATH, `\nAPP_ENC_KEY=${hex}\n`, 'utf8');
      }
    }
    return hex;
  } catch {
    return null;
  }
}

function getKey() {
  if (keyCache) return keyCache;

  let hex = process.env.APP_ENC_KEY;

  if (!hex || !/^[0-9a-fA-F]{64}$/.test(hex)) {
    // 未配置：生成并落盘，保证跨重启可解密
    const generated = ensureKeyFile();
    if (generated) {
      process.env.APP_ENC_KEY = generated;
      hex = generated;
      console.warn('[SECURITY] 未检测到 APP_ENC_KEY，已自动生成并写入 .env，请妥善保管该文件。');
    }
  }

  if (hex && /^[0-9a-fA-F]{64}$/.test(hex)) {
    keyCache = Buffer.from(hex, 'hex');
  } else {
    keyCache = crypto.randomBytes(32);
    console.error('[SECURITY] 无法持久化密钥（.env 不可写），涉敏数据重启后将无法解密！请手动设置 APP_ENC_KEY。');
  }
  return keyCache;
}

export function isEncrypted(v) {
  return typeof v === 'string' && v.startsWith(PREFIX);
}

/** 主动初始化密钥（服务启动时调用，确保 .env 落盘先于任何加解密） */
export function initCrypto() {
  getKey();
  return ENV_PATH;
}

export function encrypt(plain) {
  if (plain === null || plain === undefined || plain === '') return plain;
  const s = String(plain);
  if (isEncrypted(s)) return s; // 已加密不重复加密
  const iv = crypto.randomBytes(12);
  const cipher = crypto.createCipheriv('aes-256-gcm', getKey(), iv);
  const enc = Buffer.concat([cipher.update(s, 'utf8'), cipher.final()]);
  const tag = cipher.getAuthTag();
  return PREFIX + Buffer.concat([iv, tag, enc]).toString('base64');
}

export function decrypt(value) {
  if (!isEncrypted(value)) return value;
  try {
    const buf = Buffer.from(value.slice(PREFIX.length), 'base64');
    const iv = buf.subarray(0, 12);
    const tag = buf.subarray(12, 28);
    const data = buf.subarray(28);
    const d = crypto.createDecipheriv('aes-256-gcm', getKey(), iv);
    d.setAuthTag(tag);
    return Buffer.concat([d.update(data), d.final()]).toString('utf8');
  } catch {
    return '[解密失败]';
  }
}

/** 手机号脱敏显示：138****1111 */
export function maskPhone(v) {
  if (!v) return v;
  const s = String(v);
  if (s.length < 7) return '***';
  return s.slice(0, 3) + '****' + s.slice(-4);
}
