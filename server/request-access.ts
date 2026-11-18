import type {IncomingMessage} from 'node:http';

export type RemoteAccess=Readonly<{origin:string;host:string;user:string}>;
export type RequestAccess={origin:string;remote:boolean};

/** Opt-in only. Never infer a trusted origin or identity from request headers. */
export function remoteAccessFromEnv(env:NodeJS.ProcessEnv):RemoteAccess|null{
 const origin=env.AF_REMOTE_ORIGIN??'',user=env.AF_REMOTE_USER??'';
 if(!origin&&!user)return null;
 if(!origin||!user)throw new Error('Set both AF_REMOTE_ORIGIN and AF_REMOTE_USER to enable private phone access.');
 let url:URL;try{url=new URL(origin);}catch{throw new Error('AF_REMOTE_ORIGIN must be an exact HTTPS Tailscale origin.');}
 if(url.protocol!=='https:'||url.origin!==origin||url.port||url.username||url.password||url.pathname!=='/'||url.search||url.hash||
  !/^(?:[a-z0-9](?:[a-z0-9-]{0,61}[a-z0-9])?\.){2,}ts\.net$/.test(url.hostname)){
  throw new Error('AF_REMOTE_ORIGIN must be an exact HTTPS Tailscale origin, without a port, path, query, or wildcard.');
 }
 if(!/^[\x21-\x7e]{1,254}$/.test(user)||user.includes(','))throw new Error('AF_REMOTE_USER must be the exact ASCII Tailscale login, without spaces or commas.');
 return Object.freeze({origin,host:url.host,user});
}

/** Trust Serve identity only behind our loopback listener, never on a LAN listener.
 * Serve preserves Host and replaces Tailscale-User-Login with the authenticated user.
 * Local processes already have access to the app; forwarded traffic cannot use that shortcut.
 */
export function requestAccess(req:IncomingMessage,remote:RemoteAccess|null):RequestAccess|null{
 if(!['127.0.0.1','::1','::ffff:127.0.0.1'].includes(req.socket.remoteAddress??''))return null;
 for(const name of ['host','origin','tailscale-user-login'])if((req.headersDistinct[name]?.length??0)>1)return null;
 const host=req.headers.host??'';
 const proxyMarked=Object.keys(req.headers).some(name=>/^(tailscale[-_]|x-forwarded-|forwarded$|x-real-ip$)/.test(name));
 if(/^(127\.0\.0\.1|localhost)(:\d+)?$/.test(host))return proxyMarked?null:{origin:`http://${host}`,remote:false};
 if(!remote||host!==remote.host||req.headers['tailscale-user-login']!==remote.user||req.headers['tailscale-funnel-request']!==undefined)return null;
 if(req.headers.origin!==undefined&&req.headers.origin!==remote.origin)return null;
 return {origin:remote.origin,remote:true};
}
