// Gives the demo profile a DeepSeek key so the AI features are on. The key is
// fake: reset.sh points DeepSeek at ai-demo.mjs on localhost.
module.exports = async (t) => {
  await t.waitFor('!!window.api?.aiSetKey', 15000)
  await t.eval("window.api.aiSetKey('deepseek', 'sk-demo-not-a-real-key').then(() => true)")
}
