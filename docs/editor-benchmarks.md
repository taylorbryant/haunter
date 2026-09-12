# Editor benchmarks

Use these checks to compare editor changes on a disposable workspace. Measure
page readiness, typing, and persistence separately; fast local hydration or small
network updates do not establish end-to-end responsiveness.

## Isolated document benchmarks

Install dependencies with `bun install --frozen-lockfile`, then run:

```sh
bun run benchmark:documents
bun run benchmark:documents --sync --fixtures
```

The runner creates and removes temporary SQLite databases for its fixtures.
`--sync` adds real local WebSockets, access checks, persistence, save receipts,
and reconnection. Grants are issued by the fixture, so HTTP sign-in and session
endpoint latency are excluded. IndexedDB is simulated; its timings do not measure
real browser storage.

`--fixtures` writes block-array JSON files into a new temporary directory printed
in the result. Import them with **Pages → Recover drafts** in a disposable
workspace for browser testing.

Fixtures contain 100, 1,000, and 3,000 blocks, with 10% multiline TypeScript code
blocks and Unicode paragraphs. Most operations use nine sequential samples;
module startup and fixture creation are excluded. Output includes payload sizes,
document load/apply time, validation and projection time, and local persistence
time. These are diagnostic benchmarks, not CI timing assertions.

Yjs sends incremental edits over the network. Each database save writes a full
binary snapshot and updates the SQL projections. Include those costs when
evaluating large documents or remote database latency.

## Browser measurements

Use a production build and a worker connected to a disposable database. Follow
the [configuration instructions](../README.md#deploy-haunter) before building;
the app origin must be accepted by the worker. Do not compare development
compilation times with release performance.

Add `?editorPerformance=1` to a page URL and reload. This enables local console
messages and User Timing entries without document content or outgoing telemetry:

| Metric | What it measures |
| --- | --- |
| `haunter:navigation-to-editable` | Direct navigation through server response, client loading, body readiness, editor mount, and two animation frames; emitted once for the initial matching document navigation |
| `haunter:route-render-to-editable` | First PageEditor render through the editable surface appearing; excludes route fetching before that render |
| `haunter:input-to-frame` | `beforeinput` handling through two animation frames; a responsiveness approximation, not INP or measured pixels on screen |

Keep the tab foregrounded. Use the browser Performance panel to distinguish
request waits, JavaScript evaluation, editor creation, syntax highlighting,
transactions, and layout. Record the app revision, browser/device, network,
worker/database regions, fixture size, cache state, and sample count with results.
Compare the same conditions across revisions and retain slow samples.

Separate three cache states: a fresh browser profile, a document without a local
Yjs cache in an already-used profile, and a warm reload. Do not clear recovery
storage containing valuable unsynced edits to produce a cold measurement.

## Browser checks

| Case | Measure and verify |
| --- | --- |
| Desktop, 100 and 1,000 blocks | Cold and warm readiness, request sizes, typing latency, long tasks, and reload persistence |
| 3,000-block stress page | Typing, scrolling, inline code, validation, and save cost; do not infer large-page responsiveness from smaller fixtures |
| Real iPhone Safari | Keyboard composition, repeated Enter, inline/fullscreen code, indentation, blank lines, and persistence after reload |
| Two independent clients | Edit-to-peer latency and convergence; use isolated storage or separate devices as well as same-browser tabs |
| Network loss and worker restart | Reconnect time and unsynced-edit recovery; test page reloads and canvas recovery separately |
| Slow network and remote database | Session authorization, initial sync, durable commit latency, and behavior during continuous typing |

For every timing run, type a recognizable marker, wait for durable persistence,
and reload to confirm the complete content survived. For pages, use the
`data-saved="true"` diagnostic described in [Collaboration](collaboration.md#troubleshooting).
Check code whitespace as well as visible text.

Canvas presence tests need different accounts: same-user tabs intentionally hide
each other's cursors. Verify native canvas edits converge and survive reload;
the page timing instrumentation above does not measure canvas readiness. Follow
the [offline recovery behavior](collaboration.md#offline-edits-and-recovery)
when testing reloads with unsynced canvas changes.
