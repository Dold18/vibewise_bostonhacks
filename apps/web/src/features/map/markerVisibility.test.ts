import { expect, it } from 'vitest';
import { markerVisible, setMarkerVisible } from './markerVisibility';
it('restores discovery pins and hides search-only pins when focus ends', () => {
  expect(markerVisible('discovery','discovery','cafe',[])).toBe(true);
  expect(markerVisible('discovery','search','result',[])).toBe(false);
  expect(markerVisible('discovery','search','result',['result'])).toBe(true);
});
it('shows only relevant discovery endpoints and search results in Search', () => {
  expect(markerVisible('search','discovery','cafe',[])).toBe(false);
  expect(markerVisible('search','discovery','chosen',['chosen'])).toBe(true);
  expect(markerVisible('search','search','new-result',[])).toBe(true);
});
it('hides every ordinary pin during Navigation, including newly loaded/selected pins', () => {
  expect(markerVisible('navigation','discovery','chosen',['chosen'])).toBe(false);
  expect(markerVisible('navigation','search','result',[])).toBe(false);
});
it('hidden markers are inert, excluded from accessibility, and use the hit-testing class', () => {
  const classes=new Set<string>(),attrs=new Map<string,string>();
  const el={classList:{toggle:(c:string,b:boolean)=>b?classes.add(c):classes.delete(c)},inert:false,setAttribute:(k:string,v:string)=>attrs.set(k,v)};
  setMarkerVisible(el as unknown as HTMLElement,false);
  expect(el.inert).toBe(true);expect(classes.has('vb-marker-hidden')).toBe(true);expect(attrs.get('aria-hidden')).toBe('true');
  setMarkerVisible(el as unknown as HTMLElement,true);expect(el.inert).toBe(false);expect(classes.has('vb-marker-hidden')).toBe(false);
});
