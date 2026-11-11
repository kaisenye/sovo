// Demo stand-in for DeepSeek's Chat Completions, for README recordings only.
// Canned, realistic answers keyed on the request; never calls anything.
import { createServer } from 'node:http'

const port = Number(process.argv[2] ?? 4011)
const delay = (ms) => new Promise((r) => setTimeout(r, ms))

const TODO = [
  [/Contract redlines/i, 'Confirm the contract redlines with Priya by Thu, so she can countersign before Friday'],
  [/Q4 launch plan/i, "Review the pricing section of Daniel's Q4 launch plan by Thu"],
  [/export to PDF/i, 'Reply to Hana at Brightlane: PDF export is failing and she needs it tomorrow'],
  [/Intro: Maya/i, "Follow up on Alex's intro to Jordan, a design systems lead"],
  [/API rate limits/i, "Answer Omar's question about raising the API rate limit for his import"]
]

function ask(prompt) {
  const blocks = [...prompt.matchAll(/<message n="(\d+)"[^\n]*?subject="([^"]*)">/g)].map((m) => ({ n: m[1], subject: m[2] }))
  const lines = []
  const hits = []
  for (const [re, line] of TODO) {
    const hit = blocks.find((b) => re.test(b.subject))
    if (hit) hits.push([Number(hit.n), `- ${line} [${hit.n}]`])
  }
  for (const [, l] of hits.sort((a, b) => a[0] - b[0])) lines.push(l)
  if (!lines.length) return "I couldn't find anything waiting on you in recent mail."
  return `${lines.length} things need you this week:\n${lines.join('\n')}`
}

const DRAFTS = [
  [/Contract redlines/i, "Hi Priya,\n\nThanks for getting legal over the line. The 12-month cap works for us, so please go ahead and countersign. I'll have the signed copy back to you before our call on Friday."],
  [/Q4 launch plan/i, "Hi Daniel,\n\nThanks for pulling this together. I'll go through the pricing section tonight and send my notes by Wednesday, so you have a day before the board update."],
  [/export to PDF/i, "Hi Hana,\n\nSorry for the trouble. We found the cause and a fix ships tonight. Until then, Print to PDF from the share menu gives you the same file for tomorrow's presentation."]
]

function draft(prompt) {
  for (const [re, text] of DRAFTS) if (re.test(prompt)) return text
  return 'Thanks for the note. I will take a look today and get back to you by tomorrow.'
}

function summary(prompt) {
  const subj = /Subject: (.*)/.exec(prompt)?.[1] ?? ''
  return `A short update about ${subj.replace(/^(Re|Fwd):\s*/i, '')}; no action needed.`
}

function answer(body) {
  const msgs = body.messages ?? []
  const system = String(msgs[0]?.content ?? '')
  const prompt = String(msgs[msgs.length - 1]?.content ?? '')
  if (system.startsWith("You answer questions about the user's email")) return { text: ask(prompt), wait: 1400 }
  if (system.startsWith('You summarize')) return { text: summary(prompt), wait: 900 }
  if (system.startsWith('Suggest three short replies'))
    return { text: JSON.stringify({ options: ['Thanks, sounds good.', 'Not this week, sorry.', 'Could you tell me more?'] }), wait: 900 }
  if (system.startsWith('You write email text')) return { text: draft(prompt), wait: 1600 }
  if (system.includes('"important"')) return { text: JSON.stringify({ important: false, category: 'other', reason: 'demo' }), wait: 300 }
  if (system.includes('"labels"')) return { text: JSON.stringify({ labels: [] }), wait: 300 }
  if (system.startsWith('You edit email text')) return { text: prompt.replace(/<\/?draft>/g, '').trim(), wait: 900 }
  return { text: 'OK.', wait: 300 }
}

createServer((req, res) => {
  let raw = ''
  req.on('data', (c) => (raw += c))
  req.on('end', async () => {
    const body = raw ? JSON.parse(raw) : {}
    const { text, wait } = answer(body)
    console.log(`[ai-demo] ${req.url} ${String(body.messages?.[0]?.content ?? '').slice(0, 40)}`)
    await delay(wait)
    res.writeHead(200, { 'content-type': 'application/json' })
    res.end(JSON.stringify({
      id: 'chatcmpl_demo', object: 'chat.completion', created: Math.floor(Date.now() / 1000), model: body.model,
      choices: [{ index: 0, message: { role: 'assistant', content: text }, finish_reason: 'stop' }],
      usage: { prompt_tokens: 120, completion_tokens: 30, total_tokens: 150, prompt_cache_hit_tokens: 0, prompt_cache_miss_tokens: 120 }
    }))
  })
}).listen(port, '127.0.0.1', () => console.log(`ai-demo on ${port}`))
