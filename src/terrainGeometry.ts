import type { MapObject, Project } from './types';

export const TILE_WIDTH = 38;
export const TILE_HEIGHT = 19;
export const ELEVATION_HEIGHT = 9;
export const MAX_ELEVATION = 16;
export interface Point { x: number; y: number }
export interface Vertex extends Point { z: number }
export interface SurfaceTriangle { vertices: [Vertex, Vertex, Vertex]; points: [Point, Point, Point]; tileX: number; tileY: number; shade: number; bounds:{minX:number;maxX:number;minY:number;maxY:number}; maxDepth:number }
export interface HeightField { map: Project['map']; corners: Float32Array; minElevation:number; maxElevation:number }
export type ElevationMode = 'raise' | 'lower' | 'level';
export const projectVertex = ({x,y,z}: Vertex): Point => ({x:(x-y)*TILE_WIDTH/2,y:(x+y)*TILE_HEIGHT/2-z*ELEVATION_HEIGHT});
export function createHeightField(map: Project['map']): HeightField {
  const corners = new Float32Array((map.width+1)*(map.height+1));
  for(let y=0;y<=map.height;y++) for(let x=0;x<=map.width;x++) {
    let sum=0,count=0;
    for(let dy=-1;dy<=0;dy++) for(let dx=-1;dx<=0;dx++) {
      const tx=x+dx,ty=y+dy;
      if(tx>=0&&ty>=0&&tx<map.width&&ty<map.height){sum+=map.tiles[ty*map.width+tx].elevation;count++;}
    }
    corners[y*(map.width+1)+x]=sum/count;
  }
  let minElevation=MAX_ELEVATION,maxElevation=0;for(const tile of map.tiles){minElevation=Math.min(minElevation,tile.elevation);maxElevation=Math.max(maxElevation,tile.elevation);}return {map,corners,minElevation,maxElevation};
}
export function tileVertices(field:HeightField,x:number,y:number):[Vertex,Vertex,Vertex,Vertex,Vertex] {
  const stride=field.map.width+1,c=field.corners;
  return [{x,y,z:c[y*stride+x]}, {x:x+1,y,z:c[y*stride+x+1]}, {x:x+1,y:y+1,z:c[(y+1)*stride+x+1]}, {x,y:y+1,z:c[(y+1)*stride+x]}, {x:x+.5,y:y+.5,z:field.map.tiles[y*field.map.width+x].elevation}];
}
export function slopeShade(a:Vertex,b:Vertex,c:Vertex):number {
  const ux=b.x-a.x,uy=b.y-a.y,uz=(b.z-a.z)*.65,vx=c.x-a.x,vy=c.y-a.y,vz=(c.z-a.z)*.65;
  let nx=uy*vz-uz*vy,ny=uz*vx-ux*vz,nz=ux*vy-uy*vx;
  if(nz<0){nx=-nx;ny=-ny;nz=-nz;}
  const length=Math.hypot(nx,ny,nz)||1;
  // A fixed north-west key light: slopes remain legible without altering native heights.
  return Math.max(-38,Math.min(23,((nx*-.48+ny*-.30+nz*.825)/length-.825)*68));
}
const meshCache=new WeakMap<HeightField,Map<number,SurfaceTriangle[]>>();
export function tileTriangles(field:HeightField,x:number,y:number):SurfaceTriangle[] {
  let cache=meshCache.get(field);if(!cache){cache=new Map();meshCache.set(field,cache);}const key=y*field.map.width+x,stored=cache.get(key);if(stored)return stored;
  const v=tileVertices(field,x,y),triangles:SurfaceTriangle[]=[];
  for(let i=0;i<4;i++){const vertices:[Vertex,Vertex,Vertex]=[v[i],v[(i+1)%4],v[4]],a=projectVertex(vertices[0]),b=projectVertex(vertices[1]),c=projectVertex(vertices[2]);triangles.push({vertices,points:[a,b,c],tileX:x,tileY:y,shade:slopeShade(...vertices),bounds:{minX:Math.min(a.x,b.x,c.x),maxX:Math.max(a.x,b.x,c.x),minY:Math.min(a.y,b.y,c.y),maxY:Math.max(a.y,b.y,c.y)},maxDepth:x+y+(i===0||i===3?1:2)});}
  // Bound memory on 480×480 maps; distant overview tiles need not stay resident.
  if(cache.size>=16000)cache.delete(cache.keys().next().value!);
  cache.set(key,triangles);return triangles;
}
export function barycentric(p:Point,a:Point,b:Point,c:Point):[number,number,number]|null {
  const det=(b.y-c.y)*(a.x-c.x)+(c.x-b.x)*(a.y-c.y);
  if(Math.abs(det)<1e-8)return null;
  const u=((b.y-c.y)*(p.x-c.x)+(c.x-b.x)*(p.y-c.y))/det,v=((c.y-a.y)*(p.x-c.x)+(a.x-c.x)*(p.y-c.y))/det,w=1-u-v;
  return u>=-1e-7&&v>=-1e-7&&w>=-1e-7?[u,v,w]:null;
}
export function surfaceHeight(field:HeightField,x:number,y:number):number {
  x=Math.max(0,Math.min(field.map.width-1e-7,x));y=Math.max(0,Math.min(field.map.height-1e-7,y));
  const tx=Math.floor(x),ty=Math.floor(y),u=x-tx,v=y-ty,vertices=tileVertices(field,tx,ty),i=u>=v?(u+v<=1?0:1):(u+v>=1?2:3),triangle=[vertices[i],vertices[(i+1)%4],vertices[4]],weights=barycentric({x,y},triangle[0],triangle[1],triangle[2]);
  if(weights)return weights[0]*triangle[0].z+weights[1]*triangle[1].z+weights[2]*triangle[2].z;
  return 0;
}
export interface TerrainHit extends Point { worldX:number; worldY:number; elevation:number; depth:number }
/** Ray picking tests the visible projected triangles, including all 16 native levels. */
export function pickTerrain(field:HeightField,p:Point):TerrainHit|null {
  const baseX=p.y/TILE_HEIGHT+p.x/TILE_WIDTH,baseY=p.y/TILE_HEIGHT-p.x/TILE_WIDTH;
  const reach=Math.ceil(MAX_ELEVATION*ELEVATION_HEIGHT/TILE_HEIGHT)+2;
  let result:TerrainHit|null=null;
  for(let y=Math.max(0,Math.floor(baseY)-1);y<=Math.min(field.map.height-1,Math.floor(baseY)+reach);y++) {
    // A viewing ray has constant x-y. Only a narrow band of candidates can intersect it.
    const projectedX=baseX+(y-baseY);
    for(let x=Math.max(0,Math.floor(projectedX)-2);x<=Math.min(field.map.width-1,Math.floor(projectedX)+2);x++) {
      for(const triangle of tileTriangles(field,x,y)){
        const weights=barycentric(p,...triangle.points);if(!weights)continue;
        const worldX=weights.reduce((v,w,i)=>v+w*triangle.vertices[i].x,0),worldY=weights.reduce((v,w,i)=>v+w*triangle.vertices[i].y,0),depth=worldX+worldY;
        if(!result||depth>result.depth+1e-7)result={x,y,worldX,worldY,elevation:weights.reduce((v,w,i)=>v+w*triangle.vertices[i].z,0),depth};
      }
    }
  }
  return result;
}
/** Clip a terrain triangle at an object's depth plane, for accurate hill occlusion. */
export function foregroundPolygon(triangle:SurfaceTriangle,depth:number):Point[] {
  let output:Vertex[]=[];
  for(let i=0;i<3;i++){
    const a=triangle.vertices[i],b=triangle.vertices[(i+1)%3],da=a.x+a.y-depth,db=b.x+b.y-depth;
    if(da>1e-5)output.push(a);
    if((da>1e-5)!==(db>1e-5)){const t=da/(da-db);output.push({x:a.x+(b.x-a.x)*t,y:a.y+(b.y-a.y)*t,z:a.z+(b.z-a.z)*t});}
  }
  return output.map(projectVertex);
}
export function objectGround(field:HeightField,o:MapObject):Vertex {return {x:o.x,y:o.y,z:surfaceHeight(field,o.x,o.y)};}
export function brushCells(map:Project['map'],center:Point,radius:number):Point[] {
  const cells:Point[]=[],r=Math.max(0,Math.floor(radius)-1);
  for(let dy=-r;dy<=r;dy++)for(let dx=-r;dx<=r;dx++){const x=center.x+dx,y=center.y+dy;if(x>=0&&y>=0&&x<map.width&&y<map.height&&dx*dx+dy*dy<=r*r+.1)cells.push({x,y});}
  return cells;
}
/** A cell changes once per stroke. Repeated pointer events never amplify one brush pass. */
export function editElevation(map:Project['map'],center:Point,radius:number,mode:ElevationMode,target:number,touched:Set<number>):Project['map'] {
  const changes=new Map<number,number>();
  for(const {x,y} of brushCells(map,center,radius)){
    const index=y*map.width+x;if(touched.has(index))continue;touched.add(index);
    const before=map.tiles[index].elevation,after=Math.max(0,Math.min(MAX_ELEVATION,mode==='level'?Math.round(target):before+(mode==='raise'?1:-1)));
    if(before!==after)changes.set(index,after);
  }
  if(!changes.size)return map;
  return {...map,tiles:map.tiles.map((tile,index)=>changes.has(index)?{...tile,elevation:changes.get(index)!}:tile)};
}
export function interpolateStroke(a:Point,b:Point):Point[] {
  const steps=Math.max(Math.abs(b.x-a.x),Math.abs(b.y-a.y)),points:Point[]=[];
  for(let i=0;i<=steps;i++){const t=steps?i/steps:0;points.push({x:Math.round(a.x+(b.x-a.x)*t),y:Math.round(a.y+(b.y-a.y)*t)});}
  return points;
}
/** Native building footprints are measured in map cells, never sprite pixels. */
export function footprintHeights(map:Project['map'],o:Pick<MapObject,'x'|'y'>,size:number):{min:number;max:number} {
  let min=MAX_ELEVATION,max=0;
  for(let y=Math.max(0,Math.floor(o.y-size/2));y<Math.min(map.height,Math.ceil(o.y+size/2));y++)for(let x=Math.max(0,Math.floor(o.x-size/2));x<Math.min(map.width,Math.ceil(o.x+size/2));x++){
    const h=map.tiles[y*map.width+x].elevation;min=Math.min(min,h);max=Math.max(max,h);
  }
  return {min,max};
}
