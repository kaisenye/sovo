"""Fictional demo mailbox for README recordings. Writes seed.sql; dates are relative to now."""
import json, time, html, sys

NOW = int(time.time() * 1000)
MIN = 60_000
HOUR = 60 * MIN
DAY = 24 * HOUR

ME = ('maya@fieldnote.studio', 'Maya Chen')
INBOX, SENT, ARCHIVE = 1, 2, 3

def addrs(*people):
    return json.dumps([{'address': a, 'name': n} for a, n in people])

def body(paras):
    return ''.join(f'<p>{html.escape(p)}</p>' for p in paras)

rows = []          # message rows
cls = []           # (message_id, important, category)
summaries = {}     # message_id -> summary
replies = {}       # message_id -> [options]
uid = {INBOX: 100, SENT: 100, ARCHIVE: 100}

def msg(folder, thread, mid, sender, to, subject, ago, paras, *, cc=(), seen=True, flagged=False,
        bulk=False, attach=False, reply_to=None, unsub=None):
    uid[folder] += 1
    text = '\n\n'.join(paras)
    flags = (['\\Seen'] if seen else []) + (['\\Flagged'] if flagged else [])
    rows.append(dict(
        account_id=1, folder_id=folder, uid=uid[folder], message_id=f'<{mid}@demo.fieldnote>',
        thread_id=thread, in_reply_to=f'<{reply_to}@demo.fieldnote>' if reply_to else None,
        from_addr=sender[0], from_name=sender[1], to_addrs=addrs(*to), cc_addrs=addrs(*cc) if cc else None,
        subject=subject, date=NOW - ago, snippet=text.replace('\n', ' ')[:160], body_text=text,
        body_html=body(paras), flags=json.dumps(flags), has_attachments=1 if attach else 0, body_fetched=1,
        bulk=1 if bulk else 0, list_unsubscribe=unsub,
    ))
    return f'<{mid}@demo.fieldnote>'

P = {
    'priya': ('priya@harborlegal.co', 'Priya Raman'),
    'daniel': ('daniel@fieldnote.studio', 'Daniel Ortiz'),
    'sam': ('sam.lee@mailbox.org', 'Sam Lee'),
    'alex': ('alex@kimventures.co', 'Alex Kim'),
    'jordan': ('jordan@systemsguild.io', 'Jordan Reyes'),
    'hana': ('hana@brightlane.app', 'Hana Sato'),
    'hannah': ('hannah@fieldnote.studio', 'Hannah Park'),
    'leo': ('leo@fieldnote.studio', 'Leo Martins'),
    'omar': ('omar@tidewater.dev', 'Omar Haddad'),
    'mom': ('linda.chen@mailbox.org', 'Mom'),
    'cal': ('calendar@fieldnote.studio', 'Fieldnote Calendar'),
    'ledgerly': ('billing@ledgerly.app', 'Ledgerly'),
    'ci': ('builds@shipyard.dev', 'Shipyard CI'),
    'byte': ('hello@weeklybyte.news', 'The Weekly Byte'),
    'atlas': ('orders@atlasroasters.com', 'Atlas Roasters'),
    'cloud': ('alerts@cloudnest.io', 'Cloudnest'),
    'figure': ('team@figurehq.com', 'Figure'),
    'nina': ('nina@fieldnote.studio', 'Nina Alvarez'),
}

# ---- Inbox --------------------------------------------------------------
t = 'contract-redlines'
a = msg(ARCHIVE, t, 'cr1', P['priya'], [ME], 'Contract redlines for Friday', 2 * DAY + 3 * HOUR, [
    'Hi Maya,', 'Attached are our redlines on the master services agreement. The main changes are in section 4 (liability cap) and section 9 (termination for convenience).',
    'Could you take a look before our call on Friday?', 'Thanks,\nPriya'], attach=True)
b = msg(SENT, t, 'cr2', ME, [P['priya']], 'Re: Contract redlines for Friday', 2 * DAY + HOUR, [
    'Thanks Priya. Section 9 looks fine. I want to talk through the liability cap in section 4 before we sign off.', 'Friday at 10 works.'], reply_to='cr1')
c = msg(INBOX, t, 'cr3', P['priya'], [ME], 'Re: Contract redlines for Friday', 35 * MIN, [
    'Hi Maya,', 'Good news: legal signed off on section 4 with the cap at 12 months of fees. That was the last open item.',
    'Can you confirm by Thursday so we can countersign before the Friday call?', 'Best,\nPriya'], seen=False, reply_to='cr2')
cls += [(a, 1, 'work'), (b, 1, 'work'), (c, 1, 'work')]
summaries[c] = 'Legal accepted the 12-month liability cap in section 4. Priya needs your confirmation by Thursday to countersign before Friday.'
replies[c] = ['Confirmed, thanks Priya. Please go ahead and countersign.',
              'Great news. Give me until Thursday noon to read the final version once more.',
              'Thanks! Could you send the clean copy so I can review it before I confirm?']

t = 'q4-launch'
c = msg(INBOX, t, 'ql1', P['daniel'], [ME], 'Q4 launch plan: review by Thursday', 1 * HOUR + 12 * MIN, [
    'Hey Maya,', "I put the Q4 launch plan in the shared folder. It covers the beta waitlist, the pricing page and the press timeline.",
    'Can you review the pricing section by Thursday? I want to lock it before the board update.', 'Daniel'], seen=False, attach=True)
cls += [(c, 1, 'work')]
summaries[c] = 'Daniel shared the Q4 launch plan and wants your review of the pricing section by Thursday, before the board update.'
replies[c] = ['On it. I will send notes on pricing by Wednesday evening.',
              'Thursday is tight for me. Could we push the pricing review to Friday morning?',
              'Happy to. Is the annual discount still 20%, or did that change?']

t = 'intro-jordan'
c = msg(INBOX, t, 'ij1', P['alex'], [ME, P['jordan']], 'Intro: Maya <> Jordan (design systems)', 2 * HOUR + 40 * MIN, [
    'Maya, meet Jordan. Jordan led the design system at Systems Guild and is thinking about what to do next.',
    'Jordan, Maya runs product at Fieldnote and is hiring for exactly this. I think you two should talk.', 'I will let you take it from here!', 'Alex'], seen=False)
cls += [(c, 1, 'work')]
summaries[c] = 'Alex introduced Jordan, who led design systems at Systems Guild, as a candidate for your open role.'
replies[c] = ['Thanks Alex (moving you to Bcc)! Jordan, great to meet you. Are you free for a call next week?',
              'Thanks for the intro, Alex. Jordan, could you send over a few examples of your work?',
              'Jordan, lovely to meet you. Would coffee on Tuesday or Wednesday work?']

t = 'pdf-export'
c = msg(INBOX, t, 'pe1', P['hana'], [ME], "Can't export to PDF", 3 * HOUR + 5 * MIN, [
    'Hi there,', 'Since yesterday the Export to PDF button just spins and nothing downloads. We need this for a client presentation tomorrow.',
    'Is there a workaround?', 'Hana Sato\nBrightlane'], seen=False)
cls += [(c, 1, 'work')]
summaries[c] = 'Hana from Brightlane cannot export to PDF since yesterday and needs it for a client presentation tomorrow.'
replies[c] = ['Sorry about that, Hana. We found the bug and a fix ships tonight. Until then, Print to PDF works.',
              'Thanks for flagging. Could you tell me which browser you are using?',
              'I am looping in our support lead, who will get back to you within the hour.']

t = 'dinner'
c = msg(INBOX, t, 'dn1', P['sam'], [ME], 'Dinner Saturday?', 4 * HOUR + 20 * MIN, [
    'Are we still on for Saturday? I booked the Thai place on 5th for 7:30.', 'Bring the board game!'])
cls += [(c, 0, 'personal')]
summaries[c] = 'Sam booked the Thai place on 5th for 7:30 on Saturday and asks you to bring the board game.'
replies[c] = ['Yes! See you at 7:30. I will bring the game.', 'Could we make it 8? I am coming from the airport.', 'Can I bring a friend along?']

t = 'offsite'
c = msg(INBOX, t, 'os1', P['hannah'], [ME], 'Offsite logistics: flights + hotel', 5 * HOUR, [
    'Hi all,', 'Flights and hotel for the Lisbon offsite are booked. Itinerary attached.', 'Please send me any dietary needs by Friday.', 'Hannah'], attach=True)
cls += [(c, 0, 'work')]

t = 'design-review'
c = msg(INBOX, t, 'dr1', P['cal'], [ME], 'Invitation: Design review, Wed 2pm', 6 * HOUR, [
    'Design review', 'Wednesday, 2:00 to 3:00pm', 'Organizer: Leo Martins'], bulk=True)
cls += [(c, 0, 'calendar')]

t = 'logo-v3'
c = msg(INBOX, t, 'lv1', P['leo'], [ME, P['daniel']], 'Brand refresh: v3 logo options', 8 * HOUR, [
    'Three directions for the v3 mark are attached. I am leaning toward B, but curious what you both think.', 'Leo'], attach=True)
cls += [(c, 0, 'work')]

t = 'invoice'
c = msg(INBOX, t, 'in1', P['ledgerly'], [ME], 'Your invoice #4821 is ready', 9 * HOUR, [
    'Invoice #4821 for $1,240.00 is ready.', 'It will be charged to the card on file on Nov 15.'], bulk=True, unsub='<mailto:unsubscribe@ledgerly.app>')
cls += [(c, 0, 'billing')]

t = 'deploy'
c = msg(INBOX, t, 'ci1', P['ci'], [ME], 'Deploy succeeded: web@a91f3c2', 10 * HOUR, [
    'web@a91f3c2 is live in production.', 'Duration 3m 12s.'], bulk=True)
cls += [(c, 0, 'notification')]

t = 'usage'
c = msg(INBOX, t, 'us1', P['cloud'], [ME], 'Usage alert: 80% of monthly quota', 13 * HOUR, [
    'Your workspace has used 80% of its monthly compute quota.', 'Upgrade or adjust limits in the dashboard.'], bulk=True)
cls += [(c, 0, 'notification')]

t = 'weekly-byte'
c = msg(INBOX, t, 'wb1', P['byte'], [ME], 'The Weekly Byte #142: local-first is back', 20 * HOUR, [
    'This week: why local-first apps feel faster, a new SQLite release, and five tools we loved.'], bulk=True, unsub='<https://weeklybyte.news/unsub>')
cls += [(c, 0, 'newsletter')]

t = 'coffee'
c = msg(INBOX, t, 'ar1', P['atlas'], [ME], '20% off your next bag', 1 * DAY + 2 * HOUR, [
    'Our winter blend is back. Take 20% off your next order this week.'], bulk=True, unsub='<https://atlasroasters.com/unsub>')
cls += [(c, 0, 'marketing')]

t = 'api-limits'
c = msg(INBOX, t, 'al1', P['omar'], [ME], 'Quick question about API rate limits', 1 * DAY + 5 * HOUR, [
    'Hi Maya,', 'We are planning a bulk import of about 2 million records next week. Will we hit the rate limit, and can it be raised for a day?', 'Thanks,\nOmar'])
cls += [(c, 1, 'work')]
summaries[c] = 'Omar plans a 2 million record import next week and asks whether the API rate limit can be raised for a day.'

t = 'photos'
c = msg(INBOX, t, 'ph1', P['mom'], [ME], 'Photos from the weekend', 1 * DAY + 9 * HOUR, [
    'Here are the photos from Sunday. Dad says hi!'], attach=True)
cls += [(c, 0, 'personal')]

t = 'figure'
c = msg(INBOX, t, 'fg1', P['figure'], [ME], 'What is new in Figure: auto layout 2.0', 2 * DAY, [
    'Auto layout 2.0, faster prototypes, and a new plugin API.'], bulk=True, unsub='<https://figurehq.com/unsub>')
cls += [(c, 0, 'newsletter')]

t = 'hiring'
c = msg(INBOX, t, 'hr1', P['nina'], [ME], 'Design lead candidates: shortlist', 2 * DAY + 6 * HOUR, [
    'Shortlist for the design lead role is in the hiring doc. Three strong portfolios, interviews next week.'])
cls += [(c, 0, 'work')]

# ---- Sent, waiting on a reply -------------------------------------------
t = 'roadmap'
c = msg(SENT, t, 'rm1', ME, [P['daniel'], P['leo']], 'Proposal: Q1 roadmap', 3 * DAY, [
    'Hi both,', 'Here is my proposal for the Q1 roadmap: offline mode first, then the mobile app.', 'Thoughts by Monday?', 'Maya'])

# ---- Archive -----------------------------------------------------------
for i, (who, subj, ago, cat) in enumerate([
    ('daniel', 'Board update draft', 4 * DAY, 'work'),
    ('ledgerly', 'Receipt for invoice #4790', 6 * DAY, 'billing'),
    ('leo', 'Moodboard for the brand refresh', 7 * DAY, 'work'),
    ('sam', 'Hiking next month?', 9 * DAY, 'personal'),
]):
    c = msg(ARCHIVE, f'arch-{i}', f'ar{i}x', P[who], [ME], subj, ago, [subj + '.'])
    cls.append((c, 0, cat))

def lit(v):
    if v is None: return 'NULL'
    if isinstance(v, int): return str(v)
    return "'" + str(v).replace("'", "''") + "'"

out = []
cols = list(rows[0].keys())
for r in rows:
    out.append(f"INSERT INTO messages ({','.join(cols)}) VALUES ({','.join(lit(r[k]) for k in cols)});")
for mid, imp, cat in cls:
    out.append(f"INSERT OR REPLACE INTO ai_classifications (account_id,message_id,important,category,reason,model,created_at) VALUES (1,{lit(mid)},{imp},{lit(cat)},'demo','demo',{NOW});")
for mid, s in summaries.items():
    out.append(f"UPDATE messages SET summary={lit(s)} WHERE message_id={lit(mid)};")
for mid, opts in replies.items():
    out.append(f"INSERT OR REPLACE INTO reply_options (account_id,message_id,options,model,created_at) VALUES (1,{lit(mid)},{lit(json.dumps(opts))},'demo',{NOW});")
open(sys.argv[1], 'w').write('\n'.join(out) + '\n')
print(len(rows), 'messages')
