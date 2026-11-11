// Recording driver for the demo app. node rec.cjs <scene.cjs>
// Screencasts the page (no window chrome), shows a keycap for each shortcut,
// and keeps the demo's "Sync failed" toast (no real mail server) out of frame.
// Frames go to $SOVO_DEMO_WORK/frames/<name>; CDP port is $SOVO_DEMO_PORT (9224).
const fs = require('fs'), os = require('os'), path = require('path')
const WORK = process.env.SOVO_DEMO_WORK || path.join(os.tmpdir(), 'sovo-readme-demo')
const PORT = process.env.SOVO_DEMO_PORT || '9224'
const OUT = path.join(WORK, 'frames')

const OVERLAY = `(() => {
  if (window.__kc) return true
  const st = document.createElement('style')
  st.textContent = \`
    #kc { position: fixed; right: 36px; bottom: 36px; z-index: 99999; display: flex; gap: 6px; pointer-events: none; }
    #kc span { font: 600 15px/1 Inter, system-ui, sans-serif; color: #f2f2f4; background: rgba(28,29,31,.92); border: 1px solid rgba(255,255,255,.16);
      border-radius: 9px; padding: 9px 12px; min-width: 18px; text-align: center; box-shadow: 0 8px 24px rgba(0,0,0,.35); animation: kc-in .14s ease-out; }
    #kc[data-out] span { opacity: 0; transition: opacity .35s ease; }
    @keyframes kc-in { from { opacity: 0; transform: translateY(6px) scale(.96) } }
    .toaster .toast[data-demo-hide] { display: none !important; }
  \`
  document.head.appendChild(st)
  const box = document.createElement('div'); box.id = 'kc'; document.body.appendChild(box)
  let t = null
  window.__kc = (keys) => {
    box.removeAttribute('data-out')
    box.innerHTML = keys.map((k) => '<span>' + k + '</span>').join('')
    clearTimeout(t); t = setTimeout(() => box.setAttribute('data-out', ''), 900)
  }
  const hide = () => document.querySelectorAll('.toast').forEach((el) => {
    if (/Sync failed|ECONNREFUSED|Could not send|SMTP/i.test(el.textContent)) el.setAttribute('data-demo-hide', '')
  })
  new MutationObserver(hide).observe(document.body, { childList: true, subtree: true })
  hide()
  return true
})()`

;(async () => {
  const list = await (await fetch(`http://127.0.0.1:${PORT}/json/list`)).json()
  const page = list.find((t) => t.type === 'page' && t.url.startsWith('http://localhost'))
  const ws = new WebSocket(page.webSocketDebuggerUrl)
  await new Promise((r) => (ws.onopen = r))
  let id = 0; const pend = new Map(); let frames = null
  const send = (method, params = {}) => new Promise((r) => { const i = ++id; pend.set(i, r); ws.send(JSON.stringify({ id: i, method, params })) })
  ws.onmessage = (e) => {
    const m = JSON.parse(e.data)
    if (m.id && pend.has(m.id)) { pend.get(m.id)(m); pend.delete(m.id) }
    else if (m.method === 'Page.screencastFrame') {
      if (frames) frames.push({ data: m.params.data, ts: m.params.metadata.timestamp })
      send('Page.screencastFrameAck', { sessionId: m.params.sessionId })
    }
  }
  await send('Runtime.enable'); await send('Page.enable')
  const sleep = (ms) => new Promise((r) => setTimeout(r, ms))
  const evalJs = async (expr) => { const r = await send('Runtime.evaluate', { expression: expr, awaitPromise: true, returnByValue: true }); if (r.result?.exceptionDetails) throw new Error(r.result.exceptionDetails.exception?.description); return r.result?.result?.value }
  await evalJs(OVERLAY)
  const MOD = { alt: 1, ctrl: 2, meta: 4, shift: 8 }
  const CODES = { Enter: 13, Escape: 27, Tab: 9, Backspace: 8, ArrowDown: 40, ArrowUp: 38, ' ': 32 }
  const t = {
    sleep, eval: evalJs, send,
    async waitFor(expr, ms = 6000) { const end = Date.now() + ms; while (Date.now() < end) { try { const v = await evalJs(expr); if (v) return v } catch {} await sleep(80) } return null },
    keycap(...keys) { return evalJs(`window.__kc(${JSON.stringify(keys)})`) },
    /** Presses a key; `cap` shows it on screen. mods: 'meta', 'shift', 'meta+shift'. */
    async press(key, { mods = '', cap = null, wait = 350 } = {}) {
      const m = mods ? mods.split('+').reduce((a, k) => a | MOD[k], 0) : 0
      if (cap) await t.keycap(...[].concat(cap))
      const code = CODES[key] ?? (key.length === 1 ? key.toUpperCase().charCodeAt(0) : 0)
      const text = key.length === 1 && !(m & (MOD.meta | MOD.ctrl)) ? key : key === 'Enter' ? '\r' : undefined
      await send('Input.dispatchKeyEvent', { type: text ? 'keyDown' : 'rawKeyDown', key, code: key.length === 1 ? 'Key' + key.toUpperCase() : key, windowsVirtualKeyCode: code, modifiers: m, text })
      await send('Input.dispatchKeyEvent', { type: 'keyUp', key, windowsVirtualKeyCode: code, modifiers: m })
      await sleep(wait)
    },
    /** Types like a person. */
    async type(text, cps = 16) { for (const ch of text) { await send('Input.insertText', { text: ch }); await sleep(1000 / cps + Math.random() * 25) } },
    async start() { frames = []; await send('Page.startScreencast', { format: 'jpeg', quality: 90, everyNthFrame: 1 }); await sleep(120) },
    async stop(name, hold = 1200) {
      await sleep(hold)
      await send('Page.stopScreencast')
      const f = frames; frames = null
      const dir = path.join(OUT, name); fs.rmSync(dir, { recursive: true, force: true }); fs.mkdirSync(dir, { recursive: true })
      const lines = []
      f.forEach((fr, i) => {
        const file = `${String(i).padStart(4, '0')}.jpg`
        fs.writeFileSync(path.join(dir, file), Buffer.from(fr.data, 'base64'))
        const next = f[i + 1]?.ts ?? fr.ts + hold / 1000
        lines.push(`file '${file}'`, `duration ${Math.max(0.01, next - fr.ts).toFixed(3)}`)
      })
      lines.push(`file '${String(f.length - 1).padStart(4, '0')}.jpg'`)
      fs.writeFileSync(path.join(dir, 'list.txt'), lines.join('\n') + '\n')
      console.log(`${name}: ${f.length} frames, ${(f.at(-1).ts - f[0].ts + hold / 1000).toFixed(1)}s`)
    },
    async shot(name) { const r = await send('Page.captureScreenshot', { format: 'png' }); fs.mkdirSync(OUT, { recursive: true }); fs.writeFileSync(path.join(OUT, name + '.png'), Buffer.from(r.result.data, 'base64')) }
  }
  let failed = false
  try { await require(path.resolve(process.argv[2]))(t) } catch (e) { console.log('SCENE ERROR', e.stack); failed = true }
  ws.close(); process.exit(failed ? 1 : 0)
})()
