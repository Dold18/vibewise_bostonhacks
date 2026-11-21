#!/usr/bin/env node
/**
 * Download an optional, budget-limited bundle of genuine CC0 PBR textures
 * from Poly Haven's official API into Vibenta's public assets directory.
 *
 * USAGE:
 *   node scripts/import-polyhaven-textures.mjs --dry-run
 *   node scripts/import-polyhaven-textures.mjs --limit 12 --max-mb 25
 *
 * This is a developer-time fetch, NOT a client-facing runtime API integration.
 * The API requires a custom User-Agent. Always retain origin and hash metadata.
 * Required runtime material rendering remains separate from this importer.
 */
import fs from "node:fs/promises";
import path from "node:path";
import crypto from "node:crypto";
import { fileURLToPath } from "node:url";

const HERE=path.dirname(fileURLToPath(import.meta.url));
const OUT=path.resolve(HERE,"../apps/web/public/scene-assets/cc0/polyhaven");
const API="https://api.polyhaven.com/files/";
const AGENT="VibentaBostonHacks/1.0 (github.com/Dold18/vibenta_bostonhacks)";
const IDS=[
 "brick_wall_001","brick_wall_07","worn_brick_wall",
 "red_bricks_04","brown_brick_02","white_bricks","sandstone_blocks_04",
 "plastered_wall_05","exterior_wall_cladding",
 "asphalt_01","asphalt_02","aerial_asphalt_01","clean_asphalt",
 "dirty_concrete","concrete_floor_01","concrete_pavement_03",
 "leafy_grass","aerial_beach_01","stone_brick_wall_001",
 "wood_floor_deck","wood_planks","paving_stones_04"
];
const args=process.argv.slice(2);
function option(name,def){const i=args.indexOf(name);return i<0?def:Number(args[i+1]);}
const dry=args.includes("--dry-run");
const limit=Math.max(1,Math.min(IDS.length,option("--limit",12)));
const totalBudget=Math.max(1,option("--max-mb",25))*1024*1024;
const maxIndividual=3*1024*1024;
const resolution="1k";

function flatten(node, keys=[],out=[]){
  if (!node || typeof node!=="object") return out;
  if (typeof node.url==="string" && /^https:\/\/dl\.polyhaven\.org\//.test(node.url)){
    out.push({url:node.url,size:node.size,md5:node.md5,branch:keys.join("/")});
    return out;
  }
  for (const [key,value] of Object.entries(node))flatten(value,[...keys,key],out);
  return out;
}
function pick(files,kind){
  const suffix=kind==="albedo"?/_(diff|col|basecolor)_1k\.(jpg|png|webp)$/i:
    kind==="normal"?/_nor_gl_1k\.(jpg|png|webp)$/i:
    /_rough_1k\.(jpg|png|webp)$/i;
  const filtered=files.filter(f=>suffix.test(new URL(f.url).pathname))
    .filter(f=>!(typeof f.size==="number" && f.size>maxIndividual))
    .sort((a,b)=>(a.url.endsWith(".jpg")?-1:1)-(b.url.endsWith(".jpg")?-1:1));
  return filtered[0] || null;
}
async function requestJSON(url){
  const response=await fetch(url,{headers:{"User-Agent":AGENT,"Accept":"application/json"}});
  if(!response.ok)throw Error("HTTP "+response.status+" "+url);
  return response.json();
}
const manifest={version:1,source:"Poly Haven",sourceApi:"https://api.polyhaven.com",
  license:"CC0-1.0",licenseUrl:"https://polyhaven.com/license",
  note:"Downloaded material assets are genuine CC0 files. API credit applies only when building on the LIVE API. This is an offline importer.",
  resolution,files:[],skipped:[],runTimestamp:new Date().toISOString()};
let used=0;
await fs.mkdir(OUT,{recursive:true});
for (const id of IDS.slice(0,limit)){
 try {
  const tree=await requestJSON(API+encodeURIComponent(id));
  const all=flatten(tree);
  const requested=["albedo","normal","roughness"].map(k=>({kind:k,file:pick(all,k)})).filter(x=>x.file);
  if(requested.length===0)throw Error("No matching released 1K material files");
  for(const {kind,file} of requested){
    if(typeof file.size==="number" && used+file.size>totalBudget) {manifest.skipped.push({id,kind,reason:"budget"});continue;}
    if(dry){console.log("PLAN",id,kind,file.url,file.size||"?");continue;}
    const response=await fetch(file.url,{headers:{"User-Agent":AGENT}});
    if(!response.ok)throw Error("Download HTTP "+response.status);
    const bytes=Buffer.from(await response.arrayBuffer());
    if(bytes.length>maxIndividual || used+bytes.length>totalBudget){manifest.skipped.push({id,kind,reason:"size_or_budget"});continue;}
    if(file.md5 && crypto.createHash("md5").update(bytes).digest("hex")!==file.md5)throw Error("MD5 mismatch for "+id+" "+kind);
    const ext=path.extname(new URL(file.url).pathname).toLowerCase();
    const dir=path.join(OUT,id);await fs.mkdir(dir,{recursive:true});
    const dest=path.join(dir,kind+ext);
    await fs.writeFile(dest,bytes);
    used+=bytes.length;
    const sha256=crypto.createHash("sha256").update(bytes).digest("hex");
    manifest.files.push({id,kind,path:path.relative(OUT,dest).replaceAll("\\","/"),
      sourceUrl:file.url,sourcePage:"https://polyhaven.com/a/"+id,
      bytes:bytes.length,sha256,md5:file.md5||null});
    console.log("DOWNLOADED",id,kind,bytes.length,"bytes");
  }
 } catch(e){manifest.skipped.push({id,reason:String(e.message)});console.warn("SKIP",id,e.message);}
 await new Promise(r=>setTimeout(r,350));
}
if(dry){console.log("Dry run complete; no materials downloaded.");}
else {
 await fs.writeFile(path.join(OUT,"manifest.json"),JSON.stringify(manifest,null,2)+"\n");
 console.log("Downloaded",manifest.files.length,"maps;",(used/(1024*1024)).toFixed(2),"MiB");
}
