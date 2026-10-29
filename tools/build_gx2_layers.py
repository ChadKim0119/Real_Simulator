"""Build the simulator layers from the three aligned GX photos in assets/src/.

  gx2_full.png      interior with the steering wheel (reference only)
  gx2_nowheel.png   the same interior with the wheel removed
  gx2_wheel.png     the wheel on its own, photographed face-on (RGBA)

Outputs
  assets/gx2_plate.webp   the no-wheel interior with the windshield, side glass
                          and cluster glass cut out (alpha 0): the live road and
                          the live cluster are drawn underneath
  assets/gx2_wheel.webp   the face-on wheel, cropped to its bounding box
  js/wheel-geometry.js    how the face-on wheel maps into the photo:
                          rim  -> homography fitted to the rim's outer edge
                          hub  -> homography (the hub sits deeper in the dish)

Requires: pillow numpy scipy opencv-python-headless (opencv with SIFT)
"""
import json

import cv2
import numpy as np
from PIL import Image
from scipy import ndimage as nd

full = cv2.imread('assets/src/gx2_full.png')
bg = cv2.imread('assets/src/gx2_nowheel.png')
wheel = cv2.imread('assets/src/gx2_wheel.png', cv2.IMREAD_UNCHANGED)
H, W = bg.shape[:2]
yy, xx = np.mgrid[0:H, 0:W]


def feather(mask, s):
    return np.clip(cv2.GaussianBlur(mask.astype(np.float32), (0, 0), s), 0, 1)


def smooth_poly(pts, scale=4):
    big = np.zeros((H * scale, W * scale), np.uint8)
    cv2.fillPoly(big, [(np.asarray(pts, np.float32) * scale).astype(np.int32)], 255, lineType=cv2.LINE_AA)
    return cv2.resize(big, (W, H), interpolation=cv2.INTER_AREA).astype(np.float32) / 255


# ------------------------------------------------------------ geometry ----
# rim: fit an ellipse to the wheel's outer edge in the photo, and a circle to
# the face-on cutout's edge
diff = cv2.GaussianBlur(np.abs(full.astype(np.float32) - bg).max(-1), (0, 0), 1.2)
m = nd.binary_closing(diff > 45, iterations=3)
lab, n = nd.label(m)
blob = (lab == (np.argmax(nd.sum(m, lab, range(1, n + 1))) + 1)).astype(np.uint8)
cs, _ = cv2.findContours(blob, cv2.RETR_EXTERNAL, cv2.CHAIN_APPROX_NONE)
c = max(cs, key=cv2.contourArea)[:, 0, :]
pts = c[c[:, 1] < 720].astype(np.float32)          # the bottom merges with the footwell
hull = cv2.convexHull(pts)[:, 0, :]
dense = []
for i in range(len(hull)):
    a, b = hull[i], hull[(i + 1) % len(hull)]
    for t in np.linspace(0, 1, int(np.hypot(*(b - a)) / 3) + 1, endpoint=False):
        dense.append(a + (b - a) * t)
dense = np.array(dense, np.float32)
from scipy.spatial import cKDTree  # noqa: E402
on = dense[cKDTree(c).query(dense)[0] < 2.0]
(ex, ey), (ew, eh), eang = cv2.fitEllipse(on)

alpha = wheel[..., 3]
cs2, _ = cv2.findContours((alpha > 128).astype(np.uint8), cv2.RETR_EXTERNAL, cv2.CHAIN_APPROX_NONE)
(cx0, cy0), (cw, ch), _ = cv2.fitEllipse(max(cs2, key=cv2.contourArea)[:, 0, :].astype(np.float32))
D = (cw + ch) / 2

# The camera looks down at the wheel, so the near (lower) half of the rim
# appears larger: fit a full perspective transform, not just the ellipse.
# Measure the rim's outer edge along rays from the centre; the lower rim sits
# in shadow and needs a lower threshold.
from scipy.optimize import least_squares  # noqa: E402
d2 = cv2.GaussianBlur(np.abs(full.astype(np.float32) - bg).max(-1), (0, 0), 2)
edge_pts = []
for deg in np.arange(0, 360, 2):
    ang = np.deg2rad(deg)
    r = np.arange(300, 450)
    px = np.clip((ex + np.cos(ang) * r).astype(int), 0, W - 1)
    py = np.clip((ey + 8 + np.sin(ang) * r).astype(int), 0, H - 1)
    v = d2[py, px]
    idx = np.where(v > (14 if 35 < deg < 145 else 40))[0]
    if len(idx):
        edge_pts.append((px[idx.max()], py[idx.max()]))
edge_pts = np.array(edge_pts, float)
loop = np.vstack([edge_pts, edge_pts[:1]])
dense = np.array([loop[i] + (loop[i + 1] - loop[i]) * t for i in range(len(edge_pts)) for t in np.linspace(0, 1, 8, endpoint=False)])
tree = cKDTree(dense)
tt = np.linspace(0, 2 * np.pi, 360, endpoint=False)
circ = np.stack([cx0 + np.cos(tt) * D / 2, cy0 + np.sin(tt) * D / 2], 1)


def hmap(Hm, p):
    q = np.hstack([p, np.ones((len(p), 1))]) @ Hm.T
    return q[:, :2] / q[:, 2:]


def unpack(x):
    return np.array([[x[0], x[1], x[2]], [x[3], x[4], x[5]], [x[6], x[7], 1]])


th = np.deg2rad(eang)
R = np.array([[np.cos(th), -np.sin(th)], [np.sin(th), np.cos(th)]])
aff = R @ np.diag([ew / D, eh / D]) @ R.T                 # start: circle -> ellipse, no twist
x0 = [aff[0, 0], aff[0, 1], ex - aff[0] @ [cx0, cy0], aff[1, 0], aff[1, 1], ey - aff[1] @ [cx0, cy0], 0, 0]
fit = least_squares(lambda x: tree.query(hmap(unpack(x), circ))[0], x0,
                    x_scale=[1e-3, 1e-3, 1, 1e-3, 1e-3, 1, 1e-6, 1e-6], loss='soft_l1', f_scale=2)
rim = unpack(fit.x)
print('rim edge rms', round(float(np.sqrt((fit.fun ** 2).mean())), 2))

# hub: homography from SIFT matches on the face-on wheel's hub area
sift = cv2.SIFT_create(6000)
hub_mask = ((np.hypot(*(np.mgrid[0:alpha.shape[0], 0:alpha.shape[1]][::-1] - np.array([cx0, cy0])[:, None, None])) < 0.42 * D)
            & (alpha > 200)).astype(np.uint8) * 255
ka, da = sift.detectAndCompute(cv2.cvtColor(wheel[..., :3], cv2.COLOR_BGR2GRAY), hub_mask)
kb, db = sift.detectAndCompute(cv2.cvtColor(full, cv2.COLOR_BGR2GRAY), None)
good = [p for p, q in cv2.BFMatcher().knnMatch(da, db, k=2) if p.distance < 0.72 * q.distance]
pa = np.float32([ka[g.queryIdx].pt for g in good])
pb = np.float32([kb[g.trainIdx].pt for g in good])
hub, inl = cv2.findHomography(pa, pb, cv2.RANSAC, 2.0)
hub /= hub[2, 2]
print('rim ellipse', round(ex, 1), round(ey, 1), round(ew, 1), round(eh, 1), round(eang, 1),
      '| hub matches', int(inl.sum()), '/', len(pa))

# crop the cutout to its content
# crop to the wheel itself (the file carries faint stray alpha far outside it)
solid = nd.binary_opening(alpha > 24, iterations=2)
lab, n = nd.label(solid)
keep = lab == (np.argmax(nd.sum(solid, lab, range(1, n + 1))) + 1)
ys, xs = np.where(keep)
X0, Y0 = max(xs.min() - 4, 0), max(ys.min() - 4, 0)
X1, Y1 = min(xs.max() + 5, alpha.shape[1]), min(ys.max() + 5, alpha.shape[0])
clean = wheel.copy()
clean[..., 3] = (clean[..., 3] * nd.binary_dilation(keep, iterations=3)).astype(np.uint8)
rgba = cv2.cvtColor(clean[Y0:Y1, X0:X1], cv2.COLOR_BGRA2RGBA)
Image.fromarray(rgba).save('assets/gx2_wheel.webp', quality=92, method=6)

geo = {
    'size': [W, H],
    'tex': {'x': int(X0), 'y': int(Y0), 'w': int(X1 - X0), 'h': int(Y1 - Y0)},
    'centre': [round(float(cx0), 2), round(float(cy0), 2)],
    'radius': round(float(D / 2), 2),
    'rim': [round(float(v), 9) for v in rim.ravel()],
    'hub': [round(float(v), 9) for v in hub.ravel()],
}
with open('js/wheel-geometry.js', 'w') as f:
    f.write('/* Generated by tools/build_gx2_layers.py: how the face-on wheel maps into the photo. */\n')
    f.write('window.WheelGeometry = ' + json.dumps(geo) + ';\n')

# --------------------------------------------------------------- plate ----
lum = cv2.cvtColor(bg, cv2.COLOR_BGR2GRAY).astype(np.float32)
glass = np.zeros((H, W), bool)
# windshield: everything above the dark lip of the dash, right of the A-pillar
edge = np.full(W, 0, np.int32)
for x in range(W):
    col = cv2.GaussianBlur(lum[:140, x:x + 1], (1, 5), 0)[:, 0]
    dark = np.where(col < 38)[0]
    dark = dark[dark > 30]
    edge[x] = dark[0] if len(dark) else 0
xs_ok = np.arange(W) >= 248
e = edge.astype(np.float32)
good_e = xs_ok & (e > 40) & (e < 110)
e = np.interp(np.arange(W), np.where(good_e)[0], e[good_e])
e = cv2.GaussianBlur(e.reshape(1, -1), (0, 0), sigmaX=4, sigmaY=0).ravel()
glass |= (yy < e[None, :] - 1) & (xx >= 248)
# A-pillar edge: the pillar's inner face runs from x 245 at the top to 236 at the lip
pillar = smooth_poly([(0, 0), (247, 0), (240, 75), (0, 75)]) > 0.5
glass &= ~pillar | (xx > 247)
# side glass left of the pillar: bright landscape pixels
side = (xx < 245) & (yy < 215) & (lum > 92)
side = nd.binary_opening(side, iterations=2)
side = nd.binary_closing(side, iterations=3)
lab, n = nd.label(side)
if n:
    sizes = nd.sum(side, lab, range(1, n + 1))
    side = np.isin(lab, [i + 1 for i, s in enumerate(sizes) if s > 600])
glass |= side

# cluster glass, measured on the photo: the lit display runs x 586.5..1039,
# y 190.5..357 with small rounded corners. The hole is 1 px larger so none of
# the photographed display's blue edge survives; the column boss and the stalk
# ends in front of it stay.
SCREEN = (585.5, 189.5, 1040, 358)
sx0, sy0, sx1, sy1 = SCREEN
rr = 7
screen_pts = []
for (cx_, cy_, a0) in ((sx1 - rr, sy0 + rr, -90), (sx1 - rr, sy1 - rr, 0), (sx0 + rr, sy1 - rr, 90), (sx0 + rr, sy0 + rr, 180)):
    for t in np.linspace(0, 90, 10):
        ang = np.deg2rad(a0 + t)
        screen_pts.append((cx_ + rr * np.cos(ang), cy_ + rr * np.sin(ang)))
screen = smooth_poly(screen_pts)
boss = smooth_poly([(721, 362), (723, 347), (731, 340), (760, 336.5), (870, 336.5), (896, 340), (904, 347), (906, 362)])
stalk_l = smooth_poly([(540, 344), (590, 344), (597, 362), (540, 362)])
stalk_r = smooth_poly([(1037, 344), (1080, 344), (1080, 362), (1036, 362)])
screen_hole = np.clip(screen - boss - stalk_l - stalk_r, 0, 1)

# the display lit everything around it blue (bezel lip, top of the boss, stalk
# ends): take that tint out so the surroundings read as the switched-off cabin
near = cv2.dilate((screen > 0.5).astype(np.uint8), np.ones((15, 15), np.uint8)) > 0
b_, g_, r_ = [bg[..., i].astype(np.int16) for i in range(3)]
tint = near & (b_ - r_ > 6)
grey = cv2.cvtColor(cv2.cvtColor(bg, cv2.COLOR_BGR2GRAY), cv2.COLOR_GRAY2BGR).astype(np.float32)
neutral = (grey * np.array([1.0, 1.0, 1.04]) * 0.8)
k = np.clip((b_ - r_ - 6) / 20.0, 0, 1)[..., None] * tint[..., None]
bg = (bg * (1 - k) + neutral * k).astype(np.uint8)

a_plate = 1 - np.maximum(feather(glass, 0.9), screen_hole)
plate = np.dstack([cv2.cvtColor(bg, cv2.COLOR_BGR2RGB), (np.clip(a_plate, 0, 1) * 255).astype(np.uint8)])
Image.fromarray(plate).save('assets/gx2_plate.webp', quality=90, method=6)
geo_screen = {'x': sx0, 'y': sy0, 'w': sx1 - sx0, 'h': sy1 - sy0}
print('ok', geo['tex'], 'glass px', int(glass.sum()), 'screen', geo_screen)
