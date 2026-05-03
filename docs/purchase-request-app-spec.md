# Purchase Request App — v1 Spec

## Purpose

This is not a budgeting app. It's not a spending tracker. It's not finance software.

It's a **structured way for partners (and parents and kids, and friends and their spouses) to have the conversation about wanting to buy something** — with enough scaffolding that the conversation actually happens, gets resolved, and doesn't get lost in a text thread.

The price field exists because price is part of the conversation. The seriousness ratings exist because they're part of the conversation. The delay mechanic exists because "let me think about it" is part of the conversation, and the app makes that pause real instead of vague. Appeals exist because "I really do want this, please reconsider" is part of the conversation. Comments exist because the conversation often needs more nuance than three buttons.

Everything stays subordinate to that. The app's job ends when the decision is made. What happens next is the user's.

---

## Core Concepts

### Households

Households are the top-level container. A household has members; requests are scoped to a household; appeal quotas reset per household.

- Households are created by the app admin only (not self-serve)
- Members are added by the admin from a settings/admin screen
- When adding a member, the admin selects from a dropdown of users who have already logged in, OR enters an Authentik username manually for users who haven't logged in yet (creates a pending membership that resolves on first login)
- Friends and their spouses can be added to separate households

### Members and Roles

- Every household member is a buyer by default
- The meaningful configuration is *who approves whose requests*, not a global "approver" role
- Each buyer has a configured set of approvers within their household
- Each buyer has an `approval_mode`:
  - `any` — any one approver acting is sufficient (default)
  - `all` — every configured approver must approve before the request is approved
- A buyer with zero configured approvers cannot submit requests (UI message: "no approvers configured")
- Removal of the last approver for a buyer should be blocked

### Approval Mode Conflict Resolution (`all` mode)

When multiple approvers must act and they disagree:

- **Deny beats delay beats approve**
- Any non-approval from a required approver blocks the request
- One denial → request denied
- One delay (with no denials) → request delayed (longest delay wins on duration)

---

## Request Lifecycle

### Submission

A buyer submits a request with:

- URL
- Image (auto-fetched and stored, or manually uploaded)
- Price
- Title / description
- Buyer's seriousness rating: `need` / `really want` / `nice to have`

### Submission Methods

- Manual entry in the app
- Paste a URL (app auto-extracts metadata via Open Graph tags / HTML scraping)
- **Web Share Target** (PWA, Android only): tap "Share" on Amazon or any other site/app, pick this app, request opens with fields pre-filled. iOS Safari does not support Web Share Target — iOS users use an iOS Shortcut (documented in onboarding) or paste the URL manually.

Auto-extraction is best-effort. Always show extracted values for user confirmation before submission. Don't trust extracted prices blindly.

### Approver Action

When the approver opens a pending request:

1. The buyer's seriousness rating is shown
2. Approver selects their own seriousness rating (independent judgment, but anchored on buyer's rating — acknowledged tradeoff)
3. Approver picks an action: **Approve**, **Delay**, or **Deny**

The approver's seriousness rating is **always required**, even on approve and deny actions, to keep calibration data complete.

### The Three Actions

**Approve** — buyer is cleared to purchase. Approval is valid for 30 days.

**Delay** — request enters a cooldown. Cooldown duration is auto-calculated (see table below). Approver may override the auto-calculated value, up to 2× the auto value, with a hard ceiling of 90 days.

**Deny** — request is denied. Buyer may appeal (limited; see Appeals).

### Delay Auto-Calculation Table

Based on **approver's** seriousness rating (not buyer's):

|              | Need  | Really want | Nice to have |
|--------------|-------|-------------|--------------|
| <$25         | 12h   | 3d          | 7d           |
| $25–100      | 12h   | 7d          | 14d          |
| $100–300     | 1d    | 14d         | 30d          |
| $300–1000    | 1d    | 21d         | 60d          |
| $1000+       | 2d    | 30d         | 90d          |

### Cooldown Expiry and Re-Confirmation

When a delay's cooldown expires:

- Request enters `awaiting_reconfirm` state
- Buyer must actively re-confirm interest (one-tap "still interested?" prompt)
- Re-confirmation moves request back to pending for fresh approver review
- If buyer doesn't re-confirm within 7 days, request auto-cancels (silent, no cost)

### Approval Expiry

- Approvals are valid for 30 days from approval timestamp
- Buyer can mark purchased anytime within that window (single click, no extra fields)
- Notification reminder a few days before expiry
- After 30 days unpurchased, request auto-archives with no cost
- Buyer may re-submit fresh anytime, no appeal cost

### Buyer Cancellation

- Buyer can cancel their own request **at any time**, in any state (pending, delayed, awaiting reconfirm, approved)
- No cost, ever
- Cancellation moves request to terminal `cancelled` state
- Especially useful after approval ("changed my mind"), closes the loop cleanly

### Edits to Pending/Delayed Requests

- Trivial edits (typo fixes in description, etc.) do not reset cooldown
- Meaningful edits (price change, URL change) reset the cooldown / require fresh review
- Implementation: listing versions stored, cooldown reset triggered by changes to price or URL

### No Price Enforcement After Approval

- Once approved, the buyer purchases at whatever the price is then
- No app-side check that the buyer paid the approved amount
- Trust-based — the app is a communication tool, not an enforcement system
- Buyer may voluntarily re-submit if they feel a price change warrants re-discussion

---

## Appeals

- Triggered after a denial
- Require justification text from the buyer
- Routed to a separate **appeals queue** (visually distinct from the main pending queue)
- Quota is **configurable per household** — both count and period (e.g., 2/quarter, 3/quarter, 1/month)
- Default: 2 per calendar quarter (resets Jan 1, Apr 1, Jul 1, Oct 1)
- Visual countdown shown to buyer ("2 appeals remaining, refresh in 47 days")
- Soft SLA visible to approver on appealed items ("appealed 5 days ago")
- Auto-cancellations from delay timeouts cost nothing — only manual appeals after denial consume quota

---

## Comments / Notes Thread

Each request has an append-only comment thread.

- Both buyer and approver(s) can post comments
- No editing or deletion of posted comments (keeps history honest)
- Comments trigger notifications based on user notification preferences
- Replaces a lot of out-of-band texts ("found it cheaper here", "can this wait until next paycheck?")

---

## Notifications

### Mechanism

- **Web Push via PWA** — works on Android, desktop browsers, and iOS Safari (iOS requires the PWA be added to the home screen)
- Notifications include action buttons where appropriate
- Lock-screen quick actions: **Approve**, **Delay**, **Open app**
  - Quick **Deny** is intentionally not available — denial should require deliberate action in the app
- Quick-Approve uses approver rating = buyer rating (the "I agree" default)
- Quick-Delay uses the auto-calculated value, no override
- Override of either requires opening the app

### iOS Considerations

- iOS Safari ignores the Web Push `actions` array — lock-screen quick actions (Approve/Delay) are **Android-only**. On iOS, tapping the notification opens the PWA and the user acts inside the app. Design every notification path so single-tap-to-open is a complete flow, not a degraded fallback.
- iOS only delivers Web Push to PWAs installed via "Add to Home Screen." First-run UX for iOS users must include install instructions; without install, push silently does not work.
- If iOS action-button parity becomes important later, **ntfy** is the planned secondary channel — native iOS app, real action buttons, deep-links back to the PWA. Opt-in per user.

### Quick Action Security

- Action URLs use signed tokens (JWT with request_id, action, short expiry, server secret)
- Single-use: marked consumed in DB on first use
- Prevents replay attacks if URLs are leaked

### User Notification Settings

Per-user preferences for:

- Which events trigger notifications (new request, approval, denial, delay, appeal, re-confirm reminder, stale request, comment)
- Quiet hours (don't notify between X and Y)
- Sensible defaults: notify on everything that requires action + resolution of submitted items; never notify on user's own actions echoing back

### Approver Activity Reminders

- Pending requests: reminder at day 3, firmer at day 7
- "Need"-rated pending requests: reminder at 6h and 24h (since the approval window itself is 12h)
- At day 14, request gets a "stale" badge visible in both queues — no automatic action, just visibility
- No auto-approval ever (silence ≠ approval)

---

## Calibration Data

Buyer's rating + approver's rating are both stored on every request, regardless of action. Surfaces over time as "buyer over-rates 60% of the time" or "approver agrees with buyer 75% of the time." Phase 2 dashboard surface; data captured from day one.

---

## Authentication

- **Authentik OIDC** for identity (who you are)
- App owns authorization (what household, what role)
- A single Authentik group may gate access to the app overall, but household membership is managed entirely in the app's own database
- Admin role: single `is_admin` boolean on the user record, optionally gated by an Authentik group for additional safety

---

## Feedback

- In-app feedback form creates a GitHub issue via the GitHub API
- Server-side stores a fine-grained PAT scoped to the feedback repo
- Issue body auto-includes: app version, browser/device info, app username, timestamp
- User identified by app username only (no GitHub mention, no required GitHub account linking)
- After submission, user sees the GitHub issue link and can follow along
- "My feedback" view shows submitted items with current status pulled from GitHub
- Optional category dropdown maps to GitHub labels (bug / feature / question / other)
- Basic rate limit: 1 submission per minute per user

---

## Data Model

### Tables

**users**
- id, name, oidc_subject, is_admin, created_at

**households**
- id, name, appeal_quota_count, appeal_quota_period (`monthly` / `quarterly`), created_at

**household_members**
- id, household_id, user_id, approval_mode (`any` / `all`), joined_at

**buyer_approvers**
- buyer_member_id (FK to household_members), approver_member_id (FK to household_members)

**pending_memberships**
- id, household_id, authentik_username, approval_mode, created_at
- Resolves into household_members on user's first login

**requests**
- id, household_id, buyer_id, title, description, url, image_key, price_cents, currency
- buyer_seriousness (`need` / `really_want` / `nice_to_have`)
- status (`pending` / `approved` / `delayed` / `awaiting_reconfirm` / `denied` / `cancelled` / `archived` / `purchased`)
- created_at, updated_at, status_expires_at (for time-bounded states)

**listing_versions**
- id, request_id, price_cents, url, title, description, created_at
- Created on every meaningful edit; supports cooldown-reset detection

**reviews**
- id, request_id, approver_id, action (`approve` / `delay` / `deny`)
- approver_seriousness, delay_days (nullable), delay_expires_at (nullable)
- reconfirm_deadline (nullable), notes (nullable), created_at
- One row per review action — full history

**appeals**
- id, request_id, buyer_id, justification, period_key (e.g., `2026-Q2` or `2026-04`)
- status (`pending` / `upheld` / `overturned`), created_at, resolved_at

**comments**
- id, request_id, author_id, body, created_at

**notification_preferences**
- user_id, event_type, enabled, quiet_hours_start, quiet_hours_end

**feedback_submissions**
- id, user_id, github_issue_number, github_issue_url, category, created_at

### Notes

- No separate `delays` table — delay is just a review row with `action=delay`
- Quarterly appeal counter is derived from `appeals` rows with matching `period_key`
- No `notifications` table — push delivery is fire-and-forget; preferences are stored separately

---

## Tech Stack

- **Authentication:** Authentik (OIDC)
- **Database:** PostgreSQL
- **Image storage:** MinIO (existing instance, dedicated bucket, scoped service account)
- **Frontend:** PWA. Web Share Target for Android share-sheet integration; iOS users use an iOS Shortcut or manual paste (Web Share Target unsupported on iOS Safari).
- **Notifications:** Web Push (works on Android, desktop, and installed iOS PWAs). ntfy reserved as a possible secondary channel if iOS action-button parity is needed later.
- **Deployment:** Docker; app and MinIO on the same user-defined Docker network for internal-only S3 traffic
- **Redis:** Optional. Postgres can handle caching, queues, and rate limiting at the v1 scale, but Redis is available if it simplifies a specific implementation choice (e.g., a Redis-backed task queue) or if usage grows beyond what Postgres can comfortably absorb.

### Image Storage Details

- Bucket: dedicated `purchase-requests` bucket on existing MinIO
- Object key structure: `{household_id}/{request_id}/{filename}`
- Filenames sanitized / replaced with UUIDs at upload time
- Service account scoped via IAM policy to the bucket only
- App fetches images server-side at submission time (don't hotlink retailer URLs)
- v1: serve through app (browser → app → MinIO); switch to presigned URLs later if needed
- Internal endpoint (`http://minio:9000`) used for app-to-MinIO traffic

---

## Phase 2 (Deferred)

- **Audit log timeline UI** — surface the existing `reviews` table as a clean per-request timeline
- **Spending dashboards** — household and per-buyer views, breakdowns by seriousness, time period
- Both are essentially UI work over data already captured from day one

---

## Explicit Non-Goals

These will not be built, even though they're tempting:

- Payment integration
- Price-change enforcement after approval
- Hard budget rules / budget enforcement
- Auto-approval rules (e.g., "auto-approve under $20" — defeats the purpose)
- Tracking what was actually paid vs approved
- Categories / tags hierarchy (free-text tags, if anything)
- Native mobile apps (PWA is the deployment target)

---

## Open Questions for Later

- After living with it for a quarter, is the default appeal quota (2/quarter) too tight or about right?
- Does the "all"-mode deadlock (one approver unavailable) need an explicit "absent" toggle, or is it tolerable in practice?
- Counter-offer as a 4th approver action ("approved if under $X" / "approved after a sale") — useful or feature creep?
- Wishlist mode — saved items not yet submitted as requests — natural extension of share-target capture
- Recurring requests — approve once, future renewals auto-approve up to N times or $X total
