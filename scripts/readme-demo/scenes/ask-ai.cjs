module.exports = async (t) => {
  await t.sleep(800)
  await t.start(); await t.sleep(700)
  await t.press('j', { mods: 'meta', cap: ['⌘', 'J'], wait: 700 })
  await t.type('what do I need to do this week?', 14)
  await t.sleep(300)
  await t.press('Enter', { cap: '↵' })
  await t.waitFor("document.querySelector('.palette-answer')?.textContent.includes('things need you')", 8000)
  await t.stop('ask-ai', 3800)
}
