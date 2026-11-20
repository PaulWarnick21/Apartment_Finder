import {Store} from '../server/db.ts';
import {availabilityTargets,localAvailabilityDay,type AvailabilitySchedule} from '../server/availability-monitor.ts';

// Configuration only: never fetches pages or starts a scan.
const enabled=process.argv.includes('--enable'),disabled=process.argv.includes('--disable');
if(enabled===disabled)throw Error('Choose --enable or --disable for the daily saved-listing availability check');
const store=new Store('data/live/apartments.sqlite');
try{
 const now=new Date();let noon=new Date(Math.floor(now.getTime()/3600000)*3600000);
 while(noon<=now||localAvailabilityDay(noon).hour!==12)noon=new Date(noon.getTime()+3600000);
 const schedule:AvailabilitySchedule={enabled,timeZone:'America/Toronto',hour:12,authorizedAt:now.toISOString(),notBefore:noon.toISOString()};
 store.set('availabilitySchedule',schedule);
 store.event(enabled?'Authorized daily noon availability checks of Interested and later active homes and confirmed duplicate ads: up to 240 saved pages / 60 minutes daily, zero photos, AI or discovery.':'Daily availability monitoring disabled.');
 console.log(JSON.stringify({schedule,knownPostings:availabilityTargets(store).length,requiresRunningApp:true,discoveryScheduleChanged:false}));
}finally{store.close();}
