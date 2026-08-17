# Feature Requests

A shared place for feature ideas, wherever they come from — the office, a fitter suggestion, or from a Claude session that doesn't have direct access to Claude Code. Edit this file directly on GitHub (no need to touch Claude Code) and Claude will read it when working in this repo.

**How to add a request**: add a new entry under "Requested", with your name and today's date. Don't worry about wording it perfectly or prioritizing it — just get it down, and it'll get discussed and scoped properly before anything is built.

---

## Requested

### Extend "Deal" tracking to span the whole lifecycle, not just post-Deal-Won (BIG — plan properly before building)
- Raised by: office — 2026-08-07, following directly from investigating real duplicate-looking customer records
- **The actual problem found**: querying the live database turned up several genuine trade/commercial customers with 2-3 separate Customer records each — same name, same phone, different site addresses (e.g. "Conservatory Renovators" x3: Binfield/Tilehurst/Sandhurst, all still "Followed Up"; "Adam Slark" x2: one "Quoted", one "Deal Won" with a linked Job at a different address; also "Whitman Building Services" x2 and "New Richmond Developments" x2). These aren't data-entry mistakes — they're real concurrent quotes/jobs for the same repeat customer, entered as separate Customer records because **there was no other way to do it**: today's data model only lets a Customer have multiple linked *Jobs* after Deal Won (built earlier this session) — before that, a Customer can only be quoted for one thing at a time.
- **The office's confirmed direction**: "there should only ever be one customer record that is categorised by sector... it would be great to have the mini dashboard [like the existing Jobs/Active/Completed panel on Customer Directory] showing something like 3 jobs quoted, 2 jobs completed and 1 active and then the associated margin and total quoted at a glance." I.e. **retail** customers will rarely need more than one deal, but **trade/commercial** customers routinely have multiple simultaneous quotes and jobs, and the app should support that from first contact, not just after winning.
- **What this actually means architecturally**: extend the "Job" concept backward to cover the *entire* lifecycle (Prospect List → New Enquiry → ... → Deal Won → Book Survey → ... → Job Completed) as one continuous record type, rather than splitting "pre-Deal-Won lives on Customer" / "post-Deal-Won lives on Job" the way it does today. Customer becomes purely the contact/sector wrapper (name, email, phone, address, sector) that any number of these lifecycle records link to. This is comparable in size to (or bigger than) the original Customer/Job content-divergence fix built 2026-07-23 — touches the Sales Pipeline Kanban/stage model, Dashboard reporting, Customer Directory's mini-stats panel, `handleDealWon`, the New Enquiry/website-lead-capture flow, and needs a real migration plan for the existing duplicate records found above so none of their history/stage/quote data is lost.
- **Do not start this without a proper planning pass** (research the current data model + a design proposal, same approach as the original Customer/Job unification work) — too large and too close to real production data to improvise.

### Fitter end-of-job checklist with sign-off — ✅ built 2026-07-30

### Customer sector categorization: Retail / Trade / Commercial — ✅ built 2026-08-07
- Field added to all customer forms + a "By Sector" Dashboard section + a sector filter on Deals Won reporting. Directly surfaced the bigger duplicate-customer issue above — expect the eventual "extend Deal tracking" work to reshape how sector reporting is computed too (today it's per-Customer; once one customer can have many concurrent deals, sector stats should probably be per-deal).

### WindowCAD7 API integration
- Requested by: office — 2026-07-30
- Connect the existing "WindowCAD7 Reference" field to a real API instead of it just being a free-text label.

### Multiple installation dates per job (phased installs)
- Requested by: Dan — 2026-08-07
- "Please can we add an option to add another installation date so we have the option to book more than one install date per job card. As we will get it a lot where we will do installations in phases."
- Bigger than it first looks: a Job's install date is currently a single field, read from directly by the automatic email reminder timer, the Fitter Calendar, Kanban card badges, and Dashboard delivery tracking — all of these would need to handle multiple dates/phases, not just the Installation tab's own booking UI. Needs a proper design pass before building, not a quick add.
- Note: this may end up folded into the "extend Deal tracking" work above, since both are about one customer/job having more than one thing happening at once.

### Job reference field, shown on the job card (distinguish concurrent jobs for the same customer) — ✅ built 2026-08-07
- Editable Reference field on Jobs, shown on the Kanban card, a clearly-labeled banner in the job detail Details tab, and the Customer Directory job list.

### Service Call Booked email template + automatic send — ✅ built 2026-08-10
- Requested by: office — 2026-08-07
- Includes automatic send (like Survey/Install Booked), per-booking sent-status, and a per-template editable BCC field (above the Subject Line on every email template) so the office can see when automated emails go out.

### Primary and secondary email entry on Customer records (Sales + Installation cards) — ✅ built 2026-08-11
- Requested by: office — 2026-08-10
- Secondary email is editable everywhere the primary is (Sales Pipeline card, Customer Directory add/edit, new-enquiry form) and shown alongside it in the Customer Info panels and Directory banner. Decision confirmed: all automated emails (survey/install/service call booked, all reminders) send to **both** addresses when both are set.

### Fitter Calendar: Week/Working Week/Month view switcher with hourly grid — ✅ built 2026-08-11
- Requested by: office — 2026-08-11
- Outlook-style view switcher (Working Week / Week / Month, default Working Week), an hours column (7am–7pm) down the left of the Week/Working Week views, and events positioned/ordered by their actual time rather than just listed.

### Fitter Calendar: travel time between appointments
- Requested by: office — 2026-08-11, raised alongside the calendar view-switcher work above
- Bake in estimated travel time between a fitter's consecutive appointments (based on the distance between job addresses), shown on the calendar so back-to-back bookings that aren't realistically reachable stand out.
- **Needs a paid mapping API** (e.g. Google Distance Matrix) for real postcode-to-postcode travel times — the same kind of Google Cloud billing commitment the office previously held off on for address autocomplete. Deliberately deferred until the office is ready to commit to that cost; not started.

### Fitter mobile calendar: List/Day/Month view switcher + per-fitter default view — ✅ built 2026-08-11
- Requested by: office — 2026-08-11
- Same idea as the desktop switcher above, adapted for the fitter mobile app (List agenda / Day hourly timeline / Month), modeled on the iOS Outlook app. Also added holding a view button for ~1s to pin it as that fitter's personal default (green tick), so the app opens straight into it next time.

### Email templates: reorder + group by booking type — ✅ built 2026-08-11
- Requested by: office — 2026-08-11
- Settings → Email Templates now lists Survey Booked → Survey Reminder → Install Booked → Install Reminder (7-Day) → Install Reminder (1-Day) → Service Call Booked → Service Call Reminder, with a heading grouping each booking type's emails together.

### Track Orders: same Working Week/Week/Month view switcher as the Fitter Calendar — ✅ built 2026-08-11
- Requested by: office — 2026-08-11
- Month view unchanged; the new Week/Working Week views show each day as a column of stacked delivery badges rather than an hourly grid, since deliveries only ever have a date, not a time-of-day. The summary row at the top (job card/manual counts, save status, Add Delivery) was kept as-is.

### Customer Directory: sector mini-dashboard in the empty right-hand panel — ✅ built 2026-08-11
- Requested by: office — 2026-08-11
- The empty-state panel (shown before selecting a customer) now shows a customer-count tile per sector (Retail / Trade / Commercial), styled with the same badges/colours used elsewhere.

### Customer sector display shown inconsistently (why + fixed) — ✅ built 2026-08-11
- Raised by: office — 2026-08-11, while checking the sector work above
- Sector only ever lived on the Customer record (not Jobs) and was never actually displayed anywhere day-to-day — only used in edit forms and Dashboard reporting. Now shown as a colour-coded, emoji badge (🛍️ Retail / 🔧 Trade / 🏢 Commercial) on Sales and Installation Pipeline Kanban cards, the Customer Directory detail banner, and the Customer Info panel on both Customer and Job Details tabs. Confirmed there is exactly **one** master record for sector today — the Customer row — except for the handful of known duplicate-Customer cases (see the big "Extend Deal tracking" item above), where each duplicate has its own independent value until that's fixed properly.

### Company logo + fitter photo uploads — ✅ built 2026-08-11
- Requested by: office — 2026-08-11
- Company logo: uploaded in Settings → Company Info, shown in the sidebar and the login screen in place of the generic window icon.
- Fitter photos: uploaded in Settings → Fitters, right next to each fitter's portal password, shown on the login screen's fitter selection list in place of the generic hard-hat icon.

### Supplier logo uploads — ✅ built 2026-08-11
- Requested by: office — 2026-08-11
- Same pattern as fitter photos: an upload control next to each supplier's name in Settings → Suppliers, shown as a small icon next to the supplier name in Track Orders' Upcoming Deliveries and All Orders lists.
- Office also asked about auto-finding a supplier's logo just from typing the company name — **not realistically possible** as a free/reliable service, since logo-lookup APIs (Clearbit, Brandfetch, etc.) work off a known domain, not a fuzzy name match; guessing the domain from a name risks pulling the wrong company's logo with no way to catch it. Offered a domain-based auto-fetch (add a Website field, logo pulls from that domain automatically) as the realistic middle ground — **office chose manual-upload only for now**, so that option is parked, not built.

### Bug: Install Booked email was never actually wired up — ✅ fixed 2026-08-17
- Raised by: office — 2026-08-17, after a real install booking (Catriona Davies, job #29) sent no confirmation email
- Root cause: the "Install Booked" template existed in Settings and looked identical to Survey Booked / Service Call Booked (both of which work correctly), but no backend code ever triggered it — no send function, no detection logic in the job save handler. It had silently never worked since Survey/Service Call Booked were built.
- Fixed: added `sendInstallBookedEmail` (`api/src/reminderCore.js`) and wired detection into `jobs.js`'s update handler (same "date+fitters newly set" pattern as Survey Booked), plus the same notifyEnabled toggle + sent-status banner Survey/Service Call already have, in the Installation tab.
- Verified all other automated emails (Survey Booked, Service Call Booked, Survey/Service Call day-before reminders, Install week/day reminders) are unaffected and working correctly — this was an isolated gap, not a wider outage.
- Catriona Davies' missed confirmation was sent manually the same day once the fix deployed; her install's week/day reminders were already correctly scheduled (that part was never affected).

## Resolved / not needed

### Multi-job/multi-survey booking per fitter per day
- Requested by: office — 2026-07-30
- Turned out to already work — nothing in the app prevents or hides multiple bookings for the same fitter on the same day; both the office and fitter mobile calendars already show every booking for a day. No build needed, confirmed 2026-07-30.
