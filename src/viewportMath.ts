/** Fit may legitimately be below the usual editing scale; zoom-out must never zoom in. */
export function nextZoom(current: number, factor: number): number {
  return Math.max(0.01, Math.min(3.5, current * factor));
}
