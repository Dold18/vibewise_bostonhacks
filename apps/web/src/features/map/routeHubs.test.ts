import { expect, it, vi } from 'vitest';
import type { Map as MapLibreMap } from 'maplibre-gl';
import { createRouteHubs } from './routeHubs';
import type { RouteStation } from '../../transitRoute';
it('reuses physical station markers across panel toggles and removes every marker on exit', () => {
  const elements: {attrs:Map<string,string>;classes:Set<string>}[]=[];
  vi.stubGlobal('document',{createElement:()=>{
    const attrs=new Map<string,string>(),classes=new Set<string>();elements.push({attrs,classes});
    return {append:vi.fn(),setAttribute:(k:string,v:string)=>attrs.set(k,v),classList:{toggle:(k:string,on:boolean)=>on?classes.add(k):classes.delete(k)},style:{setProperty:vi.fn()}};
  }});
  const handles: {setLngLat:ReturnType<typeof vi.fn>;remove:ReturnType<typeof vi.fn>}[]=[];
  const add=vi.fn(()=>{const m={setLngLat:vi.fn(),remove:vi.fn()};handles.push(m);return m;});
  const hubs=createRouteHubs({} as MapLibreMap,add);
  const station: RouteStation={id:'park',name:'Park Street TEST FIXTURE',lat:42.356,lng:-71.062,role:'transfer',color:'#00843D'};
  hubs.update([station,station]);hubs.update([station]);
  expect(add).toHaveBeenCalledOnce();expect(elements[0].attrs.get('aria-label')).toContain('Transfer station');
  expect(elements[0].classes.has('is-transfer')).toBe(true);
  hubs.update([]);hubs.update([]);expect(handles[0].remove).toHaveBeenCalledOnce();
  hubs.update([station]);expect(add).toHaveBeenCalledTimes(2);
  vi.unstubAllGlobals();
});
