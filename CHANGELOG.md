# 更新日志 / Changelog

本文件记录 **workbuddy-skin** 技能的演变过程。当前最新版本为 **v0.3.0**。

---

## 当前设定总结（v0.3.0）

一句话：**通过 Electron/Chromium 的 CDP 通道，在运行时把任意图片注入为 WorkBuddy 桌面端的整体背景，并自动给消息内容加底纹、让顶部状态栏与背景融为一体，全程零侵入（不修改 `app.asar`、二进制或签名）。**

### 机制

- **零侵入注入**：WorkBuddy 基于 Electron（Chromium），其渲染进程支持 Chrome DevTools Protocol。脚本在 WorkBuddy 以 `--remote-debugging-port=9222` 启动后，通过 CDP WebSocket 注入一段 `<style id="__wb_skin_style__">` 与动态透明化逻辑，不触碰官方程序本体。
- **动态透明化启发式**：不硬编码第三方皮肤的选择器，而是扫描 DOM，把面积占屏 ≥ 8% 且不交互（非 `BUTTON/A/INPUT/SELECT/TEXTAREA/IMG/SVG`）的容器背景透明化，让 `body` 背景图透出。这与 WorkBuddy 使用的 hash 化 CSS Module 类名（如 `_gridViewItem_1ens7_14`、`_mainArea_pf4c4_71`）兼容。
- **还原性**：透明化前把原背景存入元素 `dataset`，`--restore` 时遍历还原并移除 style 标签。
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
    ├── inject.mjs                # 零依赖 CDP 注入器（核心）
    ├── apply-skin.sh             # 一键：退出 → 带调试端口重启 → 注入
    ├── restore.sh                # 运行时还原
    ├── start-debug.sh            # 仅带端口重启（DOM 调试）
    └── background.png            # 内置占位壁纸（深紫蓝渐变）
```

### 核心参数（`inject.mjs`）

| 参数 | 默认值 | 说明 |
| --- | --- | --- |
| `--port` | `9222` | CDP 调试端口 |
| `--image <path>` | — | 背景图片路径（建议 16:9）；不指定则注入纯色渐变 |
| `--css <path>` | — | 自定义 CSS 主题（替代默认背景规则） |
| `--opacity <f>` | `0.45` | 背景遮罩不透明度（浅色图用 `0.03`~`0.05`，深色图用 `0.1`~`0.3`） |
| `--card-bg <rgba>` | `rgba(245,245,245,0.92)` | 消息/回复内容底纹；传 `transparent` 可禁用 |
| `--restore` | — | 还原官方外观 |
| `--list` | — | 查看当前注入状态 |
| `--verbose` | — | 输出注入细节 |
| `--help` | — | 帮助 |

### 自动生效的三件事

1. **整体背景**：`body` 铺满背景图 + 暗/亮遮罩（`--opacity` 控制）。
2. **消息底纹**：AI 回复（`.cb-markdown`、`.cb-markdown-pre-wrapper`）与用户消息（`[class*="userMessageBubble"]`）自动加半透明浅色圆角底纹，保证复杂背景上文字可读；代码块容器单独用半透明深色，避免破坏高亮。
3. **顶部状态栏融合**：显式强制 `.workbuddy-topbar`（及 `--mac`/`--scrolled`/`--primary` 变体）透明并加 `backdrop-filter: blur(4px)`，使任务名/搜索/分享/历史提问/展开右栏那一块与壁纸连成整体。

### 日常使用命令

```bash
# 换壁纸（调试端口已在线时无需重启）
node scripts/inject.mjs --port 9222 --image /path/to/bg.png --opacity 0.03 --card-bg "rgba(245,245,245,0.92)"

# 一键重启并注入（首次或端口未开时用）
./scripts/apply-skin.sh --image /path/to/bg.png --opacity 0.03

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
- **第三方 Codex / HeiGe 皮肤不可直接用**：它们依赖 `:root[data-codex-window-type="electron"]` 与 `--color-background-surface` 等 Codex 专属选择器/变量，在 WorkBuddy 上取值为空、规则不生效，需重写选择器。
- **跨重启保留**：当前靠每次启动时 `apply-skin.sh` 重新注入；若需“永久常驻”，需额外用 `launchd` plist 拉起带调试端口的 WorkBuddy 并自动注入（比现在更重）。
- **重新生成消耗 credits**：ImageGen 每次约 5–10 credits，且结果带 unavoidable 的“AI生成”角标。

---

## 版本历史

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
