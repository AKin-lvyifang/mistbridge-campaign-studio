# Desktop / game release checklist

Current deliverable: runnable source, compiled web frontend and a working self-contained native runtime + desktop packaging pipeline. Linux runtime smoke passes. macOS/Windows installers require the exact-commit CI results; no signed installer is claimed.

Before distributing an end-user desktop installer:

- [x] Freeze and bundle Python with exact dependencies, license/source notices and isolated self-executing workers (Linux verified; target OS checks remain).
- [x] Use patched Electron 44.5.1 and exact dependency lock; full npm audit reports zero advisories.
- [ ] Build on real macOS and Windows runners, preserve logs/artifacts and verify exact commit.
- [ ] Package native fixtures, built frontend, Python runtime and parser version data; test on a clean machine without Python/Node installed.
- [ ] Smoke test install, launch, quit, macOS close/reopen, update/uninstall, Unicode filenames and non-ASCII home paths.
- [ ] Verify native save/open/export/rollback and temp cleanup on each platform.
- [ ] Add macOS signing/notarization and Windows signing under owner-controlled credentials; never commit credentials.
- [ ] Recheck native navigation, permission denial, CSP, loopback ownership/port collision and input limits.
- [ ] Complete UI accessibility and 1280×800 / high-DPI / keyboard / IME / interrupted-drag tests.

Before claiming game compatibility:

- [ ] Obtain a user-owned sample from the current ordinary AoE2 DE build and record the build.
- [ ] No-op import/export, load/save/reopen in game, compare expected fields.
- [ ] Edit ten terrain tiles and one unit, inspect map/object differences in game.
- [ ] Play dialogue, instant camera, movement, victory; test blocked paths and save/load.
- [ ] Assign exported AI pair in game, observe training/economy/attack timing and failure cases.
- [ ] Verify Chinese text, land/water transitions, unit footprints and passability.

Campaign containers, game-asset ingestion, arbitrary LLM generation, audio, local installation discovery, live game simulation and multi-scenario branching remain separate future work. Do not expose a control before it has real implementation.
