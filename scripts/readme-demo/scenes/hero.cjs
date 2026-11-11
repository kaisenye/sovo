// Still for the top of the README: the Inbox with the pointer parked out of the way.
module.exports = async (t) => {
  await t.send('Input.dispatchMouseEvent', { type: 'mouseMoved', x: 1430, y: 890 })
  await t.sleep(1500)
  await t.shot('hero')
}
