"""Split the reference photo (assets/source.jpg) into the layers used by the simulator.

  assets/dash.webp   dashboard plate: windshield cut out (alpha 0), wheel and the
                     printed cluster graphics removed by inpainting (blank black glass)
  assets/wheel.webp  steering wheel only (alpha matte)

Requires: pillow numpy scipy opencv-python-headless
"""
import cv2
import numpy as np
from PIL import Image
from scipy import ndimage as nd

SRC = 'assets/source.jpg'
im = cv2.imread(SRC)
H, W = im.shape[:2]
gray = cv2.cvtColor(im, cv2.COLOR_BGR2GRAY).astype(np.float32)
blur = cv2.GaussianBlur(gray, (0, 0), 3)


def poly_mask(pts):
    m = np.zeros((H, W), np.uint8)
    cv2.fillPoly(m, [np.array(pts, np.int32)], 255)
    return m > 0


# --- inner opening of the wheel (where the cluster/hood is seen) -------------
opening_poly = [
    (228, 440), (232, 380), (240, 320), (255, 260), (280, 200), (320, 150), (380, 105),
    (460, 75), (560, 57), (680, 48), (800, 46), (920, 48), (1030, 56), (1100, 90),
    (1180, 125), (1250, 175), (1310, 225), (1370, 275), (1420, 330), (1450, 390),
    (1470, 450), (1495, 475), (1560, 540), (1600, 600), (1632, 680), (1625, 770),
    (1530, 740), (1450, 705), (1380, 685), (1300, 655), (1200, 622), (1100, 600),
    (1000, 586), (900, 579), (856, 578), (800, 580), (700, 589), (600, 612),
    (530, 638), (450, 667), (350, 692), (250, 722), (175, 762), (112, 770),
    (96, 690), (110, 610), (150, 540), (205, 480),
]
opening = poly_mask(opening_poly)
yy, xx = np.mgrid[0:H, 0:W]

outer_poly = [
    (0, 530), (10, 500), (35, 430), (65, 360), (100, 295), (140, 235), (190, 175),
    (240, 125), (300, 75), (380, 30), (460, -2), (1380, -2), (1440, 40), (1480, 90),
    (1530, 150), (1565, 210), (1595, 270), (1620, 330), (1640, 390), (1660, 450),
    (1690, 490), (1714, 480), (1714, 1154), (-2, 1154),
]
wheel = poly_mask(outer_poly) & ~opening
wheel_a = cv2.GaussianBlur(wheel.astype(np.float32), (0, 0), 1.2)

# --- windshield: bright area above the sharp black dash edge ------------------
edge = np.full(W, -1, np.int32)
for x in range(W):
    col = gray[:240, x]
    if col[:8].mean() < 70:
        continue
    idx = np.where(col < 30)[0]
    if len(idx):
        edge[x] = idx[0]
known = np.where((edge > 60) & ((np.arange(W) < 170) | (np.arange(W) > 1570)))[0]
xs = np.arange(W)
edge_s = np.interp(xs, known, edge[known])
edge_s = cv2.GaussianBlur(edge_s.reshape(1, -1).astype(np.float32), (0, 0), 6).ravel()
ws = (yy < edge_s[None, :]) & ~opening  # the cluster hood stays opaque
ws_a = cv2.GaussianBlur(ws.astype(np.float32), (0, 0), 0.8)

# --- printed cluster graphics to remove (screen becomes plain black glass) ---
screen = poly_mask([(338, 178), (1392, 178), (1395, 590), (335, 590)])
gfx = screen & (cv2.GaussianBlur(gray, (0, 0), 1) > 16)
gfx = nd.binary_dilation(gfx, iterations=5)

# --- dash plate: inpaint wheel (half res) and graphics (full res) -------------
fill = nd.binary_dilation(wheel, iterations=6)
small = cv2.resize(im, (W // 2, H // 2), interpolation=cv2.INTER_AREA)
smask = cv2.resize(fill.astype(np.uint8) * 255, (W // 2, H // 2), interpolation=cv2.INTER_NEAREST)
sfill = cv2.inpaint(small, smask, 9, cv2.INPAINT_TELEA)
sfill = cv2.GaussianBlur(sfill, (0, 0), 7)
big = cv2.resize(sfill, (W, H), interpolation=cv2.INTER_CUBIC)
dash = im.copy()
dash[fill] = big[fill]
# darken the invented area a little: it is in the wheel's shadow
dash[fill] = (dash[fill] * 0.62).astype(np.uint8)
dash = cv2.inpaint(dash, gfx.astype(np.uint8) * 255, 7, cv2.INPAINT_TELEA)
# keep the blank glass deep black and smooth
glass = cv2.GaussianBlur(dash, (0, 0), 6)
dash[screen] = np.minimum(dash[screen], glass[screen])

alpha = (1 - ws_a)
rgba = np.dstack([cv2.cvtColor(dash, cv2.COLOR_BGR2RGB), (alpha * 255).astype(np.uint8)])
Image.fromarray(rgba).save('assets/dash.webp', quality=88, method=6)

wrgba = np.dstack([cv2.cvtColor(im, cv2.COLOR_BGR2RGB), (np.clip(wheel_a, 0, 1) * 255).astype(np.uint8)])
Image.fromarray(wrgba).save('assets/wheel.webp', quality=90, method=6)
print('ok', 'edge left/right', int(edge_s[50]), int(edge_s[1650]))
