# Editor body startup performance

Measured November 7, 2026 against merged main `e8a96ec3` (PR #180). Both revisions
use production Next.js builds, disposable accounts and SQLite databases, local
collaboration workers, and the same loopback HTTP/2 proxy.

## Where the remaining time went

A separate diagnostic build added temporary User Timing marks at document-session
construction, first document readiness, editor-module evaluation, and around
`useCreateBlockNote`. These probes were removed before the before/after benchmark.
The three measured cold desktop runs produced these medians (ranges), in ms:

| Stage | Time after click or duration |
| --- | --- |
| Document session starts | 770 (767–778) after click |
| Initial document ready | 1,415 (1,414–1,421) after click |
| Last JavaScript response completes | 3,044 (3,026–3,053) after click |
| Editor module evaluated | 3,137 (3,120–3,155) after click |
| Construct empty editor | 27 (25–28) duration |
| Body accepts the first character | 3,307 (3,297–3,332) after click |

These stages overlap; their timings must not be added together. Document setup
finished well before the editor module arrived. The earlier cold CPU profile also
spent roughly 2.5 of 3.6 seconds idle. Downloads were the main bottleneck in this
local setup, rather than constructing the empty editor or waiting for initial sync.

## Change

Theme colors remain immediately available. Shiki and its JavaScript regex engine
now load through the existing shared highlighter promise when code highlighting
is requested. The schema obtains language labels from the app's existing
`CODE_BLOCK_LANGUAGES` list; importing BlockNote's code-block package just for its
options also pulled in its bundled highlighter and defeated the lazy boundary.
The app's supported language IDs, default SQL language, syntax palettes, shared
highlighter instance, and latest-theme request handling remain in place.

An empty editor no longer requests the Shiki core/engine chunks. Code blocks load
them on demand, so their first syntax coloring now includes that download. The
code blocks remain editable while highlighting loads.
The code dialog and diagram renderer were inspected; the diagram renderer already
loads on use, and this change targets the measured highlighting payload.

## Before/after results

The table records time until a real first character is typed and confirmed in each
field. Values are medians (ranges) in ms over three samples per revision/scenario;
there is also one excluded warmup. The title is exercised before the body, as in
the previous page-creation benchmark.

| Scenario | Main title input | Candidate title input | Main body input | Candidate body input |
| --- | --- | --- | --- | --- |
| Desktop, cold, New page | 1,148 (1,147–1,160) | 1,146 (1,140–1,150) | 3,334 (3,327–3,366) | 3,014 (3,006–3,016) |
| Desktop, cold, /page | 543 (528–544) | 530 (519–543) | 747 (744–765) | 781 (749–787) |
| Desktop, warm, New page | 819 (552–820) | 832 (831–838) | 864 (766–865) | 881 (873–882) |
| Desktop, warm, /page | 533 (518–539) | 528 (515–544) | 761 (748–777) | 748 (740–766) |
| Mobile layout, cold, New page | 827 (825–828) | 826 (816–849) | 3,163 (3,152–3,170) | 2,844 (2,837–2,878) |
| Mobile layout, cold, /page | 490 (483–499) | 497 (494–512) | 697 (665–700) | 708 (685–715) |
| Mobile layout, warm, New page | 535 (533–567) | 548 (544–558) | 778 (748–783) | 764 (761–777) |
| Mobile layout, warm, /page | 490 (486–492) | 473 (460–509) | 685 (680–690) | 670 (647–719) |

Cold New page body input improved by **320 ms (9.6%)** on desktop and
**319 ms (10.1%)** in the mobile layout. Cold title timing was essentially unchanged.
Post-click JavaScript transfer reported by Resource Timing fell from 494,700 to
437,019 bytes on desktop, a reduction of 57,681 bytes (11.7%); these transfer sizes
include response headers. The removed core/engine requests accounted for 55,779
bytes, with the rest from changed application chunks.

Warm-cache and `/page` results were mixed. Body medians ranged from 15 ms earlier
to 34 ms later; these small samples do not establish an improvement for those
flows. `/page` already loads its source editor before the timed action.

### Faster connection

A desktop cold New page check used 1× CPU, 20 ms HTTP latency, 10 Mbps download,
and 5 Mbps upload, with the same sample counts and HTTP/2 setup:

| Metric | Main | Candidate |
| --- | --- | --- |
| Title input | 403 (403–404) | 403 (403–404) |
| Body input | 742 (733–745) | 493 (489–745) |

Two candidate samples improved; the third matched the baseline range. This small,
variable result is a guard against a faster-connection regression, not a claim
that every fast connection saves 249 ms.

## Conditions and verification

- Chromium 158.0.8127.18 on macOS arm64; Next.js 16.4.5 production builds.
- Main matrix: 4× CPU, 150 ms HTTP latency, 1.6 Mbps download, 750 Kbps upload;
  desktop 1280×1000 and mobile layout 390×844.
- Uncached requests reported `h2`. This is a loopback TLS proxy, not a production
  CDN; database and collaboration worker are local.
- Fresh context per sample. Warm visits an existing editor, then fully navigates
  to the source route while retaining HTTP cache. `/page` always loads its source
  editor first. The newly created document has no local Yjs cache.
- Two existing pages in the measured workspace. Each sample's new pages are
  trashed after verification so visible sidebar size stays fixed.
- One excluded warmup and three measured samples per revision/scenario, with
  alternating revision order. CPU profiles cover warmups only. No builds, test
  suites, or other browser proofs ran during the comparisons.
- All **72 comparison executions** passed first-character typing, API readback,
  exact title/body equality after reload, and browser error checks: 64 in the main
  matrix and 8 on the faster profile (18 warmups, 54 measured samples). `/page`
  also verified the new link in its parent.
- Browser checks at desktop and mobile widths verified plain typing without
  loading Shiki, first code insertion, syntax coloring, fullscreen edits with
  blank lines and indentation, and exact code persistence after reload. A fresh
  public reader also highlighted the saved code in the selected dark palette.
- A cookie-free embedded editor verified first code loading, a host theme switch,
  and fullscreen highlighting.
- The unit suite covers concurrent first-use requests sharing a single highlighter
  and keeping the latest requested theme, plus all existing syntax palettes.

The full `bun beignet check` loop and both changed-source impact maps were run.
An earlier check hit a broadcast-test timeout; that test passed alone and the full
rerun passed.

Reproduce with the [page-creation benchmark and HTTP/2 setup](editor-benchmarks.md#new-page-and-page-creation).
Use the script's default matrix, then the documented faster-profile overrides.
The phase diagnostic marks describe an instrumented build; the comparison builds
contain only the production changes. These are local workflow timings including
small automation overhead, not production telemetry, field INP, or real iPhone
Safari measurements.
