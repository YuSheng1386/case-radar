# 朋友用的 LINE 對話選單圖（web/public/menu-friends.png，2500×1686，3×2 格）
#   格子順序要跟 web/src/rules.mjs MENU.cells 一樣；改圖後把 MENU.ver 改掉，Worker 會自己重裝
#   用法：python3 tools/friends-menu.py
import os
from PIL import Image, ImageDraw, ImageFont

W, H = 2500, 1686
CELLS = [
    ('使用規則', '完整說明（網頁）', '#1f6feb'),
    ('開發規則', '分數怎麼算、列哪些', '#2da44e'),
    ('配對規則', '幫客人找房', '#bf8700'),
    ('同公司物件', '開發不列、配對照列', '#8250df'),
    ('推播規則', '每天 9 點＋特急件', '#cf222e'),
    ('今天的案件', '點了不花推播額度', '#0a7a6a'),
]
def font(size):
    import subprocess   # 本機的 Noto Sans TC 粗體（fc-match 找）
    path = subprocess.run(["fc-match", "-f", "%{file}", "Noto Sans TC:bold"], capture_output=True, text=True).stdout
    return ImageFont.truetype(path, size)

img = Image.new('RGB', (W, H), '#f6f8fa')
d = ImageDraw.Draw(img)
big, small = font(150), font(78)
cw, ch = W / 3, H / 2
for i, (t, s, c) in enumerate(CELLS):
    x0, y0 = (i % 3) * cw, (i // 3) * ch
    d.rounded_rectangle([x0 + 24, y0 + 24, x0 + cw - 24, y0 + ch - 24], radius=48, fill='white', outline='#d0d7de', width=4)
    d.rounded_rectangle([x0 + 24, y0 + 24, x0 + cw - 24, y0 + 64], radius=20, fill=c)
    d.text((x0 + cw / 2, y0 + ch / 2 - 40), t, font=big, fill=c, anchor='mm')
    d.text((x0 + cw / 2, y0 + ch / 2 + 110), s, font=small, fill='#57606a', anchor='mm')
out = os.path.join(os.path.dirname(__file__), '..', 'web', 'public', 'menu-friends.png')
img.save(out, optimize=True)
print(out, os.path.getsize(out), 'bytes')
