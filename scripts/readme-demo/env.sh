# Shared by the readme-demo scripts. Override with SOVO_DEMO_WORK / SOVO_DEMO_PORT.
HERE=${0:A:h}
ROOT=${HERE:h:h}
export SOVO_DEMO_WORK=${SOVO_DEMO_WORK:-${TMPDIR:-/tmp}/sovo-readme-demo}
export SOVO_DEMO_PORT=${SOVO_DEMO_PORT:-9224}
WORK=$SOVO_DEMO_WORK
PORT=$SOVO_DEMO_PORT
AI_PORT=4011
PROFILE=$WORK/profile
DB=$PROFILE/sovo.db
mkdir -p $WORK

demo_stop() {
  lsof -ti :$PORT | xargs kill 2>/dev/null || true
  for i in {1..30}; do pgrep -f -- "--user-data-dir=$PROFILE" >/dev/null || break; sleep 0.3; done
}

# A dev build signs in the account in .env.local; SOVO_ENV_FILE points it at the
# demo's (fake password), never one at the repo root.
demo_launch() {
  cat > $WORK/.env.local <<ENV
SOVO_EMAIL=maya@fieldnote.studio
SOVO_PASS=demo-not-a-real-password
SOVO_NAME=Maya Chen
SOVO_IMAP_HOST=127.0.0.1
SOVO_IMAP_PORT=3993
SOVO_SMTP_HOST=127.0.0.1
SOVO_SMTP_PORT=3465
ENV
  (cd $ROOT && SOVO_ENV_FILE=$WORK/.env.local SOVO_DEEPSEEK_BASE_URL=http://127.0.0.1:$AI_PORT env -u ELECTRON_RUN_AS_NODE \
    nohup npx electron-vite dev --remoteDebuggingPort $PORT -- --user-data-dir=$PROFILE > $WORK/app.log 2>&1 &)
  for i in {1..120}; do
    curl -s localhost:$PORT/json/list 2>/dev/null | grep -q '"page"' && return 0
    sleep 0.5
  done
  echo "Demo app did not start; see $WORK/app.log" >&2
  return 1
}
