export type Tool = 'select' | 'terrain' | 'object' | 'erase' | 'pan';
export interface Tile { terrain: number; elevation: number }
export interface MapObject { id: string; nativeId: number; player: number; x: number; y: number; rotation: number; label: string; category: 'unit'|'building'|'decoration'; nativeReferenceId?: number; locked?: boolean }
export interface StoryNode { id: string; name: string; enabled: boolean; delay: number; kind: 'dialogue'|'camera'|'move'|'victory'; text: string; player: number; x: number; y: number; objectId?: string; duration: number }
export interface BehaviorProfile { player: number; name: string; villagers: number; military: number; attackTime: number; aggression: 'defend'|'balanced'|'attack' }
export interface NativeEnvelope { originalBase64: string; filename: string; version: string; sha256: string; importedObjectIds: string[]; importedTriggerCount: number; baselineHash?: string }
export interface Project { formatVersion: 1; id: string; name: string; description: string; seed: number; map: { width: number; height: number; tiles: Tile[] }; objects: MapObject[]; story: StoryNode[]; behavior: BehaviorProfile; customAi?: string; native?: NativeEnvelope; createdAt: string; updatedAt: string }
export interface Asset { id: number; name: string; english: string; category: 'unit'|'building'|'decoration'; icon: string; size: number; color: string }
export interface TerrainDefinition { id: number; name: string; color: string; detail: string; passable: boolean }
export interface Diagnostic { severity: 'error'|'warning'|'info'; code: string; message: string; targetId?: string }
export interface GenerationOptions { seed: number; size: number; theme: 'river'|'highland'|'coast'; forest: number }
export interface NativeSummary { version: string; width: number; height: number; objects: number; triggers: number; sha256: string }
