#!/bin/bash
# scripts/verify-pptx.sh — PPTX wave slice verification (sandbox):
# the full bar minus the server parts (the export is client-side):
# unit tests → the smoke deck → headless LibreOffice conversion →
# pixel checks on the rendered pages.
set -euo pipefail
cd "$(dirname "$0")/.."

echo "── 1. unit tests (zip writer + package) ────────────"
npx vitest run src/lib/pptx/ 2>&1 | tail -5

echo "── 2. the smoke deck ────────────────────────────────"
ls -la /tmp/pptx-smoke.pptx

echo "── 3. LibreOffice conversion (the strict parser) ───"
rm -rf /tmp/pptx-smoke-out && mkdir -p /tmp/pptx-smoke-out
timeout 180 soffice --headless --convert-to pdf --outdir /tmp/pptx-smoke-out /tmp/pptx-smoke.pptx 2>&1 | grep -v javaldx || true
[ -f /tmp/pptx-smoke-out/pptx-smoke.pdf ] || { echo "CONVERSION FAILED"; exit 1; }
ls -la /tmp/pptx-smoke-out/pptx-smoke.pdf

echo "── 4. rendered pixel checks ─────────────────────────"
pdftoppm -r 50 -jpeg -jpegopt quality=60 /tmp/pptx-smoke-out/pptx-smoke.pdf /tmp/pptx-smoke-out/view
python3 - <<'EOF'
from PIL import Image
ok = True
im = Image.open('/tmp/pptx-smoke-out/view-1.jpg').convert('RGB')
w, h = im.size
px = im.load()
samples = [px[x, y] for y in range(0, h, 8) for x in range(0, w, 8)]
navy = sum(1 for r, g, b in samples if r < 60 and 50 < b < 120)
teal = sum(1 for r, g, b in samples if g > 140 and b > 140 and r < 100)
gold = sum(1 for r, g, b in samples if r > 200 and 150 < g < 230 and b < 130)
white = sum(1 for r, g, b in samples if r > 230 and g > 230 and b > 230)
print(f'slide 1: navy={navy} teal={teal} gold={gold} white={white}')
if navy < 1000: print('FAIL: navy background missing'); ok = False
if teal < 20: print('FAIL: teal ellipse missing'); ok = False
if gold < 5: print('FAIL: gold star (custGeom) missing'); ok = False
if white < 3: print('FAIL: white text missing'); ok = False
im2 = Image.open('/tmp/pptx-smoke-out/view-2.jpg').convert('RGB')
px2 = im2.load()
samples2 = [px2[x, y] for y in range(0, im2.size[1], 8) for x in range(0, im2.size[0], 8)]
cream = sum(1 for r, g, b in samples2 if r > 220 and g > 200 and b > 160)
print(f'slide 2: cream={cream}')
if cream < 1000: print('FAIL: slide 2 background missing'); ok = False
raise SystemExit(0 if ok else 1)
EOF
echo "── done ─────────────────────────────────────────────"
