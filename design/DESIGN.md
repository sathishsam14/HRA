# HRA – Horse Rating Automation: Design Guide (prototype)

Client: BTC Racing Department. Product name: "HRA – Horse Rating Automation". Do not invent other names.
This is a front-end prototype with sample data. Ratings shown are illustrative, not real.

## Screens (5)
1. /login (no sidebar, no top bar)
2. /dashboard
3. /rating-engine
4. /mis
5. /audit

## Global style
- Font: Inter. Icons: lucide-react, 20px, 1.5px stroke. No gradients, no emoji.
- Design frame: 1920px wide. Content width 1616px (1920 - 240 sidebar - 64 padding). Spacing on an 8px grid.
- Page background #F8FAFC. Cards: white, 12px radius, 1px #E2E8F0 border, shadow 0 1px 2px rgba(15,23,42,0.06), 24px padding, 24px gaps.
- Text: page title 28/36 semibold #12306B; section title 16/24 semibold; body 14/20; table text 14/20; captions 12/16 #64748B.
- Numbers: tabular numerals, right-aligned.
- Navy #12306B only for sidebar and page titles. Blue #2563EB only for the single primary button on a screen and for links.
- Pills (soft background, small dot): green #DCFCE7 / text #166534; amber #FEF3C7 / #92400E; red #FEE2E2 / #991B1B; grey #F1F5F9 / #475569.
- Tables: header row 44px, background #F1F5F9, 12px uppercase medium #475569; body rows 52px; 1px #EEF2F6 dividers; no vertical lines; selected row #EFF6FF; hover #F8FAFC.
- Buttons and inputs 40px high, 8px radius; secondary buttons outlined #CBD5E1; visible 2px blue focus ring.
- Change values: positive #166534, negative #991B1B, zero #64748B.

## App shell (identical on dashboard, rating-engine, mis, audit)
- Sidebar: 240px wide, full height, navy #12306B. Top: box "BTC LOGO" (160x40, 1px border rgba(255,255,255,0.3)) 24px from top and left, small text "HRA" below. Menu items 44px high, 14px text, white at 80%: Dashboard, Rating Engine, MIS Report, Audit Trail. Active item: background rgba(255,255,255,0.10), white text, 3px #2563EB bar on the left. Bottom: avatar with initials, user name, grey role pill, Logout.
- Top bar: 64px high, white, 1px #E2E8F0 bottom border, 32px side padding. Left: "HRA – Horse Rating Automation" (16px semibold #12306B) + grey caption "BTC Racing Department". Right: date "07 Nov 2026" and a pill "BNG". The top bar never contains the page title.
- Content area: starts at x=240, 32px padding. The page title is the first element inside it.
- Show a small banner on every page: "Prototype with sample data".

## Roles
- Admin: sees everything, cannot override or confirm review.
- Handicapper: can override and confirm review.
- Viewer: read only. No Override link, no Confirm review.
Demo logins (password demo1234): admin, handicapper, viewer.

## Rating Engine rules (for the explanation text; sample data already follows them)
- Race type Handicap or Terms. Reference position: 4th when 8 or more runners, 3rd when 5 to 7 runners.
- 1 kg = 2 rating points. No ceiling on ratings. Decrease is limited to 4 points.
- Exceptions (starter, veterinary, incident remarks) mean the rating does not decrease; it may increase.
- Ratings are system recommendations. The Handicapper leaves a rating or overrides it with a reason. There is no "Generate" button; ratings appear automatically when files are in.

## Rating Engine table columns (in order)
Horse, Current rating, Placing, Timing, Verdict, Recommended rating, Exception, Override, Final change, Final rating, Reason explanation, Action.

## MIS table: 29 columns in this exact order
Venue, Race date, Race season, Race type, Race category, Race no, Card no, Distance, Current rating, Horse name, Horse weight, Shoes, Weight declare, Jockey, Weight carried, Placing, Timing, Verdict, Trainer, Penetrometer reading, Railing position, Starter report observations, Veterinary report observations, Incident report observations, Recommended rating, Override, Final rating change, Final rating, Reason explanation.
Filters (exactly five): Venue, Race date (range), Race season, Race type, Race category.
Group header band: Race (first 8) | Horse (columns 9 to 21) | Reports (22 to 24) | Rating (25 to 29).

## Rating assessment trace (7 step tiles)
1 Race classification, 2 Eligibility, 3 Reference position, 4 Weight adjustment, 5 Coefficient calculation, 6 Exception applied, 7 Recommended rating.
Used in "Why this rating" (Rating Engine), "Reason explanation" (MIS) and "Rating assessment trace" (Audit Trail).

## Audit Trail
Read only. Shows only Handicapper overrides: Date and time, Handicapper, Race date, Race no, Horse, Recommended rating, Final rating, Change, Override reason. No logins, Admin actions or uploads.
