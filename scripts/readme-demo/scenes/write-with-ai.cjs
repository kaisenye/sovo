module.exports = async (t) => {
  for (let i = 0; i < 3; i++) await t.press('j', { wait: 120 })
  await t.sleep(500)
  await t.start(); await t.sleep(600)
  await t.press('Enter', { cap: '↵', wait: 1300 })
  await t.press('r', { cap: 'R', wait: 1100 })
  await t.press('j', { mods: 'meta', cap: ['⌘', 'J'], wait: 600 })
  await t.type('say the fix ships tonight, offer a workaround', 15)
  await t.sleep(300)
  await t.press('Enter', { cap: '↵' })
  await t.waitFor("!document.querySelector('.ai-write') && /fix ships tonight/.test(document.querySelector('div.compose-body')?.innerText || '')", 8000)
  await t.stop('write-with-ai', 3000)
}
