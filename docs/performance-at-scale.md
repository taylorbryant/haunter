# Performance at workspace and document scale

This follow-up compares the merged [PR #197](https://github.com/taylorbryant/haunter/pull/197) at `ed91334` with the changes in this PR. The largest delays came from mounting a wide sidebar and transferring populated drawings.

## Browser measurements

| Workload | Merged main | This PR |
| --- | ---: | ---: |
| 100-paragraph page editable in the 1,000-root workspace | 5.53 s | 3.45 s |
| Longest browser main-thread task on that route | 1,146 ms | 237 ms |
| DOM elements on that route | 18,719 | 1,603 |
| Sidebar rename, input to second animation frame | 353.8 ms | 10.4 ms |
| 100-paragraph page editable in the smaller workspace | 3.63 s | 3.68 s |
| 1,000-paragraph page editable | 5.12 s | 5.04 s |
| Blank canvas visible | 3.85 s | 4.00 s |
| 500-rectangle canvas visible | 4.77 s | 4.62 s |
| 3,000-rectangle canvas visible | 9.06 s | 7.76 s |
| Home heading visible in the smaller workspace | 1.38 s | 1.39 s |
| First task row visible | 2.12 s | 2.19 s |

Each route value is the median of three cold Chromium 159 browser contexts on a local production build. The viewport was 1280 × 1000. The profile used fourfold CPU slowdown, 100 ms network latency, 4 Mbps down, 1 Mbps up, HTTP/2 over TLS, and the real collaboration worker. The smaller workspace had approximately 100 root pages. The wide fixture had exactly 1,000. Its extra roots contained sidebar metadata. The timed editor and rename used real pages from the preview’s interaction fixture. Editor readiness uses Haunter’s `navigation-to-editable` mark. Canvas readiness is the first animation frame with a visible tldraw canvas. DOM counts and long tasks cover the observation window ending two seconds after the content first appeared. Home and Tasks use their first visible heading and task row respectively.

For sidebar typing, three fresh sessions plus an excluded warmup each typed 41 characters, 80 ms apart, into the same sidebar row with fourfold CPU slowdown and unthrottled loopback networking. Each session read back the saved title from the API. The reported value is the median of the three run medians. This measures hydrated interaction latency.

## What changed

- **Sidebar rendering.** The wide page route mounted 1,000 sidebar links on main and 49 on this PR. Each sibling group initially renders 48 rows and keeps the active branch reachable. Scrolling near the end or activating **Show more pages** appends another group. Typing a desktop or mobile rename updates the input locally. Workspace search and drag validation still use the full hierarchy.
- **Nested page indexing.** A synthetic 3,000-page chain took 79.72 ms to build its index on main and 0.48 ms on this PR. Main stored 4,501,500 descendant memberships. The new index stores 3,000 IDs and 3,000 ranges. A 3,000-root flat control measured 0.29 ms and 0.24 ms. These are seven-run Bun medians after one warmup. A test covers a 12,000-page chain and descendant-drop rejection.
- **Collaboration transport.** The same 3,000-rectangle drawing delivered a roughly 1.61 MB decoded initial sync message in both modes. A direct socket probe against the candidate measured **1,613,754 bytes** received through that message with compression disabled and **124,135 bytes** with it enabled, including the upgrade and frame overhead. Each value is a three-connection median. In a separate Chromium comparison, a loopback proxy paced actual server-to-browser socket bytes at 4 Mbps. With HTTP assets unthrottled and fourfold CPU slowdown, the same drawing appeared in 4.87 s with compression disabled and 1.83 s with it enabled (three alternating pairs). Large updates opt into Bun’s shared per-message compressor. Small edits and receipts skip compression. The canvas font gate now requests a snapshot only on mount. [Bun WebSocket compression](https://bun.com/docs/runtime/http/websockets#compression)
- **Page persistence.** The ordinary save reuses its synchronously captured Yjs state and skips collecting all block IDs. Merges and move repairs still validate their resulting state. At 3,000 blocks, median local SQLite persistence moved from 47.59 ms to 41.00 ms across nine one-character saves. Both runs validated durable receipts and peer synchronization.
- **Large recovery imports.** The original JSON request for a 2,037,165-byte recovery file returned HTTP 413. The same file imported through the file picker as a 1,000-paragraph page and two canvases containing 500 and 3,000 rectangles. Large files stage in actor- and workspace-scoped parts. One final transaction creates the recovered resources. Database tests verify rollback on a late failure and rejection of missing or mismatched parts. Deploy migration 0054 before the web app. The daily recovery cleanup schedule removes expired parts from abandoned uploads.

## Public routes and remaining costs

On the deployed site, three cold mobile Chromium runs at 390 × 844 recorded median LCP of 1.10 s on sign-in and 0.98 s on guides. These production routes were controls. The PageSpeed Insights request returned HTTP 429, so this audit has no production p75 or field INP result.

The blank canvas control was 0.15 s slower in this three-run comparison. The smaller page, Home and Tasks also showed small increases. The gains concentrated in the wide workspace and populated drawings.

The large drawing still initializes 3,000 shape elements, and tldraw requests its default font family set after mount. The 1,000-paragraph editor still renders all 1,000 blocks. Those client-side costs remain visible even after the transport and sidebar reductions.

## Repeating the workloads

Use the [HTTP/2 production preview](editor-benchmarks.md#http2-verification) and its disposable interaction fixture. For the wide sidebar, populate 1,000 live root rows with distinct titles and positions and open its 100-paragraph page. For the content fixtures, import 1,000 paragraph blocks and tldraw rectangles arranged in 80 columns, using 110 × 55 rectangles with 120 × 70 spacing. Give each record a unique ID and valid tldraw index. Use fresh browser contexts for cold timings. Record negotiated WebSocket extensions and socket-level bytes when comparing transfer sizes. DevTools frame sizes report decoded payloads.

Run `bun run benchmark:documents --sync` for the SQLite and two-client save workloads. The [interaction benchmark](editor-benchmarks.md#typing-and-list-interactions) describes the rename timing and readback checks.
