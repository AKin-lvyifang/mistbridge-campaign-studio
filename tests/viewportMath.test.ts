import { describe, expect, it } from 'vitest';
import { nextZoom } from '../src/viewportMath';
describe('viewport zoom bounds',()=>{
 it('zooms out from a 12% fit without jumping inward',()=>expect(nextZoom(.12,.8)).toBeCloseTo(.096));
 it('supports low fit scales on large maps',()=>expect(nextZoom(.02,.8)).toBeCloseTo(.016));
 it('stops at the minimum without reversing direction',()=>expect(nextZoom(.01,.8)).toBe(.01));
 it('caps detailed inspection zoom',()=>expect(nextZoom(3.4,1.25)).toBe(3.5));
 it('preserves normal multiplicative zoom',()=>expect(nextZoom(.4,1.25)).toBe(.5));
});
