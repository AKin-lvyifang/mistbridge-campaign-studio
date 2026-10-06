import { describe,expect,it } from 'vitest';
import { canAssignPreview,emptyNativeRender,nativeSpriteBounds,spriteKey,nativePixelCost } from '../src/nativeAssets';

describe('private native preview state',()=>{
 it('keys mappings by player and native unit, never object identity or guessed filename',()=>{
  expect(spriteKey({player:1,nativeId:109})).toBe('1:109');
  expect(spriteKey({player:2,nativeId:109})).toBe('2:109');
 });
 it('keeps the source hotspot grounded at any scale',()=>{
  const image={width:200,height:150} as HTMLImageElement;
  expect(nativeSpriteBounds({image,hotspot:[100,140],scale:.5,assetId:'opaque',label:'frame'},50,70)).toEqual({x:0,y:0,width:100,height:75,point:{x:50,y:70}});
 });
 it('bounds renderer decoded pixel storage and mapping counts',()=>{
  const state=emptyNativeRender();
  expect(nativePixelCost(state)).toBe(0);
  expect(canAssignPreview(state,{width:4096,height:4096} as any)).toBe(true);
  state.terrains[0]={width:4096,height:4096} as HTMLImageElement;
  expect(canAssignPreview(state,{width:1,height:1} as any)).toBe(false);
 });
 it('has no host path or persistent project extension',()=>{
  expect(emptyNativeRender()).toEqual({revision:'',sprites:{},terrains:{}});
 });
});
