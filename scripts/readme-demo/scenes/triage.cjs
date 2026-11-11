module.exports = async (t) => {
  // Start on the newsletter run, where clearing feels natural.
  for (let i = 0; i < 9; i++) await t.press('j', { wait: 90 })
  await t.sleep(600)
  await t.start(); await t.sleep(700)
  await t.press('e', { cap: 'E', wait: 650 })
  await t.press('e', { cap: 'E', wait: 650 })
  await t.press('e', { cap: 'E', wait: 650 })
  await t.press('z', { cap: 'Z', wait: 1000 })
  await t.press('h', { cap: 'H', wait: 900 })
  await t.type('tomorrow 9am', 12)
  await t.sleep(500)
  await t.press('Enter', { cap: '↵', wait: 900 })
  await t.press('R', { cap: ['⇧', 'R'], wait: 1400 })
  await t.stop('triage', 1200)
}
