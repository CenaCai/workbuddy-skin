# WorkBuddy 换肤：底层机制与实战笔记

本文档是 `workbuddy-skin` 技能的详细参考，记录经真机验证的机制、DOM 选择器和踩坑。

## 1. 可行性结论

WorkBuddy 桌面端 = Electron 37.10.3 + Chromium 138 + `app.asar`，存在 `WorkBuddy Helper (Renderer)` 进程，用户数据目录 `~/.workbuddy/app/`。当前版本 5.3.12 **没有官方背景自定义入口**（`app-config.json` 的 `personalization` 仅含 `toneStyle`/`customPrompt`）。

但 WorkBuddy 与 Codex 技术栈相同（都是 Electron/Chromium），Codex-Dream-Skin 所用的 **CDP 运行时注入** 同样适用于 WorkBuddy。唯一差异：Codex Dream Skin 的 `theme.css` 绑定 Codex 的 12 个特定部件选择器，不可直接套用；必须针对 WorkBuddy 实际 DOM 重写——因此本方案改用**动态透明化启发式**而非硬编码选择器。

## 2. 核心约束

- `--remote-debugging-port` 只能在启动时设置 → 首次注入必须重启 WorkBuddy → 当前 agent 会话会被中断。这是物理边界，无法绕过。
- 重启后 CDP 端口**保持在线**，agent 会话可恢复。因此换图时若 WorkBuddy 已带端口运行，无需再重启，直接 `node inject.mjs --image <图>` 即可。
- CDP 端口无鉴权（同机其他进程可连），与 Codex Dream Skin 自述一致——仅本机风险，外部不可达。
- macOS 系统标题栏（红黄绿按钮所在窄条）是 NSWindow 窗口装饰，**在 Chromium 渲染层之外**，任何注入方案都无法修改。其下方的 WorkBuddy 应用头栏（`teams-container.is-mac`）在渲染层内，可被透明化。

## 3. 注入流程（inject.mjs）

1. 通过 `http://127.0.0.1:<PORT>/json/list` 取 page target 与 WebSocket 地址。
2. CDP 连接后 `Runtime.evaluate` 注入一段 `<style id="__wb_skin_style__">`。
3. **动态透明化启发式**（关键，避免硬编码）：
   - 遍历 `body *`，跳过 `body` 本身与交互元素 `BUTTON/A/INPUT/SELECT/TEXTAREA/IMG/SVG`（保护按钮/输入框）。
   - 计算 `getBoundingClientRect` 面积，仅当 `width*height >= 视口面积*0.08` 才纳入（阈值从 0.5 放宽到 0.08，以覆盖侧边栏 22%、窄顶栏等）。
   - 仅当元素有不透明 `backgroundColor` 或非 `none` 的 `backgroundImage` 才处理。
   - 按 DOM 深度升序，透明化前 **12** 个（原 4，已提高到 12）最外层大容器，把原背景存进 `dataset.wbSkinOrigBg` / `dataset.wbSkinOrigImg` 后再置为 `transparent` / `none`。
4. 给 `body` 设背景图 + 暗色遮罩：`body { background-image: linear-gradient(rgba(10,12,16,OPACITY), ...), url(<dataURL>); background-size: cover; background-attachment: fixed; }`。
5. 可选 `--card-bg`：给 AI 回复区（`.cb-markdown`）和用户消息气泡（`[class*="userMessageBubble"]`）加半透明底纹。默认 `auto` 会根据背景明暗自动选择浅色（`rgba(245,245,245,0.92)`）或深色（`rgba(40,40,48,0.90)`）；传 `transparent` 禁用。
6. `--auto-text`（默认开启）：注入前调用 `scripts/analyze-bg.py` 采样壁纸左 60% 区域（侧边栏+聊天区），按感知亮度公式判断 `dark`/`light`，并注入对应的文字颜色（黑/白）、placeholder 颜色与 `text-shadow`。目标覆盖：顶部状态栏、侧边栏、消息内容、输入框/textarea/contenteditable。代码块（`pre/code`）被显式保护，避免破坏语法高亮。
7. `--restore` 时遍历 `[data-wb-skin-orig-bg]`，还原 `dataset` 中的原值并删除属性，再移除 `<style>` 标签。**彻底还原的前提是透明化前已把原背景存入 dataset**（否则只删 style 标签无法复原被改过的容器）。

CLI 参数：`--port`（默认 9222）、`--image`、`--css`、`--opacity`（默认 0.45）、`--card-bg`（默认 `auto`）、`--auto-text`（默认 `true`）、`--auto-text-threshold`（默认 128）、`--restore`、`--list`、`--target`、`--verbose`、`--help`。

## 4. 真机观察到的 WorkBuddy DOM 类名

React + CSS Modules，类名被 hash 化（不要依赖固定类名，用动态启发式更稳）：

| 用途 | 选择器（观测样本） |
|------|------|
| 应用头栏 | `teams-container.is-mac` |
| 左侧导航容器 | `_gridViewItem_1ens7_14`（264px 宽）、`conversation-list` |
| 主内容区 | `main-content main-content--chat`、`_gridViewItem_1ens7_14`（1016px 宽） |
| 输入区 | `_content_pf4c4_7`、`_mainArea_pf4c4_71` |
| 用户消息气泡 | `_userMessageBubble_1kyit_8` |
| 代码块 | `PRE.cb-markdown-pre` |

`document.documentElement`（`<html>`）属性实测为：`lang`、`data-theme`、`class`、`style` —— **不含** `data-codex-window-type`，因此 Codex 皮肤里的 `:root[data-codex-window-type="electron"]` 规则整段失效。

## 5. 透明度 / 可读性经验

- 浅色 WorkBuddy 主题 + 浅色背景图：`--opacity` 降到 **0.03–0.05**（越接近 0 越好，否则纸面发灰）。
- 深色背景图：需要 0.4–0.6 遮罩，但会与黑字冲突——优先保证背景明亮。
- 用户照片做背景：用 ImageGen image-to-image 拓展为 16:9，人物置于一侧（如右侧 1/3），向中部/左侧延展大块干净留白，确保聊天主区（中左）落在浅色区域，黑色 UI 文字才可读。
- 副作用：外层大容器会被透明化，用户消息气泡与代码块容器若被纳入也会失去原背景。`--card-bg` 已内置为这些区域补上可读底纹；如需更精细的卡片效果，可再用 `--css` 覆盖。

## 6. 端到端验证方法

- 可用 headless Chrome 加载 `test/mock.html`（模拟 WorkBuddy 多层背景结构）做注入/还原闭环验证。
- 真机截图注意：`Page.captureScreenshot` 在 **PNG 格式 + 大底图** 时可能无响应（消息体过大），改用 `jpeg` + `quality: 60` 可稳定返回。

## 7. ImageGen 注意事项

- image-to-image 拓展/优化用户图片消耗约 5–10 credits / 张。
- 结果右下角带 unavoidable 的「AI生成」水印；人物肖像受版权/肖像权约束，不能直接复刻真人肖像，可改为风格化/线条化表达。
