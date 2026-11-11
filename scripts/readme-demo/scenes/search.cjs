module.exports = async (t) => {
  await t.sleep(800)
  await t.start(); await t.sleep(700)
  await t.press('/', { cap: '/', wait: 600 })
  await t.type('contract', 10)
  await t.sleep(1300)
  await t.type(' from:priya', 10)
  await t.sleep(1400)
  await t.press('Enter', { cap: '↵', wait: 1500 })
  await t.stop('search', 1200)
}
