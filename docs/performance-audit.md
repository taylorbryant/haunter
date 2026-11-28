# Haunter performance audit

November 26, 2026 · baseline revision `302022b`

The November 27 follow-up measures the merged changes on larger workspaces, documents and drawings. [Performance at workspace and document scale](performance-at-scale.md)

## Verified improvements

The following measurements compare the baseline with the updated local production build. Browser timings are medians of three cold navigations with the same Chromium, CPU and network settings. The sidebar counts come from one 10.5-second idle trace per route and build. Document timings are medians of nine edits per fixture.

| Measurement | Baseline | After |
| --- | ---: | ---: |
| Blank canvas drawing surface | 5.45 s | 3.75 s |
| 100-paragraph page editable | 3.84 s | 3.48 s |
| Largest page editor chunk begins loading | 1.77–1.89 s | 0.12–0.13 s |
| Idle page-route prefetches on Home | 27 (73.0 kB) | 6 (9.8 kB) |
| Idle page-route prefetches on canvas | 27 (67.9 kB) | 0 |
| 3,000-block edit visible to peer | 36.5 ms | 28.8 ms |
| 3,000-block save to SQLite | 60.6 ms | 44.3 ms |
| 3,000-block save receipt after peer saw edit | 117.3 ms | 91.9 ms |

Blank canvases and drawings without text now mount while drawing fonts load. With all 16 tldraw font requests held open, Chromium saved a rectangle, reopened it in a fresh context and saved a freehand stroke. The reopened drawing surface appeared 9 ms after the first held font request. A separate canvas kept its bold drawing text at 231 × 32 px and its italic monospace text at 247 × 32 px through font completion. tldraw still fetched 1.37 MB of fonts in the background.

The page route advertises its editor chunks during server rendering. The largest chunk finished at 2.34–2.35 s. Starting the authenticated grant request alongside browser recovery moved its median start on the 100-paragraph page from 3.09 s in the first round of fixes to 2.54 s. The page became editable at 3.48 s, down from 3.60 s. The short fixture improved from 3.52 s to 3.42 s. Each cold navigation requested one grant. The Home control displayed its heading in 1.38 s in both builds and transferred 514 kB of JavaScript. Page-tree links now prefetch on pointer or keyboard intent. Home still prefetches a few linked pages. Mouse, keyboard and touch navigation each opened the intended editor and persisted its first typed character.

The member canvas shell hydrates metadata. On an authenticated 500-rectangle canvas the full API returned 265,384 bytes, the metadata API returned 224 bytes and the complete direct-route HTML was 88,221 bytes decoded. The HTML excluded the drawing records. At 3,000 rectangles the metadata use case returned 213 bytes and the full use case returned 1.59 MB. The grant now selects only the room schema version and retains the missing-room and unsupported-version checks. The MCP canvas opener and canvas-specific embedded authorization also use metadata. Regression tests cover standalone and inline canvases, trashed parent pages and removed workspace grants. They recorded zero full drawing reads on these paths and zero collaboration-worker calls from the opener. The embedded browser test verified cookie-free canvas access, edits synchronizing in both directions with the web editor, and saving offline edits after reconnection.

Document persistence reads page metadata and reuses the binary state from validation. Move reconciliation skips its tree walk when there are no recorded moves. At 100, 1,000 and 3,000 blocks, SQLite save medians were 3.6, 14.7 and 44.3 ms. Whole-document validation and snapshot writes still scale with document size. These local measurements do not establish production p75 timings.

## Baseline observations

A cold canvas took 5.45 seconds to display its drawing surface. A 100-paragraph page took 3.84 seconds to become editable. Four drawing fonts accounted for 1.40–1.55 seconds on the canvas startup path. On the page, a 144 kB editor chunk only started downloading 1.77–1.89 seconds after navigation.

## Cold navigation

Each row shows the median of three fresh Chromium contexts. Parentheses give the full range. LCP measures the largest content paint. The editor's own readiness mark waits for an editable body and two animation frames. Canvas readiness records the first frame with a visible tldraw surface. Compressed JavaScript counts completed script response bodies through two seconds after the readiness check. kB and MB use decimal units.

| Route | LCP in seconds | Visible or editable milestone in seconds | Compressed JS |
| --- | ---: | --- | ---: |
| Public sign-in | 1.11 (1.10–1.12) | Email field 1.10 (1.10–1.11) | 301 kB |
| Public guides index | 0.98 (0.97–1.07) | Heading 0.97 (0.96–1.06) | 315 kB |
| Workspace Home | 2.07 (2.05–2.76) | Home heading 1.38 (1.37–1.83) | 514 kB |
| Tasks | 2.16 (2.14–2.31) | First task row 2.13 (2.09–2.27) | 513 kB |
| Page | 3.84 (3.76–3.92) | Body editable 3.84 (3.75–3.96) | 938 kB |
| Canvas | 5.67 (5.65–5.79) | Drawing surface 5.45 (5.40–5.57) | 1,050 kB |

Public measurements used the deployed [sign-in](https://www.haunter.app/sign-in) and [guides](https://www.haunter.app/guides) pages in a 390 × 844 mobile viewport. Authenticated measurements used the audited revision's Next.js 16.4.6 production build, a 1280 × 1000 desktop viewport, local HTTP/2, a disposable SQLite database and a local collaboration worker. The workspace contained 103 pages and 200 seeded tasks. The test page contained 100 paragraphs. The canvas had no shapes.

Chromium 159.0.8154.6 on macOS arm64 used 4× CPU slowdown, 100 ms emulated HTTP latency, 4 Mbps download and 1 Mbps upload. The browser made direct, cold navigations without user input. The first Home request took 642 ms to first byte, and the next two took 103 ms each. All 18 navigations returned HTTP 200 without an uncaught page error. Production p75 Core Web Vitals and authenticated production service times remain unverified. PageSpeed returned a shared-quota error for the anonymous sign-in lookup.

## Findings and verification

### 1. A blank canvas waits for four font files

The blank drawing selected the default drawing font and waited for its regular, bold, italic and bold-italic faces. They started around 3.95 seconds after navigation. Across three loads the interval from first request to last font response lasted 1.40–1.55 seconds. In a separate network trace, those four responses transferred 614 kB. Including the fonts fetched after mount, tldraw fetched 16 font files totaling 1.37 MB within the observation window.

Mount the blank drawing immediately and fetch font faces as text needs them. For populated drawings, preserve correct first-pass text measurements for the specific faces used. Re-run the blank-canvas trace and verify text bounds on drawings with mixed fonts, bold and italic runs. The observed wait is the opportunity size. Actual time saved depends on how much work overlaps after the change. [Font selection](../features/canvases/client/tldraw-fonts.ts) · [Canvas mount condition](../features/canvases/components/tldraw-with-fonts.tsx)

### 2. Direct page loads discover the editor late

The largest editor chunk started at 1.77–1.89 seconds and finished at 3.26–3.35 seconds. Across all three runs, 13 JavaScript requests initiated after the first second carried 467 kB of compressed response bodies. After the last JavaScript response, the longest main-thread task in each run lasted 276–322 ms. Haunter already initiates document synchronization alongside editor loading. Its session timing reported 578–596 ms from session start to document readiness.

On a direct page route, test advertising the editor entry chunk from the route response so it starts alongside the workspace shell. Keep warming restricted to routes that will use it. Compare the waterfall, navigation-to-editable and first persisted character on both a short page and the 100-paragraph fixture. Measure the effect on Home as a control. [Route entry](../app/(app)/w/[workspaceId]/p/[pageId]/page.tsx) · [Editor loader](../features/pages/components/page-editor.tsx) · [Existing page creation benchmark](editor-benchmarks.md)

### 3. The sidebar prefetches many unopened pages

In a 10.5-second idle Home trace, Chromium issued **27 prefetched Server Component requests for 25 distinct page URLs**, transferring 73 kB. Request headers confirmed that all 27 were prefetches. An independent canvas trace recorded 27 such requests for 23 pages. This adds workspace traffic on entry and can generate server work even when the user stays on the current screen.

Disable automatic viewport prefetch on page-tree links in a trial. The tree already warms the route and the editor on pointer entry, keyboard focus and pointer down. Compare idle request count and click-to-edit time for mouse, keyboard and touch navigation. [Page-tree link](../features/pages/components/page-tree-row.tsx) · [Intent handlers](../features/pages/components/page-tree.tsx)

### 4. Collaboration work grows with the whole document

Nine one-character edits at each size produced the following local medians. The network update was 18 bytes at every size. At 3,000 blocks, the resulting binary snapshot was 1.93 MB and the projected JSON body was 1.92 MB.

| Blocks | Local edit | Edit visible to peer | Local SQLite persistence | Wait for save receipt after peer saw edit |
| ---: | ---: | ---: | ---: | ---: |
| 100 | 0.03 ms | 2.8 ms | 3.6 ms | 6.3 ms |
| 1,000 | 0.03 ms | 12.3 ms | 22.1 ms | 40.2 ms |
| 3,000 | 0.03 ms | 36.5 ms | 60.6 ms | 117.3 ms |

Before broadcasting, the worker constructs and validates a candidate from the full document. Persistence separately captures, validates, projects and commits full state. One low-risk first experiment is to read only page metadata during an ordinary save. The existing checkpoint helper already loads the old body when a checkpoint is due. Then profile duplicate full-state encoding and projection. Verify durable receipts, move-conflict handling, concurrent HTTP writes and convergence across clients at all three fixture sizes. [Incoming update](../infra/documents/validate-update.ts) · [Persistence](../infra/documents/persistence.ts) · [Checkpoint decision](../features/pages/lib/checkpoint-page.ts)

### 5. Canvas authorization and hydration retrieve full drawings

The canvas route hydrates the full drawing into the browser query cache. The member drawing surface takes its live store from tldraw sync. The session-grant path also loads the saved drawing to authorize the user and a full room snapshot to check that the room exists.

In a disposable 3,000-rectangle fixture, the repository returned a **1.59 MB drawing record** and a **1.55 MB room string**. The metadata record was **213 bytes**. The standalone drawing JSON compressed to 119 kB with gzip. These are fixture sizes, independent of the blank-canvas browser timings.

Use metadata for the member canvas shell and a schema-version or existence query for issuing sync grants. Preserve tenant, parent-page and embedded-session checks, and keep full-snapshot access for consumers that read the drawing. Compare authenticated response bytes and DB reads on a populated direct load. [Canvas route](../app/(app)/w/[workspaceId]/c/[canvasId]/page.tsx) · [Session grant](../features/documents/use-cases/open-canvas-session.ts) · [Repository projections](../infra/canvases/drizzle-canvas-repository.ts)

## Search and editing controls

A search for a common body term across 1,000 synthetic pages with 16 KiB of indexed text each took 8.7 ms locally. The repository returned 349 kB of row JSON for 21 matching candidates. After selecting 20 results and creating snippets, the API result serialized to 9.8 kB. A no-match search rose from 2.3 ms at 100 pages to 17.5 ms at 1,000. These are nine-sample medians against local SQLite. If production search latency becomes material, measure database-to-app bytes and test returning snippets with the matched rows. Preserve substring, ranking and pagination semantics. [Search query](../infra/search/workspace-search-repository.ts) · [Snippet generation](../features/search/use-cases.ts)

After hydration, median input-to-second-frame time was **13.4 ms (12.4–14.0)** for body typing, **13.8 ms (12.9–14.8)** for a task rename and **38.9 ms (31.8–41.2)** for a sidebar page rename. Parentheses give the range of the three run medians. The test typed 41 characters with an 80 ms inter-key delay, fourfold CPU slowdown and unthrottled loopback networking. It loaded 200 task rows. All 12 executions, including three excluded warmups, passed persisted-content checks. These timings describe active typing after setup. Cold editor startup remains the higher priority for this fixture.

## Repeating the audit

- For route loads, use the [production preview and HTTP/2 setup](editor-benchmarks.md#http2-verification). Seed its local interaction fixture once via `POST /test/interaction-fixture`, sign in to the synthetic workspace, and open each route in a fresh browser context. Add `?editorPerformance=1` to the page and read `haunter:navigation-to-editable` in User Timing.
- In Chromium's Network panel, record the idle Home page for ten seconds and inspect page-route requests carrying router prefetch headers. On a blank canvas, filter for `.woff2` and compare the end of the four Shantell Sans responses with the appearance of `.tl-canvas`.
- For collaboration, run `bun run benchmark:documents --sync`. This uses Bun, temporary SQLite, two local WebSocket sessions and simulated IndexedDB. The fixture has 10% multiline code blocks. The installed Bun was 1.4.5.
- For hydrated typing, use the [interaction benchmark](editor-benchmarks.md#typing-and-list-interactions). This audit ran the existing workload with only the local HTTPS fixture's certificate and synthetic-cookie handling adapted from the page-creation harness.
