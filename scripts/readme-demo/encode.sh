#!/bin/zsh
# encode.sh <clip> [fps] [width]: $WORK/frames/<clip> -> $WORK/out/<clip>.webp + <clip>.poster.jpg
# The hero clip is framed on a backdrop first (frame.py).
# Resamples the screencast to a steady frame rate by timestamp (ffmpeg's concat
# demuxer stretches short frames), then img2webp makes a looping lossy WebP.
set -e
source ${0:A:h}/env.sh
s=$1; fps=${2:-15}; w=${3:-1600}
rm -rf $WORK/seq/$s $WORK/png/$s; mkdir -p $WORK/seq/$s $WORK/png/$s $WORK/out
$PY - "$WORK/frames/$s/list.txt" "$WORK/seq/$s" "$fps" <<'PY'
import sys, os
lst, out, fps = sys.argv[1], sys.argv[2], float(sys.argv[3])
files, durs = [], []
for line in open(lst):
    if line.startswith('file'): files.append(line.split("'")[1])
    elif line.startswith('duration'): durs.append(float(line.split()[1]))
files = files[:len(durs)]
src = os.path.dirname(lst)
total = sum(durs); t = 0.0; i = 0; acc = durs[0]; k = 0
while t < total:
    while t >= acc and i < len(files) - 1:
        i += 1; acc += durs[i]
    os.symlink(os.path.join(src, files[i]), os.path.join(out, f'{k:04d}.jpg'))
    k += 1; t += 1 / fps
print(k, 'frames', round(total, 1), 's')
PY
if [[ $s == hero ]]; then
  # The hero sits on a backdrop (frame.py): $SOVO_DEMO_BACKDROP, or the gradient.
  $PY $HERE/frame.py $WORK/seq/$s $WORK/png/$s $DEMO_W $w 0 "${SOVO_DEMO_BACKDROP:-}"
  cp $WORK/png/$s/still.jpg $WORK/out/$s.poster.jpg
else
  ffmpeg -loglevel error -y -framerate $fps -i $WORK/seq/$s/%04d.jpg -vf "scale=$w:-1:flags=lanczos" $WORK/png/$s/%04d.png
  last=$(ls $WORK/png/$s | tail -1)
  ffmpeg -loglevel error -y -i $WORK/png/$s/$last -q:v 3 $WORK/out/$s.poster.jpg
fi
img2webp -loop 0 -lossy -q 72 -m 4 -d $((1000 / fps)) $WORK/png/$s/*.png -o $WORK/out/$s.webp >/dev/null 2>&1
echo "$s: $(du -k $WORK/out/$s.webp | cut -f1) KB webp, $(du -k $WORK/out/$s.poster.jpg | cut -f1) KB poster"
