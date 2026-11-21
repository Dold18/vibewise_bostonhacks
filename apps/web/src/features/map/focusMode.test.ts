import { expect, it, vi } from 'vitest';
import type { Map as MapLibreMap } from 'maplibre-gl';
import { createFocusController, deriveFocusMode, FOCUS_LAYER } from './focusMode';
it('gives Navigation priority over Search', () => {
  expect(deriveFocusMode({navigationOpen:true,searchOpen:true})).toBe('navigation');
  expect(deriveFocusMode({navigationOpen:false,searchOpen:true})).toBe('search');
});
it('uses a separate layer below routes and changes the camera only for navigation', () => {
  vi.stubGlobal('document',{body:{dataset:{}}});
  const layers: {id:string;type:string}[]=[{id:'road',type:'line'},{id:'transit-route-ride',type:'line'},{id:'label',type:'symbol'}];
  const sources = new Set<string>(); const events = new Map<string,()=>void>();
  const map={isStyleLoaded:()=>true,getStyle:()=>({layers}),getSource:(s:string)=>sources.has(s),getLayer:(s:string)=>layers.find(l=>l.id===s),
    addSource:(s:string)=>sources.add(s),addLayer:vi.fn((l:{id:string;type:string},before:string)=>layers.splice(layers.findIndex(x=>x.id===before),0,l)),
    setPaintProperty:vi.fn(), moveLayer:vi.fn(),on:(e:string,f:()=>void)=>events.set(e,f),off:vi.fn()};
  const pitch={lock:vi.fn(),unlock:vi.fn()};const controller=createFocusController(map as unknown as MapLibreMap,pitch);
  // Tile loading after camera movement does not make an installed style uneditable.
  map.isStyleLoaded=()=>false;
  controller.apply({navigationOpen:false,searchOpen:true});
  expect(pitch.lock).not.toHaveBeenCalled(); expect(map.setPaintProperty).toHaveBeenLastCalledWith(FOCUS_LAYER,'fill-opacity',.44);
  controller.apply({navigationOpen:true,searchOpen:true});controller.apply({navigationOpen:true,searchOpen:false});
  expect(pitch.lock).toHaveBeenCalledOnce();expect(layers.findIndex(l=>l.id===FOCUS_LAYER)).toBeLessThan(layers.findIndex(l=>l.id==='transit-route-ride'));
  controller.apply({navigationOpen:false,searchOpen:false}); expect(pitch.unlock).toHaveBeenCalledOnce();
  layers.splice(layers.findIndex(l=>l.id===FOCUS_LAYER),1);sources.clear();events.get('style.load')!();
  expect(map.addLayer).toHaveBeenCalledTimes(2);vi.unstubAllGlobals();
});
