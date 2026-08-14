// WorkBuddy 皮肤菜单（🎨 按钮 + 切换 / 自定义上传 / 还原原生）
//
// 融合自 cdredfox/workbuddy-skin-studio 的 skin-menu.mjs（MIT），并按本技能
// 的 token 体系（--wb-text / --wb-frost）做了适配：自定义上传时用 Canvas 取色，
// 直接算出与背景明暗匹配的文字色与磨砂色，免去外部取色脚本。
import { CSS_SENTINELS, STYLE_ID, MENU_ID, buildSkinCssTemplate } from './skin-css.mjs';

const HEX_COLOR = /^#[0-9a-f]{3,8}$/i;
const DEFAULT_ACCENT = '#24c9d7';

// 客户端 CSS 由 Node 端模板加哨兵生成，替换后与内置主题同源，避免两套模板漂移
export function buildSkinMenuScript({ entries, activeId, styleId = STYLE_ID, menuId = MENU_ID, cssTemplate } = {}) {
  if (!Array.isArray(entries) || entries.length === 0) {
    throw new Error('皮肤菜单至少需要一个主题');
  }
  const themes = entries.map((entry) => {
    if (!entry?.id || typeof entry.css !== 'string') throw new Error('主题条目缺少 id 或 css');
    return {
      id: String(entry.id),
      name: typeof entry.name === 'string' && entry.name.trim() ? entry.name : String(entry.id),
      accent: HEX_COLOR.test(entry.accent ?? '') ? entry.accent : DEFAULT_ACCENT,
      surface: typeof entry.surface === 'string' ? entry.surface : '#ffffff',
      css: entry.css,
    };
  });
  if (activeId !== null && !themes.some((theme) => theme.id === activeId)) {
    throw new Error(`当前主题不在菜单列表中：${activeId}`);
  }
  const payload = JSON.stringify({
    styleId,
    menuId,
    activeId,
    themes,
    cssTemplate: cssTemplate || buildSkinCssTemplate(),
    sentinels: CSS_SENTINELS,
    customId: 'custom-upload',
    storageKey: 'wbSkinStudioCustom',
  });

  return `(() => {
  const data = ${payload};

  let style = document.getElementById(data.styleId);
  if (!style) {
    style = document.createElement('style');
    style.id = data.styleId;
    document.head.appendChild(style);
  }

  // 移除旧菜单（包括可能已插入 topbar 的按钮和回退容器）
  document.getElementById(data.menuId)?.remove();
  document.querySelectorAll('button[data-wb-skin-btn]').forEach((b) => {
    const p = b.parentElement;
    if (p && p.dataset.wbSkinFallback) p.remove();
    else b.remove();
  });

  // 记录页面原始主题状态，用于“原生界面”时完整还原
  const htmlEl = document.documentElement;
  const bodyEl = document.body;
  const originalState = {
    htmlClasses: htmlEl.className,
    bodyClasses: bodyEl.className,
    htmlColorScheme: htmlEl.style.colorScheme || '',
    bodyVscodeThemeKind: bodyEl.dataset.vscodeThemeKind,
    bodyVscodeThemeName: bodyEl.dataset.vscodeThemeName,
  };

  // 菜单按钮：使用 WorkBuddy 同风格图标，插入顶部功能栏“对话内搜索”左侧
  const button = document.createElement('button');
  button.type = 'button';
  button.className = 'wb-button wb-button--ghost wb-button--medium wb-button--icon-only';
  button.dataset.wbSkinBtn = '1';
  button.setAttribute('aria-label', '切换背景');
  button.title = '切换背景';
  button.innerHTML = '<svg viewBox="0 0 16 16" fill="currentColor" xmlns="http://www.w3.org/2000/svg" width="16" height="16" class="wb-icon" aria-hidden="true"><path fill-rule="evenodd" d="M8 1.5a6.5 6.5 0 1 0 0 13 6.5 6.5 0 0 0 0-13ZM8 3a5 5 0 1 1 0 10A5 5 0 0 1 8 3Zm2.5 4a1 1 0 1 1-2 0 1 1 0 0 1 2 0Zm-3 3a1 1 0 1 1-2 0 1 1 0 0 1 2 0Zm4.5 0a1 1 0 1 1-2 0 1 1 0 0 1 2 0Z"/></svg>';

  // 把按钮放到顶部功能栏“对话内搜索”按钮左侧；找不到则回退到 body 右上角
  let fallbackRoot = null;
  const mountButton = () => {
    if (button.parentElement) return true; // 已经挂好
    // 优先定位主内容区顶部功能栏的“对话内搜索”按钮
    const searchBtn = document.querySelector('button[aria-label*="对话内搜索"]') || document.querySelector('button[aria-label*="搜索"]');
    const actions = searchBtn?.closest('.workbuddy-topbar-actions') || searchBtn?.closest('.conversation-list-topbar-actions');
    if (searchBtn && actions) {
      actions.insertBefore(button, searchBtn);
      return true;
    }
    return false;
  };
  if (!mountButton()) {
    // 页面可能还在渲染 topbar，短暂轮询后回退
    let attempts = 0;
    const tryMount = () => {
      if (mountButton()) return;
      if (++attempts < 20) setTimeout(tryMount, 100);
      else {
        // 回退：固定悬浮在右上角
        fallbackRoot = document.createElement('div');
        fallbackRoot.dataset.wbSkinFallback = '1';
        fallbackRoot.style.cssText = 'position:fixed;top:48px;right:16px;z-index:2147483000;';
        fallbackRoot.appendChild(button);
        document.body.appendChild(fallbackRoot);
      }
    };
    tryMount();
  }

  // 下拉面板：fixed 定位，跟随按钮位置
  const root = document.createElement('div');
  root.id = data.menuId;
  root.style.cssText = 'position:fixed;z-index:2147483000;font:500 13px/1.4 system-ui;user-select:none;';

  const panel = document.createElement('div');
  panel.style.cssText = 'display:none;margin-top:8px;min-width:210px;padding:6px;border-radius:12px;border:1px solid rgba(0,0,0,.1);background:rgba(255,255,255,.94);backdrop-filter:blur(16px);box-shadow:0 10px 30px rgba(0,0,0,.18);color:#17344f;';

  const rows = new Map();
  let activeNativeKey = null; // 'native-light' | 'native-dark' | null
  const currentSelection = () => htmlEl.dataset.wbSkin || activeNativeKey || null;
  const ACTIVE_ROW_BG = 'rgba(255, 193, 7, .18)';
  const ACTIVE_BTN_BG = 'rgba(255, 193, 7, .22)';
  const paint = (id) => {
    for (const [rowId, row] of rows) {
      row.style.background = rowId === id ? ACTIVE_ROW_BG : 'transparent';
      row.style.fontWeight = rowId === id ? '700' : '500';
    }
    // 按钮选中状态：浅黄色背景；原生/未选中时透明
    button.style.backgroundColor = id ? ACTIVE_BTN_BG : '';
  };
  const row = (label, dotColor, onPick, before) => {
    const item = document.createElement('div');
    item.style.cssText = 'display:flex;align-items:center;gap:8px;padding:7px 10px;border-radius:8px;cursor:pointer;';
    const dot = document.createElement('span');
    dot.style.cssText = 'width:10px;height:10px;border-radius:50%;flex:none;background:' + dotColor + ';';
    const text = document.createElement('span');
    text.textContent = label;
    item.append(dot, text);
    item.addEventListener('mouseenter', () => { if (item.style.fontWeight !== '700') item.style.background = 'rgba(0,0,0,.05)'; });
    item.addEventListener('mouseleave', () => paint(currentSelection()));
    item.addEventListener('click', () => onPick(item));
    if (before) panel.insertBefore(item, before); else panel.appendChild(item);
    return item;
  };

  // 同步切换 WorkBuddy 的 VS Code 主题模式，让原生控件（输入框/按钮等）跟着深浅色变
  const isLightSurface = (hex) => {
    const m = /^#([0-9a-f]{6})$/i.exec(hex || '');
    if (!m) return true;
    const v = parseInt(m[1], 16);
    return (0.299 * ((v >> 16) & 255) + 0.587 * ((v >> 8) & 255) + 0.114 * (v & 255)) > 140;
  };
  const applyMode = (surface) => {
    const dark = !isLightSurface(surface);
    const body = document.body;
    const html = document.documentElement;
    body.dataset.vscodeThemeKind = dark ? 'vscode-dark' : 'vscode-light';
    body.dataset.vscodeThemeName = dark ? 'IDE Dark' : 'IDE Light';
    html.style.colorScheme = dark ? 'dark' : 'light';
    ['light', 'vscode-light', 'cb-light', 'dark', 'vscode-dark', 'cb-dark'].forEach((cls) => {
      const isDarkCls = cls === 'dark' || cls === 'vscode-dark' || cls === 'cb-dark';
      body.classList.toggle(cls, dark ? isDarkCls : !isDarkCls);
      html.classList.toggle(cls, dark ? isDarkCls : !isDarkCls);
    });
  };
  const restoreOriginalMode = () => {
    // 还原“原生界面”：把 body/html 的 class、style、dataset 恢复到菜单注入前的状态
    bodyEl.className = originalState.bodyClasses;
    htmlEl.className = originalState.htmlClasses;
    htmlEl.style.colorScheme = originalState.htmlColorScheme;
    if (originalState.bodyVscodeThemeKind === undefined) delete bodyEl.dataset.vscodeThemeKind;
    else bodyEl.dataset.vscodeThemeKind = originalState.bodyVscodeThemeKind;
    if (originalState.bodyVscodeThemeName === undefined) delete bodyEl.dataset.vscodeThemeName;
    else bodyEl.dataset.vscodeThemeName = originalState.bodyVscodeThemeName;
  };
  const setTheme = (id) => {
    const theme = data.themes.find((candidate) => candidate.id === id);
    if (!theme) return;
    style.textContent = theme.css;
    htmlEl.dataset.wbSkin = theme.id;
    applyMode(theme.surface);
    paint(theme.id);
  };
  const clearTheme = () => {
    style.textContent = '';
    delete htmlEl.dataset.wbSkin;
    restoreOriginalMode();
    paint(null);
  };
  // 原生界面（白 / 黑）：清空皮肤样式后，显式切到对应原生浅色 / 深色模式
  const setNativeMode = (mode) => {
    clearTheme();
    applyMode(mode === 'dark' ? '#0e1016' : '#ffffff');
    activeNativeKey = mode === 'light' ? 'native-light' : 'native-dark';
    paint(activeNativeKey);
  };

  for (const theme of data.themes) {
    rows.set(theme.id, row(theme.name, theme.accent, () => { setTheme(theme.id); panel.style.display = 'none'; }));
  }

  // ---- 自定义图片：本地选图 -> 压缩 -> 取色 -> 生成 CSS -> 持久化 ----
  const buildCustomCss = (dataUrl, colors) => data.cssTemplate
    .split(data.sentinels.hero).join(dataUrl)
    .split(data.sentinels.accent).join(colors.accent)
    .split(data.sentinels.secondary).join(colors.secondary)
    .split(data.sentinels.surface).join(colors.surface)
    .split(data.sentinels.text).join(colors.text)
    .split(data.sentinels.frost).join(colors.frost)
    .split(data.sentinels.id).join(data.customId);

  const hex = (r, g, b) => '#' + [r, g, b].map((v) => Math.max(0, Math.min(255, Math.round(v))).toString(16).padStart(2, '0')).join('');
  const mix = (a, b, t) => a.map((v, i) => v + (b[i] - v) * t);
  const clamp255 = (v) => Math.max(0, Math.min(255, Math.round(v)));

  // 由图片采样计算与本技能 token 体系匹配的配色（文字色 + 磨砂色随明暗）
  const extractPalette = (canvas) => {
    const ctx = canvas.getContext('2d');
    const { data: px } = ctx.getImageData(0, 0, canvas.width, canvas.height);
    const buckets = new Map();
    let lumSum = 0, count = 0;
    for (let i = 0; i < px.length; i += 4) {
      const r = px[i], g = px[i + 1], b = px[i + 2];
      const max = Math.max(r, g, b), min = Math.min(r, g, b);
      const lum = 0.2126 * r + 0.7152 * g + 0.0722 * b;
      lumSum += lum; count += 1;
      const sat = max === 0 ? 0 : (max - min) / max;
      if (sat < 0.18 || lum < 24 || lum > 245) continue; // 灰、过暗、过曝不参与取主色
      const d = max - min || 1;
      let h = max === r ? (g - b) / d + (g < b ? 6 : 0) : max === g ? (b - r) / d + 2 : (r - g) / d + 4;
      const bucket = Math.round(h) % 6 * 2 + (sat > 0.55 ? 1 : 0);
      const entry = buckets.get(bucket) ?? { w: 0, r: 0, g: 0, b: 0, h: h * 60 };
      const weight = sat * sat;
      entry.w += weight; entry.r += r * weight; entry.g += g * weight; entry.b += b * weight;
      buckets.set(bucket, entry);
    }
    const avgLum = count ? lumSum / count : 128;
    const ranked = [...buckets.values()].sort((a, b2) => b2.w - a.w)
      .map((e) => ({ rgb: [e.r / e.w, e.g / e.w, e.b / e.w], h: e.h, w: e.w }));
    const accent = ranked[0]?.rgb ?? [36, 201, 215];
    const second = ranked.find((e) => Math.abs(e.h - (ranked[0]?.h ?? 0)) > 50)?.rgb
      ?? mix(accent, [255, 255, 255], 0.35);
    const dark = avgLum < 128;
    const surface = dark ? [14, 16, 22] : [248, 250, 255];
    const text = dark ? [244, 246, 252] : [15, 24, 48];
    const frost = dark ? [12, 14, 20, 0.64] : [248, 250, 255, 0.82];
    return {
      accent: hex(clamp255(accent[0]), clamp255(accent[1]), clamp255(accent[2])),
      secondary: hex(clamp255(second[0]), clamp255(second[1]), clamp255(second[2])),
      surface: hex(surface[0], surface[1], surface[2]),
      text: hex(text[0], text[1], text[2]),
      frost: 'rgba(' + frost.map(clamp255).join(',') + ')',
    };
  };

  const applyCustomTheme = (theme) => {
    style.textContent = buildCustomCss(theme.dataUrl, theme.colors);
    document.documentElement.dataset.wbSkin = data.customId;
    applyMode(theme.colors.surface);
    ensureCustomRow(theme);
    paint(data.customId);
  };

  let customRow = null;
  const deleteCustom = () => {
    try { localStorage.removeItem(data.storageKey); } catch {}
    if (document.documentElement.dataset.wbSkin === data.customId) clearTheme();
    customRow?.remove();
    rows.delete(data.customId);
    customRow = null;
  };
  const ensureCustomRow = (theme) => {
    if (customRow) { customRow.querySelector('span + span').textContent = theme.name; customRow.firstChild.style.background = theme.colors.accent; return; }
    customRow = row(theme.name, theme.colors.accent, () => { applyCustomTheme(loadCustom() ?? theme); panel.style.display = 'none'; }, uploadRow);
    const text = customRow.querySelector('span + span');
    text.style.cssText = 'flex:1;min-width:0;overflow:hidden;text-overflow:ellipsis;white-space:nowrap;';
    const del = document.createElement('span');
    del.textContent = '×';
    del.title = '删除自定义主题';
    del.style.cssText = 'flex:none;width:18px;height:18px;line-height:18px;text-align:center;border-radius:50%;color:rgba(0,0,0,.45);font-size:14px;';
    del.addEventListener('mouseenter', () => { del.style.background = 'rgba(220,60,60,.15)'; del.style.color = '#c03030'; });
    del.addEventListener('mouseleave', () => { del.style.background = 'transparent'; del.style.color = 'rgba(0,0,0,.45)'; });
    del.addEventListener('click', (event) => { event.stopPropagation(); deleteCustom(); });
    customRow.appendChild(del);
    rows.set(data.customId, customRow);
  };

  const loadCustom = () => {
    try {
      const saved = JSON.parse(localStorage.getItem(data.storageKey) ?? 'null');
      return saved && saved.dataUrl && saved.colors ? saved : null;
    } catch { return null; }
  };
  const saveCustom = (theme) => {
    try { localStorage.setItem(data.storageKey, JSON.stringify(theme)); }
    catch (error) { console.warn('WorkBuddy Skin：自定义主题图片过大，本次生效但重启后不保留', error); }
  };

  const importFromDataUrl = (dataUrl, name) => new Promise((resolve, reject) => {
    const img = new Image();
    img.onload = () => {
      const scale = Math.min(1, 1600 / img.width);
      const full = document.createElement('canvas');
      full.width = Math.round(img.width * scale);
      full.height = Math.round(img.height * scale);
      full.getContext('2d').drawImage(img, 0, 0, full.width, full.height);
      const sample = document.createElement('canvas');
      sample.width = 48; sample.height = Math.max(1, Math.round(48 * img.height / img.width));
      sample.getContext('2d').drawImage(img, 0, 0, sample.width, sample.height);
      const theme = {
        name: name || '我的图片',
        dataUrl: full.toDataURL('image/webp', 0.8),
        colors: extractPalette(sample),
      };
      saveCustom(theme);
      applyCustomTheme(theme);
      resolve(theme.colors);
    };
    img.onerror = () => reject(new Error('图片读取失败'));
    img.src = dataUrl;
  });

  const picker = document.createElement('input');
  picker.type = 'file';
  picker.accept = 'image/png,image/jpeg,image/webp';
  picker.style.display = 'none';
  picker.addEventListener('change', () => {
    const file = picker.files?.[0];
    if (!file) return;
    const reader = new FileReader();
    reader.onload = () => importFromDataUrl(reader.result, file.name.replace(/\\.[a-z0-9]+$/i, ''));
    reader.readAsDataURL(file);
    picker.value = '';
    panel.style.display = 'none';
  });

  const uploadRow = row('＋ 自定义图片', 'rgba(36,201,215,.9)', () => picker.click());
  uploadRow.style.borderTop = '1px solid rgba(0,0,0,.08)';

  const nativeLight = row('原生界面（白）', 'rgba(248,250,255,.95)', () => { setNativeMode('light'); panel.style.display = 'none'; });
  const nativeDark = row('原生界面（黑）', 'rgba(20,22,28,.95)', () => { setNativeMode('dark'); panel.style.display = 'none'; });
  rows.set('native-light', nativeLight);
  rows.set('native-dark', nativeDark);

  const saved = loadCustom();
  if (saved) ensureCustomRow(saved);

  button.addEventListener('click', () => {
    if (panel.style.display === 'none') {
      const rect = button.getBoundingClientRect();
      root.style.top = (rect.bottom + 6) + 'px';
      root.style.left = Math.max(8, rect.right - 216) + 'px';
      panel.style.display = 'block';
    } else {
      panel.style.display = 'none';
    }
  });

  root.append(panel, picker);
  document.body.appendChild(root);
  if (data.activeId === null) clearTheme();
  else setTheme(data.activeId);

  // 供脚本化调用与测试：window.__wbSkin.importFromDataUrl(dataUrl, name)
  window.__wbSkin = { importFromDataUrl, setTheme, clearTheme, setNativeMode, deleteCustom };
  return true;
})()`;
}
