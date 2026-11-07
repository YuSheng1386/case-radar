# LINE 對話選單圖：朋友用 web/public/menu-friends.png、管理者用 web/public/menu-admin.png（2500×1686）
#   版面在 web/src/menus.mjs（Worker 也讀同一份）；改圖後把該選單的 ver 改掉，Worker 會自己重裝
#   用法：python3 tools/friends-menu.py
import json, os, subprocess
from PIL import Image, ImageDraw, ImageFont

ROOT = os.path.join(os.path.dirname(__file__), '..', 'web')
SRC = open(os.path.join(ROOT, 'src', 'menus.mjs'), encoding='utf-8').read()
MENUS = json.loads(SRC[SRC.index('export default') + len('export default'):])
FONT = subprocess.run(['fc-match', '-f', '%{file}', 'Noto Sans TC:bold'], capture_output=True, text=True).stdout   # 本機 Noto Sans TC 粗體

for key in ('friends', 'admin'):
    m = MENUS[key]
    img = Image.new('RGB', (2500, 1686), '#f6f8fa')
    d = ImageDraw.Draw(img)
    for c in m['cells']:
        x0, y0, w, h = c['x'], c['y'], c['w'], c['h']
        big = ImageFont.truetype(FONT, round(h * (0.178 if h > 700 else 0.19)))
        small = ImageFont.truetype(FONT, round(h * (0.093 if h > 700 else 0.1)))
        dark = c['c'] == '#24292f'   # 管理按鈕：深底白字，跟使用規則分開
        d.rounded_rectangle([x0 + 20, y0 + 20, x0 + w - 20, y0 + h - 20], radius=40,
                            fill=c['c'] if dark else 'white', outline='#d0d7de', width=4)
        if not dark:
            d.rounded_rectangle([x0 + 20, y0 + 20, x0 + w - 20, y0 + 56], radius=18, fill=c['c'])
        d.text((x0 + w / 2, y0 + h / 2 - h * 0.05), c['t'], font=big, fill='white' if dark else c['c'], anchor='mm')
        d.text((x0 + w / 2, y0 + h / 2 + h * 0.15), c['s'], font=small, fill='#d0d7de' if dark else '#57606a', anchor='mm')
    out = os.path.join(ROOT, 'public', m['png'])
    img.save(out, optimize=True)
    print(out, os.path.getsize(out), 'bytes')
