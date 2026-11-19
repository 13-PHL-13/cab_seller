import { useRef } from 'react';
import guides from '@/data/api-guides.json';
import './api-connections.css';

export default function ApiGuide({ platform, embedded = false }: { platform: 'wb' | 'ozon'; embedded?: boolean }) {
  const guide = guides[platform], part = guide.parts[0], video = useRef<HTMLVideoElement>(null);
  const root = `${import.meta.env.BASE_URL}assets/api-guides/`;
  function seek(time: number) {
    const element = video.current;
    if (!element) return;
    const setTime = () => { element.currentTime = time; element.scrollIntoView({ behavior: 'smooth', block: 'center' }); void element.play().catch(() => undefined); };
    if (element.readyState >= 1) setTime();
    else { element.addEventListener('loadedmetadata', setTime, { once: true }); element.load(); }
  }
  const body = <div className="connection-guide-body">
      <p>{guide.intro}</p>
      {platform === 'ozon' && <p><strong>Для одного магазина нужны оба доступа:</strong> Seller API — Client ID и API Key; Performance API — отдельные Client ID и Client Secret.</p>}
      <video ref={video} controls preload="none" playsInline poster={root + part.media + '-poster.jpg'} aria-label={`Подключение ${guide.name}`}>
        <source src={root + part.media + '.mp4'} type="video/mp4" />
        <track kind="captions" src={root + part.media + '.vtt'} srcLang="ru" label="Русский" />
        <track kind="chapters" src={root + part.media + '-chapters.vtt'} srcLang="ru" label="Шаги подключения" />
      </video>
      <a className="link" href={root + part.media + '.mp4'} download>Скачать видео</a>
      <ol className="connection-guide-steps">{part.steps.map((step, i) => <li key={step.image}>
        <details open={i === 0 || step.reveal}>
          <summary>{i + 1}. {step.title}</summary>
          <p>{step.text}</p>
          <button className="btn btn-outline" type="button" onClick={() => seek(step.time)}>Показать в видео · {Math.floor(step.time / 60)}:{String(Math.floor(step.time % 60)).padStart(2, '0')}</button>
          <a href={root + step.image + '.jpg'} target="_blank" rel="noreferrer" aria-label={`Увеличить: ${step.title}`}>
            <img src={root + step.image + '.jpg'} alt={`${step.title}. Нужный элемент выделен рамкой; личные данные скрыты.`} loading="lazy" />
          </a>
          <a className="link" href={root + step.image + '.jpg'} target="_blank" rel="noreferrer">Открыть скриншот крупно ↗</a>
        </details>
      </li>)}</ol>
      <div className="connection-success">{platform === 'ozon' ? 'Вставьте Client ID и API Key в блок Seller API, а отдельные Client ID и Client Secret — в блок Performance API формы одного магазина.' : 'Вставьте скопированный токен в поле «API-токен» формы магазина Wildberries.'}</div>
      <p><a href={guide.url} className="link" target="_blank" rel="noreferrer">Открыть настройки API {guide.name} ↗</a></p>
    </div>;
  return embedded ? <section className="connection-guide connection-guide-embedded" aria-label={`Инструкция подключения ${guide.name}`}>
    <h3>Как подключить {guide.name}</h3>{body}
  </section> : <details className="connection-guide">
    <summary>Как подключить {guide.name} <span>Видео и пошаговая инструкция</span></summary>{body}
  </details>;
}
