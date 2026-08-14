// WorkBuddy 皮肤 CSS 生成（v0.5.0）
//
// 关键改进（融合自 cdredfox/workbuddy-skin-studio 的“好部分”）：
// 1) 不再用“扫描 body * + 面积阈值”的脆弱启发式去逐个透明化容器，
//    而是锚定 WorkBuddy renderer 的稳定选择器（#root / .teams-container /
//    [data-view-id]），并把壁纸挂到 #root 上。这些锚点非 CSS-module 哈希类名，
//    跨版本稳定。
// 2) 利用 WorkBuddy 自带的 --cb-* 设计令牌系统：覆写 --cb-text-primary 等
//    即可“全局”换文字色（带 !important 可压过 app 自身的 !important 黑字规则），
//    取代我们原先“逐个元素内联强制”的兜底逻辑。
// 3) 背景 token（--cb-bg-*）透出，让 #root 壁纸在面板后显示；面板用磨砂玻璃。

export const STYLE_ID = 'wb-skin-studio-style';
export const MENU_ID = 'wb-skin-studio-menu';

// 菜单自定义上传用的 CSS 模板哨兵（页面内替换，与内置主题同源，避免两套模板漂移）
export const CSS_SENTINELS = {
  id: 'workbuddy-custom-sentinel-id',
  hero: 'data:image/png;base64,WORKBUDDYHEROSENTINEL',
  accent: '#010203',
  secondary: '#040506',
  surface: '#070809',
  text: '#0a0b0c',
  frost: '#0c0d11',
};

const DEFAULT_COLORS = {
  accent: '#24c9d7',
  secondary: '#ef8fd3',
  surface: '#0e1016',
  text: '#f4f6fc',
  frost: 'rgba(14,16,22,0.62)',
};

function hexOr(value, fallback) {
  return typeof value === 'string' && /^#[0-9a-f]{3,8}$/i.test(value) ? value : fallback;
}

function color(value, fallback) {
  return hexOr(value, fallback);
}

/**
 * 由背景明暗推导一套配色（CLI / 内置预设共用）。
 * @param {{luminance?:number, mode?:'dark'|'light', accent?:string}} info
 */
export function paletteFromLuminance(info = {}) {
  const lum = typeof info.luminance === 'number' ? info.luminance : 128;
  const dark = info.mode ? info.mode === 'dark' : lum < 128;
  const accent = hexOr(info.accent, DEFAULT_COLORS.accent);
  return {
    accent,
    secondary: hexOr(info.secondary, DEFAULT_COLORS.secondary),
    surface: dark ? '#0e1016' : '#f8faff', // 实心代表色，供 VS Code 主题模式判断深浅
    text: dark ? '#f4f6fc' : '#0f1830',
    frost: dark ? 'rgba(12,14,20,0.64)' : 'rgba(248,250,255,0.82)',
  };
}

/**
 * 生成皮肤 CSS。
 * @param {{imageDataUrl:string, colors?:object, opts?:object}} param0
 *   colors: { id?, accent, secondary, surface, text, frost }
 *   opts:   { opacity?, cardBg? }
 */
export function buildSkinCss({ imageDataUrl, colors = {}, opts = {} } = {}) {
  // 校验（允许 sentinel 占位，便于菜单模板复用同一套生成器）
  if (imageDataUrl !== CSS_SENTINELS.hero && !/^data:image\/(?:png|jpeg|webp|gif|avif);base64,/i.test(imageDataUrl)) {
    throw new Error('imageDataUrl 必须是 base64 图片');
  }
  const c = {
    id: String(colors.id ?? 'custom').replace(/[^a-z0-9_-]/gi, ''),
    accent: color(colors.accent, DEFAULT_COLORS.accent),
    secondary: color(colors.secondary, DEFAULT_COLORS.secondary),
    surface: color(colors.surface, DEFAULT_COLORS.surface),
    text: color(colors.text, DEFAULT_COLORS.text),
    frost: colors.frost ? colors.frost : DEFAULT_COLORS.frost,
  };
  const opacity = typeof opts.opacity === 'number' ? opts.opacity : 0.45;
  const veil = `rgba(8,10,14,${opacity})`;
  const heroBg = imageDataUrl
    ? `linear-gradient(${veil}, ${veil}), url(${JSON.stringify(imageDataUrl)})`
    : `linear-gradient(135deg, #14161c 0%, #1d2230 50%, #2a2138 100%)`;

  // 兼容旧版 --card-bg 手动覆盖（默认用 frost 自动）
  const cardBg = typeof opts.cardBg === 'string' && opts.cardBg !== 'auto' && opts.cardBg !== 'transparent'
    ? opts.cardBg
    : `color-mix(in srgb, ${c.frost} 88%, transparent)`;

  return `/* WORKBUDDY_SKIN:${c.id} */
:root,
body[data-application-name=workbuddy] {
  --wb-accent: ${c.accent};
  --wb-frost: ${c.frost};
  --wb-text: ${c.text};
  --wb-surface: ${c.surface};

  /* 文字 token 全局覆盖：压过 app 自带 !important 黑字，覆盖绝大多数文本 */
  --cb-text-primary: var(--wb-text) !important;
  --cb-text-secondary: color-mix(in srgb, var(--wb-text) 72%, transparent) !important;
  --cb-text-disabled: color-mix(in srgb, var(--wb-text) 42%, transparent) !important;
  --cb-text-link: var(--wb-accent) !important;
  --cb-text-error-active: var(--wb-accent) !important;
  --cb-vscode-foreground: var(--wb-text) !important;
  --cb-vscode-editor-foreground: var(--wb-text) !important;
  --cb-vscode-descriptionForeground: color-mix(in srgb, var(--wb-text) 72%, transparent) !important;

  /* 背景 token 透出，让 #root 壁纸显示 */
  --cb-bg-primary: transparent !important;
  --cb-bg-secondary: transparent !important;
  --cb-panel-bg-primary: transparent !important;
}

html, body { background: transparent !important; }

/* 壁纸图层：挂在 #root（稳定锚点，非哈希类名） */
#root {
  background: ${heroBg} center / cover no-repeat fixed !important;
}

/* 遮挡壁纸的大容器透明化（稳定锚点，取代面积阈值扫描） */
.teams-container,
.teams-container.is-mac { background: transparent !important; }
[data-view-id] { background: transparent !important; }
.conversation-list,
.main-content,
.main-content--welcome,
.sidebar-next { background: transparent !important; }

/* 侧边栏磨砂玻璃 */
[data-view-id=sidebar] {
  background: color-mix(in srgb, var(--wb-frost) 70%, transparent) !important;
  border-right: 1px solid color-mix(in srgb, var(--wb-accent) 40%, transparent) !important;
  backdrop-filter: blur(10px) saturate(1.1) !important;
  -webkit-backdrop-filter: blur(10px) saturate(1.1) !important;
}
/* 主内容区：上方透出底图，下方渐变磨砂保证输入区可读 */
[data-view-id=main-content] {
  background: linear-gradient(180deg, transparent 0 38%, color-mix(in srgb, var(--wb-frost) 80%, transparent) 100%) !important;
}
/* 详情面板磨砂 */
[data-view-id=detail-panel] {
  background: color-mix(in srgb, var(--wb-frost) 90%, transparent) !important;
  backdrop-filter: blur(16px) saturate(1.05);
  -webkit-backdrop-filter: blur(16px) saturate(1.05);
}

/* 顶部状态栏透明融合 */
.workbuddy-topbar,
.workbuddy-topbar--mac,
.workbuddy-topbar--scrolled,
.workbuddy-topbar--primary {
  background-color: transparent !important;
  background-image: none !important;
  border-bottom: none !important;
  box-shadow: none !important;
  backdrop-filter: blur(4px) !important;
  -webkit-backdrop-filter: blur(4px) !important;
}

/* 消息气泡 / Markdown 底纹 + 文字色 */
.cb-markdown,
.cb-markdown-pre-wrapper,
[class*="userMessageBubble"] {
  background-color: ${cardBg} !important;
  color: var(--wb-text) !important;
  border-radius: 12px !important;
  box-shadow: 0 1px 6px rgba(0,0,0,.18);
}
.cb-markdown { padding: 12px 16px !important; }
[class*="userMessageBubble"] { padding: 10px 14px !important; }
/* 代码块保持自身背景，不强压文字色（保护语法高亮） */
.cb-markdown-pre-container { background-color: rgba(30,30,35,0.85) !important; border-radius: 8px !important; }
.cb-markdown pre, .cb-markdown pre *, .cb-markdown code, .cb-markdown code * { color: inherit !important; }
`;
}

/**
 * 生成“哨兵占位”的 CSS 模板，供菜单页内替换（自定义上传 / 切换）。
 * 与 buildSkinCss 同源，避免漂移。
 */
export function buildSkinCssTemplate() {
  return buildSkinCss({
    imageDataUrl: CSS_SENTINELS.hero,
    colors: {
      id: CSS_SENTINELS.id,
      accent: CSS_SENTINELS.accent,
      secondary: CSS_SENTINELS.secondary,
      surface: CSS_SENTINELS.surface,
      text: CSS_SENTINELS.text,
      frost: CSS_SENTINELS.frost,
    },
    opts: {},
  });
}
