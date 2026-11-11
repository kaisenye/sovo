"""frame.py <in.png> <out-dir> <window-points-width> [width] [frames]

Puts a window capture on a slowly moving black-and-white gradient: rounded
corners, a soft glow and macOS traffic lights (the capture has no title bar;
the app uses hiddenInset). Writes <out-dir>/0000.png… as one seamless loop,
for img2webp, plus <out-dir>/still.jpg for the poster."""
import math
import os
import sys

import numpy as np
from PIL import Image, ImageDraw, ImageFilter

src, out_dir = sys.argv[1], sys.argv[2]
points = int(sys.argv[3])
width = int(sys.argv[4]) if len(sys.argv) > 4 else 1600
n_frames = int(sys.argv[5]) if len(sys.argv) > 5 else 60
os.makedirs(out_dir, exist_ok=True)

# Window at output scale.
cap = Image.open(src).convert('RGB')
win_w = round(width * 0.86)
k = win_w / cap.width
win = cap.resize((win_w, round(cap.height * k)), Image.LANCZOS)
W, H = win.size
s = cap.width / points * k  # output pixels per window point

d = ImageDraw.Draw(win)
for i, c in enumerate([(255, 95, 87), (254, 188, 46), (40, 200, 64)]):
    cx, cy, rad = (26 + i * 20) * s, 20 * s, 6 * s
    d.ellipse((cx - rad, cy - rad, cx + rad, cy + rad), fill=c)

pad_x = (width - W) // 2
pad_top = round(width * 0.05)
BW, BH = width, H + pad_top + round(width * 0.065)

r = round(10 * s)
mask = Image.new('L', (W, H), 0)
ImageDraw.Draw(mask).rounded_rectangle((0, 0, W - 1, H - 1), r, fill=255)

# A faint light glow around the window so it lifts off the dark backdrop.
glow = Image.new('L', (BW, BH), 0)
ImageDraw.Draw(glow).rounded_rectangle((pad_x, pad_top, pad_x + W, pad_top + H), r, fill=255)
glow = np.asarray(glow.filter(ImageFilter.GaussianBlur(round(40 * s))), np.float32) / 255 * 0.10

# Backdrop: soft white lights drifting over black, computed small and scaled up.
SW, SH = 240, round(240 * BH / BW)
yy, xx = np.mgrid[0:SH, 0:SW].astype(np.float32)
xx /= SW
yy /= SW  # same units on both axes: circles stay round


def light(cx, cy, radius, power):
    d2 = (xx - cx) ** 2 + (yy - cy) ** 2
    return power * np.exp(-d2 / (2 * radius ** 2))


def backdrop(t):
    a = 2 * math.pi * t
    h = SH / SW
    # Three lights on looping paths; each also breathes, out of step with the others.
    v = (light(0.22 + 0.22 * math.cos(a), 0.12 * h + 0.16 * math.sin(a), 0.24, 0.60 + 0.20 * math.sin(a + 0.5))
         + light(0.80 - 0.20 * math.cos(a + 1.3), 0.88 * h - 0.14 * math.sin(a + 1.3), 0.28, 0.48 + 0.18 * math.cos(a))
         + light(0.50 + 0.38 * math.sin(a + 2.4), 0.50 * h + 0.30 * math.sin(2 * a), 0.13, 0.30 + 0.12 * math.sin(2 * a + 1)))
    v = 1 - np.exp(-v)  # soft clip: brights roll off instead of blowing out
    img = Image.fromarray(np.uint8(np.clip(v * 255, 0, 255)), 'L').resize((BW, BH), Image.BICUBIC)
    g = np.asarray(img, np.float32) / 255
    g = np.clip(0.03 + g * 0.78 + glow, 0, 1)  # near-black floor, never pure white
    return Image.fromarray(np.uint8(g * 255), 'L').convert('RGB')


def frame(t):
    bg = backdrop(t)
    bg.paste(win, (pad_x, pad_top), mask)
    ImageDraw.Draw(bg).rounded_rectangle((pad_x, pad_top, pad_x + W - 1, pad_top + H - 1), r,
                                         outline=(78, 78, 84), width=max(1, round(s * 0.5)))
    return bg


for i in range(n_frames):
    frame(i / n_frames).save(os.path.join(out_dir, f'{i:04d}.png'))
frame(0).save(os.path.join(out_dir, 'still.jpg'), quality=90)
print(n_frames, 'frames', BW, 'x', BH)
