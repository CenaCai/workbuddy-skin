# workbuddy-skin

给 **WorkBuddy 桌面端（macOS）** 换背景图 / 壁纸 / 主题的零侵入方案。基于 Chrome DevTools Protocol（CDP）在运行时注入样式，不修改 `app.asar`、不碰签名、不篡改二进制。

> 原理与 [Fei-Away/Codex-Dream-Skin](https://github.com/Fei-Away/Codex-Dream-Skin) 同源（WorkBuddy 与 Codex 同为 Electron/Chromium），但 WorkBuddy 的 DOM 与 Codex 不同，因此本方案用**动态透明化启发式**自适应真实界面，而非硬编码部件选择器。

📌 **当前版本 v0.4.1** · 完整设定总结与版本历史见 [CHANGELOG.md](./CHANGELOG.md)。

---

## ⚠️ 适用范围与限制

- **仅 macOS**。脚本依赖 `/Applications/WorkBuddy.app`、`osascript`、`curl`。
- **系统标题栏（红黄绿按钮那一条）改不了**——它是操作系统窗口装饰，在 Chromium 渲染层之外，任何注入都碰不到。其下方的 WorkBuddy 应用头栏可以改。
- 首次注入需**重启 WorkBuddy**（因为调试端口只能启动时设置），会中断当前对话；之后换图无需重启。

---

## 🚀 安装 / 使用

### 方式一：作为 WorkBuddy 技能安装（推荐）

把本仓库放到 `~/.workbuddy/skills/workbuddy-skin/`，即可被 WorkBuddy 技能系统识别。

### 方式二：直接 clone 使用

```bash
git clone git@github.com:CenaCai/workbuddy-skin.git
cd workbuddy-skin/scripts
```

---

## 快速开始

### 1. 首次换肤（需要重启 WorkBuddy）

在**系统终端**里执行（不要在 WorkBuddy 对话框里跑，否则重启会中断对话）：

```bash
cd workbuddy-skin/scripts
./apply-skin.sh --image /path/to/你的背景图.png
```

常用变体：

```bash
./apply-skin.sh --image bg.png --opacity 0.6                    # 自定义暗色遮罩
./apply-skin.sh --image bg.png --card-bg "rgba(240,240,240,0.9)" # 给消息/回复加灰框底纹
./apply-skin.sh --image bg.png --auto-text false                 # 关闭自动文字颜色
./apply-skin.sh --css   my-theme.css                            # 使用自定义 CSS 主题
WB_SKIN_PORT=9333 ./apply-skin.sh --image bg.png                 # 自定义调试端口
```

不带 `--image`/`--css` 时，脚本默认使用内置的 `background.png` 占位图。

### 2. 换图（无需重启）

只要 WorkBuddy 已经带着调试端口运行（首次注入后端口会一直在线）：

```bash
node inject.mjs --image /path/to/新图.png --opacity 0.03
```

> 浅色主题 + 浅色背景：`--opacity` 用 0.03–0.05；深色背景：0.4–0.6。默认值 0.45 不适合浅色背景。
>
> **自动文字颜色与底纹**：从 v0.4.0 起，`--card-bg` 默认 `auto`，脚本会先分析背景图亮度：
> - 浅色背景 → 黑色文字 + 浅色消息底纹（`rgba(245,245,245,0.92)`）
> - 深色背景 → 白色文字 + 深色消息底纹（`rgba(40,40,48,0.90)`）
>
> 如果背景图复杂导致文字仍看不清，可手动指定 `--card-bg` 或调整 `--opacity`。

### 3. 还原

```bash
./restore.sh        # 运行时移除注入样式
# 或者直接退出 WorkBuddy 用普通方式重开，注入自动消失
```

---

## 文件说明

| 文件 | 作用 |
|------|------|
| `scripts/inject.mjs` | 零依赖 CDP 注入器（Node 22 内置 WebSocket/fetch）。支持 `--port`/`--image`/`--css`/`--opacity`/`--card-bg`/`--auto-text`/`--auto-text-threshold`/`--restore`/`--list`/`--verbose`/`--help` |
| `scripts/analyze-bg.py` | Python 辅助：分析背景图亮度，输出 `dark`/`light` 及推荐文字颜色/遮罩（需 Pillow） |
| `scripts/apply-skin.sh` | 一键：退出 → 带调试端口重启 → 注入（自动检测托管 Python） |
| `scripts/restore.sh` | 运行时还原注入样式 |
| `scripts/start-debug.sh` | 仅带端口重启（不注入），供 Chrome `chrome://inspect` 观察 DOM |
| `scripts/background.png` | 内置默认占位壁纸 |
| `references/how-it-works.md` | 底层机制、DOM 选择器、透明化启发式、踩坑记录 |

---

## 关于第三方皮肤（Codex / HeiGe）

`HeiGeAi/heige-codex-skin-studio` 及其 `djiDJI130/workbuddy-mono-skin` 重命名版**不能直接用于 WorkBuddy**：

- 它们把规则限定在 `:root[data-codex-window-type="electron"]`，而 WorkBuddy 的 `<html>` **没有这个属性**（实测只有 `lang`/`data-theme`/`class`/`style`），整段变量/配色规则静默失效。
- 它们覆盖的是 Codex 的 CSS 变量（`--color-background-surface` 等），WorkBuddy 不使用这些变量。
- 唯一可借鉴的是 CDP 注入思路。要移植某个主题，需要把选择器改写为 WorkBuddy 真实 DOM（如 `teams-container.is-mac`、`_gridViewItem_1ens7_14`、`conversation-list`、`_mainArea_pf4c4_71`），再用 `inject.mjs --css` 注入。

---

## License

MIT © CenaCai
