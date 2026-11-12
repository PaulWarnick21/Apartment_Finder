// Partial output is never evidence: success requires a terminal completed event.
export async function completedText(response:Response):Promise<string>{
 if(!response.ok)throw new Error(`ChatGPT returned HTTP ${response.status}. Review ChatGPT Settings → Usage or account access. No paid fallback or retry was sent.`);
 if(!response.body)throw new Error('ChatGPT returned an empty response stream.');
 const reader=response.body.getReader(),decoder=new TextDecoder();let buffer='',text='',doneText:string|undefined,total=0;
 function event(block:string){const data=block.split('\n').filter(l=>l.startsWith('data:')).map(l=>l.slice(5).trimStart()).join('\n');if(!data||data==='[DONE]')return;const value=JSON.parse(data);
  if(['response.failed','response.incomplete','error'].includes(value.type)){const code=value.response?.error?.code??value.error?.code??value.code;throw new Error(code==='subscription_sharing_usage_limit_exceeded'?'ChatGPT plan usage limit reached. Review ChatGPT Settings → Usage; photo review paused.':code==='subscription_sharing_usage_unavailable'?'ChatGPT usage is temporarily unavailable; photo review paused.':'ChatGPT did not complete the photo assessment. No retry or paid fallback was sent.');}
  if(value.type==='response.output_text.delta'&&typeof value.delta==='string')text+=value.delta;
  if(value.type==='response.completed'){if(value.response?.status&&value.response.status!=='completed')throw new Error('ChatGPT response did not complete.');const output=(value.response?.output??[]).flatMap((x:any)=>x.content??[]).filter((x:any)=>x.type==='output_text').map((x:any)=>x.text).join('');doneText=output||text;}
 }
 try{while(true){const chunk=await reader.read();if(chunk.done){buffer+=decoder.decode();break;}total+=chunk.value.byteLength;if(total>2_000_000)throw new Error('ChatGPT response exceeded the local size limit.');buffer+=decoder.decode(chunk.value,{stream:true});buffer=buffer.replace(/\r\n/g,'\n');let index;while((index=buffer.indexOf('\n\n'))>=0){event(buffer.slice(0,index));buffer=buffer.slice(index+2);}if(doneText!==undefined){await reader.cancel();return doneText;}}
  if(buffer.trim())event(buffer);if(doneText===undefined)throw new Error('ChatGPT stream ended before completion; photo review remains pending.');return doneText;
 }finally{await reader.cancel().catch(()=>{});reader.releaseLock();}
}
