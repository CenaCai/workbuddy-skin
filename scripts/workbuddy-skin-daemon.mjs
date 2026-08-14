#!/usr/bin/env node
/**
 * workbuddy-skin 常驻守护（launchd 周期调用）
 *
 * 目标：让 WorkBuddy 桌面端**始终带调试端口**运行，并在（重新）启动后**自动恢复注入的皮肤**，
 * 这样即使 WorkBuddy 后台自动更新 / 被普通方式重启，调试端口与「切换背景」按钮也会自动回来，
 * 不再需要你手动跑 apply-skin.sh。
 *
 * 零依赖：仅用 Node 22 内置 WebSocket / fetch / child_process。
 *
 * 行为：
 *   1. WorkBuddy 未运行        -> 带端口启动它（设 WB_SKIN_NO_AUTOSTART=1 可关闭“未运行也启动”）。
 *   2. WorkBuddy 在跑但端口没开 -> 退出并以带端口方式重启（覆盖自动更新 / 普通双击启动）。
 *   3. 端口开着但皮肤未注入      -> 自动重新注入（默认背景；若 localStorage 有上次自定义上传则一并恢复）。
 *   4. 已注入                   -> 不做事。
 *
 * 由 launchd 调用，参见 ~/Library/LaunchAgents/com.cenacai.workbuddy.skin.plist。
 *   --dry-run  只打印将要做什么，不实际退出 / 启动 / 注入（用于安全验证）。
 *
 * 环境变量：
 *   WB_SKIN_PORT          调试端口（默认 9222）
 *   WB_NODE               Node 二进制路径（默认内置托管 Node 22）
 *   WB_SKIN_NO_AUTOSTART  设为 1 时，WorkBuddy 未运行也不主动启动（仅修复“在跑但无端口”的情况）
 */

import { spawn, spawnSync } from 'node:child_process';
import { existsSync } from 'node:fs';
import { resolve, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';

const PORT = parseInt(process.env.WB_SKIN_PORT || '9222', 10);
const APP = '/Applications/WorkBuddy.app';
const ELECTRON = resolve(APP, 'Contents/MacOS/Electron');
const SCRIPT_DIR = dirname(fileURLToPath(import.meta.url));
const NODE = process.env.WB_NODE || '/Users/cenacai/.workbuddy/binaries/node/versions/22.22.2/bin/node';
const DRY = process.argv.includes('--dry-run');
const NO_AUTOSTART = process.env.WB_SKIN_NO_AUTOSTART === '1';

const log = (...a) => console.log(`[skin-daemon ${new Date().toISOString()}]`, ...a);
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

const runSync = (cmd, args, opts = {}) => spawnSync(cmd, args, { encoding: 'utf8', ...opts });

function wbRunning() {
  const r = runSync('pgrep', ['-f', `${APP}/Contents/MacOS/Electron`]);
  return r.status === 0 && r.stdout.trim().length > 0;
}
async function portOpen() {
  try {
    const r = await fetch(`http://127.0.0.1:${PORT}/json/list`, { signal: AbortSignal.timeout(1500) });
    return r.ok;
  } catch { return false; }
}
async function killWb() {
  if (DRY) { log('[dry] 将强制退出 WorkBuddy'); return; }
  // 先礼貌退出；若仍存活（如有未保存会话弹确认框），则强制杀掉所有 WorkBuddy 进程
  runSync('osascript', ['-e', 'quit app "WorkBuddy"']);
  for (let i = 0; i < 10; i++) { if (!wbRunning()) return; await sleep(1000); }
  runSync('pkill', ['-9', '-f', `${APP}/Contents/MacOS/Electron`]);
  runSync('pkill', ['-9', '-f', `${APP}/Contents/Frameworks`]);
}
function launchWb() {
  if (DRY) { log('[dry] 将以端口', PORT, '启动 WorkBuddy'); return; }
  if (!existsSync(ELECTRON)) { log('✗ 未找到', ELECTRON); return; }
  const p = spawn(ELECTRON, [`--remote-debugging-port=${PORT}`], { detached: true, stdio: 'ignore' });
  p.unref();
  log('已带端口', PORT, '启动 WorkBuddy');
}
async function waitPort(ms = 60000) {
  const end = Date.now() + ms;
  while (Date.now() < end) { if (await portOpen()) return true; await sleep(1000); }
  return false;
}

// ---- 极简 CDP 客户端（全局 WebSocket） ----
async function cdpEval(expr) {
  const list = await (await fetch(`http://127.0.0.1:${PORT}/json/list`)).json();
  const page = list.find((t) => t.type === 'page');
  if (!page) throw new Error('未找到 page target');
  const ws = new WebSocket(page.webSocketDebuggerUrl);
  await new Promise((res, rej) => { ws.onopen = res; ws.onerror = rej; });
  let id = 0; const pending = new Map();
  ws.onmessage = (e) => {
    const m = JSON.parse(e.data);
    if (m.id && pending.has(m.id)) {
      const { resolve, reject } = pending.get(m.id);
      pending.delete(m.id);
      m.error ? reject(new Error(m.error.message)) : resolve(m.result);
    }
  };
  const send = (method, params = {}) => new Promise((resolve, reject) => {
    const i = ++id; pending.set(i, { resolve, reject });
    ws.send(JSON.stringify({ id: i, method, params }));
  });
  try {
    const r = await send('Runtime.evaluate', { expression: expr, returnByValue: true });
    if (r.exceptionDetails) throw new Error(r.exceptionDetails.exception?.description || r.exceptionDetails.text);
    return r.result.value;
  } finally { ws.close(); }
}

async function reinject() {
  if (DRY) { log('[dry] 将重新注入皮肤'); return; }
  const r = spawnSync(
    NODE,
    [resolve(SCRIPT_DIR, 'inject.mjs'), '--port', String(PORT), '--image', resolve(SCRIPT_DIR, 'background.png')],
    { encoding: 'utf8' }
  );
  const out = (r.stdout || r.stderr || '').trim();
  if (out) log(out.split('\n').pop());
  // 皮肤 / 原生模式的持久化恢复由菜单脚本在注入时自动完成（读取 localStorage），此处无需额外处理
}

async function main() {
  const running = wbRunning();
  const open = await portOpen();

  if (!running) {
    if (NO_AUTOSTART) { log('WorkBuddy 未运行，且 WB_SKIN_NO_AUTOSTART=1，跳过启动'); return; }
    log('WorkBuddy 未运行 -> 启动（带端口）');
    launchWb();
    if (!(await waitPort())) { log('✗ 端口', PORT, '未在 60s 内就绪'); return; }
    await sleep(6000); // 等界面渲染
    await reinject();
    return;
  }

  if (!open) {
    log('WorkBuddy 在跑但端口未开 -> 强制重启（带端口）');
    await killWb();
    for (let i = 0; i < 20; i++) { if (!wbRunning()) break; await sleep(1000); }
    await sleep(2000);
    launchWb();
    if (!(await waitPort())) { log('✗ 端口', PORT, '未在 60s 内就绪'); return; }
    await sleep(6000);
    await reinject();
    return;
  }

  // 端口开着：仅在未注入时重inject；已注入则不动
  let injected = false;
  try { injected = await cdpEval('!!window.__wbSkin'); } catch (e) { log('探测注入状态失败：', e.message); }
  if (!injected) { log('端口开着但未注入 -> 重新注入'); await reinject(); }
  else log('已注入，无需操作');
}

main().catch((e) => { console.error('[skin-daemon] 错误:', e); process.exit(1); });
