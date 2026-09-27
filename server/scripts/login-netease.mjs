#!/usr/bin/env node
// 网易云扫码登录：生成二维码，手机「网易云音乐」App 扫码授权后，
// 自动把登录 Cookie 写入 server/.env 的 NETEASE_COOKIE，解除游客态 30s 试听限制。
// 用法：npm run login:netease  （在浏览器/图片中扫码，等待授权即可）

import { writeFileSync, readFileSync, existsSync, unlinkSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';

const here = dirname(fileURLToPath(import.meta.url));
const serverDir = dirname(here);
const envPath = join(serverDir, '.env');
const qrPng = join(serverDir, '.netease_login_qr.png');

const NC = await import('NeteaseCloudMusicApi');
const def = NC.default;
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

// 1) 取二维码 key
const keyRes = await def.login_qr_key({});
const unikey = keyRes?.body?.data?.unikey;
if (!unikey) {
  console.error('获取二维码 key 失败');
  process.exit(1);
}

// 2) 生成二维码（链接 + 图片）
const qrRes = await def.login_qr_create({ key: unikey, qrimg: true });
const { qrurl, qrimg } = qrRes?.body?.data || {};
console.log('\n请用手机「网易云音乐」App 扫码登录：');
if (qrurl) console.log('  • 浏览器打开此链接查看二维码 →', qrurl);
if (qrimg) {
  const b64 = String(qrimg).split(',')[1];
  if (b64) {
    writeFileSync(qrPng, Buffer.from(b64, 'base64'));
    console.log('  • 或直接打开二维码图片 →', qrPng);
  }
}

// 3) 轮询等待授权（最多约 4 分钟）
console.log('\n等待扫码授权（请在手机上确认登录）...');
let cookie = null;
for (let i = 0; i < 96; i++) {
  await sleep(2500);
  const r = await def.login_qr_check({ key: unikey });
  const code = r?.body?.code;
  if (code === 803) {
    cookie = r?.body?.cookie || null;
    console.log('\n✓ 登录授权成功！');
    break;
  } else if (code === 802) {
    process.stdout.write(`\r  已扫码，请在手机上点击「确认登录」...`);
  } else if (code === 801) {
    process.stdout.write(`\r  等待扫码...`);
  } else {
    process.stdout.write(`\r  状态 ${code}...`);
  }
}
console.log('');

// 清理二维码图片
try { unlinkSync(qrPng); } catch { /* ignore */ }

if (!cookie) {
  console.error('登录超时或取消，请重试。');
  process.exit(1);
}

// 4) 写入 server/.env
let content = existsSync(envPath) ? readFileSync(envPath, 'utf8') : '';
const line = `NETEASE_COOKIE=${cookie}`;
if (/^\s*NETEASE_COOKIE\s*=/m.test(content)) {
  content = content.replace(/^\s*NETEASE_COOKIE\s*=.*$/m, line);
} else {
  content = content.replace(/\s*$/, '') + '\n' + line + '\n';
}
writeFileSync(envPath, content);
console.log('✓ 已将登录 Cookie 写入', envPath);
console.log('→ 请重启后端使其生效：先停掉 npm run dev，再重新 npm run dev');
