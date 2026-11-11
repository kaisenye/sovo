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
  $HERE/encode.sh $s
  cp $WORK/out/$s.webp $WORK/out/$s.poster.jpg $ASSETS/
done

demo_stop
lsof -ti :$AI_PORT | xargs kill 2>/dev/null || true
