# Page-body performance assessment

## Status

The redundant SQL body read has been removed from collaborative page opening and
polling. The server hydrates a separate metadata query; title/icon updates,
optimistic rename rollback, and workspace events keep both query variants coherent.
Full reads remain available for exports and the legacy editor. The document session
now starts alongside the editor bundle and is shared with the mounted editor.

**Desktop validation is complete; performance is not fully signed off.** A
42-navigation production browser run found fast cached opening through 1,000
blocks, one slow cold synchronization, and excessive typing latency in the
3,000-block stress page. Inline code typing also needs further profiling on the
1,000-block page. Persistence and reconnect checks passed. The production build
and full application checks pass. Real iPhone Safari remains untested.

Validation also corrected unreadable diagnostic logs and duplicate server Yjs
imports. Save-status notifications now leave the mounted editor's props stable;
this reduced the initial stress-test spikes but did not solve its steady typing
cost. No storage or save guarantees were relaxed.

## Reproduce the isolated benchmarks

```sh
bun run benchmark:documents
bun run benchmark:documents --sync --fixtures
```

The runner creates and removes temporary SQLite databases. It does not connect to
the configured database, modify existing pages, or use existing sessions. `--sync`
adds real local WebSockets with the production protocol, access checks, persistence,
save receipts, and reconnect behavior. Grants are issued directly by the fixture,
so the HTTP session endpoint is outside the measurement. IndexedDB is simulated;
its timings are not browser-storage measurements. `--fixtures` writes bare block
arrays into a new temporary directory printed in the JSON result. Import those
with **Pages → Recover drafts** in the disposable test workspace for browser tests.

Fixtures contain 100, 1,000, and 3,000 blocks, with 10% multiline TypeScript code
blocks and Unicode paragraphs. Conversion preserves IDs and whitespace. Timings
use nine sequential samples unless noted; module startup and fixture creation are
excluded. They are diagnostic benchmarks, not CI timing assertions.

## Local results — September 7, 2026

Run on the development Mac using Bun 1.4.1 and temporary SQLite. Raw JSON sizes
exclude HTTP compression, response framing, and React hydration encoding.

| Blocks | Previous full-page JSON | Metadata JSON now | Full read + serialize, median | Metadata read + serialize, median |
| --- | ---: | ---: | ---: | ---: |
| 100 | 64,092 B | 264 B | 0.69 ms | 0.10 ms |
| 1,000 | 638,832 B | 264 B | 2.59 ms | 0.33 ms |
| 3,000 | 1,917,832 B | 264 B | 6.15 ms | 0.69 ms |

This removes over 99.9% of the **duplicate JSON payload** for the 1,000-block
fixture. It does not remove the Yjs body transfer on a cold load or shrink the
editor's JavaScript bundle. The before/after columns compare the repository read
paths exercised by the old and new loading code, not browser navigation durations.

| Blocks | Local peer delivery, median / max | Explicit save receipt, median / max | Reconnect + save 50 offline edits |
| --- | ---: | ---: | ---: |
| 100 | 1.10 / 1.36 ms | 3.73 / 6.63 ms | 320 ms |
| 1,000 | 1.21 / 3.00 ms | 19.52 / 23.60 ms | 351 ms |
| 3,000 | 1.29 / 4.21 ms | 55.01 / 67.10 ms | 395 ms |

Peer delivery and save receipts have nine samples. Reconnect has one sample per
fixture and includes the worker's normal debounce. Explicit flush measurements
bypass that debounce; they are not ordinary autosave latency. Polling resolution
is roughly 1 ms. Both clients and the worker share one local runtime, with no
representative network latency, React, layout, or real keyboard events.

Cold body synchronization alone took 12, 23, and 53 ms (one sample each). Simulated
IndexedDB loading took 0.9, 3.4, and 13.7 ms. Neither is a time-to-edit result.

## Persistence costs

A one-character incremental Yjs update was 18 bytes in this run. The corresponding
full snapshots were roughly 64 KB, 633 KB, and 1.93 MB. SQL body projections were
roughly 64 KB, 639 KB, and 1.92 MB. Every save still writes both snapshots plus
search text and any changed derivations/history. At 3,000 blocks that is about
3.85 MB per save **before** search text, history, and database overhead.

Full persistence on local SQLite took a median 3.7, 18.2, and 46.7 ms. That is a
remaining large-document/many-active-document cost, particularly for a remote
database. An append-only binary log alone would not remove SQL projection writes.
Before changing persistence guarantees, measure remote commit latency and bytes
under concurrent typing; then consider batched projections and incremental binary
storage together. No save intervals, atomicity, receipts, or restore fencing were
relaxed in this change.

## Actual browser readiness and typing

### Production browser results — September 7, 2026

Measured in the logged-in Codex desktop browser on the development Mac, using
`next build` / `next start`, a local Hocuspocus worker, and the disposable remote
Turso database. Ten separate documents at each of 100 and 1,000 blocks were opened
once without a local Yjs cache, then reloaded from IndexedDB. A 3,000-block document
was opened and reloaded once. Every sample verified the expected code-block count.

**Cold means an uncached document, not an empty browser HTTP/JavaScript cache.**
These runs do not measure a fresh browser profile, throttled network, production
worker hosting, concurrent server load, or iPhone Safari. No comparative Liveblocks
browser measurement was taken. The local worker still needs a deployment-region
test against the database.

| Blocks | Runs per cache state | Cold navigation-to-editable, median / max | Warm navigation-to-editable, median / max |
| --- | ---: | ---: | ---: |
| 100 | 10 | 0.882 / 1.703 s | 0.226 / 0.428 s |
| 1,000 | 10 | 1.559 / 3.621 s | 0.681 / 0.742 s |
| 3,000 | 1 | 2.598 s | 1.536 s |

[All readiness samples](yjs-browser-validation-2026-09-07.csv) include route-render
and body-ready timings. The 3.621-second outlier included 3.106 seconds waiting for
the body. That locates most of its delay before editor mounting; it does not isolate
grant authorization, database latency, and WebSocket synchronization individually.
Keep that outlier in the assessment. The 3,000-block cached body loaded in 51 ms,
but route-render-to-editable still took 1.097 seconds.

The matrix preceded the validation fixes for editor memoization and server module
identity. Production navigation, typing, persistence, and reconnect were checked
again after those fixes; the matrix is not a statistical before/after comparison.

| Input case | Samples | Input-to-two-frames, median / max |
| --- | ---: | ---: |
| 100-block paragraph, with a second client connected | 12 | 23 / 34 ms |
| 1,000-block paragraph after memoization | 16 | 28 / 143 ms |
| 3,000-block paragraph before memoization | 18 | 127 / 266 ms |
| 3,000-block paragraph after memoization | 16 | 121 / 139 ms |

The first two characters in the 1,000-block paragraph took about 143 ms; subsequent
characters took 24–39 ms. A six-character inline-code continuation took 92–119 ms.
The earlier code-typing sequence recorded spikes up to 193 ms and encountered a
browser automation timeout, so it should be repeated with a browser trace. The
partial input was inspected before continuing; the final complete marker persisted.
These short, automated input sequences are diagnostics, not a statistically robust
latency distribution or INP measurement. Memoization alone is insufficient.

Verified against the production build:

- Paragraph, inline code, and fullscreen code edits survived reloads, including
  indentation and blank lines. The 3,000-block paragraph edit also survived reload.
- A live edit reached a second browser tab.
- Both clients made divergent edits with the worker stopped. One reloaded while
  it was still stopped and recovered local edits from IndexedDB. After restart,
  both converged and reported **Saved to server**; another reload retained both
  markers. These tabs shared an origin and browser storage; this is not a separate
  device or isolated-storage offline test.
- Title and icon changes appeared in the header and survived reload in the other
  client.
- Restoring the fixture from history replaced the body without an app reload,
  displayed the previous-copy recovery notice, and allowed new edits to save.
- The full Beignet check and production build passed. Production runtime logs no
  longer report duplicate Yjs imports after externalizing the server's `yjs`
  package; both route handling and SSR use the native module identity.

The duplicate import was reproduced with a temporary stack logger pointing at the
separate server route bundle after SSR had loaded Yjs. The configuration uses
[Next.js serverExternalPackages](https://nextjs.org/docs/app/api-reference/config/next-config-js/serverExternalPackages).
The browser bundle and collaboration worker retain their existing module loading.

### Remaining performance work

Before broad performance sign-off, capture a main-thread trace for 1,000-block
inline code and 3,000-block paragraph typing. Separate syntax decoration work,
ProseMirror transactions, React commits, and layout; optimize the dominant measured
cost and repeat these samples. Profile grant/sync/database stages for cold-load
outliers separately. Full-cache-cold loads, real iPhone Safari, slow-network tests,
request transfer sizes, and long-task attribution are still outstanding.

### Reproduce the browser diagnostics

Use a production build on an origin accepted by the worker. Do not compare Next
development compilation times with release performance. Add `?editorPerformance=1`
to a page URL and reload. This opt-in enables local console messages and User Timing
entries with no document content or outgoing telemetry:

- `haunter:navigation-to-editable`: direct navigation through server response,
  client loading, body readiness, editor mount, and two animation frames. It is
  emitted once for the initial matching document navigation.
- `haunter:route-render-to-editable`: from the first PageEditor render through
  the editable surface appearing. For in-app navigation it excludes time spent
  fetching the route before PageEditor renders.
- `haunter:input-to-frame`: beforeinput handling through two animation frames.
  This is a responsiveness approximation, **not INP** or measured pixels on screen.

Keep the tab foregrounded and confirm a real typed character appears and survives
reload. Use the browser Performance panel to attribute remaining time to request
waits, JavaScript evaluation, editor creation, syntax highlighting, and layout.
Record separate browser traces for a fresh profile/cache and a warm reload. Do not
clear recovery storage containing valuable unsynced edits just to make a cold test.

Complete the remaining parts of this matrix before performance sign-off:

| Case | Measure / verify |
| --- | --- |
| Desktop, 100 and 1,000 blocks, cold and warm | Document-cache runs complete; fresh-profile caches, request sizes, long tasks remain |
| 3,000-block stress page | Initial timing and paragraph persistence complete; profile slow typing, scrolling and inline code |
| iPhone Safari, small and large pages | Real keyboard input, repeated Enter, inline/fullscreen code, warm reload and persistence |
| Two tabs, one disconnected | Shared-browser worker-outage/reload/convergence passed; isolated-client network loss and timed reconnect remain |
| Representative slow network / remote DB | Grant, sync and commit latency; transferred bytes; behavior while typing continuously |

Suggested initial targets to validate, not results achieved: warm direct loads under
1 second on desktop / 1.5 seconds on iPhone; cold loads under 2.5 / 3.5 seconds for
the 1,000-block fixture on the normal target network. Investigate typing frames
above 50 ms on desktop or 100 ms on iPhone. Treat the 3,000-block fixture as a stress
case until actual rendering measurements establish an appropriate budget.
