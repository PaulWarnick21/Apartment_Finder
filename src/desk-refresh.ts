import type {Home} from './domain';

/** Reuse unchanged cards across polls so scan progress doesn't redraw every gallery. */
export function retainUnchangedHomes(previous:Home[],next:Home[]):Home[]{
 const old=new Map(previous.map(home=>[home.id,home]));
 return next.map(home=>{const prior=old.get(home.id);return prior&&JSON.stringify(prior)===JSON.stringify(home)?prior:home;});
}
