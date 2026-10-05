"""Shared wire validation; no parser is imported in the HTTP process."""
from __future__ import annotations

import math
from typing import Literal
from pydantic import BaseModel, ConfigDict, Field, StrictInt, ValidationError

SUPPORTED_VERSION = "1.59"
ASSETS = {
    349: ("Oak tree", "decoration"), 350: ("Pine tree", "decoration"),
    623: ("Rock", "decoration"), 304: ("Bonfire", "decoration"),
    59: ("Forage bush", "decoration"), 66: ("Gold mine", "decoration"),
    102: ("Stone mine", "decoration"), 600: ("Flag", "decoration"),
    109: ("Town center", "building"), 70: ("House", "building"),
    12: ("Barracks", "building"), 598: ("Outpost", "building"),
    79: ("Watch tower", "building"), 562: ("Lumber camp", "building"),
    448: ("Scout cavalry", "unit"), 93: ("Spearman", "unit"),
    74: ("Militia", "unit"), 4: ("Archer", "unit"), 38: ("Knight", "unit"),
    83: ("Villager", "unit"), 125: ("Monk", "unit"), 594: ("Sheep", "unit"),
}
TERRAINS = {0, 12, 9, 6, 3, 24, 25, 2, 1, 23, 22, 4}

class Model(BaseModel):
    model_config = ConfigDict(extra="forbid", allow_inf_nan=False)

class Tile(Model):
    terrain: StrictInt = Field(ge=0, le=255)
    elevation: StrictInt = Field(ge=0, le=16)

class Map(Model):
    width: StrictInt = Field(ge=36, le=480)
    height: StrictInt = Field(ge=36, le=480)
    tiles: list[Tile] = Field(max_length=480*480)

class MapObject(Model):
    id: str = Field(min_length=1, max_length=200)
    nativeId: StrictInt = Field(ge=0, le=65535)
    player: StrictInt = Field(ge=0, le=8)
    x: float
    y: float
    rotation: float
    label: str = Field(max_length=500)
    category: Literal["unit", "building", "decoration"]
    nativeReferenceId: StrictInt | None = None
    locked: bool = False

class StoryNode(Model):
    id: str = Field(min_length=1, max_length=200)
    name: str = Field(min_length=1, max_length=240)
    enabled: bool
    delay: StrictInt = Field(ge=0, le=86400)
    kind: Literal["dialogue", "camera", "move", "victory"]
    text: str = Field(max_length=10000)
    player: StrictInt = Field(ge=1, le=8)
    x: float
    y: float
    objectId: str | None = None
    duration: StrictInt = Field(ge=0, le=3600)

class Behavior(Model):
    player: StrictInt = Field(ge=1, le=8)
    name: str = Field(max_length=200)
    villagers: StrictInt = Field(ge=0, le=500)
    military: StrictInt = Field(ge=0, le=500)
    attackTime: StrictInt = Field(ge=0, le=86400)
    aggression: Literal["defend", "balanced", "attack"]

class NativeEnvelope(Model):
    originalBase64: str = Field(max_length=24*1024*1024)
    filename: str = Field(max_length=500)
    version: str
    sha256: str = Field(pattern=r"^[a-fA-F0-9]{64}$")
    importedObjectIds: list[str] = Field(max_length=100000)
    importedTriggerCount: StrictInt = Field(ge=0, le=100000)
    baselineHash: str | None = None

class Project(Model):
    formatVersion: Literal[1]
    id: str = Field(min_length=1, max_length=200)
    name: str = Field(min_length=1, max_length=500)
    description: str = Field(max_length=50000)
    seed: StrictInt
    map: Map
    objects: list[MapObject] = Field(max_length=100000)
    story: list[StoryNode] = Field(max_length=1000)
    behavior: Behavior
    customAi: str | None = Field(default=None, max_length=1_000_000)
    native: NativeEnvelope | None = None
    createdAt: str
    updatedAt: str


def validate_project(data: dict) -> tuple[Project | None, list[dict]]:
    try:
        project = Project.model_validate(data)
    except ValidationError as exc:
        return None, [{"severity": "error", "code": "PROJECT_SCHEMA", "message":
                       f"{'.'.join(map(str, e['loc']))}: {e['msg']}"} for e in exc.errors()[:30]]
    diagnostics = []
    def issue(code, message, target=None, severity="error"):
        d = {"severity": severity, "code": code, "message": message}
        if target:
            d["targetId"] = target
        diagnostics.append(d)
    m = project.map
    if m.width != m.height or len(m.tiles) != m.width*m.height:
        issue("MAP_SHAPE", "Native maps must be square with exactly width × height tiles.")
    if project.native and project.native.version != SUPPORTED_VERSION:
        issue("NATIVE_VERSION", "Only ordinary DE scenario version 1.59 is tested.")
    ids = set()
    for obj in project.objects:
        if obj.id in ids:
            issue("OBJECT_ID", "Duplicate object ID.", obj.id)
        ids.add(obj.id)
        original_locked = bool(obj.locked and project.native and obj.id in project.native.importedObjectIds and obj.nativeReferenceId is not None)
        if not original_locked and (not 0 <= obj.x < m.width or not 0 <= obj.y < m.height):
            issue("OBJECT_BOUNDS", "Object is outside the map.", obj.id)
        if not original_locked and not 0 <= obj.rotation <= 360:
            issue("OBJECT_ROTATION", "Rotation must be 0 to 360 degrees.", obj.id)
        if not project.native and obj.nativeId not in ASSETS:
            issue("OBJECT_UNSUPPORTED", "New objects must use the curated native asset palette.", obj.id)
    object_by_id = {o.id: o for o in project.objects}
    story_ids = set()
    for node in project.story:
        if node.id in story_ids:
            issue("STORY_ID", "Duplicate story node ID.", node.id)
        story_ids.add(node.id)
        if node.kind in {"camera", "move"} and (not 0 <= node.x < m.width or not 0 <= node.y < m.height):
            issue("STORY_BOUNDS", "Story location is outside the map.", node.id)
        if node.kind == "move" and node.objectId not in ids:
            issue("STORY_OBJECT", "Move event needs an existing object.", node.id)
        if node.kind == "move" and node.objectId in object_by_id and object_by_id[node.objectId].player != node.player:
            issue("STORY_PLAYER", "Move event player must match the target object owner.", node.id)
        if node.kind == "move" and node.objectId in object_by_id and ASSETS.get(object_by_id[node.objectId].nativeId, ("", ""))[1] != "unit":
            issue("STORY_UNIT", "Move events require a supported unit target.", node.id)
        if node.kind == "dialogue" and node.duration < 1:
            issue("STORY_DURATION", "Dialogue duration must be positive.", node.id)
        if node.kind == "dialogue" and not node.text.strip():
            issue("STORY_TEXT", "Dialogue text is empty.", node.id)
    if not project.native and any(t.terrain not in TERRAINS for t in m.tiles):
        issue("TERRAIN_UNSUPPORTED", "New terrain must use the curated native terrain palette.")
    diagnostics.append({"severity": "warning", "code": "GAME_TEST_REQUIRED", "message":
                        "Native structure is checked, but game loading, pathfinding, and trigger playback require AoE2 DE."})
    return project, diagnostics
