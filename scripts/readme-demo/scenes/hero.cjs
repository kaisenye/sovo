// Still for the top of the README: the Inbox with the pointer parked out of the way.
module.exports = async (t) => {
  const [w, h] = await t.eval('[innerWidth, innerHeight]')
  await t.send('Input.dispatchMouseEvent', { type: 'mouseMoved', x: w - 10, y: h - 10 })
  await t.sleep(1500)
  await t.shot('hero')
}
