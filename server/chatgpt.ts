import {createServer,type Server} from 'node:http';
import {createHash,randomBytes,randomUUID} from 'node:crypto';
import {join} from 'node:path';
import {createRemoteJWKSet,jwtVerify,type JWTVerifyGetKey} from 'jose';
import {z} from 'zod';
import {CredentialVault} from './credential-vault.ts';

const issuer='https://auth.openai.com',resource='https://api.openai.com/v1';
const scopes='openid profile email offline_access resource.invoke chatgpt.tokens.use.direct';
const tokenSchema=z.object({access_token:z.string().min(1),refresh_token:z.string().optional(),id_token:z.string().optional(),expires_in:z.number().positive(),scope:z.string().optional(),token_type:z.string().refine(s=>s.toLowerCase()==='bearer')});
type Tokens={access:string;refresh?:string;id?:string;expires:number;scopes:string[]};
type Profile={id:string;client:string;subject?:string;email?:string;tokens?:Tokens;model?:string;models?:Model[]};
type Saved={host:string;active?:string;profiles:Profile[]};
export type Model={slug:string;name:string};
export type ChatGptState={connected:boolean;sharing:boolean;model:string;models:Model[];active:string;profiles:{id:string;label:string}[];pending:boolean;message:string};
type Pending={server:Server;timer:NodeJS.Timeout;state:string;nonce:string;verifier:string;redirect:string;profile:Profile;returnTo:string;used:boolean};
const jwks=createRemoteJWKSet(new URL(`${issuer}/.well-known/jwks.json`),{timeoutDuration:10000});
const random=()=>randomBytes(32).toString('base64url');
export function validateCallback(params:URLSearchParams,state:string,client?:string){
 if(params.getAll('state').length!==1||params.get('state')!==state)throw new Error('Sign-in state did not match. Start a new sign-in.');
 if(params.has('error'))throw new Error('ChatGPT sign-in was declined or could not be completed.');
 const returned=params.get('client_id');
 if(params.getAll('client_id').length>1||client&&returned&&client!==returned)throw new Error('ChatGPT returned a different client registration.');
 const issued=client||returned;
 if(!issued||issued==='dynamic_agent_client'||!params.get('code')||params.getAll('code').length!==1)throw new Error('ChatGPT registration was incomplete.');
 return {client:issued,code:params.get('code')!};
}
export function hasPlanPermission(tokens?:Tokens){return !!tokens?.access&&tokens.scopes.includes('chatgpt.tokens.use.direct');}
export async function verifyIdentity(token:string,client:string,nonce:string,subject?:string,keys:JWTVerifyGetKey=jwks){
 const {payload}=await jwtVerify(token,keys,{issuer,audience:client,requiredClaims:['exp','sub','nonce']});
 if(payload.nonce!==nonce||!payload.sub||subject&&subject!==payload.sub)throw new Error('ChatGPT account identity did not match this registration.');
 return {subject:payload.sub,email:typeof payload.email==='string'?payload.email:undefined};
}
function pack(data:z.infer<typeof tokenSchema>,previous?:Tokens):Tokens{return {access:data.access_token,refresh:data.refresh_token??previous?.refresh,id:data.id_token??previous?.id,expires:Date.now()+data.expires_in*1000,scopes:data.scope===undefined?(previous?.scopes??[]):data.scope.split(/\s+/)};}
// Only whitelisted machine codes are put in user-visible errors; raw OAuth bodies may contain secrets.
const unusable=new Set(['invalid_grant','invalid_refresh_token','token_expired','refresh_token_expired','refresh_token_invalidated','refresh_token_reused']);
class TokenError extends Error{constructor(public code:string,status:number){super(`ChatGPT sign-in or renewal failed (HTTP ${status}). ${unusable.has(code)?'Sign in again.':'Try again later or review account access.'}`);}}
async function exchange(fields:Record<string,string>){
 const response=await fetch(`${issuer}/api/accounts/oauth/token`,{method:'POST',headers:{'Content-Type':'application/x-www-form-urlencoded'},body:new URLSearchParams(fields),signal:AbortSignal.timeout(20000)});
 const raw=await response.json().catch(()=>({}));if(!response.ok)throw new TokenError(typeof raw.error==='string'?raw.error:raw.error?.code??'',response.status);
 const parsed=tokenSchema.safeParse(raw);if(!parsed.success)throw new Error('ChatGPT returned an incomplete token response.');return parsed.data;
}
export class ChatGptConnection{
 private vault:CredentialVault<Saved>;private pending?:Pending;private starting=false;private message='';
 constructor(dataDir:string){this.vault=new CredentialVault(join(dataDir,'chatgpt'),()=>({host:`urn:uuid:${randomUUID()}`,profiles:[]}));}
 async state():Promise<ChatGptState>{const saved=await this.vault.read(),p=saved.profiles.find(p=>p.id===saved.active);return {connected:!!p?.tokens,sharing:hasPlanPermission(p?.tokens),model:p?.model??'',models:p?.models??[],active:saved.active??'',profiles:saved.profiles.map((p,i)=>({id:p.id,label:`${p.email||'Saved account'} · ${i+1}`})),pending:!!this.pending||this.starting,message:this.message};}
 async begin(returnTo:string,newProfile=false){
  if(this.pending||this.starting)throw new Error('A ChatGPT sign-in is already pending. Finish it or cancel it first.');this.starting=true;
  try{const origin=new URL(returnTo);if(!/^http:\/\/(127\.0\.0\.1|localhost):\d+\/$/.test(origin.href))throw new Error('Invalid local return address');
   const saved=await this.vault.locked(async()=>{const s=await this.vault.read();await this.vault.write(s);return s;});
   const profile=(!newProfile&&saved.profiles.find(p=>p.id===saved.active))||{id:randomUUID(),client:''};
   const server=createServer((req,res)=>{void this.callback(req.url??'/',req.method??'',res);});
   await new Promise<void>((resolve,reject)=>{server.once('error',reject);server.listen(0,'127.0.0.1',resolve);});
   const port=(server.address() as {port:number}).port;
   const pending:Pending={server,timer:setTimeout(()=>{this.cancel();this.message='Sign-in timed out. Continue with ChatGPT to try again.';},300000),state:random(),nonce:random(),verifier:random(),redirect:`http://127.0.0.1:${port}/auth/callback`,profile,returnTo:origin.href+'?settings=1',used:false};pending.timer.unref();this.pending=pending;
   const url=new URL(`${issuer}/api/accounts/authorize`);url.search=new URLSearchParams({client_id:profile.client||'dynamic_agent_client',...(!profile.client?{agent_name_hint:'Apartment Finder'}:{}),ext_agent_host_id:saved.host,response_type:'code',redirect_uri:pending.redirect,scope:scopes,resource,state:pending.state,nonce:pending.nonce,code_challenge_method:'S256',code_challenge:createHash('sha256').update(pending.verifier).digest('base64url'),...(profile.tokens&&!hasPlanPermission(profile.tokens)?{prompt:'consent'}:{})}).toString();
   this.message='Finish signing in with OpenAI in your browser.';return url.href;
  }finally{this.starting=false;}
 }
 private async callback(path:string,method:string,res:import('node:http').ServerResponse){
  res.setHeader('Cache-Control','no-store');res.setHeader('Referrer-Policy','no-referrer');res.setHeader('Content-Security-Policy',"default-src 'none'");
  const pending=this.pending,url=new URL(path,'http://127.0.0.1');
  if(method!=='GET'||url.pathname!=='/auth/callback'||!pending||pending.used){res.writeHead(404);res.end('No pending sign-in.');return;}
  // Invalid unsolicited callbacks cannot consume the legitimate pending attempt.
  if(url.searchParams.get('state')!==pending.state){res.writeHead(400);res.end('Sign-in state mismatch.');return;}
  pending.used=true;
  try{const result=validateCallback(url.searchParams,pending.state,pending.profile.client||undefined);
   await this.vault.locked(async()=>{const saved=await this.vault.read();let profile=saved.profiles.find(p=>p.id===pending.profile.id);if(!profile){profile={...pending.profile,client:result.client};saved.profiles.push(profile);}saved.active??=profile.id;
    // Preserve registration even if an authorization code expires before exchange.
    await this.vault.write(saved);
    const tokens=await exchange({grant_type:'authorization_code',client_id:result.client,code:result.code,code_verifier:pending.verifier,redirect_uri:pending.redirect,resource});
    if(!tokens.id_token)throw new Error('ChatGPT did not return a verifiable identity.');
    const identity=await verifyIdentity(tokens.id_token,result.client,pending.nonce,profile.subject);
    profile.subject=identity.subject;profile.email=identity.email;profile.tokens=pack(tokens);profile.models=[];profile.model=undefined;saved.active=profile.id;await this.vault.write(saved);
   });
   this.message='Connected. Load available models and choose one for photo analysis.';
  }catch{this.message='ChatGPT sign-in could not be completed. Continue with ChatGPT to try again; account access has not been verified.';}
  finally{clearTimeout(pending.timer);this.pending=undefined;res.writeHead(303,{Location:pending.returnTo});res.end();pending.server.close();}
 }
 cancel(){if(this.pending?.used)throw new Error('Sign-in is completing. Try again shortly.');if(this.pending){clearTimeout(this.pending.timer);this.pending.server.close();this.pending=undefined;}this.message='Sign-in cancelled.';}
 async select(id:string){if(this.pending)throw new Error('Finish or cancel sign-in first.');await this.vault.locked(async()=>{const saved=await this.vault.read();if(!saved.profiles.some(p=>p.id===id))throw new Error('Account not found');saved.active=id;await this.vault.write(saved);});this.message='Account selected. Refresh its available models.';}
 async access(expectedProfile?:string):Promise<{token:string;profile:string;model:string}>{return this.vault.locked(async()=>{const saved=await this.vault.read(),p=saved.profiles.find(p=>p.id===saved.active);if(!p||expectedProfile&&expectedProfile!==p.id||!hasPlanPermission(p.tokens))throw new Error('Connect ChatGPT and allow use of your plan in Preferences.');let t=p.tokens!;
  if(t.expires<Date.now()+60000){if(!t.refresh)throw new Error('Sign in to ChatGPT again to renew this connection.');try{const raw=await exchange({grant_type:'refresh_token',client_id:p.client,refresh_token:t.refresh,resource});t=pack(raw,t);p.tokens=t;await this.vault.write(saved);}catch(e){if(e instanceof TokenError&&unusable.has(e.code)){delete p.tokens;await this.vault.write(saved);}throw e;}}
  if(!hasPlanPermission(t))throw new Error('ChatGPT plan permission is disabled. Reconnect in Preferences.');return {token:t.access,profile:p.id,model:p.model??''};
 });}
 async models(){const access=await this.access();const response=await fetch(`${resource}/models`,{headers:{Authorization:`Bearer ${access.token}`},signal:AbortSignal.timeout(20000)});if(!response.ok)throw new Error(`ChatGPT model access returned HTTP ${response.status}. Check your account permissions.`);
  const schema=z.object({models:z.array(z.object({slug:z.string(),display_name:z.string(),visibility:z.string()}))});const parsed=schema.safeParse(await response.json());if(!parsed.success)throw new Error('ChatGPT returned an unexpected model catalog.');const models=parsed.data.models.filter(m=>m.visibility==='list').map(m=>({slug:m.slug,name:m.display_name}));
  await this.vault.locked(async()=>{const saved=await this.vault.read(),p=saved.profiles.find(p=>p.id===access.profile)!;p.models=models;if(!models.some(m=>m.slug===p.model))p.model=undefined;await this.vault.write(saved);});this.message=models.length?'Choose a model for photo analysis.':'No models available for this account.';return models;
 }
 async chooseModel(model:string){await this.vault.locked(async()=>{const saved=await this.vault.read(),p=saved.profiles.find(p=>p.id===saved.active);if(!p?.models?.some(m=>m.slug===model))throw new Error('Choose a model from this account’s current list.');p.model=model;await this.vault.write(saved);});this.message='Model saved. Scanning remains paused.';}
 async disconnect(){if(this.pending)throw new Error('Finish or cancel sign-in first.');let confirmed=true;
  await this.vault.locked(async()=>{const saved=await this.vault.read(),p=saved.profiles.find(p=>p.id===saved.active);if(!p)return;
   try{if(p.tokens?.refresh){const discovery=await fetch(`${issuer}/.well-known/openid-configuration`,{signal:AbortSignal.timeout(10000)});if(!discovery.ok)throw new Error();const metadata=await discovery.json() as any,endpoint=new URL(metadata.revocation_endpoint);if(endpoint.origin!==issuer)throw new Error();const result=await fetch(endpoint,{method:'POST',headers:{'Content-Type':'application/x-www-form-urlencoded'},body:new URLSearchParams({token:p.tokens.refresh,token_type_hint:'refresh_token',client_id:p.client}),signal:AbortSignal.timeout(10000)});confirmed=result.status===200;}}catch{confirmed=false;}
   delete p.tokens;p.models=[];delete p.model;await this.vault.write(saved);
  });this.message=confirmed?'Signed out.':'Signed out locally. Remote revocation was not confirmed; disconnect Apartment Finder in ChatGPT settings.';
 }
 close(){if(this.pending){clearTimeout(this.pending.timer);this.pending.server.close();this.pending=undefined;}}
}
const connections=new Map<string,ChatGptConnection>();
export function chatGpt(dataDir:string){let instance=connections.get(dataDir);if(!instance){instance=new ChatGptConnection(dataDir);connections.set(dataDir,instance);}return instance;}
export function aiMode():'chatgpt'|'api'{return process.env.AI_PROVIDER==='api'?'api':'chatgpt';}
