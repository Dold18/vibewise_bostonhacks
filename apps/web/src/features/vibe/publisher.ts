import { immutable, type OutingVibeProfile } from './profile.ts';
export interface ProfilePublisher { getSnapshot():OutingVibeProfile|null; subscribe(fn:(p:OutingVibeProfile|null)=>void):()=>void }
export function createProfilePublisher() {
 let latest:OutingVibeProfile|null=null; const subscribers=new Set<(p:OutingVibeProfile|null)=>void>();
 return {
  getSnapshot:()=>latest,
  subscribe(fn:(p:OutingVibeProfile|null)=>void){subscribers.add(fn);fn(latest);return()=>{subscribers.delete(fn);};},
  publish(p:OutingVibeProfile|null){if(p&&latest&&p.sessionId===latest.sessionId&&p.version<latest.version)return;latest=p?immutable(p):null;for(const fn of [...subscribers]){try{fn(latest);}catch{ /* A failing consumer must not corrupt the quiz or another subscriber. */ }}},
 };
}
export const outingProfiles=createProfilePublisher();
