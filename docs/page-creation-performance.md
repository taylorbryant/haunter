# Page creation performance

Measured November 7, 2026 against merged main
`7a0f94f0f540d1a59ca89560fd16becef0028fe6`. Both revisions ran production Next
builds with disposable accounts, SQLite databases, and local collaboration workers.
The candidate stages document-client code before the bulk editor preload and
reuses the app's Inter font in editable and read-only editors.

Values are milliseconds: median (range) over three measured samples. Input timing
ends after a real character is typed and confirmed in the field, so it includes
small automation overhead. Title is exercised first, then body. These are local
workflow timings, not field INP.

## HTTP/2 verification

A loopback TLS proxy served the app over actual browser HTTP/2 connections and
forwarded secure collaboration WebSockets. Uncached resource timings reported
`h2` throughout. The proxy and HTTPS fixture setup are included in the benchmark
instructions. Each row contains three measured samples per revision.

| Desktop New page scenario | Main title input | Candidate title input | Main body input | Candidate body input |
| --- | --- | --- | --- | --- |
| Constrained, cold | 2,248 (2,175–2,265) | 1,147 (1,126–1,149) | 3,549 (3,471–3,557) | 3,300 (3,286–3,307) |
| Constrained, warm | 877 (876–877) | 825 (515–825) | 924 (920–926) | 868 (753–869) |
| Faster connection, cold | 454 (437–454) | 404 (402–404) | 789 (789–794) | 743 (742–752) |

The constrained connection uses the same 4× CPU / 150 ms / 1.6 Mbps download /
750 Kbps upload conditions as the main matrix. The faster check uses 1× CPU,
20 ms latency, 10 Mbps download, and 5 Mbps upload. Cold title entry improved
49% over HTTP/2 under the constrained profile; body entry improved 7%. The faster
check also improved slightly. The large cold-start benefit therefore appeared
under both tested protocols, though this remains a local proxy rather than a
production CDN measurement.

All 24 HTTP/2 executions passed typing, API readback, exact reload persistence,
and browser error checks, bringing the total to 88 verified executions: 22
excluded warmups and 66 measured samples. HTTP/2 checks cover desktop New page;
`/page` and the mobile layout are covered by the HTTP/1.1 matrix below.

## HTTP/1.1 comparison

| Scenario | Main title input | Candidate title input | Main body input | Candidate body input |
| --- | --- | --- | --- | --- |
| Desktop, cold, New page | 2,398 (2,379–2,500) | 1,097 (881–1,187) | 3,611 (3,603–3,636) | 3,359 (3,358–3,366) |
| Desktop, cold, /page | 540 (537–548) | 549 (547–553) | 711 (670–722) | 723 (705–744) |
| Desktop, warm, New page | 668 (586–706) | 803 (715–1,062) | 929 (905–960) | 848 (835–1,106) |
| Desktop, warm, /page | 540 (533–545) | 548 (544–556) | 678 (671–682) | 694 (692–711) |
| Mobile layout, cold, New page | 2,316 (2,246–2,327) | 1,209 (844–1,225) | 3,510 (3,507–3,532) | 3,209 (3,194–3,217) |
| Mobile layout, cold, /page | 508 (507–511) | 510 (493–525) | 680 (647–686) | 658 (653–688) |
| Mobile layout, warm, New page | 591 (513–819) | 495 (480–509) | 820 (739–858) | 715 (685–734) |
| Mobile layout, warm, /page | 512 (510–513) | 498 (487–507) | 674 (642–683) | 656 (636–669) |

Cold **New page** title entry improved 54% on desktop and 48% in the mobile
layout. Body entry improved 7% and 9%, respectively. Warm-cache results were
mixed: desktop title entry was 135 ms later while body entry was 81 ms earlier;
mobile title and body entry were 96 ms and 105 ms earlier. `/page` was already
loaded before the timed click and showed only small differences; this pass does
not establish a meaningful `/page` responsiveness improvement.

## Diagnosis and change

The cold-start browser profiles were dominated by waiting for downloads. The
original eager preload queued the large editor assets before the create response
could reveal the new route's title module. The document client's code also arrived
late despite the existing hook that opens the confirmed new page before navigation
finishes. Loading its code first gives creation, route loading, and authenticated
document setup an earlier start before the remaining editor downloads compete.

The same trace found four redundant BlockNote Inter font requests for which
Resource Timing reported 70,904 transferred bytes. Both editor surfaces now reuse the app's next/font Inter,
including portal roots and the editor's default text styles. Candidate cold
samples made none of those duplicate requests.

## Conditions and verification

- Chromium 158.0.8127.18, macOS arm64; desktop 1280×1000 and mobile 390×844.
- 4× CPU throttling; 150 ms HTTP latency, 1.6 Mbps download, 750 Kbps upload.
- Two existing pages in the measured workspace. Each sample's created pages are
  trashed after verification, keeping visible sidebar size fixed.
- Fresh context per sample. Warm first visits an existing editor and then fully
  navigates to the source route in the same context, retaining HTTP cache; it does
  not retain the previous document's JavaScript heap. `/page` always loads its
  source editor first. Newly created documents have no local Yjs cache.
- One excluded warmup per revision/scenario, then three measured samples with
  revision order alternating. CPU profiles cover excluded warmups only. Builds
  and test suites did not run concurrently with these comparisons.
- All 64 HTTP/1.1 executions (16 warmups and 48 measured samples) accepted the first
  character in both fields, passed API readback and exact full-content reload
  checks, and had no browser page errors. `/page` also verified the parent's link.
- Separate browser checks confirmed that Enter from a title typed before the body
  mounts transfers focus to the arriving body; both edits survived reload at desktop
  and mobile widths. Failed creation stayed on Home and opened no document session.
- Editable, public shared, and embedded editors used the loaded application font
  without requesting BlockNote's duplicate static faces.

See [the benchmark instructions](editor-benchmarks.md#new-page-and-page-creation)
for reproduction. Production CDN scheduling, database latency, and remote
collaboration latency differ from these local setups. These measurements do not establish production
user latency or iPhone Safari behavior. The full `bun beignet check` validation
loop and both changed-source impact maps were also run before handoff.
