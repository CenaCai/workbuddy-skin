#!/usr/bin/env node
/**
 * WorkBuddy 界面背景注入脚本（基于 Chrome DevTools Protocol / CDP）
 *
 * v0.5.0：融合 cdredfox/workbuddy-skin-studio 的“稳定锚点 + --cb-* 设计令牌 +
 * 应用内 🎨 菜单”思路。背景透明化不再依赖“扫描 body * + 面积阈值”的脆弱启发式，
 * 而是锚定 #root / .teams-container / [data-view-id] 等稳定选择器，并用 --cb-text-*
 * 令牌全局换文字色；同时注入一个 🎨 菜单，可随时切换背景、上传自定义图片（自动取色）。
 *
 * 用法：
 *   node inject.mjs --image /path/to/bg.png            # 注入背景图 + 🎨 菜单
 *   node inject.mjs --image bg.png --opacity 0.4       # 自定义遮罩不透明度
 *   node inject.mjs --image bg.png --no-menu           # 仅注入背景，不加载菜单
 *   node inject.mjs --css my-theme.css                 # 使用自定义 CSS（跳过菜单）
 *   node inject.mjs --restore                          # 恢复官方外观
 *   node inject.mjs --list                             # 仅列出可注入的 target
 *
 * 依赖：Node 22+（内置 WebSocket / fetch，无需 npm install）
 */
import { readFile } from 'node:fs/promises';
import { existsSync } from 'node:fs';
import { resolve, extname, dirname, basename } from 'node:path';
import { execFileSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';

import {
  buildSkinCss,
  buildSkinCssTemplate,
  paletteFromLuminance,
  STYLE_ID,
  MENU_ID,
} from './src/skin-css.mjs';
import { buildSkinMenuScript } from './src/skin-menu.mjs';

const HELP = `用法: node inject.mjs [选项]

  --port <n>      调试端口（默认 9222）
  --image <path>  背景图片路径（png/jpg/jpeg/webp/gif/avif/bmp）
  --css <path>    自定义 CSS 文件路径（覆盖内置背景样式，并跳过菜单）
  --opacity <f>   背景遮罩不透明度 0~1（默认 0.45，越大越暗）
  --card-bg <rgba|auto|transparent> 消息底纹（默认 auto：随背景明暗自动）
  --auto-text [true|false] 根据背景明暗自动调整文字颜色（默认 true）
  --auto-text-threshold <n> 自动文字颜色阈值 0~255（默认 128）
  --no-menu       仅注入背景，不加载 🎨 菜单
  --restore       恢复官方外观（移除注入与菜单）
  --list          仅列出可注入的页面 target，不注入
  --target <i>    指定 target 下标（配合 --list 结果使用）
  --verbose       打印侦察到的 DOM 结构详情
  --help          显示帮助
`;

function parseArgs(argv) {
  const a = {
    port: 9222, opacity: 0.45, cardBg: 'auto', autoText: true, autoTextThreshold: 128,
    restore: false, list: false, verbose: false, noMenu: false,
  };
  let i = 2;
  const need = (flag) => {
    const v = argv[++i];
    if (v === undefined) { console.error(`缺少参数: ${flag}`); process.exit(1); }
    return v;
  };
  while (i < argv.length) {
    const arg = argv[i];
    if (arg === '--port') a.port = parseInt(need('--port'), 10);
    else if (arg === '--image') a.image = need('--image');
    else if (arg === '--css') a.css = need('--css');
    else if (arg === '--opacity') a.opacity = parseFloat(need('--opacity'));
    else if (arg === '--card-bg') a.cardBg = need('--card-bg');
    else if (arg === '--auto-text') {
      const raw = arg;
      if (raw.includes('=')) {
        const v = raw.split('=')[1].toLowerCase();
        a.autoText = v === 'true' || v === '1' || v === 'yes' || v === 'on' || v === 'enable';
      } else {
        const next = argv[i + 1];
        if (next && !next.startsWith('--')) {
          const v = next.toLowerCase();
          if (v === 'false' || v === '0' || v === 'no' || v === 'off' || v === 'disable') a.autoText = false;
          else if (v === 'true' || v === '1' || v === 'yes' || v === 'on' || v === 'enable') a.autoText = true;
          else { console.error(`--auto-text 参数值无效: ${next}`); process.exit(1); }
          i++;
        } else a.autoText = true;
      }
    }
    else if (arg === '--auto-text-threshold') a.autoTextThreshold = parseFloat(need('--auto-text-threshold'));
    else if (arg === '--no-menu') a.noMenu = true;
    else if (arg === '--restore') a.restore = true;
    else if (arg === '--list') a.list = true;
    else if (arg === '--target') a.target = parseInt(need('--target'), 10);
    else if (arg === '--verbose') a.verbose = true;
    else if (arg === '--help') a.help = true;
    else { console.error(`未知参数: ${arg}`); console.error(HELP); process.exit(1); }
    i++;
  }
  return a;
}

/** 简单 CDP 客户端（基于全局 WebSocket） */
class CDP {
  constructor(ws) {
    this.ws = ws;
    this.id = 0;
    this.pending = new Map();
    ws.onmessage = (e) => {
      const msg = JSON.parse(e.data);
      if (msg.id && this.pending.has(msg.id)) {
        const { resolve, reject } = this.pending.get(msg.id);
        this.pending.delete(msg.id);
        msg.error ? reject(new Error(`${msg.error.message}`)) : resolve(msg.result);
      }
    };
  }
  static connect(url) {
    return new Promise((resolve, reject) => {
      const ws = new WebSocket(url);
      const t = setTimeout(() => reject(new Error('CDP WebSocket 连接超时')), 10000);
      ws.onopen = () => { clearTimeout(t); resolve(new CDP(ws)); };
      ws.onerror = () => { clearTimeout(t); reject(new Error('CDP WebSocket 连接失败')); };
    });
  }
  send(method, params = {}) {
    const id = ++this.id;
    return new Promise((resolve, reject) => {
      this.pending.set(id, { resolve, reject });
      this.ws.send(JSON.stringify({ id, method, params }));
    });
  }
  close() { try { this.ws.close(); } catch {} }
}

const IMAGE_MIME = {
  '.png': 'image/png', '.jpg': 'image/jpeg', '.jpeg': 'image/jpeg',
  '.webp': 'image/webp', '.gif': 'image/gif', '.avif': 'image/avif', '.bmp': 'image/bmp',
};

const SCRIPT_DIR = dirname(fileURLToPath(import.meta.url));

async function imageToDataUrl(path) {
  if (!path) return null;
  const abs = resolve(path);
  if (!existsSync(abs)) { console.error(`背景图不存在: ${abs}`); process.exit(1); }
  const buf = await readFile(abs);
  const mime = IMAGE_MIME[extname(abs).toLowerCase()] || 'image/png';
  return `data:${mime};base64,${buf.toString('base64')}`;
}

/** 调用 Python 分析背景图明暗（仅 CLI 模式用于决定明暗；菜单走页内取色） */
function analyzeBackground(imagePath, threshold) {
  const analyzer = resolve(SCRIPT_DIR, 'analyze-bg.py');
  if (!existsSync(analyzer)) return null;
  try {
    const python = process.env.WB_PYTHON || 'python3';
    const out = execFileSync(python, [analyzer, resolve(imagePath), String(threshold)], { encoding: 'utf8', timeout: 15000 });
    return JSON.parse(out);
  } catch (e) {
    console.warn(`  ⚠ 背景亮度分析失败：${e.message}，将按深色处理`);
    return null;
  }
}

/** 仅注入样式（无菜单模式） */
function buildStyleOnlyScript(css) {
  return `(function(){
    var STYLE_ID = ${JSON.stringify(STYLE_ID)};
    var o = document.getElementById('__wb_skin_style__'); if (o) o.remove(); /* 清理旧版 v0.4.x 样式 */
    var old = document.getElementById(STYLE_ID); if (old) old.remove();
    var style = document.createElement('style');
    style.id = STYLE_ID;
    style.textContent = ${JSON.stringify(css)};
    (document.head || document.documentElement).appendChild(style);
    return { applied: true };
  })()`;
}

const RESTORE_JS = `(function(){
  var STYLE_ID = ${JSON.stringify(STYLE_ID)};
  var MENU_ID = ${JSON.stringify(MENU_ID)};
  var o = document.getElementById('__wb_skin_style__'); if (o) o.remove(); /* 旧版 v0.4.x */
  var s = document.getElementById(STYLE_ID); if (s) s.remove();
  var m = document.getElementById(MENU_ID); if (m) m.remove();
  delete document.documentElement.dataset.wbSkin;
  // 清理旧版本（v0.4.x）可能残留的内联样式
  var legacy = document.querySelectorAll('[data-wb-skin-orig-bg],[data-wb-skin-text]');
  for (var i = 0; i < legacy.length; i++) {
    var e = legacy[i];
    e.style.removeProperty('background-color');
    e.style.removeProperty('background-image');
    e.style.removeProperty('color');
    e.style.removeProperty('text-shadow');
    delete e.dataset.wbSkinOrigBg;
    delete e.dataset.wbSkinOrigImg;
    delete e.dataset.wbSkinText;
  }
  return 'restored style+menu, cleared ' + legacy.length + ' legacy nodes';
})()`;

async function getTargets(port) {
  const res = await fetch(`http://127.0.0.1:${port}/json/list`);
  if (!res.ok) throw new Error(`无法连接调试端口 ${port}（HTTP ${res.status}）。请确认 WorkBuddy 已带 --remote-debugging-port=${port} 启动。`);
  return res.json();
}

async function main() {
  const a = parseArgs(process.argv);
  if (a.help) { console.log(HELP); return; }

  let targets;
  try {
    targets = await getTargets(a.port);
  } catch (e) {
    console.error('✗ ' + e.message);
    process.exit(1);
  }

  const pages = targets.filter(t => t.type === 'page');
  if (a.list) {
    console.log(`共 ${pages.length} 个可注入页面：\n`);
    pages.forEach((t, i) => console.log(`  [${i}] ${t.title || '(无标题)'}  ${t.url}`));
    return;
  }
  if (pages.length === 0) { console.error('✗ 未找到 page target，无法注入。'); process.exit(1); }

  let chosen = pages;
  if (a.target !== undefined) {
    if (a.target < 0 || a.target >= pages.length) { console.error(`✗ target 下标越界（0~${pages.length - 1}）`); process.exit(1); }
    chosen = [pages[a.target]];
  }

  if (a.restore) {
    console.log('恢复官方外观：移除注入样式与 🎨 菜单…');
    for (const t of chosen) {
      try {
        const cdp = await CDP.connect(t.webSocketDebuggerUrl);
        const r = await cdp.send('Runtime.evaluate', { expression: RESTORE_JS, returnByValue: true });
        cdp.close();
        console.log(`  ✓ ${t.title || t.url}  (${r && r.result && r.result.value})`);
      } catch (e) { console.error(`  ✗ ${t.title}: ${e.message}`); }
    }
    console.log('已恢复官方外观。');
    return;
  }

  // ---- 构造皮肤 ----
  let activeCss = null;
  let activeColors = null;
  let activeName = '当前背景';

  if (a.css) {
    activeCss = await readFile(resolve(a.css), 'utf8');
    activeName = basename(resolve(a.css));
  } else {
    const dataUrl = await imageToDataUrl(a.image);
    let info = { mode: 'dark' };
    if (dataUrl && a.autoText) {
      const analyzed = analyzeBackground(resolve(a.image), a.autoTextThreshold);
      if (analyzed) {
        info = analyzed;
        console.log(`  背景分析：${analyzed.mode}（亮度 ${analyzed.luminance}）→ 文字色自动适配`);
      }
    }
    activeColors = paletteFromLuminance(info);
    activeCss = buildSkinCss({ imageDataUrl: dataUrl, colors: activeColors, opts: { opacity: a.opacity, cardBg: a.cardBg } });
    activeName = a.image ? basename(resolve(a.image)) : '纯色渐变';
  }

  // ---- 组装菜单条目：当前背景 + 内置预设 ----
  const entries = [{
    id: 'active',
    name: activeName,
    accent: activeColors?.accent,
    surface: activeColors?.surface,
    css: activeCss,
  }];

  // 内置预设：scripts/background.png（本仓库自带的干净渐变壁纸，无版权风险）
  const presetPath = resolve(SCRIPT_DIR, 'background.png');
  if (!a.css && existsSync(presetPath)) {
    try {
      const pData = await imageToDataUrl(presetPath);
      const pInfo = analyzeBackground(presetPath, a.autoTextThreshold) || { mode: 'dark' };
      const pColors = paletteFromLuminance(pInfo);
      entries.push({
        id: 'preset-gradient',
        name: '默认渐变',
        accent: pColors.accent,
        surface: pColors.surface,
        css: buildSkinCss({ imageDataUrl: pData, colors: pColors, opts: { opacity: a.opacity, cardBg: a.cardBg } }),
      });
    } catch (e) { console.warn(`  ⚠ 预设壁纸加载失败，跳过：${e.message}`); }
  }

  // ---- 注入 ----
  let injectJs;
  if (a.css || a.noMenu) {
    injectJs = buildStyleOnlyScript(activeCss);
  } else {
    injectJs = '(()=>{var o=document.getElementById("__wb_skin_style__");if(o)o.remove();})();\n'
      + buildSkinMenuScript({ entries, activeId: 'active', cssTemplate: buildSkinCssTemplate() });
  }

  console.log(a.css
    ? `注入自定义 CSS：${resolve(a.css)}`
    : `注入背景图：${a.image ? resolve(a.image) : '(纯色渐变)'}（遮罩 ${a.opacity}${a.noMenu ? '，无菜单' : '，🎨 菜单已加载'}）`);
  console.log(`目标页面 ${chosen.length} 个：\n`);

  for (const t of chosen) {
    try {
      const cdp = await CDP.connect(t.webSocketDebuggerUrl);
      const r = await cdp.send('Runtime.evaluate', { expression: injectJs, returnByValue: true });
      cdp.close();
      const err = r && r.exceptionDetails;
      if (err) {
        console.error(`  ✗ ${t.title || t.url}  JS 异常: ${JSON.stringify(err.exception?.description || err.text).slice(0, 300)}`);
      } else {
        console.log(`  ✓ ${t.title || t.url}`);
      }
    } catch (e) {
      console.error(`  ✗ ${t.title}: ${e.message}`);
    }
  }
  if (!a.css && !a.noMenu) {
    console.log('\n完成。WorkBuddy 顶部功能栏出现「切换背景」按钮：可切换背景、上传自定义图片（自动取色）、或切换原生浅色/深色界面。');
  } else {
    console.log('\n完成。');
  }
}

main().catch(e => { console.error('✗ 未捕获错误:', e); process.exit(1); });
