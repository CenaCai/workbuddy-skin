#!/usr/bin/env python3
"""
分析背景图亮度，给出文字颜色建议。

输入：图片路径
输出：JSON {
  "mode": "dark" | "light",
  "luminance": 0~255,
  "textColor": "#ffffff" | "#1a1a1a",
  "secondaryTextColor": "rgba(...)",
  "textShadow": "rgba(...)",
  "recommendedOpacity": 0.03~0.45
}

策略：
- WorkBuddy 的文本区域主要在画面左侧/中央（侧边栏 + 聊天区），所以只取左 60% 区域分析。
- 使用感知亮度公式：0.299*R + 0.587*G + 0.114*B。
- 默认阈值 128：低于阈值视为深色背景，建议白色文字；否则黑色文字。
"""
import json
import math
import sys
from pathlib import Path

try:
    from PIL import Image
except ImportError:
    print(json.dumps({"error": "Pillow not installed"}), file=sys.stderr)
    sys.exit(1)


def luminance(rgb):
    r, g, b = rgb[:3]
    return 0.299 * r + 0.587 * g + 0.114 * b


def analyze(path, threshold=128):
    img = Image.open(path).convert('RGBA')
    w, h = img.size

    # 合成到中性灰底，避免透明区域干扰
    bg = Image.new('RGBA', (w, h), (128, 128, 128, 255))
    img = Image.alpha_composite(bg, img).convert('RGB')

    # 缩放到统一尺寸并取左 60%（WorkBuddy 文字主区域）
    thumb = img.resize((300, 200), Image.LANCZOS)
    text_region = thumb.crop((0, 0, int(300 * 0.6), 200))

    px = text_region.load()
    w, h = text_region.size
    total = 0
    for y in range(h):
        for x in range(w):
            total += luminance(px[x, y])
    avg_lum = total / (w * h)

    if avg_lum < threshold:
        mode = "dark"
        text_color = "#ffffff"
        secondary = "rgba(255,255,255,0.70)"
        shadow = "rgba(0,0,0,0.50)"
        # 深色背景建议稍高遮罩（让背景别太抢眼），但仍保持可见
        recommended_opacity = round(min(0.45, 0.05 + (1 - avg_lum / 255) * 0.35), 2)
    else:
        mode = "light"
        text_color = "#1a1a1a"
        secondary = "rgba(0,0,0,0.55)"
        shadow = "rgba(255,255,255,0.60)"
        # 浅色背景遮罩压到极低，避免纸面发灰
        recommended_opacity = round(max(0.03, 0.05 - (avg_lum - 128) / 255 * 0.04), 2)

    return {
        "mode": mode,
        "luminance": round(avg_lum, 1),
        "textColor": text_color,
        "secondaryTextColor": secondary,
        "textShadow": shadow,
        "recommendedOpacity": recommended_opacity,
    }


if __name__ == "__main__":
    if len(sys.argv) < 2:
        print(json.dumps({"error": "缺少图片路径"}), file=sys.stderr)
        sys.exit(1)
    path = sys.argv[1]
    threshold = float(sys.argv[2]) if len(sys.argv) > 2 else 128
    if not Path(path).exists():
        print(json.dumps({"error": f"图片不存在: {path}"}), file=sys.stderr)
        sys.exit(1)
    result = analyze(path, threshold)
    print(json.dumps(result, ensure_ascii=False))
