/** Fit may legitimately be below the usual editing scale; zoom-out must never zoom in. */
export function nextZoom(current: number, factor: number): number {
  return Math.max(0.01, Math.min(3.5, current * factor));
}

/** Undo cancels an unfinished gesture before the document undo stack is touched. */
export function cancelsActiveStroke(event:Pick<KeyboardEvent,'key'|'ctrlKey'|'metaKey'|'isComposing'>):boolean {
  return !event.isComposing&&(event.key==='Escape'||((event.metaKey||event.ctrlKey)&&['z','y'].includes(event.key.toLowerCase())));
}
