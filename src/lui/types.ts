import type { GenerationOptions, MapObject, Project, StoryNode } from '../types';

export interface Region { x: number; y: number; width: number; height: number }
export type PlaceObject = Omit<MapObject, 'category' | 'nativeReferenceId' | 'locked'>;
export type LuiCommand =
  | { type: 'paint_terrain'; region: Region; terrain: number }
  | { type: 'set_elevation'; region: Region; elevation: number }
  | { type: 'place_objects'; objects: PlaceObject[] }
  | { type: 'move_objects'; moves: { id: string; x: number; y: number }[] }
  | { type: 'remove_objects'; ids: string[] }
  | ({ type: 'generate_map' } & GenerationOptions)
  | { type: 'add_story'; nodes: StoryNode[] }
  | { type: 'edit_story'; node: StoryNode }
  | { type: 'remove_story'; ids: string[] };
export interface DiffStats {
  terrainTiles: number; elevationTiles: number; objectsAdded: number; objectsMoved: number;
  objectsRemoved: number; storyAdded: number; storyEdited: number; storyRemoved: number;
  mapReplaced: boolean;
}
export interface CommandChange { label: string; detail: string; destructive: boolean }
export interface Proposal {
  baseRevision: string; commands: LuiCommand[]; next: Project; changes: CommandChange[];
  stats: DiffStats; warnings: string[]; destructive: boolean; selectedId: string | null;
}
export interface ConversationMessage { role: 'user' | 'assistant'; content: string }
export type ProviderPreset = 'deepseek' | 'openai' | 'custom';
/** Public local-session metadata only. Secrets never belong in renderer status. */
export interface ProviderStatus {
  configured: boolean;
  providerName: string;
  baseUrl: string;
  endpoint: string;
  model: string;
  preset: ProviderPreset;
  storage: 'session-memory';
  sessionRevision: number;
}
export const EMPTY_PROVIDER_STATUS: ProviderStatus = {
  configured: false, providerName: '', baseUrl: '', endpoint: '', model: '',
  preset: 'custom', storage: 'session-memory', sessionRevision: 0,
};
/** Rebuild an explicit allowlist instead of retaining arbitrary server fields. */
export function parseProviderStatus(data: unknown): ProviderStatus {
  if (!data || typeof data !== 'object') throw new Error('大模型服务状态响应无效。');
  const value = data as Record<string, unknown>;
  if (typeof value.configured !== 'boolean'
    || typeof value.providerName !== 'string' || value.providerName.length > 200
    || typeof value.baseUrl !== 'string' || value.baseUrl.length > 2048
    || typeof value.endpoint !== 'string' || value.endpoint.length > 2080
    || typeof value.model !== 'string' || value.model.length > 200
    || !['deepseek', 'openai', 'custom'].includes(value.preset as string)
    || value.storage !== 'session-memory'
    || !Number.isSafeInteger(value.sessionRevision) || (value.sessionRevision as number) < 0
    || (value.configured && (!value.providerName.trim() || !value.baseUrl || !value.model.trim()))) {
    throw new Error('大模型服务状态响应无效。');
  }
  if (value.baseUrl || value.endpoint) {
    let url: URL;
    try { url = new URL(value.baseUrl); } catch { throw new Error('大模型服务地址无效。'); }
    if (url.protocol !== 'https:' || url.username || url.password || url.search || url.hash
      || value.baseUrl.endsWith('/') || value.endpoint !== `${value.baseUrl}/chat/completions`) {
      throw new Error('大模型服务地址无效。');
    }
  }
  return {
    configured: value.configured, providerName: value.providerName,
    baseUrl: value.baseUrl, endpoint: value.endpoint, model: value.model,
    preset: value.preset as ProviderPreset, storage: value.storage,
    sessionRevision: value.sessionRevision as number,
  };
}
export interface ChatResponse {
  message: string; commands: unknown[]; toolResults: { name: string; ok: boolean; message: string }[];
  model: string; usage: { promptTokens: number; completionTokens: number }; rounds: number;
}
