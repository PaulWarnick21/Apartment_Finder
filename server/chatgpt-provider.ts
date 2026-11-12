import {readFile} from 'node:fs/promises';
import type {Caps,Photo} from '../src/domain.ts';
import {chatGpt,aiMode,type ChatGptConnection} from './chatgpt.ts';
import {completedText} from './response-stream.ts';
import {OpenAiVision,visionSchema,photoRequest,type VisionProvider} from './provider.ts';
export class ChatGptVision implements VisionProvider{
 version:string;private stopped=false;
 constructor(private connection:ChatGptConnection,private profile:string,private model:string){this.version=`chatgpt:${model}:window-review-v2`;}
 async review(photo:Photo,path:string){if(this.stopped)throw new Error('ChatGPT photo review is paused for this run.');try{const access=await this.connection.access(this.profile),data=await readFile(path);
 const response=await fetch('https://api.openai.com/v1/responses',{method:'POST',signal:AbortSignal.timeout(120000),headers:{Authorization:`Bearer ${access.token}`,'Content-Type':'application/json'},body:JSON.stringify({...photoRequest(photo,data,this.model),stream:true})});return visionSchema.parse(JSON.parse(await completedText(response)));
 }catch(e){this.stopped=true;throw e;}}
}
export async function providerReady(dataDir:string){if(aiMode()==='api')return !!process.env.OPENAI_API_KEY&&!!process.env.OPENAI_MODEL;const s=await chatGpt(dataDir).state();return !s.pending&&s.sharing&&!!s.model;}
export async function createVisionProvider(dataDir:string,caps:Caps):Promise<VisionProvider>{
 const mode=aiMode();if((caps.billingMode??'api')!==mode)throw new Error('AI billing mode changed. Prepare a new scan plan before continuing.');
 if(mode==='api')return new OpenAiVision(process.env.OPENAI_API_KEY??'',process.env.OPENAI_MODEL??'');
 const connection=chatGpt(dataDir),access=await connection.access();if(!access.model)throw new Error('Choose a ChatGPT model in Preferences before scanning.');return new ChatGptVision(connection,access.profile,access.model);
}
