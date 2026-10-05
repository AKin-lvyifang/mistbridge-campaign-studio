# Local generation and validation

This first slice generates an original editable single-scenario project. It does
not call a language model, request an API key, reproduce a published campaign, or
bundle game art. The UI uses original schematic symbols. Native IDs are references
verified against the installed AoE2ScenarioParser 0.9.4 datasets.

## Map generation

`generateMap({ seed, size, theme, forest })` returns only tiles and objects.
Equal inputs produce identical output, including object IDs and rotations.

- `seed`: an unsigned 32-bit integer, including zero.
- `size`: an integer from 36 through 480; new native maps are square.
- `theme`: `river`, `highland`, or `coast`.
- `forest`: 0–100, a relative density control. It is not a promise that this
  percentage of map tiles will be forest.

A coordinate hash drives smooth value-noise fields for ground color and elevation.
A separate seeded PRNG places objects. River and coast shapes use continuous
curves. Settlement clearings, a primary west-to-east road, and two branch roads
are laid over those fields. Forests use correlated density patches and maintain a
clear margin around roads and settlements. Preset buildings retain native-sized
spacing on smaller maps. Terrain forest types are deliberately omitted; trees are
explicit native objects rather than relying on editor terrain auto-population.

The river crossing is a stone-road causeway made from terrain. It is not a
verified native bridge assembly. Terrain 4 is traversable shallows; terrain 1 is
shallow *water*, which should not be described as traversable by land units.

The default “雾桥来信 / Mistbridge” layout contains a western player settlement and
escort, a player-owned guide, an eastern campfire and waymarker, a northern enemy
settlement and guard, and resource pockets. Player numbers are references;
starting resources, diplomacy, civilisations, AI assignment, native pathing, and
victory behavior still require review in the actual game editor.

The route regression tests flood-fill passable terrain with a one-level height
step limit. This proves an approximate tile route for the generated story, not
AoE2 collision/pathfinding, unit passage, bridge behavior, or combat balance.

## Story starter

`generateStory(text, project)` is a deterministic quotation/keyword template.
It detects Chinese versus English, preserves quoted lines, selects an existing
player-owned guide, and binds the destination to an existing campfire or flag.
If no guide exists it omits movement rather than inventing an object reference.

Supported nodes are dialogue, camera, move, and victory. Delay is an absolute
integer number of seconds from scenario start. The template emits an opening
camera, opening line, timed move order, and timed follow-up line. It does not wait
for arrival. Keywords requesting victory add a **disabled** timed victory node
that the author must review and enable deliberately.

There are no arrival/death conditions, failure branches, audio assets, free-form
script compilation, or natural-language reasoning in this slice. Labels in the
object inspector are editor metadata; they are not automatically native unit
renaming effects. The story timing still needs in-game testing.

## PER behavior starter

`compileAi(profile)` writes a readable PER file with gathering allocations,
villager and militia-line training limits, housing, a barracks rule, and an
optional one-time timed attack. The profile's player is a suggested assignment,
not an instruction that assigns the script to a native player. A starting Town
Center, appropriate resources, population room, and manual AI assignment are
needed. This is not a competitive AI or a patrol system.

The generated constant is `militiaman-line`, as documented in the original
[Computer Player Strategy Builder reference](https://userpatch.aiscripters.net/CPSB.pdf)
(unit-line parameters, pp. 62–64). Command arities and basic facts use that primary
reference. Additional language details can be checked in the maintained
[AI scripting command index](https://airef.github.io/commands/commands-index.html).
A matching empty `.ai` loader and `.per` file must be installed together under the
same basename. Test the script against the target game build; old scripting
references are not a claim of game-build certification.

`validateAi` is deliberately limited: it tokenizes comments and quoted strings,
checks balanced parentheses, rule separators, conditions/actions, supported
command argument counts and comparison operators. Unrecognized commands produce
warnings. This is not the engine's full PER compiler, type checker or runtime.

Custom PER source is stored in `Project.customAi`. Syntax errors remain warnings
in project validation so a draft can be saved and reopened; direct PER lint still
returns errors. The UI should block AI download on those errors. Editing profile
controls can explicitly regenerate and replace custom source.

## Project validation and preservation

`validateProject` accepts unknown values and reports bounded diagnostics. It
checks runtime types, array limits, map shape, native ranges, player numbers,
coordinates, object identity, native references, rotations, supported story
kinds, timing, references, owners and behavior settings. It warns about water
placement, timed victory, and AI/story ownership conflicts.

`parseProject` rejects malformed JSON and invalid structural data without relying
on a TypeScript cast. Repairable story drafts (a deleted actor, mismatched owner,
non-unit movement binding, or empty bounded dialogue/name) remain loadable; they
still produce export-blocking diagnostics until repaired. Arbitrary objects in
text fields and invalid timing/coordinate/schema values remain rejected.

Imported unknown terrain/object IDs are retained when covered by the native
original. Only locked imported IDs carrying a native reference may retain unusual
finite coordinates or rotations. This local exemption is not authorization to
change protected data: the backend independently parses the original bytes and
compares protected fields. Original-file hashes and resize restrictions are
checked in the native service. Merely checking an editor “locked” flag on a new
object does not relax validation.

Preserved imported triggers are not rewritten by the story editor. New story
nodes append timed triggers. Native no-op and modified-file roundtrips are tested
separately by the backend. Neither local validation nor a binary roundtrip proves
that a scenario plays correctly in AoE2 DE.
