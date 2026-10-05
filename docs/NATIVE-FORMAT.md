# Native AoE2 DE format support

## Status and boundary

This is a working native binary adapter, not a JSON file renamed to `.aoe2scenario`.
It uses **AoE2ScenarioParser 0.9.4**, pinned with its resolved Python dependencies
in `requirements.txt`. The supported matrix is deliberately **ordinary AoE2 DE
scenario format 1.59 only**, square maps of 36–480 tiles, elevations 0–16. Files
claiming other versions, RoR/unknown variants, unparsed trailing data, invalid
coordinates, and malformed/oversized input are rejected. Chronicles, old internal
1.59 layouts, custom datasets and DLC-specific semantics are not certified.

**No game executable has been run.** Passing these tests means native fields can
be read, edited, serialized and independently reparsed. It does not prove that a
particular game build will load or play the file correctly. No proprietary game
sprites, textures, sounds, campaigns, or installed game data are included.

## Run and test

```sh
python -m venv .venv
.venv/bin/python -m pip install -r requirements.txt
.venv/bin/python -m uvicorn server.app:app --host 127.0.0.1 --port 8787
.venv/bin/python -m unittest discover -s tests -p 'test_*.py' -v
```

On Windows use `.venv\Scripts\python.exe`. The backend interpreter must contain
the pinned parser; the health endpoint reports a dependency mismatch otherwise.
Production serves the built frontend from `dist/` at the same loopback origin.
Development accepts frontend origins `http://localhost:5173` and
`http://127.0.0.1:5173`. The service is not designed as a public Internet server.

## HTTP contract

- `GET /api/health`: parser version, tested formats, and `gameTested: false`.
- `POST /api/import?filename=example.aoe2scenario`: raw binary body, with
  `Content-Type: application/octet-stream`. Returns `{project, summary, warnings}`.
- `POST /api/validate`: `application/json` body `{project}`. Returns project schema
  and authoring diagnostics. This inexpensive check does not parse the envelope.
- `POST /api/export`: `application/json` body `{project}`. Returns binary download,
  `X-Scenario-Version: 1.59`, `X-Native-Verified: fresh-process`, and
  `X-Native-Byte-Identical`. Export performs full native-envelope and preservation
  validation even if `/api/validate` has passed.
- Errors use a non-success status and JSON `detail`; malformed projects or native
  inputs return 422, oversized requests 413, wrong content type 415, foreign
  origins 403, and untrusted Host headers 400.

Only loopback Host headers are accepted. Foreign Origin and cross-site fetch
requests are rejected; no permissive CORS is installed. Binary and JSON request
content types are mandatory, preventing simple cross-site form submissions.

## Process isolation and input protections

The HTTP process never imports the parser. Import and compile each run in a new
Python subprocess. Every export, including no-op export, is then reparsed in a
**different fresh subprocess** before any bytes are returned. Workers use temporary
directories; no original user path is opened or overwritten. There is no network,
script execution, or automatic installation in the native adapter; the parser's
external XS checker integration is disabled.

Native input is capped at 16 MiB, JSON at 48 MiB, expanded DEFLATE content at
128 MiB. Each worker has a 60-second wall timeout; Unix also applies 45 CPU-second,
1.5 GiB address-space and 256 MiB file-size limits. Two workers at most run through
the API concurrently. The Windows fallback retains wall-time and input limits but
not Unix resource limits. The subprocess isolation is for stability and bounded
parsing, not a claim that arbitrary hostile parser inputs are fully sandboxed.

## Preservation model

Imported projects carry the complete original bytes in `native.originalBase64`,
its SHA-256, filename, version, original object inventory and trigger count.
Export verifies all of these against a freshly parsed original. No-op native
export is **byte-for-byte identical**, even when editor-only metadata changes.
The original envelope is not replaced after export; repeated exports therefore
append authored story nodes once to the same original and do not accumulate them.

For edited imports:

1. Start from the original parser representation, rather than recreating the
   scenario from the simplified canvas model.
2. Commit only changed map, unit, message, and/or trigger managers. Preserve all
   unedited sections and existing trigger structs.
3. Preserve unknown/special objects as locked placeholders, including status,
   animation, garrison, captions and unsupported native IDs. Client lock flags
   never exempt an originally ordinary object from coordinate validation.
4. Keep original native references when moving/editing existing objects. Allocate
   new references above both the original next-ID counter and all existing IDs.
   Deletion of references used by imported triggers or garrisons is blocked.
5. Preserve original trigger order and structs; append authored story triggers.
   Imported map resize is blocked to avoid invalidating native locations.
6. Compare untouched section hashes, existing trigger hashes, options other than
   the expected trigger counter, and preserved per-object fields. Reparse the
   result in another process and compare all compiled section/trigger hashes.

The parser adds NUL terminators to newly authored trigger strings, then strips
those terminators on parse. Hash comparison normalizes only trailing NULs; native
numeric fields are compared in their serialized byte representation. Header
trigger counts, native filename, unit next-ID counter and explicitly edited fields
may change. Compression and filename differences are expected on edited output.
This is a known-field preservation guarantee, **not a claim of universal lossless
compatibility with unknown future layouts**.

## Authored events and AI

Story delays are absolute whole seconds from scenario start. Each node becomes a
non-looping trigger with a timer condition; enabled state is retained.

- Dialogue: native Display Instructions effect with player, UTF-8 message and
  duration. Dialogue duration must be positive.
- Camera: instantaneous native Change View effect at the integer tile location.
  No smooth camera movement is implemented; duration is ignored.
- Move: native Task Object effect with a real object reference and integer target
  tile. Its player must match the targeted object's owner.
- Victory: native Declare Victory effect for the selected player.

Existing triggers are opaque to this UI. Import does not attempt to reverse them
into story nodes. Importing an exported scenario therefore shows its previously
compiled story as native preserved triggers.

Project `behavior` and optional `customAi` are editor/companion-file data. They are
not silently injected into the native AI slots. AI `.ai`/`.per` files must be
assigned to the appropriate player in the game editor. Player settings from
imported files remain unchanged. New maps enable player slots needed by their
objects/events and center the editor camera.

## Fixtures, license and provenance

`fixtures/SOURCES.json` records exact fixture hashes, upstream package URL,
release-wheel SHA-256 and pinned source reference.

- Upstream public blank: `fixtures/upstream/default-1.59.aoe2scenario`, 642 bytes,
  SHA-256 `99155dfc6c6487220f6b982808ff1aad552f6985027e9aa1e10e2eb74ab5928b`.
- Original derived preservation sample: `fixtures/preservation-1.59.aoe2scenario`,
  SHA-256 `11ea2ea6d3c89891e1abc1e137db9e33e5a801cc7c7bb29158c2e136c3042a35`.
  It includes a deliberate synthetic unknown object ID and is a parser test,
  not a playable scenario. Rebuild using `fixtures/rebuild_derived.py`.

The pinned wheel's actual included `LICENSE` is the GNU GPL version 3 text,
although its package metadata says MIT. That upstream conflict is documented,
not resolved by choosing the looser label. This application follows a
GPL-3.0-only-compatible distribution path; the upstream license is retained in
`fixtures/upstream/LICENSE.AoE2ScenarioParser`. Process separation does not remove
license obligations. Public distribution should retain notices, provide the
application's corresponding source, and provide the exact upstream source (or
otherwise satisfy applicable GPL source-distribution obligations).

## Test scope and remaining acceptance

The native regression suite checks exact no-op bytes, real terrain/elevation
edits, unit add/move/delete, unknown-object fields, references, imported trigger
preservation, new scenario export, all four authored effect types, Unicode,
repeat-export stability, envelope tampering, untested versions, truncation/trailing
bytes, strict schema and loopback-origin protections, and verification failures.

Still required before claiming game-ready support: open/save/reopen in the user's
current AoE2 DE build; inspect cliffs and impassable terrain; test unit pathfinding,
collisions, dialogue UI, camera cuts, scripted movement, victory/defeat, AI
assignment and save/load. Multiplayer, campaign containers, mods installation,
RoR, Chronicles and arbitrary old-version conversion are outside this adapter.

## Observed benchmark (2026-10-05)

`docs/native-benchmark.json` contains all three raw wall-time samples, machine and
runtime versions, output sizes/hashes and method. Final-default median timings:
importing the 80×80 preservation sample 0.737 s; byte-identical export with fresh
verification 1.361 s; terrain/object edited export 2.095 s; exporting the generated
120×120 Mistbridge project (326 objects, four events) 4.556 s. These are measurements
on this development machine under concurrent, variable load, not guaranteed performance.

The last benchmark output is the genuine native scenario
`fixtures/generated-mistbridge-1.59.aoe2scenario` (5,606 bytes), SHA-256
`638cb7aca3fcddd1bedf74d928c6931d67b9ca0cb4428c48c0bffa4d1eb2e28f`.
To reproduce timings and regenerate that authored fixture, run
`.venv/bin/python -m server.benchmark` after generating the TypeScript benchmark's
`fixtures/generated-mistbridge-project.json` input.
