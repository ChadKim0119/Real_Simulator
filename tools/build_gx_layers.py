"""Split the GX interior photo into simulator layers.

  assets/gx_dash.webp      dashboard plate: wheel removed (inpainted), screen content
                           removed (black glass)
  assets/gx_wheel.webp     steering wheel incl. paddles (alpha matte)
  assets/gx_shroud.webp    steering-column camera shroud, sits in front of the screen
  assets/gx_screen.webp    clean screen backdrop taken from the close-up photo
                           (all readouts removed; they are drawn live)

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

save_rgba('assets/gx_wheel.webp', im, feather(wheel, 1.1))
save_rgba('assets/gx_shroud.webp', im, feather(shroud, 0.9) * (yy < 330))

# ------------------------------------------------------ screen backdrop ----
cl = cv2.imread('assets/gx_cluster.jpg')
X0, Y0, X1, Y1 = 245, 118, 1150, 455
crop = cl[Y0:Y1, X0:X1].copy()
ch, cw = crop.shape[:2]
cg = cv2.cvtColor(crop, cv2.COLOR_BGR2GRAY)
hsv = cv2.cvtColor(crop, cv2.COLOR_BGR2HSV)


def cpoly(pts):
    return poly([(x - X0, y - Y0) for x, y in pts], (ch, cw))


# readouts to remove (photo coords of the close-up)
TEXT_BOXES = [
    (500, 145, 585, 195), (640, 140, 750, 245), (805, 150, 885, 195),   # temp, speed/MPH/P, clock
    (930, 205, 1100, 350),                                                # MTS list
    (318, 392, 470, 445), (930, 390, 1090, 445),                          # temp & fuel bars
    (245, 320, 285, 360),                                                 # mode icon
]
text = np.zeros((ch, cw), bool)
for x0, y0, x1, y1 in TEXT_BOXES:
    box = np.zeros((ch, cw), bool)
    box[max(0, y0 - Y0):y1 - Y0, max(0, x0 - X0):x1 - X0] = True
    bright = (cg > 120) | ((hsv[..., 1] > 90) & (hsv[..., 2] > 90))
    text |= box & bright
text = nd.binary_dilation(text, iterations=4)
# the right-hand arc line
arc = np.zeros((ch, cw), np.uint8)
cv2.ellipse(arc, (900 - X0, 305 - Y0), (192, 192), 0, -40, 32, 255, 9)
text |= (arc > 0) & (cg > 60)
# thin bright leftovers (arc lines, stitching) in the dark parts of the display
th = cv2.morphologyEx(cg, cv2.MORPH_TOPHAT, cv2.getStructuringElement(cv2.MORPH_ELLIPSE, (9, 9)))
cyy, cxx = np.mgrid[0:ch, 0:cw]
dark_zone = (cyy < 135) | (cxx > 630) | (cxx < 115)
text |= nd.binary_dilation(dark_zone & (th > 22), iterations=2)
# camera shroud and wheel in the close-up: rebuild from surroundings
occl = cpoly([(515, 455), (520, 392), (545, 378), (850, 378), (875, 392), (880, 455)])
holes = (text | occl).astype(np.uint8) * 255
clean = cv2.inpaint(crop, holes, 6, cv2.INPAINT_TELEA)
soft = cv2.GaussianBlur(clean, (0, 0), 5)
hm = feather(holes > 0, 3)[..., None]
clean = (clean * (1 - hm) + soft * hm).astype(np.uint8)
# display edges fall off to black (also hides stalk/paddle remnants in the corners)
edge = np.ones((ch, cw), np.float32)
edge *= np.clip(1 - (cyy - 280) / 57.0, 0.18, 1)
edge *= np.clip(cxx / 60.0, 0.25, 1) * np.clip((cw - cxx) / 60.0, 0.25, 1)
clean = (clean * edge[..., None]).astype(np.uint8)
Image.fromarray(cv2.cvtColor(clean, cv2.COLOR_BGR2RGB)).save('assets/gx_screen.webp', quality=90, method=6)
print('ok', clean.shape)
