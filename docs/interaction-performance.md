# Interaction performance measurements

Measured November 7, 2026 against main `1f788c337de863fd16839dd912407336aeac8c79`.
The candidate isolates task-row renders and coalesces caret-only live-context
reports. Both revisions ran as production Next builds with disposable SQLite
databases and local collaboration workers.

## Results

These results replace the initial run after strengthening body reload verification.
The benchmark now captures the complete edited paragraph before reload and requires
an exact match afterward, so a previous warmup cannot satisfy a later sample's
check. Simulated reloads retaining only the warmup or a truncated latest edit were
also rejected by the corrected check.

Values are medians across three samples; parentheses show the sample range.
Each sample types the same 41 characters after hydration. Input-to-frame is the
sample's median `beforeinput`-to-second-animation-frame duration, not field INP.

| Measurement                                       | Baseline                  | Candidate           |
| ------------------------------------------------- | ------------------------- | ------------------- |
| Task rename input-to-frame                        | 242.9 ms (228.7–246.8)    | 12.9 ms (11.1–14.3) |
| Task rename input-to-frame p95                    | 273.9 ms (269.9–287.8)    | 26.1 ms (17.7–29.8) |
| Task rename main-thread work, entire typing batch | 10,238 ms (10,151–10,320) | 356 ms (335–373)    |
| Body typing input-to-frame                        | 11.5 ms (10.6–13.2)       | 12.8 ms (11.1–14.5) |
| Body typing context POSTs                         | 11 (11–11)                | 4 (4–4)             |
| Body typing context request body bytes            | 5,735 (5,735–5,735)       | 2,089 (2,089–2,089) |
| Page-tree rename input-to-frame                   | 33.0 ms (31.3–36.3)       | 31.0 ms (29.7–34.5) |

Task renaming showed a substantial improvement: about 95% less input-to-frame
latency and 97% less main-thread work in this stress case. Typing context traffic
fell by 64%; the overlapping body-typing timing ranges do not establish a
responsiveness improvement. The unchanged page tree served as a control.

## What changed and why

The baseline CPU profile traced a large share of task-typing work to
`formatDueDateLabel`: editing one title rendered every task's date and assignee
pickers. `TaskRow` now uses React's default memo comparison with stable callbacks
and per-row draft/pending/selection props. Draft ownership, optimistic writes,
error retries, and the embedded task observer remain in the list. Keyboard focus
return is scoped to each row.

Caret-only movement within the same page block now coalesces for up to one
second. Complete caret offsets are preserved. Activation, block changes, selected
ranges, clearing a range, and clearing context keep the 300 ms path; a pending
caret timer can be brought forward. Continuous typing cannot keep postponing the
deadline. Heartbeats and page-hide flushing retain their existing behavior.

Page-tree renaming was much less expensive than task renaming in this workload.
No tree rendering refactor was justified by this pass. Drag interactions, very
large trees, task-list minute ticks, and cold page creation need separate profiles
if they become the next reported problem.

## Conditions and reproduction

- Chromium 158.0.8127.18 on macOS arm64, 1280 × 1000 viewport, 4× CPU throttling.
- Local requests without network throttling; authenticated synthetic account.
- 100 seeded sidebar pages plus three preview/document pages; 100 body paragraphs;
  200 loaded tasks, all with future due dates.
- Fresh browser context for each flow, with hydration and setup excluded.
- 80 ms inter-key delay; request counts include a 1.2-second drain after typing.
- One excluded warmup per revision/flow, then three samples in alternating order.
- CPU profiles captured only during excluded warmups. No concurrent builds or
  full test runs during the comparison.
- All 24 workload executions (six warmups and 18 measured samples) passed their
  persistence checks with no browser page errors. All eight body reloads matched
  the complete edited paragraph; task/page renames passed API readback.

Run the [interaction benchmark](editor-benchmarks.md#typing-and-list-interactions)
to reproduce the comparison and generate raw JSON samples and CPU profiles.
These are local diagnostic measurements, not production telemetry. The large
task improvement applies to this 200-row dated-task workload; smaller lists and
different devices will have different absolute timings.
