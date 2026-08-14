# workbuddy-skin

给 **WorkBuddy 桌面端（macOS）** 换背景图 / 壁纸 / 主题的零侵入方案。基于 Chrome DevTools Protocol（CDP）在运行时注入样式，不修改 `app.asar`、不碰签名、不篡改二进制。

> **v0.5.0 起新增的能力**：
> - 改用 WorkBuddy 稳定 DOM 锚点（`#root` / `.teams-container` / `[data-view-id]`）与原生 `--cb-*` 设计令牌做全局换色，取代 v0.4.x"面积阈值扫描 + 逐个元素内联强制"的脆弱兜底；
> - 新增应用内切换背景菜单：随时切换背景、上传自定义图片（Canvas 自动取色）、一键还原原生界面；
> - v0.5.1：菜单按钮移入顶部功能栏、改用 WorkBuddy 同款图标、选中态改为浅黄，并修复"还原原生界面"时颜色未完整还原的问题。
> - v0.5.2："原生界面"拆为「原生界面（浅色）」/「原生界面（黑色）」两项，分别切到 WorkBuddy 原生浅色 / 深色模式。

📌 **当前版本 v0.5.2** · 完整设定总结与版本历史见 [CHANGELOG.md](./CHANGELOG.md)。

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

### 4. 应用内切换背景菜单（v0.5.1）

注入成功后，主内容区**顶部功能栏会出现一个「切换背景」按钮**（WorkBuddy 同款线条图标，位于“对话内搜索”左侧），无需再开终端即可：

- 在当前背景与内置预设之间切换。
- 上传本地图片，菜单会 Canvas 采样自动提取主色并生成配套配色。
- 点击"原生界面（浅色）" / "原生界面（黑色）"分别切到 WorkBuddy 原生浅色 / 深色外观，立即移除所有注入样式与配色。

如果只想用 CLI 换图、不需要菜单，加 `--no-menu`：

```bash
node inject.mjs --image /path/to/bg.png --no-menu
```

---

## 更换背景图的两种方式

目前给 WorkBuddy 换背景图有两条路径，核心区别在于“图片怎么进来”——是否经过客户端的内容风控。

### 方式一：在对话框里给图片，由 Skill 处理（融合度最好）

在 WorkBuddy 对话框里直接粘贴 / 拖入一张图片，然后让我（Skill）来操作：我会读取图片、按需优化或拓展构图，再用 `inject.mjs` 注入。

- **优点**：整个界面融合度最好。Skill 可以基于原图做智能处理（例如把人物放到一侧、向另一侧延展出大面积留白，保证黑色 UI 文字清晰可读），生成与界面协调度更高的壁纸。
- **代价**：图片会经过 WorkBuddy 客户端的内容风控（图片审核）。部分图片（含敏感或版权风险的）会被拦截、无法使用。

### 方式二：通过功能栏直接替换背景图（最稳，绕过风控）

点击顶部功能栏「切换背景」按钮（“对话内搜索”左侧，WorkBuddy 同款线条图标），在菜单里选「＋ 自定义图片」从本地选图。图片在浏览器内用 Canvas 采样、自动取色并即时注入，全程不经过对话上传。

- **优点**：完全不经过客户端图片风控，本地任意图片都能用。
- **代价**：界面融合性一般——上传的是什么就用什么，没有 Skill 的智能构图优化，需要你自己挑选 / 预处理一张与界面协调的底图。

---

## 文件说明

| 文件 | 作用 |
|------|------|
| `scripts/inject.mjs` | 零依赖 CDP 注入器（Node 22 内置 WebSocket/fetch）。支持 `--port`/`--image`/`--css`/`--opacity`/`--card-bg`/`--auto-text`/`--auto-text-threshold`/`--no-menu`/`--restore`/`--list`/`--verbose`/`--help` |
| `scripts/analyze-bg.py` | Python 辅助：分析背景图亮度，输出 `dark`/`light` 及推荐文字颜色/遮罩（需 Pillow） |
| `scripts/apply-skin.sh` | 一键：退出 → 带调试端口重启 → 注入（自动检测托管 Python） |
| `scripts/restore.sh` | 运行时还原注入样式 |
| `scripts/start-debug.sh` | 仅带端口重启（不注入），供 Chrome `chrome://inspect` 观察 DOM |
| `scripts/background.png` | 内置默认占位壁纸 |
| `scripts/src/skin-css.mjs` | CSS 生成器：稳定锚点 + `--cb-*` token 覆盖 + 磨砂玻璃 |
| `scripts/src/skin-menu.mjs` | 应用内切换背景菜单脚本生成器：切换背景、上传图片、自动取色、还原 |
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
