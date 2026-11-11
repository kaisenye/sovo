#!/bin/zsh
# record.sh [scene ...]: re-records README visuals into docs/assets/readme.
# No arguments: every scene. Each scene starts from a freshly seeded app.
set -e
source ${0:A:h}/env.sh
ASSETS=${SOVO_DEMO_ASSETS:-$ROOT/docs/assets/readme}
mkdir -p $ASSETS
scenes=("$@")
(( $#scenes )) || scenes=(hero ask-ai instant-reply write-with-ai triage search compose)

for s in $scenes; do
  echo "== $s"
  $HERE/reset.sh
  node $HERE/rec.cjs $HERE/scenes/$s.cjs
  if [[ $s == hero ]]; then
    rm -rf $WORK/hero
    # SOVO_DEMO_BACKDROP=<image>: a still on that photo (the README's is kept
    # out of the repo, it is a licensed stock photo). Unset: animated gradient.
    python3 $HERE/frame.py $WORK/frames/hero.png $WORK/hero $DEMO_W 1600 72 "${SOVO_DEMO_BACKDROP:-}"
    cp $WORK/hero/still.jpg $ASSETS/hero.jpg
    if [[ -n ${SOVO_DEMO_BACKDROP:-} ]]; then
      rm -f $ASSETS/hero.webp
    else
      img2webp -loop 0 -lossy -q 75 -m 4 -d 83 $WORK/hero/0*.png -o $ASSETS/hero.webp >/dev/null 2>&1
    fi
    echo "hero: $(du -k $ASSETS/hero.jpg | cut -f1) KB still"
  else
    $HERE/encode.sh $s
    cp $WORK/out/$s.webp $WORK/out/$s.poster.jpg $ASSETS/
  fi
done

demo_stop
lsof -ti :$AI_PORT | xargs kill 2>/dev/null || true
