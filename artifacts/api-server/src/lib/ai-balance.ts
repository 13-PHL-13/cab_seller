export function parseRouterBalance(payload: unknown): number | null {
 const data=payload&&typeof payload==='object'?(payload as {data?:unknown}).data:null;
 if(!data||typeof data!=='object')return null;
 const row=data as Record<string,unknown>;
 const value=row.credits??row.balance??row.total_credits;
 if((typeof value!=='number'&&typeof value!=='string')||value==='')return null;
 const amount=Number(value);return Number.isFinite(amount)?amount:null;
}
export async function routerBalance(apiKey:string,request:typeof fetch=fetch):Promise<number|null>{
 const response=await request('https://routerai.ru/api/v1/credits',{headers:{Authorization:`Bearer ${apiKey}`,Accept:'application/json'},redirect:'error',signal:AbortSignal.timeout(10000)});
 if(!response.ok)return null;return parseRouterBalance(await response.json());
}
