import { describe, expect, it } from 'vitest';
import { brushCells, createHeightField, editElevation, footprintHeights, foregroundPolygon, interpolateStroke, objectGround, pickTerrain, projectVertex, slopeShade, surfaceHeight, tileTriangles, tileVertices } from '../src/terrainGeometry';
import { objectBounds, objectDepth } from '../src/terrainRendering';
import type { MapObject, Project } from '../src/types';
const map=(width=8,height=8,z=0):Project['map']=>({width,height,tiles:Array.from({length:width*height},()=>({terrain:0,elevation:z}))});
const object=(x:number,y:number):MapObject=>({id:'test',nativeId:93,player:1,x,y,rotation:0,label:'test',category:'unit'});

describe('continuous native-height surface',()=>{
 it('retains exact native height at every tile center',()=>{const m=map();m.tiles.forEach((t,i)=>t.elevation=i%17);const f=createHeightField(m);for(let y=0;y<m.height;y++)for(let x=0;x<m.width;x++)expect(surfaceHeight(f,x+.5,y+.5)).toBe(m.tiles[y*m.width+x].elevation);});
 it('shares edge vertices and interpolated heights, with no gaps between slopes',()=>{const m=map();m.tiles[3*m.width+3].elevation=6;const f=createHeightField(m),left=tileVertices(f,3,3),right=tileVertices(f,4,3);expect(left[1]).toEqual(right[0]);expect(left[2]).toEqual(right[3]);expect(surfaceHeight(f,4-1e-8,3.4)).toBeCloseTo(surfaceHeight(f,4+1e-8,3.4),6);});
 it('uses a constant-height plateau rather than extruding each tile',()=>{const f=createHeightField(map(4,4,6));for(const v of tileVertices(f,2,2))expect(v.z).toBe(6);expect(surfaceHeight(f,1.2,2.7)).toBeCloseTo(6);});
 it('clamps boundary sampling without NaN at the map corners',()=>{const f=createHeightField(map(4,4,3));for(const [x,y] of [[0,0],[4,4],[-2,-2],[100,100]])expect(surfaceHeight(f,x,y)).toBeCloseTo(3);});
 it('projects height as actual vertical geometry',()=>{const low=projectVertex({x:4,y:4,z:0}),high=projectVertex({x:4,y:4,z:8});expect(high.x).toBe(low.x);expect(low.y-high.y).toBe(72);});
 it('lights opposite slopes differently',()=>{const light=slopeShade({x:0,y:0,z:0},{x:1,y:0,z:1},{x:0,y:1,z:0});const dark=slopeShade({x:0,y:0,z:1},{x:1,y:0,z:0},{x:0,y:1,z:1});expect(light).toBeGreaterThan(dark);});
});

describe('height-aware picking and occlusion',()=>{
 it.each([0,1,4,8,16])('picks tile centers at native height %s',z=>{const f=createHeightField(map(20,20,z)),p=projectVertex({x:12.5,y:11.5,z}),hit=pickTerrain(f,p);expect(hit?.x).toBe(12);expect(hit?.y).toBe(11);expect(hit?.elevation).toBeCloseTo(z);});
 it('picks the foremost intersecting surface rather than a hidden lower tile',()=>{const m=map(20,20);for(let y=7;y<12;y++)for(let x=7;x<12;x++)m.tiles[y*m.width+x].elevation=8;const f=createHeightField(m),point=projectVertex({x:8.5,y:8.5,z:8}),hit=pickTerrain(f,point);expect(hit?.depth).toBeCloseTo(17);expect(hit?.x).toBe(8);expect(hit?.y).toBe(8);});
 it('returns no tile for empty space',()=>expect(pickTerrain(createHeightField(map()),{x:10000,y:-1000})).toBeNull());
 it('grounds fractional object positions on the same rendered triangles',()=>{const m=map();m.tiles[3*8+3].elevation=4;const f=createHeightField(m),o=object(3.3,3.7);expect(objectGround(f,o).z).toBe(surfaceHeight(f,o.x,o.y));expect(objectGround(f,object(3.5,3.5)).z).toBe(4);});
 it('clips terrain at the object depth plane',()=>{const f=createHeightField(map()),triangle=tileTriangles(f,3,3)[1];expect(foregroundPolygon(triangle,100)).toEqual([]);expect(foregroundPolygon(triangle,0)).toHaveLength(3);const clipped=foregroundPolygon(triangle,7);expect(clipped.length).toBeGreaterThanOrEqual(3);for(const p of clipped)expect(p.y).toBeGreaterThanOrEqual(7*19/2-1e-5);});
});

describe('undoable elevation brush transactions',()=>{
 it('does not mutate the original map and preserves terrain IDs',()=>{const m=map(),before=JSON.stringify(m);m.tiles[27].terrain=24;const saved=JSON.stringify(m),next=editElevation(m,{x:3,y:3},1,'raise',0,new Set());expect(next.tiles[27]).toEqual({terrain:24,elevation:1});expect(JSON.stringify(m)).toBe(saved);expect(before).not.toBe(saved);expect(next.tiles[0]).toBe(m.tiles[0]);});
 it('changes each cell only once within a stroke, then supports another stroke',()=>{const touched=new Set<number>(),m=map(),one=editElevation(m,{x:3,y:3},2,'raise',0,touched),repeated=editElevation(one,{x:3,y:3},2,'raise',0,touched);expect(repeated).toBe(one);const two=editElevation(one,{x:3,y:3},1,'raise',0,new Set());expect(two.tiles[27].elevation).toBe(2);});
 it('clamps raise/lower at the native 0–16 range without an empty history edit',()=>{const low=map(),high=map(8,8,16);expect(editElevation(low,{x:3,y:3},1,'lower',0,new Set())).toBe(low);expect(editElevation(high,{x:3,y:3},1,'raise',0,new Set())).toBe(high);});
 it('levels a circle to an integer native height',()=>{const next=editElevation(map(),{x:3,y:3},2,'level',7,new Set());expect(next.tiles.filter(t=>t.elevation===7)).toHaveLength(5);});
 it('clips brush cells to map boundaries',()=>{const cells=brushCells(map(),{x:0,y:0},3);expect(cells.every(p=>p.x>=0&&p.y>=0)).toBe(true);expect(cells).toHaveLength(6);});
 it('interpolates fast pointer movement without holes',()=>expect(interpolateStroke({x:1,y:1},{x:5,y:3})).toEqual([{x:1,y:1},{x:2,y:2},{x:3,y:2},{x:4,y:3},{x:5,y:3}]));
 it('reports native footprint height variation without flattening the map',()=>{const m=map();m.tiles[3*8+3].elevation=5;expect(footprintHeights(m,object(3.5,3.5),2)).toEqual({min:0,max:5});expect(m.tiles[27].elevation).toBe(5);});
});

describe('building volume and screen bounds',()=>{
 it('keeps the whole town-center front facade selectable',()=>{const f=createHeightField(map(20,20)),o={...object(10.5,10.5),nativeId:109,category:'building' as const},bounds=objectBounds(o,f);expect(bounds.y+bounds.height).toBeGreaterThan(bounds.point.y+30.4);expect(objectDepth(o)).toBeCloseTo(o.x+o.y+3.2);});
 it('does not shift unit or tree depth to a building footprint',()=>{const o=object(4.5,3.5);expect(objectDepth(o)).toBe(8);expect(objectDepth({...o,category:'decoration',nativeId:349})).toBe(8);});
});
