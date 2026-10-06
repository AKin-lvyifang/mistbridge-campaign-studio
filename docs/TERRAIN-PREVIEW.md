# Terrain and elevation preview

The editor now uses an original continuous, lit heightfield instead of isolated raised diamonds. Native map data remains one integer elevation per tile (0–16); no Microsoft artwork is included.

## Editing

- The initial view focuses the main settlement at an editing scale. F fits the full map; the crosshair returns to the main scene.
- Choose the mountain tool (E), then Raise, Lower, or Set Height.
- Raise/Lower changes each covered cell by one level per stroke. Repeated pointer events do not compound a stationary stroke. Set Height makes the brush area the selected level.
- Brush strokes interpolate between pointer samples and commit as a single normal undo transaction. Escape, pointer cancellation, and window blur discard an unfinished stroke.
- The inspector and viewport show native tile heights. A selected building shows the height range across its native footprint and warns when it spans different levels. Painting never silently levels a building or changes its coordinates.
- The mountain display button toggles one-level contour lines. Grid, objects, fit, pan, minimap, and zoom remain independent controls.

## Geometry and rendering contract

Each tile center retains its exact native elevation. Shared corner heights average the adjacent tile centers; four triangles connect those corners to the center. Adjacent cells therefore share edges without gaps. This is a continuous preview reconstruction, not a claim to match the game engine's slope tessellation or passability rules.

Native levels produce vertical geometry at nine preview pixels per level, with fixed directional slope lighting. The map boundary has a cutaway edge; internal height changes are slopes, not invented native cliff objects. Terrain-family edge blending and small original procedural marks soften dry-ground transitions. Water remains visually distinct. Trees have original layered oak/pine silhouettes and grounded shadows.

Terrain picking tests projected triangles along the view ray through all sixteen levels and returns the nearest intersecting surface. Fractional object positions sample the same piecewise planar mesh. Objects are depth-sorted; projected foreground terrain is clipped against each object's depth plane (the front of the drawn footprint for buildings) and masks its silhouette, so hills can occlude units and vegetation. Object picking checks the actual drawn silhouette and rejects terrain-occluded pixels. Objects are still schematic billboards rather than native multi-angle game sprites.

Below 18% zoom the overview uses coarser display blocks to bound drawing work; native data, object grounding, brush feedback, and picking stay full resolution. Zoom in for exact tile-surface inspection. The rendered terrain/object scene is cached separately from hover feedback. Panning and rapid wheel zoom transform the cached image immediately, then redraw detail after the gesture; brush previews coalesce rapid input. Mesh cache memory is capped. Maximum-map overview redraws are still heavier than close-up editing. Geometry, topology, lighting, height editing, native footprint measurements, and picking have regression tests in `tests/terrainGeometry.test.ts`. Native export continues to serialize the unchanged integer height field through the existing compiler; the preview mesh is never serialized into `.aoe2scenario` files.

## Remaining validation boundary

This is an editing preview, not simulation. Native terrain slopes, cliffs, building foundations, collision, and line of sight must be checked inside the game. Visual polish does not certify game placement. Very large maps and maximum detail views should be profiled on the target hardware.
