/** Explicit loopback cancellation: Chromium custom-protocol abort propagation is not assumed. */
export async function requestLuiCancellation(requestId:string, fetcher:typeof fetch=fetch):Promise<boolean>{
  if(!requestId)return false;
  try{
    const response=await fetcher('/api/lui/cancel',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({requestId}),signal:AbortSignal.timeout(3000)});
    return response.ok;
  }catch{return false;}
}
