import { expect, it } from 'vitest';
import { paddingAround } from './routeFrame';
it('reserves both desktop cards together on the left', () => {
  const c = {left:0,top:0,right:1440,bottom:900};
  expect(paddingAround(c,[{left:12,top:12,right:404,bottom:800},{left:416,top:12,right:808,bottom:500}]).left).toBeGreaterThanOrEqual(828);
});
it('reserves the mobile top and bottom sheets while leaving room for the route', () => {
  const p=paddingAround({left:0,top:0,right:390,bottom:844},[{left:8,top:8,right:382,bottom:400},{left:0,top:650,right:390,bottom:844}]);
  expect(p.top).toBeGreaterThan(400); expect(p.bottom).toBeGreaterThan(190); expect(p.top+p.bottom).toBeLessThan(844);
});
