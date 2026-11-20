import { useEffect, useState } from 'react';
import { MarketplaceSyncPendingError } from '@/lib/marketplace-api';

export type ReportRange = { from: string; to: string; requestId: number };
export function useMarketplaceReport<T>(loader: (from:string,to:string)=>Promise<T>, range: ReportRange | null) {
  const [report,setReport] = useState<T|null>(null);
  const [error,setError] = useState('');
  const [loading,setLoading] = useState(false);
  useEffect(()=>{
    if (!range) return;
    let active=true;
    let timer: ReturnType<typeof setTimeout>;
    setReport(null);setError('');setLoading(true);
    const refresh=async()=>{
      try {
        const value=await loader(range.from,range.to);
        if (!active) return;
        setReport(value);
        const sync=(value as {sync?:{state:string;stale:boolean;updatedAt:string|null}}).sync;
        setError(sync?.stale ? sync.state==='blocked' ? 'Показана сохранённая выгрузка. Обновление остановлено: нужна проверка ответа площадки и прав ключа.' : 'Показана сохранённая выгрузка. Обновление отчёта продолжается в фоне.' : '');
        if(sync?.stale && sync.state!=='blocked') timer=setTimeout(()=>void refresh(),30_000);
      } catch(reason) {
        if(!active)return;
        setError(reason instanceof Error ? reason.message : 'Не удалось получить отчёт.');
        if(reason instanceof MarketplaceSyncPendingError)timer=setTimeout(()=>void refresh(),30_000);
      } finally { if(active)setLoading(false); }
    };
    void refresh();
    return ()=>{active=false;clearTimeout(timer);};
  },[loader,range]);
  return {report,error,loading};
}
