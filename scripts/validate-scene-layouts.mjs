#!/usr/bin/env node
/**
 * Vibenta independent scene-layout validation.
 * Run: node scripts/validate-scene-layouts.mjs
 * Checks manifests, on-disk references and authored transforms.
 * NOT a visual, GPU, map collision, license-legal or performance test.
 */
import fs from 'node:fs/promises';
import path from 'node:path';
import {fileURLToPath} from 'node:url';
const root=path.resolve(path.dirname(fileURLToPath(import.meta.url)),'..');
const publicRoot=path.join(root,'apps','web','public');
const base=path.join(publicRoot,'scene-assets','third-party');
const read=async p=>JSON.parse(await fs.readFile(p,'utf8'));
const [modelibr,kaykit,layouts,recipes]=await Promise.all([
 read(path.join(base,'modelibr','manifest.v1.json')),
 read(path.join(base,'kaykit','manifest.v1.json')),
 read(path.join(base,'composites','layouts.v1.json')),
 read(path.join(base,'composites','recipes.v1.json'))
]);
const errors=[],warnings=[];
const fail=(ok,msg)=>{if(!ok)errors.push(msg);};
const ids=new Map();
for(const model of [...modelibr.models,...kaykit.models]){
 fail(!ids.has(model.id),'duplicate model ID: '+model.id);ids.set(model.id,model);
}
const defined=new Set(),used=new Set();
fail(layouts.compositionCount===layouts.scenes.length,'layout count mismatch');
fail(layouts.scenes.length>=30&&layouts.scenes.length<=50,'layout count should be 30–50');
fail(layouts.slotCount===2,'layout slot count must be 2');
fail(modelibr.models.length===modelibr.modelCount,'modelibr model count mismatch');
fail(kaykit.models.length===kaykit.modelCount,'kaykit model count mismatch');
let placements=0,checked=0;
for(const s of layouts.scenes){
 fail(typeof s.id==='string'&&s.id.length>0&&!defined.has(s.id),'duplicate/missing scene ID '+s.id);
 defined.add(s.id);
 fail(!!s.context&&!!s.mood,'scene must include context and mood: '+s.id);
 fail(['explicit_or_verified_context','vibe_selected','user_opt_in'].includes(s.activation),'unrecognized activation: '+s.id);
 const slots=s.slots||{};
 fail(Object.keys(slots).sort().join('|')==='ambient_accent|hero_installation','wrong slot structure: '+s.id);
 fail(s.displayPolicy?.fictionalDecoration===true,'fictional decoration flag absent: '+s.id);
 fail(s.displayPolicy?.focusMode==='hide','focus mode must hide: '+s.id);
 fail(s.displayPolicy?.occlusionFallback==='hide_both_slots','must not block map: '+s.id);
 for(const [role,slot] of Object.entries(slots)){
  fail(Array.isArray(slot.center)&&slot.center.length===3&&slot.center.every(Number.isFinite),'bad center: '+s.id+' '+role);
  fail(Number.isFinite(slot.radius)&&slot.radius>0,'bad radius: '+s.id+' '+role);
  fail(Array.isArray(slot.placements)&&slot.placements.length<=5,'too many props: '+s.id+' '+role);
  for(const p of slot.placements||[]){
   placements++; used.add(p.assetId);
   fail(p.slot===role,'wrong slot in '+s.id+': '+p.assetId);
   fail(ids.has(p.assetId),'unimported model ID: '+s.id+' '+p.assetId);
   fail(Array.isArray(p.position)&&p.position.length===3&&p.position.every(Number.isFinite),'bad position: '+s.id);
   fail(p.anchor==='bottom_center','unsupported anchor: '+s.id+' '+p.assetId);
   fail(Number.isFinite(p.yawDegrees)&&Math.abs(p.yawDegrees)<=180,'invalid yaw: '+s.id+' '+p.assetId);
   fail(Number.isFinite(p.targetMaxDimension)&&p.targetMaxDimension>0&&p.targetMaxDimension<=3,'invalid span: '+s.id+' '+p.assetId);
   const radial=Math.hypot(p.position?.[0]||0,p.position?.[2]||0);
   if(radial+p.targetMaxDimension/2>slot.radius+0.1)warnings.push(s.id+': '+p.assetId+' could extend beyond '+role+' preview pad');
  }
 }
}
for(const r of recipes.recipes)fail(defined.has(r.id),'source recipe missing from layouts: '+r.id);
for(const id of used){const m=ids.get(id);if(!m)continue;const u=m.uri;
 if(typeof u!=='string'||!u.startsWith('/scene-assets/')||u.includes('..')||u.includes('\\')){errors.push('unsafe URI '+id);continue;}
 const abs=path.resolve(publicRoot,'.'+u);
 if(!abs.startsWith(publicRoot+path.sep)){errors.push('path outside public root: '+id);continue;}
 try{const stat=await fs.stat(abs);fail(stat.isFile()&&stat.size>0,'empty/missing model: '+id);checked++;}
 catch(e){errors.push('model path not on disk: '+id+' '+u+' '+e.message);}
}
const report={ok:errors.length===0,layoutCount:layouts.scenes.length,sourceRecipesRetained:recipes.recipes.length,uniqueReferencedModels:used.size,placements,modelPathsChecked:checked,modelInventory:ids.size,warningCount:warnings.length,warnings,errors,
limits:'No visual QA, texture/UV checks, triangle budgets, map route occlusion or Safari/mobile GPU tests'};
console.log(JSON.stringify(report,null,2));
if(!report.ok)process.exitCode=1;
