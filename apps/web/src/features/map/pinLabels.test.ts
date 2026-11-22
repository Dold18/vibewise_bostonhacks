import { expect, it } from 'vitest';
import { choosePinLabels } from './pinLabels';
import { mapStyle } from '../../mapStyle';
const bounds={left:0,top:0,right:1000,bottom:800};
const rect=(left:number,top:number,right=left+120,bottom=top+24)=>({left,top,right,bottom});
it('removes street and building names without removing geographic context',()=>{
  expect(mapStyle.layers.some(l=>l.id==='road-label')).toBe(false);
  expect(mapStyle.layers.some(l=>l.type==='symbol'&&'source-layer' in l&&l['source-layer']==='building')).toBe(false);
  expect(mapStyle.layers.some(l=>l.id==='water-label')).toBe(true);
});
it('shows separated names but suppresses colliding names in a dense cluster',()=>{
  expect([...choosePinLabels([{id:0,rect:rect(100,100),priority:0},{id:1,rect:rect(150,110),priority:0},{id:2,rect:rect(400,100),priority:0}],[],[],bounds)]).toEqual([0,2]);
});
it('hover/focus wins over quieter overlapping labels',()=>{
  expect([...choosePinLabels([{id:0,rect:rect(100,100),priority:0},{id:1,rect:rect(150,100),priority:3}],[],[],bounds)]).toEqual([1]);
});
it('keeps names clear of panels, other pins, and screen edges',()=>{
  expect([...choosePinLabels([{id:0,rect:rect(100,100),priority:0},{id:1,rect:rect(400,100),priority:0},{id:2,rect:rect(-5,200),priority:3}], [rect(410,110)], [rect(80,80,250,150)],bounds)]).toEqual([]);
});
it('allows one focused name above a packed group while preventing label-label collisions',()=>{
  expect([...choosePinLabels([{id:0,rect:rect(100,100),priority:3},{id:1,rect:rect(110,100),priority:0}],[rect(120,110)],[],bounds)]).toEqual([0]);
});
