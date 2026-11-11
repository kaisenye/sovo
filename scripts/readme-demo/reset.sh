#!/bin/zsh
# A fresh demo app: re-seed the fictional inbox (dates relative to now) and
# relaunch it on CDP $SOVO_DEMO_PORT with DeepSeek pointed at ai-demo.mjs.
set -e
source ${0:A:h}/env.sh

demo_stop
lsof -ti :$AI_PORT | xargs kill 2>/dev/null || true
nohup node $HERE/ai-demo.mjs $AI_PORT > $WORK/ai.log 2>&1 &

# First run: the app creates its schema and the account; then folders and settings.
if ! sqlite3 $DB 'SELECT 1 FROM folders WHERE account_id = 1' 2>/dev/null | grep -q 1; then
  mkdir -p $PROFILE
  demo_launch
  for i in {1..60}; do sqlite3 $DB 'SELECT 1 FROM accounts WHERE id = 1' 2>/dev/null | grep -q 1 && break; sleep 0.5; done
  demo_stop
  sqlite3 $DB < $HERE/bootstrap.sql
fi

python3 $HERE/seed.py $WORK/seed.sql >/dev/null
sqlite3 $DB <<SQL
DELETE FROM messages; DELETE FROM list_rows; DELETE FROM list_dirty; DELETE FROM ai_classifications; DELETE FROM reply_options;
DELETE FROM ai_jobs; DELETE FROM outbox; DELETE FROM move_jobs; DELETE FROM reminders; DELETE FROM mutes; DELETE FROM replied_senders;
DELETE FROM settings WHERE key LIKE 'account.1.workspace%';
.read $WORK/seed.sql
SQL
echo "{\"x\":60,\"y\":60,\"width\":$DEMO_W,\"height\":$DEMO_H,\"maximized\":false,\"fullScreen\":false}" > $PROFILE/window-state.json

demo_launch
node $HERE/rec.cjs $HERE/scenes/setup.cjs
sleep 4
