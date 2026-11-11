// Top of the README: a short tour. Move down the Inbox, open a thread (summary
// and Instant Reply), go back, then ask the inbox what needs doing.
module.exports = async (t) => {
  const [w, h] = await t.eval('[innerWidth, innerHeight]')
  await t.send('Input.dispatchMouseEvent', { type: 'mouseMoved', x: w - 10, y: h - 10 })
  await t.sleep(1200)
  await t.start(); await t.sleep(900)
  await t.press('j', { cap: 'J', wait: 450 })
  await t.press('j', { cap: 'J', wait: 450 })
  await t.press('j', { cap: 'J', wait: 700 })
  await t.press('Enter', { cap: '↵', wait: 2400 })
  await t.press('Escape', { cap: 'esc', wait: 900 })
  await t.press('j', { mods: 'meta', cap: ['⌘', 'J'], wait: 600 })
  await t.type("what's on me this week?", 15)
  await t.sleep(300)
  await t.press('Enter', { cap: '↵' })
  await t.waitFor("document.querySelector('.palette-answer')?.textContent.includes('things need you')", 8000)
  await t.stop('hero', 3200)
}
