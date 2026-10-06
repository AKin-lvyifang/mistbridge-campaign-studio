import { describe, expect, it } from 'vitest';
import { nextZoom, cancelsActiveStroke } from '../src/viewportMath';
describe('viewport zoom bounds',()=>{
 it('zooms out from a 12% fit without jumping inward',()=>expect(nextZoom(.12,.8)).toBeCloseTo(.096));
 it('supports low fit scales on large maps',()=>expect(nextZoom(.02,.8)).toBeCloseTo(.016));
 it('stops at the minimum without reversing direction',()=>expect(nextZoom(.01,.8)).toBe(.01));
 it('caps detailed inspection zoom',()=>expect(nextZoom(3.4,1.25)).toBe(3.5));
 it('preserves normal multiplicative zoom',()=>expect(nextZoom(.4,1.25)).toBe(.5));
});

describe('unfinished gesture cancellation',()=>{
 it.each(['z','Z','y'])('captures document undo/redo %s while a gesture is active',key=>{expect(cancelsActiveStroke({key,ctrlKey:true,metaKey:false,isComposing:false})).toBe(true);expect(cancelsActiveStroke({key,ctrlKey:false,metaKey:true,isComposing:false})).toBe(true);});
 it('keeps IME composition independent',()=>expect(cancelsActiveStroke({key:'z',ctrlKey:true,metaKey:false,isComposing:true})).toBe(false));
 it('does not cancel for ordinary typing',()=>expect(cancelsActiveStroke({key:'z',ctrlKey:false,metaKey:false,isComposing:false})).toBe(false));
});
