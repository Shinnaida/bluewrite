# Flowchart style notes (client-approved)

Files: `docs/flowchart/bluewrite-officer-journey.drawio`,
`docs/flowchart/bluewrite-admin-journey.drawio`,
`docs/flowchart/bluewrite-phone-journey.drawio`

Recorded 2026-11-04 after reviewing the client's own save of the file.
Follow this scheme on every future edit so the client's choices are kept.

## Colour scheme (the client's colours — black / white / transparent only)

- **Page background:** transparent — `background="none"` on every `<mxGraphModel>`.
- **Shape fill:** transparent — `fillColor=none` on every shape (boxes, diamonds,
  ovals, pentagons) AND on every connector (draw.io writes it there too).
- **Outlines:** black. draw.io strips `strokeColor=#000000` on save because black
  is the default — do NOT re-add it; absence of `strokeColor` means black.
- **Outline width:** 2px (`strokeWidth=2`) on pages 1–6.
  ⚠️ The client's save reset all page-7 (profile) shapes to thin 1px outlines.
  Pages 8–9 (profile, added later) follow the thin profile style until the
  client confirms they want 2px everywhere.
- **Text:** default black. Sizes: 13 titles, 11 shapes, 10 legend.
- No other colours anywhere (no grey, no blue, no red).

## Layout rules (unchanged)

- US Letter portrait pages (816×1056), orthogonal connectors only.
- Decisions are diamonds answered only Yes / No.
- Pentagons carry cross-page letters: S2, A, B, C, D, E, F, G, H, I, J, K.
  (F: profile photo+look, G: profile safety+password,
  H: waiting for the answer, I: backup code, J: archive, K: shorter version.)
- Numbered circles are same-page loops back, matched in pairs
  (1 on sign-in; 2 + 3 on the code pages; 4 on Home; 6 on the waiting page).
- Text sits inside shapes with padding; no line crosses any shape.
- Everything locked (`locked="1"`) so nothing shifts on open.

## Reference restyle (2026-11-08, SoleVision journey as reference — no database)

- Page titles use the reference format: bold `N · Name` plus a small second
  line `BlueWrite — what the <officer|admin|officer on the phone> does ·
  page N of M`. Page tabs renamed the same way (`1 Signing in`, …).
- Page 1 of each file carries a dashed `legend1` reading-guide box adapted
  from the reference WITHOUT its database lines (no DB pentagon, no
  Database cylinder, no DB1 circles — BlueWrite journeys have no database):
  oval = start/end · rectangle = step · parallelogram = typing/message ·
  diamond = question (Yes/No) · pentagon = jump code to another page ·
  numbered circle = jump back to the same number on this page.
- Shape semantics follow the reference legend: typing steps (enter / type /
  fill / passwords / PIN / searches / filters) and shown messages (notices,
  errors, warnings, requests) are parallelograms; system actions and status
  displays stay rectangles; questions stay diamonds.
- Every connector now ends in a standard arrowhead
  (`endArrow=classic;endFill=1`), as in the reference. Nothing else about
  the connectors changed (orthogonal, locked).
- Verified after restyle: no `Database`/`DB1` text anywhere, all geometry
  inside US Letter, ids unchanged (only the long-standing per-page `0`/`1`
  root ids repeat, as before).

## workflow.draw.io (2026-11-08 — blotter log-book → Word → approve/sign)

- New 2-page file: W1 (report + encode) and W2 (approve + sign), same
  project styling as the other flowcharts (`locked="1"`, `fontSize=11`,
  `strokeWidth=2`, `fillColor=none`; no arrowheads on flow edges).
- W1: START → Incident/Complaint Reported → Desk Officer Receives → Write
  the blotter entry in the log book → Find a similar incident format file
  on the PC → Open Microsoft Word and duplicate the similar file → Create
  a new report and encode the log-book text → Review for completeness and
  accuracy → diamond "Report complete & correct?" (No → Revise or Add
  Missing Information, loops back; Yes → pentagon 1).
- W2: pentagon 1 → Submit to Supervisor → Supervisor Reviews and
  Validates → diamond "Report approved?" (No → Return Report for
  Correction → Revise Report, loops back to Supervisor Reviews; Yes →
  Finalize Incident Report → Print and Sign Report → File/Store Report in
  Records → END). Typo "approvedd?" from the reference fixed.
- No Database row: this is a manual paper/Word workflow, no DB touch.
- Verified: 2 pages, unique ids, all edges resolve, no overlaps, in
  bounds, XML-safe; both pages render-checked in draw.io.

## workflow-hipo.drawio (2026-11-08 — rebuilt as WORKFLOW flowchart)

- Per user correction ("it is not hipo, it is workflow"), this file is
  now a 2-page flowchart replicating the reference images, in the same
  project style as workflow.draw.io (`locked="1"`, `fontSize=11`,
  `strokeWidth=2`, `fillColor=none`, orthogonal edges, offPageConnector
  page links, Yes/No edge labels, US Letter 816x1056).
- R1: Start → Incident/Complaint is Reported → Desk Officer Receives →
  Write the blotter entry in the log book → Find a similar incident
  format file on the PC → Open Microsoft Word and duplicate the similar
  file → Create a new report, edit and encode the log-book text →
  Review for Completeness and Accuracy (checks it) → diamond "Report
  complete & correct?" (No → Revise or Add Missing Information, loops
  back; Yes → pentagon 1). All 11 shapes fit y30–938.
- R2: pentagon 1 → Submit to Supervisor → Supervisor Reviews and
  Validates → diamond "Report approved?" (reference typo "approvedd?"
  fixed; No → Return for Correction → Revise Report, loops back to
  Supervisor Reviews; Yes → Finalize → Print and Sign → File/Store in
  Records → End). Same layout/content as workflow.draw.io W2.
- Verified (2 pages, unique ids, 21 edges resolve, no overlaps,
  in-bounds, XML-safe) + both pages render-checked; temp files deleted.
- Note: both workflow files now carry the log-book → PC format →
  Word-duplicate → encode → check → approve/sign flow (detailed variant
  in workflow.draw.io, reference-image structure here). Rename candidate
  if the "-hipo" name confuses.

## Database layer in OfficerPhone.drawio (2026-11-08 — same SoleVision reference)

- New DB cells use the file's newer style with `fillColor=none` (matches the
  officer-journey DB cells): pentagon `shape=offPageConnector`, cylinder
  `shape=cylinder`, circle `ellipse`, all `fontSize=11;strokeWidth=2`,
  `locked="1"`.
- Every page (all 21) has the bottom DB key row: `DB` pentagon →
  `Database` cylinder → `DB1` circle with double-headed orthogonal links.
- 18 inline `DB1` circles sit pass-through in the chain where the server DB
  is touched: code check (S2), backup-code check + lockout counter (I1),
  OCR text return (B1), draft save + filed report (D1), profile display
  (E1), photo saved (F1), recorded request + new password saved (G1),
  archive state (J1), password check + code check + token mint (B3), stored
  token verified against server (D3), session revoked (E3), server photo
  read (F3), draft created (G3). Pure-nav, on-device-only (PIN/local files),
  and connectivity-check pages get the key row only.
- Steps that save or check now say so (e.g. `F_save`, `F_sub`, `H_saved`,
  `J_out`, `L_mint`, `T_create`; diamonds ask `... in the Database?`).
- Tall pages (D1, K1, A3, B3) are uniformly rescaled about the top margin so
  the row fits on the US Letter page; edges follow (absolute edge points are
  shifted/scaled with their cells). J3 (START page) also carries the "How to
  read this chart" box.
- Verified: 21 cylinders + 39 DB1 + 21 DB pentagons, 42 double-headed row
  links, no overlaps, nothing off-page, XML-safe; pages B3, D1, G1
  render-checked in draw.io.

## Database layer in Admin.drawio (2026-11-08 — same SoleVision reference)

- `Admin.drawio` keeps its own (older, pre-restyle) look: default black on
  white, `locked="1"`, `fontSize=11;strokeWidth=2` pentagons/circles, flow
  edges with no arrowheads. DB cells follow the file, not the reference's
  `light-dark` styling.
- Every page (all 12) has the bottom DB key row: `DB` pentagon →
  `Database` cylinder → `DB1` circle, joined by double-headed orthogonal
  links (the only arrowheads in the file). Rows sit at y≈930; on
  I-Deactivate and L-Station-Settings (taller flows) at y≈975.
- 15 inline `DB1` circles sit pass-through in the vertical chain at each DB
  touch: login check + lockout counter + email-code check (Start), directory
  lookup (Accounts), uniqueness + create (New Account), guard→save (Edit),
  clear-code + issue-codes (Sign-In Help), deactivate state (Deactivate),
  mark-handled (Requests), queue load + locked-record edit (Review),
  restore (Archive), trail rows (Audit Trail), settings save (Station
  Settings). B-Admin-Home (pure nav hub) has the row only.
- Steps that save or check now say so: "saved to the Database" /
  "in the Database" / "(from the Database)" (e.g. `D_ok`, `E_saved`,
  `G_off`, `L_done`).
- Start page also carries the "How to read this chart" box (end of page)
  with the DB third line: `DB pentagon = go to the Database · DB1 circle
  = Database step in the flow`.
- Verified: 12 cylinders + 27 DB1 + 12 DB pentagons, 153 edges, no
  overlaps, no out-of-bounds, pages Start + I-Deactivate render-checked in
  draw.io.

## Database layer (2026-11-08, officer journey only — per SoleVision reference)

- `Database` cylinders (`shape=cylinder`, black outline, transparent fill,
  font 11, locked) stand on every page that saves or checks records
  (all officer pages except 8 · The shorter version, which stores nothing).
  Each cylinder has one short orthogonal connector with a classic arrowhead
  from the page's key data step (e.g. `System checks login`,
  `SUBMITTED + filed`, `Saved — colleagues see the new photo`).
- `DB1` circles (same 30×30 ellipse style as numbered circles) mark a second
  DB touch far from the cylinder: attempts counters (pages 1–3), `Saved by
  Save draft` (page 9), the recorded office request (page 13). Flow goes
  step → DB1 → (same-page jump) → DB1-mate → cylinder.
- `DB` pentagons are a cross-page database handoff, used once: page 9
  `DB: filed report (next)` → page 10 `DB: filed report, continued`,
  sitting beside the filed-and-locked flow.
- Page-1 legend grew a third line: `cylinder = the database (saved
  records) · DB pentagon = a database handoff to another page ·
  DB1 circle = a jump to the database on this page` (box 736×88).
- Verified: 12 cylinders + 10 DB1 + 2 DB pentagons, 171 edges all with
  arrowheads, no overlaps, no connector crossing any shape, pages 1 and 9
  render-checked in draw.io.

## Client's own edits observed (kept as-is)

- Deleted the page-2 symbol legend (`B_leg`).
- Shortened the profile END label to plain `END` (restored to
  `END: Sign in again from page 1` on the rebuilt page 9).
- File header still says `pages="6"` after their save — corrected to the real
  count on rebuild (draw.io tolerates the stale value).


## Copy-as-image parity with bluewrite-usecase (2026-11-08)
- Removed the `background="none"` attribute from all mxGraphModel tags in
  Admin, OfficerPhone, admin-journey, officer-journey, phone-journey,
  workflow-hipo, workflow (71 diagrams) so they match bluewrite-usecase,
  which carries no background attribute — select-all + copy-as-image now
  behaves the same (draw.io default background) in every file.
