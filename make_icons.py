# アプリアイコン生成(テトリス風・高コントラスト)
from PIL import Image, ImageDraw

BG = (16, 20, 28)          # #10141C
COLORS = {
    'I': (0, 229, 255),    # 水色
    'O': (255, 214, 0),    # 黄
    'T': (213, 0, 249),    # 紫
    'S': (0, 230, 118),    # 緑
    'Z': (255, 61, 0),     # 赤
    'J': (41, 121, 255),   # 青
    'L': (255, 145, 0),    # 橙
}

def rounded_rect(draw, box, radius, fill):
    draw.rounded_rectangle(box, radius=radius, fill=fill)

def draw_block(draw, x, y, size, color):
    # 本体
    draw.rectangle([x, y, x + size, y + size], fill=color)
    # 上のハイライト
    hl = tuple(min(255, int(c + (255 - c) * 0.35)) for c in color)
    draw.rectangle([x, y, x + size, y + int(size * 0.18)], fill=hl)
    # 下の影
    sh = tuple(int(c * 0.6) for c in color)
    draw.rectangle([x, y + int(size * 0.82), x + size, y + size], fill=sh)
    # 枠
    draw.rectangle([x, y, x + size, y + size], outline=(0, 0, 0), width=max(1, size // 22))

def make(size, maskable=False):
    img = Image.new('RGBA', (size, size), (0, 0, 0, 0))
    d = ImageDraw.Draw(img)

    if maskable:
        # マスク前提:全面を背景で塗る(角丸なし)
        d.rectangle([0, 0, size, size], fill=BG)
        margin = size * 0.20   # セーフゾーン
    else:
        rounded_rect(d, [0, 0, size, size], radius=int(size * 0.22), fill=BG)
        margin = size * 0.14

    # 中央に 3x3 のグリッドで S ミノ風の積みを描く
    area = size - margin * 2
    cell = area / 3
    ox = margin
    oy = margin
    gap = cell * 0.06
    b = cell - gap

    # 配置(行, 列, 色):テトリスらしい積み
    layout = [
        (0, 1, 'T'),
        (1, 0, 'S'), (1, 1, 'S'),
        (2, 1, 'O'), (2, 2, 'I'),
    ]
    for (r, c, key) in layout:
        x = ox + c * cell + gap / 2
        y = oy + r * cell + gap / 2
        draw_block(d, int(x), int(y), int(b), COLORS[key])

    return img

make(192).save('icon-192.png')
make(512).save('icon-512.png')
make(512, maskable=True).save('icon-maskable-512.png')
make(180).save('apple-touch-icon.png')
print('icons generated')
