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

### Primary and secondary email entry on Customer records (Sales + Installation cards)
- Requested by: office — 2026-08-10
- Ability to add both a primary and secondary email address under the Customer record, shown/usable on both Sales Pipeline and Installation Pipeline cards. Needs a design pass on which address automated emails (survey/install/service call booked, reminders) send to when both are set.

### Fitter Calendar: Week/Working Week/Month view switcher with hourly grid — ✅ built 2026-08-11
- Requested by: office — 2026-08-11
- Outlook-style view switcher (Working Week / Week / Month, default Working Week), an hours column (7am–7pm) down the left of the Week/Working Week views, and events positioned/ordered by their actual time rather than just listed.

### Fitter Calendar: travel time between appointments
- Requested by: office — 2026-08-11, raised alongside the calendar view-switcher work above
- Bake in estimated travel time between a fitter's consecutive appointments (based on the distance between job addresses), shown on the calendar so back-to-back bookings that aren't realistically reachable stand out.
- **Needs a paid mapping API** (e.g. Google Distance Matrix) for real postcode-to-postcode travel times — the same kind of Google Cloud billing commitment the office previously held off on for address autocomplete. Deliberately deferred until the office is ready to commit to that cost; not started.

---

## Resolved / not needed

### Multi-job/multi-survey booking per fitter per day
- Requested by: office — 2026-07-30
- Turned out to already work — nothing in the app prevents or hides multiple bookings for the same fitter on the same day; both the office and fitter mobile calendars already show every booking for a day. No build needed, confirmed 2026-07-30.
