// @vitest-environment jsdom
import { describe, expect, it } from 'vitest'
import { buildReplyBody, quotableHtml, signatureBlock } from './quote.js'
import { cleanPastedHtml } from './richText.js'

// Shaped like a real Outlook mail: a global p { margin:0 } rule, body
// paragraphs that set 1em back, a margin:0in signature, wrapped source lines.
const outlook = `<html><head><style type="text/css" style="display:none;"> P {margin-top:0;margin-bottom:0;} </style></head>
<body dir="ltr">
<p style="margin-top: 1em; margin-bottom: 1em;">Kaisen,</p>
<p style="margin-top: 1em; margin-bottom: 1em;">Please ask G11 for a short dated written statement that it is
 available and prepared.</p>
<div id="Signature">
<p style="text-align: left; text-indent: 0px; margin: 0in;"><span>James A. Cooper, Esq.</span></p>
<p style="text-align: left; text-indent: 0px; margin: 0in;"><span>Office Main Line: (540) 200-8830</span></p>
</div>
</body></html>`

describe('quotableHtml', () => {
  it('adds no <br> for source newlines', () => {
    const out = quotableHtml(outlook)
    expect(out).not.toContain('<br>')
    expect(out).toContain('statement that it is available and prepared.')
  })

  it('keeps 1em paragraphs as <p> and turns margin-0 ones into <div>', () => {
    const out = quotableHtml(outlook)
    expect(out).toContain('<p>Kaisen,</p>')
    expect(out).toContain('<div><span>James A. Cooper, Esq.</span></div><div><span>Office Main Line')
  })

  it("follows a class rule like Outlook's p.MsoNormal", () => {
    const html = '<style>p.MsoNormal, li.MsoNormal { margin:0in; }</style><p class="MsoNormal">a</p><p>b</p>'
    expect(quotableHtml(html)).toBe('<div>a</div><p>b</p>')
  })

  it('keeps <pre> newlines and drops remote images', () => {
    const out = quotableHtml('<pre>a\nb</pre><img src="https://t.example/p.gif">')
    expect(out).toBe('<pre>a\nb</pre>')
  })

  it('feeds the reply body', () => {
    const body = buildReplyBody({ from_addr: 'jim@x.com', from_name: 'Jim', date: null, body_text: null, body_html: outlook })
    expect(body.startsWith('<div><br></div><div class="sovo-quote">')).toBe(true)
    expect(body).not.toMatch(/<blockquote[^>]*><br>/)
  })
})

describe('signature spacing', () => {
  // The saved signature that showed a blank line under "Thanks," in compose.
  const saved =
    '<div><div><div>Thanks,</div><div>    <div><span style="color: rgb(107, 114, 128)">Kaisen Ye</span></div>' +
    '<div><br></div><div>m. 346-368-1097</div></div></div></div>'

  it('drops indentation between blocks', () => {
    const out = signatureBlock(saved)
    expect(out).not.toMatch(/>\s+</)
    expect(out).toContain('<div>Thanks,</div><div><div><span style="color: rgb(107, 114, 128)">Kaisen Ye</span></div><div><br></div>')
  })

  it('keeps spaces between inline words and nbsp lines', () => {
    expect(cleanPastedHtml('<div><b>a</b> <i>b</i></div><p>&nbsp;</p>')).toBe('<div><b>a</b> <i>b</i></div><p>&nbsp;</p>')
  })
})
