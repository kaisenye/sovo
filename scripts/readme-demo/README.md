# README demo recordings

Scripts that re-record the hero shot and feature clips in `docs/assets/readme/`.
They run Sovo against a fictional mailbox (Maya Chen at Fieldnote), never your
own data, and a local stand-in for DeepSeek, so no AI provider is called.

## Needs

macOS with `ffmpeg`, `img2webp` (`brew install ffmpeg webp`), `sqlite3`,
`python3`, and the repo's `pnpm install`.

## Re-record

```bash
scripts/readme-demo/record.sh                    # every scene
scripts/readme-demo/record.sh ask-ai triage      # just these
```

Each scene starts from a freshly seeded app (dates relative to now) in a
1152×720 window, 125% of 1440×900 so text reads larger, plays scripted
keystrokes with a keycap overlay, and writes `<scene>.webp` plus a
`<scene>.poster.jpg` still (GitHub shows it where WebP doesn't play).

## Files

| File | What it does |
| --- | --- |
| `record.sh` | Runs scenes end to end and copies the results into `docs/assets/readme` |
| `reset.sh` | Re-seeds and relaunches the demo app on CDP port 9224 |
| `seed.py` | The fictional mailbox: Inbox, Sent, Archive, AI verdicts and summaries |
| `bootstrap.sql` | Account, folders and AI settings for a new demo profile |
| `ai-demo.mjs` | Fake DeepSeek on port 4011 with canned answers |
| `rec.cjs` | Recording driver: screencast, keycaps, `press` / `type` / `waitFor` helpers |
| `scenes/*.cjs` | One script per clip; `setup.cjs` sets the fake AI key |
| `encode.sh` | Frames to a 15 fps, 1600 px looping WebP and poster |
| `frame.py` | Puts the hero capture on a backdrop: a photo, or a looping black-and-white gradient |

The demo profile and frames live in `$TMPDIR/sovo-readme-demo`
(`SOVO_DEMO_WORK` to move it). Delete that folder to start from a new profile.
`SOVO_DEMO_ASSETS` writes the results somewhere other than `docs/assets/readme`.

The README hero sits on a licensed stock photo that is not in the repo. To
rebuild it, pass the image: `SOVO_DEMO_BACKDROP=~/path/to/photo.avif record.sh hero`.
Without it the hero gets an animated black-and-white gradient (`hero.webp`);
then point the README's hero back at that file.

To add a clip, copy a scene, record it, and add a row to the Features table in
the top-level README.
