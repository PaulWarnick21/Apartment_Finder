import {mkdirSync,writeFileSync,readFileSync,existsSync} from 'node:fs';
import {resolve,join} from 'node:path';
import {Store} from '../server/db.ts';
import {criteriaSchema} from '../src/domain.ts';
import {discoveryScheduleStatus,seedScheduledYield} from '../server/discovery-scheduler.ts';
import {discoveryWindowOpen,type DiscoverySchedule} from '../server/discovery-schedule-policy.ts';
import {rememberIntakeRejection} from '../server/intake-memory.ts';
import type {SearchAreaPolicy} from '../server/search-area.ts';

const mode=process.argv[2];if(!['--enable','--disable','--status'].includes(mode))throw Error('Use --enable, --disable or --status');
const store=new Store('data/live/apartments.sqlite');
try{
 if(mode==='--status'){console.log(JSON.stringify(discoveryScheduleStatus(store)));process.exitCode=0;}
 else if(mode==='--disable'){
  const current=store.get<DiscoverySchedule>('scanSchedule');store.set('scanSchedule',{...current,enabled:false});
  writeFileSync('data/live/discovery-power.json',JSON.stringify({enabled:false}));
  store.event('Recurring discovery disabled by user; current scheduled batch stops at its next guard.');
  console.log(JSON.stringify({enabled:false}));
 }else{
  const current=store.get<DiscoverySchedule>('scanSchedule');if(current?.version===1&&current.enabled){console.log(JSON.stringify({alreadyEnabled:true,schedule:current}));}
  else{
   if(store.get<{mode:string}>('reviewWorkflow')?.mode!=='quick-first')throw Error('Quick-first workflow required');
   const now=new Date(),folder=resolve('data/live/discovery-schedule-activation-'+now.toISOString().replace(/[:.]/g,'-'));mkdirSync(folder,{recursive:true});
   await store.backupTo(join(folder,'before.sqlite'));
   writeFileSync(join(folder,'before-settings.json'),JSON.stringify({criteria:store.criteria,searchAreaPolicy:store.get('searchAreaPolicy'),schedule:current},null,2));
   let first=new Date(Math.ceil(now.getTime()/60000)*60000);while(!discoveryWindowOpen(first))first=new Date(first.getTime()+60000);
   const schedule:DiscoverySchedule={version:1,enabled:true,timeZone:'America/Toronto',authorizedAt:current?.version===1?current.authorizedAt:now.toISOString(),notBefore:first.toISOString()};
   store.transaction(()=>{
    // Capture existing visible grades before enabling future amenity bonuses or tighter intake.
    const homes=store.homes();for(const h of homes)if(h.quickRank&&!store.get('preservedQuickRank:'+h.id))store.set('preservedQuickRank:'+h.id,h.quickRank);
    store.set('criteria',criteriaSchema.parse({...store.criteria,quickAmenityBonuses:true,quickIntake:{...store.criteria.quickIntake,minRent:1500,maxRent:3500,minPhotos:store.criteria.quickIntake?.minPhotos??2,allowedBeds:[1,2]}}));
    const area=store.get<SearchAreaPolicy>('searchAreaPolicy');if(!area?.sourceRoutes)throw Error('Configured source routes required');
    store.set('searchAreaPolicy',{...area,regions:['downtown-vancouver'],allowNearbyFallback:false,existingHomeIds:[...new Set([...area.existingHomeIds,...homes.map(h=>h.id)])],configuredAt:now.toISOString()});
    const old=store.db.prepare("SELECT m.value FROM meta m JOIN plans p ON m.key='newListingValidation:'||p.id WHERE p.created_at>=? AND json_extract(p.caps,'$.assessmentMode')='quick'").all(new Date(now.getTime()-72*3600000).toISOString()) as {value:string}[];
    for(const row of old)for(const [source,progress] of Object.entries(JSON.parse(row.value).sources) as [string,{outcomes:{url:string;result:string;sourceId?:string}[]}][])for(const o of progress.outcomes)rememberIntakeRejection(store,source,o.url,o.result,o.sourceId,now.getTime());
    seedScheduledYield(store,now);store.set('scanSchedule',schedule);
   });
   if(existsSync('private/settings.json')){writeFileSync(join(folder,'private-settings-before.json'),readFileSync('private/settings.json'));writeFileSync('private/settings.json',JSON.stringify(store.criteria,null,2));}
   writeFileSync('data/live/discovery-power.json',JSON.stringify({enabled:true,timeZone:schedule.timeZone}));
   store.event('Authorized recurring quick discovery: daily 21:00–03:00 and Monday–Thursday 05:00–13:00 Toronto; adaptive source cadence and rolling limits; zero AI/address requests.');
   console.log(JSON.stringify({schedule,backup:folder,limits:discoveryScheduleStatus(store).limits}));
  }
 }
}finally{store.close();}
