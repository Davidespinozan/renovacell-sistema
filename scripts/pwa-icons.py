# Uso: python3 scripts/pwa-icons.py apps/web/public/brand/icon-512.png apps/web/public/brand
# Genera los íconos de la PWA: fondo verde profundo de marca, logo más pequeño y centrado.
#  any      → cuadro redondeado con esquinas transparentes (lanzadores que no enmascaran)
#  maskable → a sangre, logo dentro de la zona segura (círculo del 80 %) para Android
#  apple    → a sangre y OPACO (iOS pinta de negro cualquier transparencia)
import sys
from PIL import Image, ImageDraw, ImageFilter
SRC, OUT = sys.argv[1], sys.argv[2]
logo = Image.open(SRC).convert('RGBA')
# Fondo: verde profundo de marca (no el del menú: en el teléfono el #0A2412 se veía casi negro y el logo se perdía).
TOP, BOT = (0x0A, 0x7A, 0x28), (0x00, 0x5A, 0x0D)   # #0A7A28 → --green-deep #005A0D
def fondo(n):
    im = Image.new('RGB', (n, n)); px = im.load()
    for y in range(n):
        t = y / (n - 1); c = tuple(round(TOP[i] + (BOT[i] - TOP[i]) * t) for i in range(3))
        for x in range(n): px[x, y] = c
    # luz suave detrás del logo para separarlo del fondo
    halo = Image.new('L', (n, n), 0); d = ImageDraw.Draw(halo); r = int(n * .36)
    d.ellipse((n // 2 - r, n // 2 - r, n // 2 + r, n // 2 + r), fill=90)
    halo = halo.filter(ImageFilter.GaussianBlur(n * .10))
    im.paste(Image.new('RGB', (n, n), (0x5F, 0xD0, 0x8A)), (0, 0), halo)
    return im.convert('RGBA')
def icono(n, escala, radio=0.0):
    S = n * 4 if radio else n
    base = fondo(n)
    lado = round(n * escala); lg = logo.resize((lado, lado), Image.LANCZOS)
    base.alpha_composite(lg, ((n - lado) // 2, (n - lado) // 2))
    if radio:
        m = Image.new('L', (S, S), 0); ImageDraw.Draw(m).rounded_rectangle((0, 0, S - 1, S - 1), radius=int(S * radio), fill=255)
        base.putalpha(m.resize((n, n), Image.LANCZOS))
    else:
        base = base.convert('RGB')
    return base
icono(512, .68, .225).save(f'{OUT}/app-512-v2.png', optimize=True)
icono(192, .68, .225).save(f'{OUT}/app-192-v2.png', optimize=True)
icono(512, .60).save(f'{OUT}/app-maskable-512-v2.png', optimize=True)
icono(192, .60).save(f'{OUT}/app-maskable-192-v2.png', optimize=True)
icono(180, .68).save(f'{OUT}/app-apple-180-v2.png', optimize=True)
# vista previa: cómo lo recorta cada plataforma
def prev():
    W = Image.new('RGB', (4 * 300 + 100, 380), (230, 234, 240)); d = ImageDraw.Draw(W)
    def pegar(im, x, mask=None):
        im = im.convert('RGBA').resize((260, 260), Image.LANCZOS)
        if mask is not None: im.putalpha(mask)
        W.paste(im, (x, 40), im)
    S = 260 * 4
    circ = Image.new('L', (S, S), 0); ImageDraw.Draw(circ).ellipse((0, 0, S - 1, S - 1), fill=255); circ = circ.resize((260, 260), Image.LANCZOS)
    sq = Image.new('L', (S, S), 0); ImageDraw.Draw(sq).rounded_rectangle((0, 0, S - 1, S - 1), radius=int(S * .225), fill=255); sq = sq.resize((260, 260), Image.LANCZOS)
    pegar(Image.open(f'{OUT}/app-apple-180-v2.png'), 40, sq); d.text((40, 320), 'iPhone (apple 180)', fill=(11, 18, 32))
    pegar(Image.open(f'{OUT}/app-maskable-512-v2.png'), 340, circ); d.text((340, 320), 'Android circulo (maskable)', fill=(11, 18, 32))
    pegar(Image.open(f'{OUT}/app-maskable-512-v2.png'), 640, sq); d.text((640, 320), 'Android squircle (maskable)', fill=(11, 18, 32))
    pegar(Image.open(f'{OUT}/app-512-v2.png'), 940); d.text((940, 320), 'any 512 (sin mascara)', fill=(11, 18, 32))
    W.save(sys.argv[3])
if len(sys.argv) > 3: prev()   # 3er argumento opcional: ruta de la vista previa
for f in ['app-512-v2', 'app-192-v2', 'app-maskable-512-v2', 'app-maskable-192-v2', 'app-apple-180-v2']:
    im = Image.open(f'{OUT}/{f}.png'); print(f, im.size, im.mode)
