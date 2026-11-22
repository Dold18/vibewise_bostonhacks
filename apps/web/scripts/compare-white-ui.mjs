import {readFileSync,writeFileSync} from 'node:fs';
import {inflateSync} from 'node:zlib';
function decodePng(buf) {
  let pos = 8, w = 0, h = 0, ct = 0; const idat = [];
  while (pos < buf.length) {
    const len = buf.readUInt32BE(pos), type = buf.toString('ascii', pos + 4, pos + 8), data = buf.subarray(pos + 8, pos + 8 + len);
    if (type === 'IHDR') { w = data.readUInt32BE(0); h = data.readUInt32BE(4); ct = data[9]; } else if (type === 'IDAT') idat.push(data); else if (type === 'IEND') break;
    pos += 12 + len;
  }
  const bpp = ct === 6 ? 4 : 3, stride = w * bpp, raw = inflateSync(Buffer.concat(idat)), px = Buffer.alloc(h * stride);
  for (let y = 0; y < h; y++) {
    const f = raw[y * (stride + 1)], o = y * (stride + 1) + 1;
    for (let x = 0; x < stride; x++) {
      const a = x >= bpp ? px[y * stride + x - bpp] : 0, b = y ? px[(y - 1) * stride + x] : 0, c = x >= bpp && y ? px[(y - 1) * stride + x - bpp] : 0;
      let v = raw[o + x];
      if (f === 1) v += a; else if (f === 2) v += b; else if (f === 3) v += (a + b) >> 1;
      else if (f === 4) { const p = a + b - c, pa = Math.abs(p - a), pb = Math.abs(p - b), pc = Math.abs(p - c); v += pa <= pb && pa <= pc ? a : pb <= pc ? b : c; }
      px[y * stride + x] = v & 255;
    }
  }
  return { w, h, bpp, px };
}

const before=process.argv[2],after=process.argv[3],out=process.argv[4];
const B=JSON.parse(readFileSync(before+'/ui.json')),A=JSON.parse(readFileSync(after+'/ui.json'));
const reports=B.ui.map((u,i)=>{
 const v=A.ui[i],b=decodePng(readFileSync(before+'/'+u.name+'.png')),a=decodePng(readFileSync(after+'/'+v.name+'.png'));
 const rects=u.tree.filter(t=>typeof t.cls==='string'&&['vb-tools-widget','vb-preferences-widget','account-btn','maplibregl-popup-content'].some(c=>t.cls.split(' ').includes(c))).map(t=>t.rect);
 let pixels=0,changed=0,maxDelta=0;
 for(let y=0;y<b.h;y++)for(let x=0;x<b.w;x++){
  if(!rects.some(([rx,ry,rw,rh])=>x>=rx+20&&x<rx+rw-20&&y>=ry+20&&y<ry+rh-20))continue;
  pixels++;const bi=(y*b.w+x)*b.bpp,ai=(y*a.w+x)*a.bpp;let delta=0;
  for(let k=0;k<3;k++)delta=Math.max(delta,Math.abs(b.px[bi+k]-a.px[ai+k]));
  if(delta>3)changed++;maxDelta=Math.max(maxDelta,delta);
 }
 return {state:u.name,domIdentical:JSON.stringify(u.tree)===JSON.stringify(v.tree),comparedUiPixels:pixels,changedPixels:changed,changedPercent:+(100*changed/pixels).toFixed(4),maxDelta};
});
writeFileSync(out,JSON.stringify({screenshots:'Map pixels excluded; opaque UI interiors inset by 20 px to exclude rounded corners, widget margins and map-backed shadows',reports},null,2));console.log(reports);
