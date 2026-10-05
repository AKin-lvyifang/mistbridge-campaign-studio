# Architecture

One authoritative `Project` object is shared by the map viewport, story dock, AI editor, history and file exporter. Editor UUIDs, native asset IDs and native object reference IDs are distinct.

- React/TypeScript UI and shared domain core run in a browser or isolated Electron renderer.
- Canvas2D projects native tile coordinates into an isometric schematic scene. It culls offscreen tiles and depth-sorts objects; it is not the AoE2 engine.
- Deterministic local generation outputs editable project data. StoryGenerator is a provider-independent proposal interface; the only shipped implementation is explicitly rule-based.
- Story proposals record the source revision and are applied as one undoable change only if the project revision still matches.
- Manual edits and generated changes commit through the same bounded in-memory undo stack. Browser storage is convenience autosave; downloaded JSON is the portable durable format.
- `customAi` belongs to the project, so script drafts survive save/open/history. AI syntax errors block AI bundle export, while draft files remain editable.
- Python FastAPI binds loopback only. Browser origin/Host and content types are checked; bounded jobs run parser operations in fresh subprocesses.
- Import retains original native bytes and provenance in an envelope. Export starts from that original, changes supported fields, preserves unknown content where representable, and independently verifies before returning bytes.
- The static private preview is built with `VITE_STATIC_PREVIEW=1`. It does not make native API requests and explicitly disables native import/export. It has no backend, account integration or data upload.

## Desktop boundary

Electron has context isolation, sandboxed renderer, no Node integration, deny-by-default permissions and same-origin navigation. It exposes only a small menu-command bridge. Native macOS/Windows menus share renderer commands.

The source launch uses a project-local Python environment; packaged builds use an included PyInstaller runtime and a stable studio://app renderer origin over an owned ephemeral loopback service. Frozen Linux import/export has been tested. Platform installer CI, clean-machine QA, signing and notarization remain required before claiming end-user release readiness. See DESKTOP-PACKAGING.md.
