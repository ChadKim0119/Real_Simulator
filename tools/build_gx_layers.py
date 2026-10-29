"""Split the GX interior photo into simulator layers.

  assets/gx_dash.webp      dashboard plate: wheel removed (inpainted), screen content
                           removed (black glass)
  assets/gx_wheel.webp     steering wheel incl. paddles (alpha matte)
  assets/gx_shroud.webp    steering-column camera shroud, sits in front of the screen
  assets/gx_top.webp       invented strip above the photo: dash top, windshield
                           opening (transparent) and A-pillars

Coordinates are interior-photo pixels; the strip above the photo spans y -170..0.
Requires: pillow numpy scipy opencv-python-headless
"""
import cv2
import numpy as np
from PIL import Image
from scipy import ndimage as nd

im = cv2.imread('assets/gx_interior.jpg')
H, W = im.shape[:2]
gray = cv2.cvtColor(im, cv2.COLOR_BGR2GRAY)


def poly(pts, shape=(H, W)):
    m = np.zeros(shape, np.uint8)
    cv2.fillPoly(m, [np.array(pts, np.int32)], 255)
    return m > 0


def feather(mask, s):
    return np.clip(cv2.GaussianBlur(mask.astype(np.float32), (0, 0), s), 0, 1)


def save_rgba(path, bgr, alpha, q=90):
    rgba = np.dstack([cv2.cvtColor(bgr, cv2.COLOR_BGR2RGB), (alpha * 255).astype(np.uint8)])
    Image.fromarray(rgba).save(path, quality=q, method=6)


# ---------------------------------------------------------------- wheel ----
OUTER = [
    (243, 500), (237, 420), (237, 330), (248, 250), (270, 175), (310, 110), (370, 60),
    (450, 22), (560, 2), (560, -5), (800, -5), (800, 2), (900, 15), (950, 40), (985, 75),
    (1015, 110), (1045, 155), (1068, 205), (1086, 255), (1098, 310), (1108, 380),
    (1110, 450), (1104, 520), (1092, 600), (1068, 680), (1040, 760), (1025, 815),
    (330, 815), (290, 700), (262, 600),]
UPPER = [
    (305, 342), (318, 260), (345, 200), (395, 145), (470, 100), (560, 70), (680, 57),
    (800, 62), (880, 90), (940, 130), (985, 190), (1010, 250), (1027, 342),
    (910, 342), (885, 320), (850, 300), (760, 292), (680, 290), (600, 292), (510, 300),
    (470, 320), (440, 342),
]
LOWER_L = [(322, 485), (448, 485), (468, 555), (500, 640), (530, 720), (548, 770),
           (470, 770), (420, 740), (375, 690), (345, 620), (328, 550)]
LOWER_R = [(1352 - x, y) for x, y in LOWER_L]
PADDLE_L = [(398, 276), (440, 276), (480, 283), (474, 302), (430, 301), (402, 296)]
PADDLE_R = [(1352 - x, y) for x, y in PADDLE_L]

wheel = poly(OUTER) & ~poly(UPPER) & ~poly(LOWER_L) & ~poly(LOWER_R)
wheel |= poly(PADDLE_L) | poly(PADDLE_R)

# ---------------------------------------------------------------- screen ---
# visible display area (photo coords); the shroud and paddles sit in front of it
SCREEN = [(408, 98), (915, 98), (920, 288), (405, 288)]
screen = poly(SCREEN)
SHROUD = [(572, 288), (575, 252), (590, 240), (775, 240), (790, 252), (793, 288), (785, 296), (580, 296)]
shroud = poly(SHROUD)

# ---------------------------------------------------------------- dash -----
fill = nd.binary_dilation(wheel, iterations=5)
small = cv2.resize(im, (W // 2, H // 2), interpolation=cv2.INTER_AREA)
smask = cv2.resize(fill.astype(np.uint8) * 255, (W // 2, H // 2), interpolation=cv2.INTER_NEAREST)
sfill = cv2.inpaint(small, smask, 9, cv2.INPAINT_TELEA)
sfill = cv2.GaussianBlur(sfill, (0, 0), 6)
big = cv2.resize(sfill, (W, H), interpolation=cv2.INTER_CUBIC)
dash = im.copy()
dash[fill] = (big[fill] * 0.7).astype(np.uint8)
# blank screen: deep black glass with a faint top reflection
glass = screen & ~shroud
yy, xx = np.mgrid[0:H, 0:W]
refl = np.clip(1 - (yy - 98) / 120.0, 0, 1) * 7
base = np.dstack([refl + 6, refl + 6, refl + 8]).astype(np.uint8)
g_a = feather(glass, 1.0)[..., None]
dash = (dash * (1 - g_a) + base * g_a).astype(np.uint8)
cv2.imwrite('/tmp/_gx_dash.png', dash)
Image.fromarray(cv2.cvtColor(dash, cv2.COLOR_BGR2RGB)).save('assets/gx_dash.webp', quality=88, method=6)

# the rim's top reaches slightly above the frame: extend it by mirroring its edge rows
TOP = 170
wim = np.zeros((H + TOP, W, 3), np.uint8)
wim[TOP:] = im
wal = np.zeros((H + TOP, W), np.float32)
wal[TOP:] = feather(wheel, 1.1)
for x in range(500, 861):
    apex = 0.000647 * (x - 680) ** 2 - 9.3        # outer edge of the rim above y = 0
    for y in range(int(np.floor(apex)), 0):
        src = min(-y - 1, H - 1)
        wim[TOP + y, x] = im[src, x]
        wal[TOP + y, x] = np.clip(y - apex, 0, 1) * wal[TOP + src, x]
save_rgba('assets/gx_wheel.webp', wim, wal)

# strip above the photo: dash top continues upward, then the windshield opening
band = 46
# the photo's first rows carry a light edge; continue from slightly lower rows,
# smoothed sideways so no mirrored highlights appear
dash[0:4] = dash[4]
src = cv2.GaussianBlur(dash[4:10].astype(np.float32).mean(axis=0, keepdims=True), (0, 0), sigmaX=8, sigmaY=0)[0]
top = np.zeros((TOP, W, 3), np.float32)
ta = np.zeros((TOP, W), np.float32)
rng = np.random.default_rng(1)
for k in range(1, band + 1):
    shade = 1.0 - 0.7 * (k / band) ** 0.9
    top[TOP - k] = src * shade + rng.normal(0, 1.2, (W, 1))
    ta[TOP - k] = 1
# windshield base: a dark lip and a faint glint along the glass edge
lip = TOP - band
top[lip:lip + 3] *= 0.35
top[lip - 1] = (70, 74, 80)
ta[lip - 1] = 0.55
# headliner shadow at the very top
for k in range(18):
    top[k] = (14, 14, 16)
    ta[k] = 1 - k / 18 * 0.75 if k < 18 else 0
# A-pillars
pil = np.zeros((TOP, W), np.uint8)
cv2.fillPoly(pil, [np.array([(0, 0), (170, 0), (70, lip), (0, lip)], np.int32)], 255)
cv2.fillPoly(pil, [np.array([(1250, 0), (1440, 0), (1440, lip), (1385, lip)], np.int32)], 255)
pa = feather(pil > 0, 2.0)
gy = np.linspace(0, 1, TOP)[:, None]
pillar_col = np.dstack([18 + 12 * gy, 19 + 12 * gy, 22 + 12 * gy]) * np.ones((1, W, 1))
top = top * (1 - pa[..., None]) + pillar_col * pa[..., None]
ta = np.maximum(ta, pa)
Image.fromarray(cv2.cvtColor(dash, cv2.COLOR_BGR2RGB)).save('assets/gx_dash.webp', quality=88, method=6)
save_rgba('assets/gx_top.webp', np.clip(top, 0, 255).astype(np.uint8), ta)
save_rgba('assets/gx_shroud.webp', im, feather(shroud, 0.9) * (yy < 330))

print('ok')
