# Campaign Studio design system

Implementation contract, 2026-10-05. Agreed with the frontend owner: React/TypeScript, Canvas2D viewport, Electron macOS/Windows shell; `radix-ui` primitives, `lucide-react` icons, native HTML form controls. This is a macOS-informed cross-platform editor, not a claim that HTML controls are AppKit controls. The dimensions and colors below are product decisions, not measurements prescribed by Apple.

## 1. Component foundation

Use one shared component layer. Feature panels compose its components; they do not invent new buttons, tabs, cards, modal behavior, or per-panel spacing.

| Component | Foundation and contract |
| --- | --- |
| Button / IconButton | Native `button`; primary, neutral, quiet, destructive variants; same sizes everywhere. Icon-only controls require an accessible label and tooltip. |
| Tabs / DockTabs | Radix Tabs; arrow-key navigation; controlled selection. Keep canvas/project state outside tab panels so changing a panel cannot reset the scene. |
| Dialog / ConfirmDialog | Radix Dialog / AlertDialog; named title, description, focus containment, Escape, return focus. Use for consequential decisions and setup, not normal property editing. |
| Menu / ContextMenu | Radix DropdownMenu / ContextMenu when implemented; same command registry as native Electron menus and shortcuts. Context menus supplement visible commands. |
| Tooltip | One Radix Tooltip provider; show label, shortcut and short explanation. Essential errors and prerequisites also appear persistently. |
| Field / NumberField / Select | Native labeled inputs/selects, shared styles; units alongside numbers; help/error IDs connected by `aria-describedby`. |
| Panel / Section / InspectorRow | Flat dock surfaces, consistent headers, disclosure sections, aligned labels/values. No nested decorative cards around every property. |
| DiagnosticRow / EmptyState / Status | Shared severity icon, concise message, location and available next action. Reuse in dock, inspector and export review. |

Import primitives only through this layer. Add a primitive when its interaction is needed; do not add a second competing UI kit or hand-roll focus traps. Radix handles substantial keyboard/focus/ARIA behavior, while this app remains responsible for labels, integration and testing. [Radix accessibility](https://www.radix-ui.com/primitives/docs/overview/accessibility), [Tabs](https://www.radix-ui.com/primitives/docs/components/tabs), [Dialog](https://www.radix-ui.com/primitives/docs/components/dialog).

## 2. Workspace anatomy

- **Window/menu:** native Electron platform window controls and app menu. Preserve resize, full screen, minimize and standard File/Edit/View/Window/Help behavior. Never draw decorative traffic lights in the Windows build.
- **Main toolbar:** 44px high, at most three logical groups: project/scenario and save state; common document edits; validate/export and inspector visibility. Keep viewport tools local to the viewport. Every toolbar command also has a menu route. [Apple Toolbars](https://developer.apple.com/design/human-interface-guidelines/toolbars?changes=la)
- **Left dock:** default 260px, range 220–360px. Asset library with search/category filter; a Scene tab can expose the object hierarchy without a fourth column. Use compact rows or thumbnail grids, not large promotional cards.
- **Center:** persistent, dominant isometric map. A 36px local toolbar contains Select, Paint, Place, Pan; active tool; contextual brush options. Zoom, coordinates and current selection belong in a 24px status strip. A small minimap may sit in a corner without covering core tools.
- **Right dock:** default 300px, range 260–400px. Selection inspector with object name/type, transform, player, state and references. The blueprint permits an object tree above the inspector; if the tree lives here, its rows must leave useful inspector space. Use one hierarchy location, not mirrored competing trees.
- **Bottom dock:** 32px tab strip for Story, Computer AI, Assistant, Diagnostics and History. Open to 220–300px only when useful; collapse without removing discoverability. Keep the map mounted and selection intact. [Godot editor anatomy](https://docs.godotengine.org/en/stable/getting_started/introduction/first_look_at_the_editor.html)
- Dock boundaries are flat 1px dividers. Resize handles have a larger invisible hit region and a keyboard-accessible alternative. Preserve user widths; offer Reset Layout. Floating/dock rearrangement can wait until actually implemented.
- At narrow widths, allow explicit dock collapse and command overflow rather than shrinking text. Test 1280×800 and 1440×900 first; 1024px-wide windows need a collapsed auxiliary pane. No landing page, hero, giant dashboard metrics, or full-screen chat inside an open project.

This follows Apple's preference for resizeable workspaces and keyboard access, with Godot's viewport/dock organization. [Apple macOS design](https://developer.apple.com/design/human-interface-guidelines/designing-for-macos/), [Godot dock customization](https://docs.godotengine.org/en/stable/tutorials/editor/customizing_editor.html).

## 3. Tokens

Use semantic CSS variables, not repeated literal values inside features. Default is dark graphite chrome with a warm, earthy map; canvas terrain colors are separate from UI status colors.

| Token | Value / purpose |
| --- | --- |
| `--bg` / `--panel` / `--raised` | `#17191d` / `#1e2229` / `#272d36` |
| `--input` | `#14181e` |
| `--border` | `#3e4856`, decorative separators only |
| `--control-border` | `#68778b`, meaningful input/checkbox/control boundaries |
| `--text` / `--secondary` / `--muted` | `#edf0f5` / `#b4bfce` / `#949fb0` |
| `--accent` / `--accent-bg` | `#8ab4ff` / `#233d61`, focus and selection |
| `--primary` / primary text | `#2864cf` / `#ffffff` |
| danger / warning / success | `#ff9b9b` / `#efc575` / `#8dceaa` |
| Spacing | 4, 8, 12, 16, 24px; standard panel inset 12px |
| Radius | control 6px; popup 8px; dock 0px |
| Control heights | regular 30px; compact 28px; icon hit area at least 30×30px |
| Type | 13px / 1.45 body; 12px secondary labels; 14px semibold panel title; no sub-12px essential text |
| Font | `-apple-system, BlinkMacSystemFont, "Segoe UI", "PingFang SC", "Microsoft YaHei", sans-serif` |
| Icons | Lucide 16px, consistent 1.75px stroke; 18px only for prominent toolbar controls |
| Focus | visible 2px accent outline, 2px offset; never remove without equivalent |
| Motion | 100–140ms opacity/color only; respect reduced motion; no decorative map motion |

Computed sRGB contrast: body/secondary/muted on panel = 13.97 / 8.57 / 5.96:1; white on primary = 5.51:1; accent on selected background = 5.26:1; control border on supported surfaces ≥3.03:1. Do not lower text opacity. These checks cover the stated pairs, not complete accessibility conformance. Use selection outlines/icons as well as color; show player number beside player swatches. [W3C non-text contrast](https://www.w3.org/WAI/WCAG22/Understanding/non-text-contrast.html), [target size](https://www.w3.org/WAI/WCAG22/Understanding/target-size-minimum.html).

No gradients/glass behind property text, ornamental gold borders, or colored cards per feature. Shadows belong to menus/dialogs only. Add a Light/System appearance only when every component and canvas overlay is verified; do not expose a nonfunctional theme setting.

## 4. Inspector, selection and edit behavior

- Canvas selection, object list selection, inspector and related story references share one selected ID set. Inspectors update immediately with the selection. [Godot Inspector](https://docs.godotengine.org/en/stable/tutorials/editor/inspector_dock.html), [Apple Panels](https://developer.apple.com/design/human-interface-guidelines/panels?changes=_3)
- Properties use aligned label/value rows, section disclosures, units (`格`, `秒`) and a reset action for changed defaults. Chinese labels are primary; original game name/data ID belongs in secondary metadata or help.
- No selection: “选择地图中的对象以查看属性”, with relevant selection guidance. Multi-selection: show count, common editable fields and a “多个值” mixed state; never silently copy one object's value to all.
- Numeric editing must preserve partial input while typing. Validate on commit; Enter commits, Escape restores. Do not change numeric values by scrolling over an unfocused field.
- A drag, brush stroke or property commit is one undoable transaction. Pointer capture plus pointer-up/cancel finalization prevents stuck tools. AI/rule-generated changes use the same transaction path and a reviewable diff before application.
- Hover is temporary; selection persists; keyboard focus has a separate visible ring. Inactive-window selection stays recognizable without looking focused. [Apple focus and selection](https://developer.apple.com/design/human-interface-guidelines/focus-and-selection/)
- Missing native assets retain label, ID and explicit schematic placeholder. The viewport must say “示意预览” until actual game assets are available. Do not imply exact rendering, simulation or native export support from visual polish.

## 5. Keyboard and platform contract

`Mod` means Command on macOS and Control on Windows. Render platform-correct shortcut labels; use Electron platform information in desktop builds. The command registry supplies label, shortcut, enabled state, reason and action to toolbar, menus and keyboard handler.

| Action | macOS | Windows |
| --- | --- | --- |
| New / Open / Save | ⌘N / ⌘O / ⌘S | Ctrl+N / Ctrl+O / Ctrl+S |
| Undo | ⌘Z | Ctrl+Z |
| Redo | ⇧⌘Z | Ctrl+Y; optionally Ctrl+Shift+Z alias |
| Settings | ⌘, | Ctrl+, |
| Copy / Paste / Select all | ⌘C / ⌘V / ⌘A | Ctrl+C / Ctrl+V / Ctrl+A |
| Select / Brush / Pan | V / B / H, viewport scope | Same |
| Temporary pan | Space + pointer drag | Same; middle-drag may be an additional route |
| Frame selection / Fit map | F / 0, viewport scope | Same |
| Zoom | + / −, viewport scope | Same |
| Cancel operation | Escape | Escape |
| Delete selected objects | Backspace/Delete, viewport or object list only | Delete, viewport or object list only |

Never intercept typing, IME composition, text selection or standard text undo with viewport shortcuts. Ignore unhandled events; prevent default only when a command actually runs. Tool switching and zoom require viewport focus. Menus/dialogs own their arrow/Escape behavior. Keep native text editing menu roles in Electron. Avoid global capture of system/browser shortcuts. Trackpad pan and cursor-anchored zoom need separate testing; provide visible zoom and pan alternatives.

## 6. Validation and truthful states

- **Invalid field:** keep entered value visible, set `aria-invalid`, show specific inline remedy. Example: “玩家编号必须为 1–8”. Do not silently clamp without informing the author.
- **Diagnostic:** severity icon + text + object/region reference + “定位”. Sort blocking errors above warnings; clicking locates and selects the relevant scene item.
- **Blocked export:** disable the execution step with visible reason and a diagnostics route. Keep “保存工程” available. “已保存工程” and “已导出原生场景” are different states.
- **Unknown compatibility:** explicit “尚未验证”; no green success badge. Unsupported native fields/rotation are unavailable with a reason. Only advertise validated capabilities.
- **Loading/generation/export:** show the actual operation and stage; disable duplicate invocation; keep safe navigation available. Indeterminate progress is preferable to invented percentages.
- **Offline native service:** persistent service status and retry instructions; ordinary project editing remains usable where supported. Do not label a generated project JSON as a playable `.aoe2scenario`.
- **No assets/search results:** short explanation and useful action such as Clear Filters or Connect Game Assets; no blank dock and no generic celebratory illustration.
- **AI assistance:** distinguish “规则生成” from actual model generation. Show changed tile/object counts and accept/cancel actions for proposals; never imply a model call took place if none did.

## 7. Acceptance checklist

- All standard controls come from the shared layer and use tokens; only specialized canvas/graph/timeline drawing is bespoke.
- Open a sample directly into a substantial map viewport. Select a map object and confirm list/inspector synchronization; undo the edit.
- Keyboard-only path covers dock tabs, fields, menus and dialogs. Escape and focus restoration work; text/Chinese IME input does not trigger tools.
- Test disabled, empty, mixed-selection, invalid, loading, service-offline and blocked-export states.
- Verify no clipped text, inaccessible actions or overlapping panes at 1280×800 and 150% UI scale; inspect high-DPI canvas sharpness separately from CSS size.
- Check contrast, accessible names, meaningful selection and non-color-only statuses in the rendered app. Library usage alone does not establish accessibility.
- macOS/Windows packaging and native menu behavior require execution on their respective platforms; browser QA does not certify these builds.
