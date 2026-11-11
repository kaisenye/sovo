module.exports = async (t) => {
  await t.sleep(800)
  await t.start(); await t.sleep(700)
  await t.press('Enter', { cap: '↵', wait: 1800 })
  await t.press('1', { cap: '1', wait: 1500 })
  await t.press('Enter', { mods: 'meta', cap: ['⌘', '↵'], wait: 400 })
  await t.stop('instant-reply', 2200)
}
