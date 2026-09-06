# Session expiration recovery plan

Status: implemented and reviewed locally on September 5, 2026. Validation details are recorded below.

Branch: `taylorbryant/session-expiration-recovery`

Baseline: `d24b8a7` — Add durable local-first draft recovery (#60)

Investigated: September 5, 2026

## Outcome

A user can continue writing when their session expires, see whether the latest
changes are stored locally, sign back in without leaving the editor, and have
their draft sync automatically after their identity and workspace access are
verified. They should never need to move sentences into another application to
recover from an expired session.

Deliver this for page bodies, page titles, and embedded and standalone canvases,
which already share `DurableDraftController`. Other authenticated actions should
participate in session detection and pausing, but arbitrary mutations and uploads
must not be queued for automatic replay.

## Investigation baseline (before this change)

- `components/app-session-provider.tsx` provides a static server-rendered
  identity and role. It does not observe session expiry or coordinate recovery.
- `client/index.ts` reports failed background queries independently. Page,
  navigation, canvas, task, and notification queries poll. Four simulated 401s
  produced four separate `Unauthorized` notifications.
- `client/durable-drafts.ts` persists edits before server saves, but a 401 enters
  generic `sync-error`. Another edit schedules another request. Authentication
  restoration alone does not wake the controller.
- `features/pages/components/editor/haunter-editor.tsx` and the canvas surface
  debounce local writes by 100 ms. Component unmount flushes exist; browser
  lifecycle handling and an explicit local-durability indicator do not.
- `components/header-save-indicator.tsx` collapses errors to `Save failed` and
  reflects body state, not the independently saved title.
- `components/header-page-actions.tsx` requires a successful server save and
  refresh for normal export. It cannot serve as an emergency draft export.
- `components/auth/otp-auth-form.tsx` combines authentication with onboarding,
  workspace selection, navigation, and refresh. Recovery needs authentication
  without those navigation effects.
- Beignet's installed auth provider calls `auth.api.getSession({ headers })`
  and returns only the session data. An isolated test showed database expiry
  advancing without forwarding renewed cookies to the browser.

The previous editor persisted conflict recovery copies but did not persist
ordinary authentication failures the same way. The screenshot is consistent with
that earlier editor. Whether the affected user's deployment includes #60 remains
unverified; confirm the deployed commit during rollout.

## Chosen approach

### 1. Make browser session renewal reliable

Use the installed Better Auth 1.7.1 deferred-refresh flow:

- Set `session.deferSessionRefresh: true` in `lib/better-auth.ts`.
- Mount a session coordinator that explicitly checks GET
  `/api/auth/get-session?disableCookieCache=true` and follows `needsRefresh`
  with POST `/api/auth/get-session?disableCookieCache=true`. Require the POST to succeed before
  accepting the session. Inspection of the installed `useSession()` observer
  showed that a failed renewal POST could retain the preceding successful GET
  result, so the implementation owns this short protocol directly.
- Keep the existing auth route handler and existing lifetime/cache settings.
  Server-only session reads will no longer consume the renewal window without
  updating the browser. A plain periodic server-side `getSession` is insufficient.
- Check on mount, returning to a visible tab, reconnecting, and at a bounded
  cadence during visible, recent user activity. Start with a 60-second check
  while interaction occurred within the last five minutes; do not keep hidden
  or idle tabs alive indefinitely. Deduplicate overlapping checks.
- Use the authoritative active-tab check rather than adding a second timer
  based on a cached expiry. Bound each verification to 15 seconds; network
  failure alone does not classify a healthy session as expired.
- Following a protected-request 401 or another tab's auth change, bypass the
  signed cookie cache for the authoritative check. Use the same verified GET/POST
  path so deferred renewal is still honored.

This exact deferred GET/POST behavior was verified against the installed package
using an isolated memory database: server reads did not extend expiry; browser
GET indicated refresh was needed; browser POST extended expiry and set cookies.
Also test renewal near the original browser-cookie deadline and after an expired
cookie cache. See [Better Auth's Next.js integration](https://better-auth.com/docs/integrations/next)
and [session management](https://better-auth.com/docs/concepts/session-management).

### 2. Coordinate authentication failures across the app

Add a browser session coordinator in `client/` and connect it to
`components/app-session-provider.tsx`. Track checking, authenticated, expired, account-changed, access-lost,
and connection-error states. OTP progress belongs to the dialog. Track connectivity and
local durability separately from authentication.

- Preserve the editor owner's identity and mounted editor while checking or
  expired. Initial loading, a failed network request, or a temporary null auth
  result must not unmount the document or trigger a redirect.
- Use the existing `createClient` custom `fetch` option for browser request
  observation/gating, with explicit handling for the upload client and Better
  Auth calls. Cover direct API calls as well as React Query. Keep this state
  browser-scoped: `client/index.ts` is also imported by server code, so a
  process-global gate must never affect other server requests or users.
- On the first protected 401, pause protected network work and run one session
  verification. Handle this before `inline`/`silent` error presentation choices.
  A failed OTP attempt is a form error, not a new expiration incident.
- Prevent automatic query retries for 401s. Suppress auth-related toasts and
  duplicate inline errors while one recovery banner owns the explanation.
- Suspend protected polling, workspace activation effects, and SSE reconnects.
  Keep sign-in, session checks, recovery workspace verification, local editing,
  and local export available. Do not use a global offline flag that blocks auth.
- An EventSource error does not expose an HTTP status reliably; use a session
  check, not an assumption that every disconnect means expiration.
- Keep 403/access loss, 409/conflicts, network failures, and 5xx responses
  distinct. If a session check succeeds but requests still return 401, bound
  recovery to one attempt and show an actionable failure instead of looping.
- Tag checks and recovery attempts with an identity/generation so late results
  from a previous account or sign-in attempt cannot reopen the request gate.

Primary integration points: `client/index.ts`, `client/auth-client.ts`,
`client/error-feedback.ts`, `components/user-error-toaster.tsx`, `app/providers.tsx`,
`features/pages/client/upload.ts`, feature query helpers,
`features/workspaces/client/use-workspace-route-sync.ts`, and
`features/collab/client/workspace-events.tsx` / `sse.ts`.

### 3. Pause remote saves while preserving local drafts

Extend `DurableDraftController` with explicit pause/resume events and a remote
pause reason. Local persistence must continue in every auth recovery state.

- A 401 must retain the latest local revision, stop remote debounce/retry work,
  and leave typing available. Subsequent edits update the local draft without
  issuing additional protected requests.
- Keep exact-write acknowledgements and version checks. A pause must not allow
  an obsolete in-flight completion to delete a newer draft or update a cache
  belonging to another account.
- Expose local revision/durability separately from remote sync status. Only say
  the latest changes are saved locally when their write has completed.
- Add a registry for mounted draft controllers, keyed by account, workspace,
  resource type, and resource ID. Use it to pause/resume, read current values,
  flush local writes, and aggregate status. Follow existing page/canvas flusher
  conventions and clean up registrations on unmount.
- Resume only after the coordinator verifies the same account and the original
  workspace's current membership/role. Resume with existing compare-and-set
  tokens; preserve the conflict choice if the remote version changed.
- Automatically resume mounted drafts. Persist unmounted drafts for recovery
  when reopened; do not introduce a background sync engine for all stored data.
- Expiration must not delete drafts. An account change must never load, replay,
  or present the previous account's recovery copy as the new account's content.

Integrate page body, page title, and canvas controllers together. Do not gate
local editing solely through `useCanEditWorkspace()` when the only change is an
expired session: its current conditional rendering can replace the durable editor.
Confirmed membership loss or downgrade should preserve the local draft in a
recovery surface while disabling server writes.

### 4. Add sign-in inside the editor

Extract reusable email-code authentication behavior from `OtpAuthForm`, keeping
the existing normal sign-in/onboarding flow intact. Add a recovery dialog with
an explicit authenticated callback and no route navigation.

1. A sticky, accessible banner offers **Sign in** and **Download draft**.
   It does not steal focus or open a modal while the user is typing.
2. On user action, open the email-code dialog for the document owner's account.
   Failed codes, resend limits, and network errors stay in the dialog. Dismissing
   it leaves the draft and expiration banner intact.
3. After verification, verify the returned user ID, activate the original
   workspace through Better Auth, and fetch `organization.getActiveMember()` to
   verify its ID and current role. Do not select the first workspace or onboard.
4. If the account or membership does not match, keep syncing paused and offer
   appropriate recovery. Freeze/hide the old account's editing surface before
   presenting a different account's app state; never mix query caches.
5. If access is valid, update the app session context without replacing the
   editor, resume its draft saves, and refresh relevant queries. Conflicts stay
   explicit. Close the dialog and restore focus/selection/scroll.
6. Handle same-account sign-in in another tab through the same verification path.
   Broadcast only auth-change signals, never credentials or document content.

Avoid a full `router.refresh()` or hard navigation during this flow. In
particular, the existing workspace-route synchronization effect must not race
the recovery coordinator or refresh the editor before local persistence settles.

### 5. Expose accurate save status and a usable escape hatch

| State | User-facing behavior |
| --- | --- |
| Expired, all latest edits stored locally | “Your session expired. Your changes are saved in this browser. Sign in to sync them.” |
| Expired, local write pending | “Your session expired. Saving your latest changes in this browser…” |
| Local storage failed | “Your latest changes could not be saved in this browser. Keep this tab open and download your draft.” |
| Session restored, writes pending | “Signed in. Syncing your changes…” |
| All writes acknowledged | Return to the normal saved indicator. |
| Current workspace access lost | Explain the access change; preserve recovery/export and stop protected writes. |

- Aggregate title and body status in the page header; apply equivalent status to
  standalone and embedded canvases. One successful field must not hide another
  field's unsaved changes. Do not label a title-only failure as saved.
- Export the latest in-memory title/body as Markdown using existing conversion
  helpers. Supply a single JSON recovery bundle when canvases or multiple pages are
  present, linking snapshots to their resource IDs. One download avoids browser
  restrictions on multiple automatic downloads. Read from the
  editor/controller, not a server query or stale query cache. Export must work
  even when IndexedDB fails; it must not require `flushServer()`.
- Bound local-write delay during continuous input, flush on visibility loss,
  pagehide, and app-controlled navigation/logout, and await local flushes before
  controlled navigation. Register beforeunload protection only when the latest
  changes are not durable. Browser termination cannot guarantee asynchronous
  writes; do not promise crash-proof recovery for uncommitted changes.
- Use a persistent banner and polite status announcements. Preserve focus and
  keyboard operation on desktop and mobile; avoid repeating announcements on
  every poll or keystroke.

## Implementation sequence

Keep each step reviewable, with its own focused tests. Land the complete recovery
flow before considering the issue resolved.

1. **Session renewal and coordination:** deferred refresh, mounted observer,
   request classification/gating, and one recovery incident across parallel 401s.
2. **Draft integration:** pause/resume, local durability reporting, controller
   registration, and lifecycle protection for pages, titles, and canvases.
3. **Recovery UI:** reusable OTP behavior, banner/dialog, verified workspace
   recovery, automatic mounted-draft resume, and safe multi-tab handling.
4. **Save status and export:** aggregate status, local recovery downloads, and
   explicit local-storage failure behavior.
5. **Browser verification and rollout:** exercise the matrix below, confirm
   deployment includes #60, and ship the coupled renewal/observer changes together.

Before substantial implementation, load the repository's installed Intent skills
for app architecture, React Query, Next routes, and Better Auth. Use Beignet
generators and central registration if implementation needs a new contract or
artifact. The selected design reuses existing auth endpoints and draft storage;
no database migration or dependency upgrade is anticipated.

## Acceptance and regression coverage

Use unit tests for the coordinator and draft transitions, component tests for the
dialog/status, and real-browser checks for cookies, IndexedDB, navigation, and
cross-tab behavior. In-memory tests alone cannot establish browser durability.

| Scenario | Required result |
| --- | --- |
| Session expires while typing; several polls fail concurrently | One banner; text and selection remain; one session check; no toast storm. |
| More typing and pause/resume cycles after expiration | Latest edits remain local; no repeated remote saves while expired. |
| Page title changes while body is saved | Header reports the title's pending/error state. |
| Same-account OTP sign-in | No editor remount; original workspace verified; latest draft syncs automatically. |
| Same-account sign-in or sign-out in another tab | Coordinator verifies the change; no stale identity resumes writes. |
| Different account or workspace role changed to viewer | No old-account replay/cache contamination; existing draft remains recoverable. |
| Another editor updates content before recovery | Existing conflict handling protects both versions; no silent overwrite. |
| Late successful save or session response from an earlier generation | Cannot erase a newer draft or reopen access for the wrong identity. |
| Network outage or 500; then connection returns | No false expiry claim; local copy retained; retry/resume behavior is bounded. |
| Actual 403 or missing membership | Access-change feedback, no sign-in loop, no forbidden replay. |
| IndexedDB/localStorage unavailable or quota exceeded | No false “saved locally”; current content export works. |
| Reload after local commit; close during debounce; sustained typing | Committed draft restores; pending local writes trigger appropriate protection; delay is bounded. |
| Page body, title, embedded canvas, standalone canvas | Same pause/recovery guarantees; unrelated saved fields do not mask errors. |
| Auth cache expires; renewal due; original cookie deadline approaches | Server reads do not consume renewal; browser GET/POST updates the cookie and DB. |
| Initial auth loading, valid-session 401, failed renewal POST | No premature editor teardown, unhandled exception, or unbounded retry loop. |
| Export while signed out and while local storage fails | Download contains the current draft and requires no authenticated request. |

Run `bun beignet check` after changes. Before handoff, inspect both
`bun beignet map --changed --json` and
`bun beignet map --changed --base origin/main --json`.

Existing investigation baseline: 34 draft/error tests passed, plus isolated 401
and cookie-renewal checks. These do not substitute for the new acceptance tests.
Record implementation validation separately from this planning baseline.

## Rollout and measurement

Verify the deployed SHA before attributing the report to the current editor.
Track session recovery attempts/results, repeated 401 counts, pending-draft
resume results, and local-storage failures using the app's existing diagnostics
where available. Record outcome codes and timing, never OTPs, session tokens,
emails, or document content. Browser storage remains scoped to the existing
account/workspace/resource identity.

Success means a user can expire their session, write additional text, sign in,
and see that exact text saved without reloading or manually rescuing it. Confirm
the same behavior with a changed remote document and a failed local write before
calling the work complete.


## Implementation validation and review

The implementation is on `taylorbryant/session-expiration-recovery` and includes
session renewal, the browser request gate, coordinated query/SSE pausing, draft
pause/resume, the OTP dialog, current-value export, and navigation protection.
Normal sign-in still performs its existing onboarding and redirect flow.

### Automated checks

- `bun beignet check`: Beignet dependency lint, strict doctor, Biome lint,
  TypeScript, and the complete test suite pass.
- New focused regression tests cover concurrent 401s, bounded recovery, stale
  responses, account mismatch, membership loss, failed renewal POST, workspace
  restoration, retained drafts, interrupted saves, local-storage failures,
  conflict preservation, live-value exports, and command navigation guards.
- The installed Better Auth memory adapter runs the actual browser verification
  helper with a cookie jar. It verifies that a server session read does not
  extend expiration, GET reports renewal due, and POST extends the session and
  returns the renewed session-token cookie even after accepting GET's cache
  cookie.
- Both required Beignet impact maps were inspected. Their mapping gaps concern
  tests and UI entrypoints; these files were reviewed directly. Strict doctor
  reports no registration drift. No new routes, schema migration, or dependency
  changes are needed.

### Browser verification

Used Chromium with an isolated temporary app copy and SQLite database, synthetic
accounts, and a local mail stub. The existing development server and its database
were left running unchanged.

- Expired a signed-in session while the page stayed mounted, typed additional
  sentences, and downloaded a Markdown file containing the current text.
- Completed the actual OTP recovery endpoints in place. The editor DOM node,
  document route, focus, and selection remained intact; the exact latest text
  was confirmed in SQLite after the automatic content save.
- Simulated another account's session response with a page menu open. The old
  editor remained mounted but hidden, its portal menu was hidden, and the
  original-account sign-in dialog remained usable.
- Forced IndexedDB writes to fail while editing the title and body. The header
  reported `Save failed`, the banner explained the local-storage failure, and
  the download contained both current values. The unload guard activated.
- Restored storage and retried while signed out. The drafts became durable,
  the header showed `Saved in this browser`, and the unload guard cleared.
- Inspected desktop and 390px mobile layouts and the mobile recovery drawer.
  Fixed the banner offset so it does not cover the fixed sidebar or sticky
  header. No horizontal overflow or browser application errors were observed.

### Findings corrected during review

- A pause during `flushLocal()` could leave `flushServer()` waiting forever.
- A queued acknowledgement needed a second cancellation check before deleting
  the local recovery row.
- Local-storage retry was incorrectly blocked alongside remote saving.
- Workspace selection drift needed to pause the gate before restoring the
  original workspace and checking membership.
- The registry needed to batch status notifications instead of propagating
  every keystroke through the app shell.
- Title-only recovery export could otherwise produce an empty file, and
  multiple downloads could be blocked by the browser.
- Command-driven navigation and automatic refresh needed the same local-write
  guard as ordinary links, with refresh suppressed during session recovery.
- Paused save labels must not hide conflict or invalid-content states.

### Follow-up review fixes

The second review reproduced three additional failures. Regression tests failed
before the fixes and pass afterward:

- Renewal POST now bypasses the cookie cache, just like GET. The previous test
  did not carry GET's `Set-Cookie` into POST, so it missed a successful response
  that left the database expiration and session-token deadline unchanged. The
  strengthened test carries browser cookies and calls the production verifier.
- Content restrictions persist independently of verification status. A known
  account mismatch keeps the editor, portal menus, and export action hidden
  through rechecks, offline errors, and expiration. Lost workspace access keeps
  the editor inert through those states. Only verified original-account access
  clears restrictions; focus restoration uses the same restriction. Component
  tests exercise an online-event recheck and confirm the original editor DOM
  node and text survive recovery.
- Cancelled save invocations ignore errors before any pause or conflict-recovery
  side effects. Tests deliver an old 401 or `SESSION_PAUSED` response after a new
  save starts and confirm that the latest save completes and clears its local
  recovery copy.

The focused suite covering these paths passes all 23 tests. The complete
`bun beignet check` passes all five checks. Both required impact maps were
inspected again; the additional mapping gap is the new component test, with no
registration drift. Follow-up validation used in-memory auth and DOM integration
tests; the earlier Chromium exercise was not repeated for these fixes.

### Validation boundaries

The browser exercise covered page body/title recovery; canvas integration uses
its existing shared controller and its existing regression suite, with added
JSON export coverage. Separate Safari/Firefox and a full two-browser login
matrix were not exercised. Cross-tab signals were reviewed, and account-change
handling was exercised using a simulated session response. Deployment and the
original reporter's deployed SHA remain rollout checks, not part of this local
implementation.
