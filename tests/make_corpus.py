"""Synthetic test corpus: known properties so the metrics and grouping code can be checked."""
import os, sys, random, shutil, subprocess
from PIL import Image, ImageDraw, ImageFilter
out = sys.argv[1]
shutil.rmtree(out, ignore_errors=True); os.makedirs(out)
random.seed(7)

def art(w, h, seed, grey=False):
    r = random.Random(seed)
    im = Image.new('RGB', (w, h), (240, 235, 225) if not grey else (235, 235, 235))
    d = ImageDraw.Draw(im)
    for _ in range(40):
        x0, y0 = r.randint(0, w), r.randint(0, h); x1, y1 = x0 + r.randint(20, w // 3), y0 + r.randint(20, h // 3)
        c = tuple(r.randint(0, 255) for _ in range(3)) if not grey else (lambda v: (v, v, v))(r.randint(0, 255))
        d.rectangle([x0, y0, x1, y1], fill=c, outline=(0, 0, 0), width=3)
    for _ in range(60):
        d.line([r.randint(0, w), r.randint(0, h), r.randint(0, w), r.randint(0, h)], fill=(0, 0, 0), width=2)
    return im

def put(name, im, mtime=None, **kw):
    p = os.path.join(out, name); im.save(p, **kw)
    if mtime: os.utime(p, (mtime, mtime))
    return p

base = art(1600, 1200, 1)
put('G0sharp_big.png', base)
put('G0blurry.jpg', base.filter(ImageFilter.GaussianBlur(9)), quality=90)
put('G0small.jpg', art(320, 240, 2), quality=90)
put('G0grey.png', art(1200, 900, 3, grey=True))
put('G0jpegheavy.jpg', base.resize((1200, 900)), quality=6)
put('G0good_jpeg.jpg', base.resize((1200, 900)), quality=92)
# duplicates of sharp_big: exact copy and resized copy
shutil.copy(os.path.join(out, 'G0sharp_big.png'), os.path.join(out, 'G0sharp_big_copy.png'))
put('G0sharp_big_small.jpg', base.resize((800, 600)), quality=90)
# a comic set: same mtime, shared name prefix, same style
for i in range(4):
    put(f'GJ73xV{i}bIAAKi7Q.jpg', art(900, 1300, 10 + i), mtime=1711819867, quality=90)
# unrelated singles
for i in range(6):
    put(f'single_{i}.jpg', art(1000 + i * 37, 800, 100 + i), mtime=1700000000 + i * 5000, quality=90)
# a photo-like image: smooth gradients plus noise
ph = Image.effect_noise((1200, 800), 18).convert('RGB').filter(ImageFilter.GaussianBlur(1.2))
put('IMG_photo.jpg', ph, quality=90)
# transparent png
rgba = Image.new('RGBA', (600, 600), (0, 0, 0, 0)); ImageDraw.Draw(rgba).ellipse([50, 50, 550, 550], fill=(200, 30, 30, 255))
put('transparent.png', rgba)
# junk and non-media
open(os.path.join(out, 'desktop.ini'), 'w').write('[.ShellClassInfo]')
open(os.path.join(out, 'notes.txt'), 'w').write('not media')
# videos
os.makedirs(os.path.join(out, 'vids'))
subprocess.run(['ffmpeg', '-v', 'error', '-y', '-f', 'lavfi', '-i', 'testsrc=duration=3:size=640x360:rate=24', '-pix_fmt', 'yuv420p', os.path.join(out, 'vids', 'clip.mp4')], check=True)
subprocess.run(['ffmpeg', '-v', 'error', '-y', '-f', 'lavfi', '-i', 'testsrc2=duration=2:size=320x240:rate=10', os.path.join(out, 'vids', 'anim.gif')], check=True)
# nested folder
os.makedirs(os.path.join(out, 'nested', 'Checked'))
put('nested/inside.jpg', art(900, 700, 55), quality=90)
put('nested/Checked/skip.jpg', art(900, 700, 56), quality=90)
print(len(os.listdir(out)), 'top-level entries')
