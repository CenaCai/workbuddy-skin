---
name: workbuddy-skin
description: Inject custom backgrounds, wallpapers, or full CSS themes into the WorkBuddy desktop app (macOS) at runtime via the Chrome DevTools Protocol, without modifying the app binary, asar, or signature. Use this skill when a user asks to change WorkBuddy's background image, apply a theme/skin, set a wallpaper, mentions "换皮"/"换背景"/"自定义背景", or references Codex-Dream-Skin / HeiGe Codex Skin Studio. Also use it to evaluate whether a third-party skin repo is compatible with WorkBuddy.
agent_created: true
---

# WorkBuddy 桌面端换肤（CDP 运行时注入）

## Purpose

Apply a custom background image, wallpaper, or full CSS theme to the **WorkBuddy desktop application on macOS** at runtime. The technique uses the Chrome DevTools Protocol (CDP) to inject a `<style>` node and transparentize opaque DOM containers so a body background shows through — **zero modification** to `app.asar`, the binary, or the code signature.

## When to use

- User wants to change the WorkBuddy interface background image, wallpaper, or theme.
- User mentions "换肤", "换背景", "自定义背景", "主题", or references `Codex-Dream-Skin` / `HeiGe Codex Skin Studio` / `workbuddy-mono-skin`.
- User provides an image and wants it expanded/optimized as a readable WorkBuddy background.
- User asks whether some third-party "skin" repo works on WorkBuddy (compatibility check).

## Mechanism (summary)

- WorkBuddy is an Electron 37 + Chromium 138 app. CDP injection requires the renderer launched with `--remote-debugging-port=<PORT>`. This flag is **only settable at launch**, so the *first* injection requires restarting WorkBuddy with the port open.
- Once started with the port, the port stays online and the agent session recovers, so **subsequent image swaps need NO restart** — just re-run `inject.mjs --image <img>`.
- Injection dynamically locates large opaque DOM containers, saves their original background to a `dataset` attribute, and transparentizes them; then sets a body background image plus an optional dark overlay (`--opacity`).
- A Python helper (`analyze-bg.py`) samples the left/center region of the wallpaper and classifies it as `dark` or `light`; `inject.mjs` then auto-selects white/black text colors and light/dark message card backgrounds (`--card-bg auto`).
- The macOS system title bar (traffic-light row) is OS window chrome, **outside** the render layer — cannot be themed by any injection approach.

## Usage

### First-time setup (requires restart → current session interrupts)
Run in the user's **own terminal**, not inside the agent session:
```bash
cd ~/.workbuddy/skills/workbuddy-skin/scripts
./apply-skin.sh --image /path/to/bg.png
# custom overlay:     ./apply-skin.sh --image bg.png --opacity 0.6
# content card shade: ./apply-skin.sh --image bg.png --card-bg "rgba(245,245,245,0.92)"
# disable auto-text:  ./apply-skin.sh --image bg.png --auto-text false
# custom CSS theme:   ./apply-skin.sh --css my-theme.css
# custom port:        WB_SKIN_PORT=9333 ./apply-skin.sh --image bg.png
```
`apply-skin.sh` quits WorkBuddy, relaunches it with `--remote-debugging-port=9222`, waits for the port and render, then injects.

### Swap image without restart (port already open)
```bash
cd ~/.workbuddy/skills/workbuddy-skin/scripts
node inject.mjs --image /path/to/bg.png --opacity 0.03
# 加内容底纹（auto 会根据背景明暗自动选浅色/深色）：
node inject.mjs --image /path/to/bg.png --opacity 0.03 --card-bg auto
# 关闭自动文字颜色：
node inject.mjs --image /path/to/bg.png --opacity 0.03 --auto-text false
```

### Restore
```bash
cd ~/.workbuddy/skills/workbuddy-skin/scripts
./restore.sh            # runtime removal of injected styles
# or simply quit WorkBuddy and relaunch normally — injection disappears on its own
```

## Scripts (in `scripts/`)

- `inject.mjs` — zero-dependency CDP injector (Node 22 built-in WebSocket/fetch). Flags: `--port`, `--image`, `--css`, `--opacity` (default 0.45), `--card-bg` (default `auto`; also accepts `transparent` or an explicit rgba), `--auto-text` (default `true`), `--auto-text-threshold` (default 128), `--restore`, `--list`, `--target`, `--verbose`, `--help`.
- `analyze-bg.py` — Python helper used by `inject.mjs` to classify wallpaper brightness and pick text/card colors (requires Pillow).
- `apply-skin.sh` — quit → relaunch with port → inject (one-shot; restarts the app).
- `restore.sh` — runtime restore of injected styles.
- `start-debug.sh [port]` — relaunch with port only (no injection), for DOM inspection via Chrome `chrome://inspect`.
- `background.png` — bundled default placeholder wallpaper.

## Critical gotchas

- **Opacity by theme:** light WorkBuddy theme + light background → set `--opacity` near 0 (0.03–0.05) so text stays readable; dark background → raise opacity (0.4–0.6) for contrast. The default 0.45 is wrong for light backgrounds.
- **Auto text & card colors:** when `--auto-text` is enabled (default), `inject.mjs` runs `analyze-bg.py` on the wallpaper. It chooses black text + light message cards for light backgrounds, and white text + dark message cards for dark backgrounds. Disable with `--auto-text false`.
- **Readability of chat text on busy backgrounds:** use `--card-bg` to add a semi-transparent box behind user message bubbles and AI `.cb-markdown` content. Default `auto` picks `rgba(245,245,245,0.92)` for light themes and `rgba(40,40,48,0.90)` for dark themes; set to `transparent` to disable.
- **Readability of user photos:** expand to 16:9 with the subject off to one side and large clean negative space where chat text sits (center/left). See the workflow in `references/how-it-works.md`.
- **Do NOT copy `#` comment lines** from docs into the terminal — `#` is treated as a command and errors with `command not found: #`.
- **Example image paths** in docs (e.g. `~/Pictures/wallpaper.jpg`) are placeholders; the script defaults to the bundled `background.png` when no `--image`/`--css` is given.
- **macOS-only:** scripts assume `/Applications/WorkBuddy.app` and `osascript`/`curl`. Not portable to Windows (where HeiGe-style `.bat`/`apply.ps1` installers live).

## Adapting third-party skins (Codex / HeiGe)

Themes built for Codex/CodeBuddy (e.g. `HeiGeAi/heige-codex-skin-studio`, the `djiDJI130/workbuddy-mono-skin` rebrand) are **NOT directly usable** on WorkBuddy:

- They scope rules to `:root[data-codex-window-type="electron"]`, an attribute WorkBuddy's `<html>` does **not** have (verified live via CDP — WorkBuddy's root attrs are `lang`, `data-theme`, `class`, `style`). So the entire variable/color block silently fails.
- They override Codex CSS variables (`--color-background-surface`, `--color-background-panel`, `--color-text-foreground`, …) that WorkBuddy does not use (the computed value is empty).
- Only the `#root { background: … }` portion partially applies; the rest does nothing.

The only portable part is the CDP injection concept. To port a theme, rewrite its selectors against WorkBuddy's hashified CSS-Module class names (e.g. `teams-container.is-mac`, `_gridViewItem_1ens7_14`, `_mainArea_pf4c4_71`, `conversation-list`, `_content_pf4c4_7`, `_userMessageBubble_1kyit_8`, `PRE.cb-markdown-pre`) and WorkBuddy's own variable system, then inject via `inject.mjs --css`.

## References

`references/how-it-works.md` — detailed mechanism, observed DOM selectors, the dynamic transparentization heuristic, limitations, and the image-expansion workflow.
