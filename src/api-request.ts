/** A response can be lost after a write commits. Callers must read back before retrying. */
export class ApiError extends Error {
 constructor(message:string,public recoverable=false,public status?:number){super(message);this.name='ApiError';}
}

export async function apiRequest<T=any>(path:string,method='GET',body?:unknown,token='',fetcher:typeof fetch=fetch):Promise<T>{
 let response:Response;
 try{
  response=await fetcher('/api/'+path,{method,headers:{Accept:'application/json','Content-Type':'application/json','X-AF-Token':token},body:body===undefined?undefined:JSON.stringify(body),cache:'no-store',signal:AbortSignal.timeout(20000)});
 }catch{
  throw new ApiError('The connection was interrupted. Your decision could not yet be confirmed.',true);
 }
 let result:any;
 try{result=await response.json();}
 catch{
  // Safari reports a generic "string did not match" for empty/non-JSON responses.
  // Do not display proxy HTML, or mistake an unreadable acknowledgement for success.
  throw new ApiError(`The app returned an unreadable response (HTTP ${response.status}). Your decision could not yet be confirmed.`,response.ok||response.status>=500||response.status===408,response.status);
 }
 if(!response.ok)throw new ApiError(typeof result?.error==='string'?result.error:`Request failed (HTTP ${response.status}).`,response.status===409||response.status===408||response.status>=500,response.status);
 return result as T;
}
