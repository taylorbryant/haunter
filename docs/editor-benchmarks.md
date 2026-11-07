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

Complete the [local development setup](../CONTRIBUTING.md#local-development)
with a disposable database, then switch both processes to production mode:

1. Stop `bun run dev` and `bun run dev:collaboration` with Ctrl+C in their
   respective terminals. Wait for both processes to exit so port 3000 is free
   and the worker has released its database lease.
2. In `.env.local`, set a unique `BETTER_AUTH_SECRET` of at least 32 characters,
   a real `RESEND_API_KEY`, and a verified `RESEND_FROM` sender. Both processes
   must use the same database and auth secret; the worker must accept the app's
   origin.
3. Build the worker's canvas runtime and the web app, then start the web app
   from the repository root:

   ```sh
   bun run build:canvas-browser
   bun run build
   bun run start
   ```

4. In the second terminal, restart the worker from the same repository root
   with the updated configuration:

   ```sh
   NODE_ENV=production bun run dev:collaboration
   ```

Keep both processes running and sign in again before measuring. Do not compare
development compilation times with release performance.

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

## Typing and list interactions

Use `scripts/benchmark-interactions.ts` to compare body typing, task renaming,
and page-tree renaming. It seeds 100 sidebar pages, a 100-paragraph document,
and 200 tasks with future due dates in the preview's disposable database.

Start separate production previews from isolated copies of the baseline and
candidate revisions, with the same benchmark fixture helper in both copies:

```sh
# Baseline checkout, terminal 1
bun scripts/preview-mcp-editor.ts --production --port-offset=-10
# Candidate checkout, terminal 2
bun scripts/preview-mcp-editor.ts --production --port-offset=-9
# Candidate checkout, terminal 3, after both builds are ready
BENCH_PROFILE_DIR=/tmp/haunter-interaction-profiles \
  bun scripts/benchmark-interactions.ts \
  main=http://127.0.0.1:8787 pr=http://127.0.0.1:8788 \
  > /tmp/haunter-interactions.jsonl
```

The runner uses Chromium, a 1280 × 1000 viewport, 4× CPU throttling, and local
unthrottled requests. Each flow types the same 41 characters with an 80 ms
inter-key delay. It loads all 200 task rows before timing, excludes setup and
saving, and measures a fresh browser context after hydration. Restart previews
before a comparison to reset fixtures. Avoid builds and other tests during the
timing run.

One warmup per variant/flow is excluded, followed by three samples in alternating
variant order (`BENCH_SAMPLES` overrides the count). JSON output includes each
sample and median/range summaries for input-to-frame, main-thread work, script
time, and live-context POST count/body bytes. Input-to-frame measures
`beforeinput` through two animation frames; it is a local responsiveness proxy,
not field INP. Request counts include a 1.2-second drain after typing.
`BENCH_PROFILE_DIR` optionally records CPU profiles during the excluded warmups.

Each sample also verifies persistence: the edited body's complete paragraph text
must match exactly before and after a saved reload, and task/page renames are
read back through the API. Matching only the repeated typing marker would allow
old warmup edits to hide a lost sample. Timings are diagnostic evidence, not CI
thresholds. See [the measured interaction pass](interaction-performance.md) for
an example comparison and its limits.

## New page and /page creation

Run `scripts/benchmark-page-creation.ts` against two disposable
`preview:mcp-editor --production` hosts, using separate checkouts and port offsets
as in the interaction benchmark above. Start both hosts with fresh fixtures before
a comparison. The runner creates pages, verifies their contents, then trashes its
created pages so the visible sidebar stays the same size.

```sh
# Baseline checkout, terminal 1
bun scripts/preview-mcp-editor.ts --production --port-offset=10
# Candidate checkout, terminal 2
bun scripts/preview-mcp-editor.ts --production --port-offset=11
# Candidate checkout, terminal 3, once both builds are ready
BENCH_PROFILE_DIR=/tmp/haunter-page-creation-profiles \
  bun scripts/benchmark-page-creation.ts \
  main=http://127.0.0.1:8807 candidate=http://127.0.0.1:8808 \
  > /tmp/haunter-page-creation.jsonl
```

Defaults: Chromium, 4× CPU throttling, 150 ms HTTP latency, 1.6 Mbps download,
750 Kbps upload, desktop 1280×1000 and mobile 390×844. These emulate a constrained
browser against a local database and worker over HTTP/1.1. Production HTTP/2
request scheduling, Turso latency, and remote WebSocket latency can differ.
Request interception is deliberately avoided because
[Playwright routing disables HTTP caching](https://playwright.dev/docs/api/class-page#page-route).

Each scenario gets a fresh browser context. Cold starts at Home for **New page**,
or loads the parent editor for **/page**. Warm first visits an existing editor,
then navigates to the source page in the same context, retaining the HTTP cache.
The new document itself has no local Yjs cache in either case. `/page` necessarily
has its editor code loaded before the timed click in both cases.

The runner excludes one warmup per revision/scenario and collects three samples,
alternating revision order. It records click-to-visible title, writable title,
and editable body, plus elapsed time after an actual character is typed and
confirmed in each field. The input checks include automation overhead; they are
local workflow measurements, not field INP. Each sample then saves a unique body
marker and full title, checks API readback and the subpage link where applicable,
and requires exact title and body equality after reload.

`BENCH_PROFILE_DIR` saves CPU profiles during excluded warmups. JSON samples
include resource timings and transfer sizes for download diagnosis. Override
`BENCH_SAMPLES`, `BENCH_CPU`, `BENCH_LATENCY`, `BENCH_DOWNLOAD_MBPS`,
`BENCH_UPLOAD_MBPS`, `BENCH_CACHE=cold|warm`,
`BENCH_FLOW=new|slash`, or `BENCH_VIEWPORT=desktop` for focused diagnosis. Do not
run builds, full test suites, or other benchmarks during a measured comparison.

### HTTP/2 verification

The optional local TLS proxy allows a real browser HTTP/2 comparison while the
app and collaboration worker continue using disposable data. It requires Node
and OpenSSL. Generate a short-lived local certificate:

```sh
mkdir -p /tmp/haunter-creation-tls
cat > /tmp/haunter-creation-tls/cert.conf <<'EOF'
[req]
distinguished_name=dn
x509_extensions=ext
prompt=no
[dn]
CN=127.0.0.1
[ext]
subjectAltName=IP:127.0.0.1,DNS:localhost
EOF
openssl req -x509 -newkey rsa:2048 -nodes -days 2 \
  -config /tmp/haunter-creation-tls/cert.conf \
  -keyout /tmp/haunter-creation-tls/key.pem \
  -out /tmp/haunter-creation-tls/cert.pem
```

Start the proxy in its own terminal, then start both previews with HTTPS URLs.
The `--https` option advertises app-port + 20 and worker-port + 30; the proxy maps
those ports to the actual local listeners. Both revisions must use the same
preview helper when comparing an older baseline.

```sh
node scripts/benchmark-http2-proxy.mjs \
  /tmp/haunter-creation-tls/cert.pem /tmp/haunter-creation-tls/key.pem \
  3127:3107 1437:1407 3128:3108 1438:1408
# Baseline checkout, separate terminal
bun scripts/preview-mcp-editor.ts --production --port-offset=10 --https \
  --tls-ca=/tmp/haunter-creation-tls/cert.pem
# Candidate checkout, separate terminal
bun scripts/preview-mcp-editor.ts --production --port-offset=11 --https \
  --tls-ca=/tmp/haunter-creation-tls/cert.pem
# Once both builds are ready
BENCH_ALLOW_SELF_SIGNED=1 BENCH_VIEWPORT=desktop BENCH_FLOW=new \
  bun scripts/benchmark-page-creation.ts \
  main=http://127.0.0.1:8807 candidate=http://127.0.0.1:8808
```

The helper hosts remain HTTP; their fixtures advertise the HTTPS app origins.
The benchmark mirrors the helper's synthetic login into the HTTPS session cookie.
Resource entries record `protocol`; verify uncached app requests report `h2`.
`BENCH_ALLOW_SELF_SIGNED=1` is only for these local test certificates. A faster
connection check can add `BENCH_CPU=1 BENCH_LATENCY=20 BENCH_DOWNLOAD_MBPS=10
BENCH_UPLOAD_MBPS=5`. Stop previews and proxy with Ctrl+C after testing.

See [the page creation results](page-creation-performance.md) for the measured
comparison, complete ranges, and limits.
