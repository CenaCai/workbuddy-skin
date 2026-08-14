# 更新日志 / Changelog

本文件记录 **workbuddy-skin** 技能的演变过程。当前最新版本为 **v0.5.6**。

---

## 当前设定总结（v0.5.0）

一句话：**通过 Electron/Chromium 的 CDP 通道，在运行时把任意图片注入为 WorkBuddy 桌面端的整体背景；用稳定 DOM 锚点 + WorkBuddy 原生 `--cb-*` 设计令牌做全局换色与透明化，并提供一个应用内 换肤 菜单随时切换背景或上传图片，全程零侵入（不修改 `app.asar`、二进制或签名）。**

### 机制

- **零侵入注入**：WorkBuddy 基于 Electron（Chromium），其渲染进程支持 Chrome DevTools Protocol。脚本在 WorkBuddy 以 `--remote-debugging-port=9222` 启动后，通过 CDP WebSocket 注入样式与菜单脚本，不触碰官方程序本体。
- **稳定 DOM 锚点（v0.5.0 新架构）**：
  - 壁纸挂在 `#root`（全屏根节点）。
  - `.teams-container` 与 `[data-view-id]`（`sidebar` / `main-content` / `detail-panel` / `sources-panel`）透明化，让壁纸在各面板后透出。
  - 这些锚点不是 CSS-module 哈希类名，跨版本稳定；不再依赖 v0.4.x 的“扫描 `body *` + 面积阈值 ≥ 8%”启发式。
- **原生 `--cb-*` 设计令牌覆盖（v0.5.0）**：WorkBuddy 自身使用 `--cb-text-primary`、`--cb-bg-primary` 等 token。通过 `!important` 覆写这些 token，可全局切换文字色并压过 app 自带的 `!important` 黑字规则；同时把背景 token 设为 `transparent`，让 `#root` 壁纸显示。这取代了 v0.4.x 复杂的“逐个元素内联强制”兜底逻辑。
- **磨砂玻璃面板**：侧边栏、主内容区底部、详情面板使用 `color-mix()` + `backdrop-filter: blur(...)`，在透出背景图的同时保证文字可读。
- **应用内 换肤 菜单**：注入成功后，WorkBuddy 右上角出现菜单按钮，可切换当前背景 / 内置预设、上传本地图片（Canvas 自动取色）、一键还原原生界面。
- **还原性**：`--restore` 移除新样式标签（`wb-skin-studio-style` / `wb-skin-studio-menu`），并清理旧版 v0.4.x 残留（`__wb_skin_style__` 与内联 `dataset` 标记）。
- **零依赖**：`inject.mjs` 仅用 Node 22 内置的 `WebSocket` / `fetch`，无需 `npm install`。

### 目录结构

```
workbuddy-skin/
├── SKILL.md                      # 技能定义（触发词/用法/兼容性）
├── CHANGELOG.md                  # 本文件
├── README.md                     # 面向人的使用文档
├── LICENSE                       # MIT © CenaCai
├── .gitignore
├── references/how-it-works.md    # 底层机制、真机 DOM 类名表、透明化启发式、踩坑
└── scripts/
    ├── inject.mjs                # 零依赖 CDP 注入器（核心编排）
    ├── analyze-bg.py             # Python 背景亮度分析器（Pillow）
    ├── apply-skin.sh             # 一键：退出 → 带调试端口重启 → 注入
    ├── restore.sh                # 运行时还原
    ├── start-debug.sh            # 仅带端口重启（DOM 调试）
    ├── background.png            # 内置占位壁纸（深紫蓝渐变）
    └── src/
        ├── skin-css.mjs          # CSS 生成器（锚点 + token + 磨砂玻璃）
        └── skin-menu.mjs         # 应用内 换肤 菜单脚本生成器
```

### 核心参数（`inject.mjs`）

| 参数 | 默认值 | 说明 |
| --- | --- | --- |
| `--port` | `9222` | CDP 调试端口 |
| `--image <path>` | — | 背景图片路径（建议 16:9）；不指定则注入内置渐变 |
| `--css <path>` | — | 自定义 CSS 文件路径（替代默认背景样式，并跳过菜单） |
| `--opacity <f>` | `0.45` | 背景遮罩不透明度（浅色图用 `0.03`~`0.05`，深色图用 `0.1`~`0.3`） |
| `--card-bg <rgba\|auto\|transparent>` | `auto` | 消息/回复内容底纹；`auto` 随背景明暗自动切换，传 `transparent` 可禁用 |
| `--auto-text [true\|false]` | `true` | 根据背景明暗自动调整文字颜色 |
| `--auto-text-threshold <n>` | `128` | 自动文字颜色亮度阈值（0~255） |
| `--no-menu` | — | 仅注入背景，不加载应用内 换肤 菜单 |
| `--restore` | — | 还原官方外观 |
| `--list` | — | 查看当前注入状态 |
| `--verbose` | — | 输出注入细节 |
| `--help` | — | 帮助 |

### 自动生效的四件事

1. **整体背景**：`#root` 铺满背景图 + 暗/亮遮罩（`--opacity` 控制）。
2. **背景亮度分析**：`scripts/analyze-bg.py` 采样壁纸，按感知亮度公式判断 `dark`/`light`；菜单上传图片时改由页内 Canvas 取色。
3. **全局文字与面板配色**：覆写 `--cb-text-primary/secondary/disabled/link`、`--cb-vscode-foreground` 等 token，自动切换深浅文字；`--cb-bg-*` 设为透明让壁纸透出。
4. **磨砂玻璃与消息底纹**：侧边栏 / 主内容区 / 详情面板加半透明磨砂背景；`.cb-markdown` 与用户消息气泡加圆角底纹，代码块容器单独保护语法高亮。

### 日常使用命令

```bash
# 换壁纸（调试端口已在线时无需重启），默认带 换肤 菜单
node scripts/inject.mjs --port 9222 --image /path/to/bg.png --opacity 0.45

# 不需要应用内菜单
node scripts/inject.mjs --image /path/to/bg.png --no-menu

# 一键重启并注入（首次或端口未开时用）
./scripts/apply-skin.sh --image /path/to/bg.png --opacity 0.45

# 还原官方外观
node scripts/inject.mjs --restore

# 查看注入状态
node scripts/inject.mjs --list
```

### 背景图制作建议

- 比例 **16:9**（如 1920×1080）；主体偏一侧、中央/左侧留白，避免图案压在聊天文字区。
- 浅色图配 `--opacity 0.03`~`0.05`；深色图配 `0.1`~`0.3`。
- 无透明通道的图片若底色过深导致文字不清，可用 Python（`PIL` + 颜色距离抠图/重新合成浅灰底）或 ImageGen（image-to-image 扩展）预处理。

### 已知限制（务必知晓）

- **仅 macOS 可用**：`apply-skin.sh` 用 `osascript` 退出、`nohup` 重启 Electron，依赖 macOS。
- **系统标题栏改不了**：最顶部带红/黄/绿三个按钮的窄条是 macOS 窗口装饰，在 Chromium 渲染层之外，任何注入方案都无法修改。
- **跨重启保留**：当前靠每次启动时 `apply-skin.sh` 重新注入；若需“永久常驻”，需额外用 `launchd` plist 拉起带调试端口的 WorkBuddy 并自动注入（比现在更重）。
- **重新生成消耗 credits**：ImageGen 每次约 5–10 credits，且结果带 unavoidable 的“AI生成”角标。

---

## 版本历史

### v0.5.6 — 2026-08-14

- **修复“切换原生浅色界面无效 / 依旧全黑”**：根因并非主题 class 没切，而是 WorkBuddy 的表面令牌 `--wb-home-bg-primary` 由 **`html[data-theme]`** 驱动——打包 CSS 用 `[data-theme="dark"] .teams-container.is-mac`（特异性 `0,3,0`）锁定深色值 `#1f1f1f`，其特异性高于未加守卫的浅色规则 `.teams-container.is-mac`（特异性 `0,2,0`，值 `#f2f2f2`）。旧版 `applyMode` 只切换了 `light/vscode-light/cb-light` 等 **class** 与 `dataset.vscodeThemeKind/Name`，却**从没动过 `html.dataset.theme`**，导致 `<html>` 上残留的 `data-theme="dark"` 始终让深色规则胜出——视觉上就是切到“原生界面（浅色）”后侧栏/主区/顶栏仍死黑（上一次探测：`--wb-home-bg-primary` 计算值仍为 `#1f1f1f`，`teamsBg: rgb(31,31,31)`）。
- **修复方式**：`applyMode(surface)` 现在除切 class 外，会**显式同步 `html.dataset.theme`**（浅色 surface → `'light'`、深色 surface → `'dark'`），让 `[data-theme="dark"]` 祖先匹配消失、未加守卫的浅色规则立即生效；并在 `originalState` / `restoreOriginalMode` 中保存与还原 `html.dataset.theme`，保证“还原原生/自定义图片”退出时不破坏 WorkBuddy 自身的主题记号。附带效果：自定义图片与主题也会按背景明暗正确设置 `data-theme`，文字/面板配色跟随切换。
- **验证**：CDP 探针在切到原生浅色后实测 `htmlTheme=light`、`--wb-home-bg-primary=#f2f2f2`、`teamsBg/sidebarBg=rgb(242,242,242)`；浅→深→浅来回切换均正确，并在 0/3/6/12 秒连续采样中**稳定不回退**（之前偶发的 ~5s 回退正是 `data-theme="dark"` 与浅色 class 互相矛盾触发的不一致所致，根因消除后消失）。
- **同期补充：修复 CLI 换图被菜单 persistence 覆盖**。手动 `node inject.mjs --image xxx` 时，菜单加载会读取 `localStorage` 中保存的 `native-light`/`native-dark`/`custom-upload` 并恢复，导致新注入的图片不生效（例如本次处理《鬼灭之刃》换图时，localStorage 仍保存着之前的 `native-dark`，注入后界面先显示图片随即被恢复成原生深色）。新增 `--preserve-state` 标志：手动 CLI 默认**不保留旧状态**，注入前把 `localStorage` 设为 `{mode:'theme',themeId:'active'}`，让新图立即成为当前主题；daemon 自动重注入时传 `--preserve-state`，继续尊重用户上次的原生模式或自定义上传，保证 v0.5.5 持久化行为不变。守护脚本已同步加 `--preserve-state`。

### v0.5.5 — 2026-08-14

- **模式持久化**：`scripts/src/skin-menu.mjs` 在切换皮肤 / 自定义上传 / 原生浅色 / 原生深色时，将当前模式写入 `localStorage`（`wbSkinStudioState`：mode = `theme` | `native-light` | `native-dark` + themeId）；每次（重新）注入时按该状态自动恢复，原生模式不再随重启丢失。守护重注入后无需用户重新点选。
- 守护 `workbuddy-skin-daemon.mjs` 移除原先的"自定义上传单独恢复"逻辑（改为由菜单统一恢复，避免与持久化原生模式冲突）。
- **守护脚本修复（同日补丁）**：`killWb` 内使用了 `await` 却未声明为 `async`，导致脚本一启动就 `SyntaxError`、守护进程每轮轮询崩溃（launchctl 状态恒为 `1`），端口永远打不开。已改为 `async function killWb()` 并在主循环 `await` 它。修复后守护在下一轮 30s 轮询自行生效：强制重启 WorkBuddy（带端口 9222）→ 重新注入皮肤 → 顶栏「切换背景」按钮恢复。
- **按钮挂接位置修复（同日补丁）**：`mountButton` 原先用 `button[aria-label*="对话内搜索"] || button[aria-label*="搜索"]` 选址，守护在界面未完全渲染时（主顶栏「对话内搜索」尚不存在）会命中**侧栏**的「搜索」按钮，把「切换背景」按钮插进左侧栏顶栏而非主内容区顶栏，导致用户看不到。改为**只认主内容区 `.workbuddy-topbar-actions` 内的「对话内搜索」**，绝不落入侧栏；并新增 MutationObserver「情况2」：按钮已挂载但主顶栏后来出现且它不在主顶栏时，自动搬到主顶栏。重新注入后实测 `location=MAIN_TOPBAR / left-of-搜索`。

### v0.5.4 — 2026-08-14

- **常驻守护（自动恢复）**：新增 `scripts/workbuddy-skin-daemon.mjs` 与 `~/Library/LaunchAgents/com.cenacai.workbuddy.skin.plist`，解决"注入是运行时内存态、WorkBuddy 自动更新 / 普通重启后按钮与端口全清"的问题。
  - 守护每轮巡检：WorkBuddy 没在跑 → 带端口启动（可用 `WB_SKIN_NO_AUTOSTART=1` 关闭）；在跑但端口没开 → 退出并以带端口方式重启（覆盖自动更新 / 双击启动）；端口开着但未注入 → 自动重新注入（默认背景，并从 `localStorage` 恢复上次自定义上传）；已注入 → 不动。
  - `RunAtLoad` + 每 30s 巡检；日志写入 `workbuddy-skin-daemon.log`。
  - 仅新增文件，**不改**任何注入逻辑；零依赖（Node 22 内置 WebSocket/fetch/child_process）。

### v0.5.3 — 2026-08-14

- **修复“切换背景”按钮凭空消失**：根因是按钮被命令式插入到 React 受控的顶部功能栏（`.workbuddy-topbar-actions`）。切换主题（含点击「原生界面（浅色/黑色）」）、导航或任何 React 重渲染时，React 在调和子节点时会把不认识的按钮一并移除，而面板与 `<style>` 因挂在 `body`/`head` 上得以幸存。
- **自愈挂载（MutationObserver）**：新增对稳定节点 `#root` 子树的 `MutationObserver`，按钮一旦脱离文档即在一个 `requestAnimationFrame` 内重新挂回原位置（常态 mutation 回调立即返回、零额外开销）；上一次注入遗留的观察者会在重注入时被 `disconnect()`，避免泄漏。
- 仅改 `scripts/src/skin-menu.mjs`，无需重新生成样式/CSS。

### v0.5.2 — 2026-08-14

- **“原生界面”拆分为两个独立选项**：菜单中原来的单一“原生界面”改为「原生界面（浅色）」与「原生界面（黑色）」两项，点击分别清空皮肤样式并显式切到 WorkBuddy 原生浅色 / 深色模式（类 `light vscode-light cb-light` / `dark vscode-dark cb-dark`），背景图与所有皮肤配色一并移除。
- **选中态跟踪**：新增 `activeNativeKey` 跟踪当前选中的原生模式，菜单重新打开时高亮对应的原生项。
- `window.__wbSkin` 测试钩子新增 `setNativeMode('light' | 'dark')`。

### v0.5.1 — 2026-08-14

- **菜单按钮融入顶部功能栏**：皮肤菜单按钮从右上角浮动改为插入主内容区顶部功能栏，放在“对话内搜索”按钮左侧；使用与 WorkBuddy 同风格的 `wb-icon` 线型图标（调色板）。
- **选中状态改为浅黄色**：按钮与菜单项的选中高亮由浅蓝色改为 `rgba(255, 193, 7, .18/.22)` 浅黄色。
- **修复“原生界面”颜色还原不完整**：选择原生界面时，除了清空注入样式，还会把 `html`/`body` 的 class、`colorScheme`、`dataset.vscodeThemeKind/Name` 恢复到菜单注入前的原始状态，避免侧栏文字仍被强制为白色。
- **挂载逻辑更稳健**：若首次注入时顶部功能栏尚未渲染，会轮询等待最多 2 秒，超时后才回退到右上角悬浮。

### v0.5.0 — 2026-08-14

- **架构升级：稳定锚点 + `--cb-*` 设计令牌（融合 cdredfox/workbuddy-skin-studio）**：
  -  wallpaper 挂到 `#root`，面板透明化改用 `.teams-container` 与 `[data-view-id]`（`sidebar` / `main-content` / `detail-panel` / `sources-panel`），彻底替换 v0.4.x 的“扫描 `body *` + 面积阈值 ≥ 8%”启发式。
  -  用 `!important` 覆写 WorkBuddy 原生 `--cb-text-primary/secondary/disabled/link`、`--cb-vscode-foreground`、`--cb-bg-primary/secondary`、`--cb-panel-bg-primary` 等 token，全局切换文字色并压过 app 自带的 `!important` 黑字规则；背景 token 设为 `transparent` 让壁纸透出。这解决了 v0.4.2 需要“内联 JS 强制兜底”的根源问题。
  -  面板使用 `color-mix()` + `backdrop-filter: blur(...)` 磨砂玻璃，兼顾背景图透出与文字可读。
- **新增应用内 换肤 菜单**：注入后 WorkBuddy 右上角出现菜单按钮，可切换当前背景 / 内置预设、上传本地图片（页内 Canvas 自动取色）、一键还原原生界面。
- **新增 `--no-menu` 参数**：CLI 换图时可选择不加载应用内菜单。
- **代码结构模块化**：新增 `scripts/src/skin-css.mjs` 与 `scripts/src/skin-menu.mjs`，CSS 模板与菜单脚本同源生成，避免两套逻辑漂移。
- **向后兼容**：保留全部旧 CLI 参数；`--restore` 同时清理新版 `wb-skin-studio-style` / `wb-skin-studio-menu` 与旧版 `__wb_skin_style__` 残留。

### v0.4.2 — 2026-08-14

- **修复左侧栏“置顶对话”黑字看不清**：真实 DOM 探测发现，侧栏里被 app 用**更高 specificity 的 `!important` 黑字规则**（如置顶对话的标题 `_title_11ei8_23`、时间 `_time_11ei8_231`，specificity `0,2,0`）覆盖，文档层 CSS 的 `[class*="sidebar"] *`（`0,1,1`）赢不过它，导致约 53 个置顶项文字在深色磨砂底上几乎不可见。实验确认：内联 `style` 的 `!important` 优先级高于任何选择器（含 `!important`），因此 `buildInjectJs` 在注入 JS 末尾追加一段兜底逻辑——遍历 `.conversation-sidebar` 内“叶子文本元素”，对计算亮度 `<120` 者用 `setProperty('color', tc, 'important')` 强制套用自适应文字色，并用 `dataset.wbSkinText` 标记；`--restore` 时一并清理。验证：重新注入后侧栏文字分布由「592 白 + 53 黑」变为「645 全白」。
- **调浅左侧栏磨砂底**：`sidebarRules` 背景由 `rgba(18,20,26,0.78)` + `blur(10px)` 调整为 `rgba(22,24,32,0.60)` + `blur(8px)`（仍保留 `!important` 压过动态透明化），让背景图在侧栏透出更多、整体更融合，同时白字依旧清晰；并补一条极淡的右侧分隔线 `border-right: 1px solid rgba(255,255,255,0.06)`。
- 提交：`3074604`

### v0.4.1 — 2026-08-14

- **左侧栏磨砂半透明深色底（增强复杂/深色壁纸可读性）**：真实 DOM 探测确认左侧栏容器为 `.conversation-sidebar`（约 264×799）。动态透明化 JS 会把它设成内联 `background-color: transparent` 让壁纸透出，但在复杂/深色壁纸上白字会叠在人物、图案上导致糊。新增 `sidebarRules`，以 `!important` 压过内联透明，给侧栏加 `background-color: rgba(18,20,26,0.78)` + `backdrop-filter: blur(10px)`，压暗并模糊背景，换取稳定可读性（背景图在侧栏内几乎不可见）。已用 computed style 验证生效。
- **修复 `--auto-text` CLI 参数解析**：原实现把布尔 flag 当有值参数处理，无值时报"缺少参数"；现支持 `--auto-text`（无值启用）、`--auto-text=false`、`--auto-text false` 三种写法。
- 提交：`0a8c116`（含 `75142ea` 的 CLI 修复）

### v0.4.0 — 2026-08-14

- **新增背景自适应文字颜色与自动消息底纹**：
  - 新增 `scripts/analyze-bg.py`：用 Pillow 采样壁纸左 60% 区域，按感知亮度公式 `0.299R+0.587G+0.114B` 输出 `dark`/`light`、推荐文字颜色、遮罩不透明度。
  - `inject.mjs` 新增 `--auto-text`（默认 `true`）与 `--auto-text-threshold`（默认 `128`）。
  - 根据分析结果自动注入：浅色背景 → 黑色文字 + `text-shadow: 0 1px 2px rgba(255,255,255,0.6)`；深色背景 → 白色文字 + `text-shadow: 0 1px 2px rgba(0,0,0,0.5)`。
  - 覆盖元素：顶部状态栏（`.workbuddy-topbar` 及其变体）、侧边栏/目录列表、AI 回复 `.cb-markdown`、用户消息气泡、`input`/`textarea`/`[contenteditable]` 输入框。
  - 代码块 `pre/code` 及 `.cb-markdown-pre-container` 被显式保护，避免破坏语法高亮。
- **`--card-bg` 默认改为 `auto`**：
  - 浅色背景 → `rgba(245,245,245,0.92)`
  - 深色背景 → `rgba(40,40,48,0.90)`
  - 仍接受显式 rgba 或 `transparent`。
- **`apply-skin.sh` / `restore.sh` 自动检测托管 Python**：优先使用 `/Users/cenacai/.workbuddy/binaries/python/versions/3.13.12/bin/python3`（已预装 Pillow），避免系统 `python3` 缺少依赖导致分析失败。
- 更新 `README.md` / `SKILL.md` / `references/how-it-works.md` 说明新参数与行为。
- 提交：`fc378f3`

### v0.3.0 — 2026-08-14

- **修复顶部状态栏不整体**：真机探测发现 `.workbuddy-topbar`（任务名/搜索/分享/历史提问/展开右栏）尺寸约 1016×56，占屏比约 0.056，低于启发式透明化阈值 0.08，一直保持实白 `rgb(255,255,255)`，与壁纸割裂。
  - 在注入样式中显式针对 `.workbuddy-topbar` / `--mac` / `--scrolled` / `--primary` 强制：`background-color: transparent`、`background-image: none`、去边框/阴影、`backdrop-filter: blur(4px)`（防滚动内容透出）。
  - 该规则随 `<style>` 标签在 `--restore` 时一并清除。
- 提交：`c2020c7`

### v0.2.0 — 2026-08-14

- **新增 `--card-bg` 可读性底纹**：背景图导致部分文字看不清时，给消息内容加灰框底纹。
  - AI 回复：`.cb-markdown`、`.cb-markdown-pre-wrapper` 加半透明浅色圆角底纹 + 阴影。
  - 用户消息：`[class*="userMessageBubble"]` 加同款底纹。
  - 代码块容器 `.cb-markdown-pre-container` 单独用半透明深色背景，避免破坏代码高亮。
  - 默认 `rgba(245,245,245,0.92)`；传 `transparent` 可禁用。
- 同步更新 `README.md` / `SKILL.md` / `references/how-it-works.md`。
- 提交：`e3f6602`

### v0.1.0 — 2026-08-13

- **初始版本**：WorkBuddy 桌面端换肤 CDP 注入技能（macOS）。
  - `scripts/inject.mjs`：零依赖 CDP 注入器，动态透明化启发式（阈值自 0.5 放宽到 0.08、透明化数量 4→12、显式保护交互元素）。
  - `scripts/apply-skin.sh`：一键退出 → 带 `--remote-debugging-port` 重启 → 等待 → 注入；默认回退到内置 `background.png`。
  - `scripts/restore.sh` / `start-debug.sh` 辅助脚本。
  - 内置占位壁纸 `background.png`。
  - `references/how-it-works.md`：机制、真机 DOM 类名表、踩坑；并明确第三方 Codex/HeiGe 皮肤不可直接用于 WorkBuddy。
- 提交：`5b54c21`
