#!/usr/bin/env node
/**
 * WorkBuddy 界面背景注入脚本（基于 Chrome DevTools Protocol / CDP）
 *
 * 原理：WorkBuddy 桌面端是 Electron(Chromium) 应用。以调试端口启动后，
 * 通过本机 127.0.0.1 的 CDP 协议向 renderer 进程运行时注入 CSS + 背景图，
 * 不改官方二进制、不碰签名、不动安装目录。
 *
 * 用法：
 *   node inject.mjs --image /path/to/bg.png            # 注入背景图
 *   node inject.mjs --image bg.png --opacity 0.6       # 自定义遮罩不透明度
 *   node inject.mjs --css my-theme.css                 # 使用自定义 CSS（可选）
 *   node inject.mjs --restore                          # 恢复官方外观
 *   node inject.mjs --list                             # 仅列出可注入的 target
 *   node inject.mjs --target 0 --image bg.png          # 注入指定 target
 *
 * 依赖：Node 22+（内置 WebSocket / fetch，无需 npm install）
 */
import { readFile } from 'node:fs/promises';
import { existsSync } from 'node:fs';
import { resolve, extname } from 'node:path';

const HELP = `用法: node inject.mjs [选项]

  --port <n>      调试端口（默认 9222）
  --image <path>  背景图片路径（png/jpg/jpeg/webp/gif）
  --css <path>    自定义 CSS 文件路径（覆盖内置背景样式）
  --opacity <f>   背景遮罩不透明度 0~1（默认 0.45，越大越暗）
  --restore       恢复官方外观（移除注入）
  --list          仅列出可注入的页面 target，不注入
  --target <i>    指定 target 下标（配合 --list 结果使用）
  --verbose       打印侦察到的 DOM 结构详情
  --help          显示帮助
`;

function parseArgs(argv) {
  const a = { port: 9222, opacity: 0.45, restore: false, list: false, verbose: false };
  let i = 2;
  const need = (flag) => {
    const v = argv[++i];
    if (v === undefined) { console.error(`缺少参数: ${flag}`); process.exit(1); }
    return v;
  };
  while (i < argv.length) {
    switch (argv[i]) {
      case '--port': a.port = parseInt(need('--port'), 10); break;
      case '--image': a.image = need('--image'); break;
      case '--css': a.css = need('--css'); break;
      case '--opacity': a.opacity = parseFloat(need('--opacity')); break;
      case '--restore': a.restore = true; break;
      case '--list': a.list = true; break;
      case '--target': a.target = parseInt(need('--target'), 10); break;
      case '--verbose': a.verbose = true; break;
      case '--help': a.help = true; break;
      default: console.error(`未知参数: ${argv[i]}`); console.error(HELP); process.exit(1);
    }
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
      ws.onerror = (e) => { clearTimeout(t); reject(new Error('CDP WebSocket 连接失败')); };
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

async function imageToDataUrl(path) {
  if (!path) return null;
  const abs = resolve(path);
  if (!existsSync(abs)) { console.error(`背景图不存在: ${abs}`); process.exit(1); }
  const buf = await readFile(abs);
  const mime = IMAGE_MIME[extname(abs).toLowerCase()] || 'image/png';
  return `data:${mime};base64,${buf.toString('base64')}`;
}

/** 默认背景 CSS：铺满 + 暗色遮罩保证文字可读 */
function buildDefaultCss(dataUrl, opacity) {
  const overlay = `rgba(10,12,16,${opacity})`;
  const bgImage = dataUrl
    ? `linear-gradient(${overlay}, ${overlay}), url("${dataUrl}")`
    : `linear-gradient(135deg, #14161c 0%, #1d2230 50%, #2a2138 100%)`;
  return `
html { background: transparent !important; }
body {
  background-color: transparent !important;
  background-image: ${bgImage} !important;
  background-size: cover !important;
  background-position: center !important;
  background-attachment: fixed !important;
  background-repeat: no-repeat !important;
}
`;
}

/** 注入后执行的 JS：动态透明化“遮挡背景的大容器”，让 body 背景透出 */
function buildInjectJs(css) {
  return `(function () {
  var STYLE_ID = '__wb_skin_style__';
  var old = document.getElementById(STYLE_ID);
  if (old) old.remove();

  var style = document.createElement('style');
  style.id = STYLE_ID;
  style.textContent = ${JSON.stringify(css)};
  (document.head || document.documentElement).appendChild(style);

  // 动态透明化：找到面积大、有非透明背景、且位于较外层的容器，使其背景透明
  var vw = window.innerWidth || document.documentElement.clientWidth;
  var vh = window.innerHeight || document.documentElement.clientHeight;
  var area = vw * vh;
  var found = [];
  var all = document.querySelectorAll('body *');
  var INTERACTIVE = { BUTTON:1, A:1, INPUT:1, SELECT:1, TEXTAREA:1, IMG:1, SVG:1 };
  for (var i = 0; i < all.length; i++) {
    var el = all[i];
    if (el === document.body) continue;
    if (INTERACTIVE[el.tagName]) continue; // 保护按钮/链接/输入框等交互元素
    var r = el.getBoundingClientRect();
    if (r.width * r.height < area * 0.08) continue; // 放宽阈值，让侧边栏/顶栏也透明化
    var cs = window.getComputedStyle(el);
    var bgc = cs.backgroundColor;
    var bgi = cs.backgroundImage;
    var opaque = bgc && bgc !== 'transparent' && bgc !== 'rgba(0, 0, 0, 0)';
    var hasImg = bgi && bgi !== 'none';
    if (!opaque && !hasImg) continue;
    // 计算 DOM 深度
    var depth = 0, p = el; while (p && p !== document.body) { depth++; p = p.parentElement; }
    found.push({ tag: el.tagName, cls: (el.className && typeof el.className === 'string') ? el.className.slice(0, 120) : '', id: el.id || '', depth: depth, w: Math.round(r.width), h: Math.round(r.height), bgc: bgc });
  }
  // 只透明化最外层（深度最浅）的前 12 个，覆盖侧边栏/顶栏/主区等多层容器
  found.sort(function (a, b) { return a.depth - b.depth; });
  var transparentized = [];
  for (var k = 0; k < Math.min(12, found.length); k++) {
    var t = found[k];
    var els = document.querySelectorAll('body *');
    for (var m = 0; m < els.length; m++) {
      var e = els[m];
      if (e === document.body) continue;
      var er = e.getBoundingClientRect();
      if (er.width * er.height < area * 0.08) continue;
      var ecs = window.getComputedStyle(e);
      var ebgc = ecs.backgroundColor;
      var eopaque = ebgc && ebgc !== 'transparent' && ebgc !== 'rgba(0, 0, 0, 0)';
      if (e.tagName === t.tag && (e.className === t.cls) && eopaque) {
        // 保存原背景值，供 --restore 时还原
        e.dataset.wbSkinOrigBg = ecs.backgroundColor;
        e.dataset.wbSkinOrigImg = ecs.backgroundImage;
        e.style.backgroundColor = 'transparent';
        e.style.backgroundImage = 'none';
      }
    }
    transparentized.push(t.tag + (t.cls ? '.' + t.cls.split(' ')[0] : '') + (t.id ? '#' + t.id : ''));
  }
  return {
    viewport: vw + 'x' + vh,
    candidateContainers: found.slice(0, 8),
    transparentized: transparentized
  };
})()`;
}

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

  // 确定要注入的 target
  let chosen = pages;
  if (a.target !== undefined) {
    if (a.target < 0 || a.target >= pages.length) { console.error(`✗ target 下标越界（0~${pages.length - 1}）`); process.exit(1); }
    chosen = [pages[a.target]];
  }

  if (a.restore) {
    console.log(`恢复官方外观：还原容器背景并移除注入…`);
    const restoreJs = `(function(){
      var els = document.querySelectorAll('[data-wb-skin-orig-bg]');
      var n = els.length;
      for (var i = 0; i < els.length; i++) {
        els[i].style.backgroundColor = els[i].dataset.wbSkinOrigBg;
        els[i].style.backgroundImage = els[i].dataset.wbSkinOrigImg;
        delete els[i].dataset.wbSkinOrigBg;
        delete els[i].dataset.wbSkinOrigImg;
      }
      var s = document.getElementById('__wb_skin_style__'); if (s) s.remove();
      return 'restored ' + n + ' containers';
    })()`;
    for (const t of chosen) {
      try {
        const cdp = await CDP.connect(t.webSocketDebuggerUrl);
        const r = await cdp.send('Runtime.evaluate', { expression: restoreJs, returnByValue: true });
        cdp.close();
        console.log(`  ✓ ${t.title || t.url}  (${r && r.result && r.result.value})`);
      } catch (e) { console.error(`  ✗ ${t.title}: ${e.message}`); }
    }
    console.log('已恢复官方外观。');
    return;
  }

  const dataUrl = await imageToDataUrl(a.image);
  const css = a.css
    ? await readFile(resolve(a.css), 'utf8')
    : buildDefaultCss(dataUrl, a.opacity);
  const injectJs = buildInjectJs(css);

  console.log(dataUrl
    ? `注入背景图：${resolve(a.image)}（遮罩 ${a.opacity}）`
    : '注入纯色渐变背景（未指定 --image）');
  console.log(`目标页面 ${chosen.length} 个：\n`);

  for (const t of chosen) {
    try {
      const cdp = await CDP.connect(t.webSocketDebuggerUrl);
      const r = await cdp.send('Runtime.evaluate', { expression: injectJs, returnByValue: true });
      cdp.close();
      const v = r && r.result && r.result.value;
      console.log(`  ✓ ${t.title || t.url}`);
      if (v && a.verbose) {
        console.log(`     视口: ${v.viewport}`);
        console.log(`     已透明化容器: ${(v.transparentized || []).join(', ') || '(无)'}`);
        console.log(`     候选容器: ${JSON.stringify(v.candidateContainers)}`);
      }
    } catch (e) {
      console.error(`  ✗ ${t.title}: ${e.message}`);
    }
  }
  console.log('\n完成。若背景未生效，请用 --verbose 查看 DOM 结构后精确调整。');
}

main().catch(e => { console.error('✗ 未捕获错误:', e); process.exit(1); });
