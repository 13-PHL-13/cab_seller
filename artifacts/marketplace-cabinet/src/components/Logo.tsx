import { useId } from 'react';

interface LogoProps {
  size?: number;
}

/** Логотип «Навигатор продаж» — бирюзовая метка с буквой H и стрелкой. */
export function Logo({ size = 34 }: LogoProps) {
  const gid = useId();
  return (
    <svg width={size} height={size} viewBox="0 0 64 64" aria-hidden="true">
      <defs>
        <linearGradient id={gid} x1="0%" y1="0%" x2="100%" y2="100%">
          <stop offset="0%" stopColor="#3BB894" />
          <stop offset="100%" stopColor="#0B5B47" />
        </linearGradient>
      </defs>
      <path
        d="M32 2.5C17.9 2.5 6.5 13.9 6.5 28c0 8.6 4.6 16.9 11 24.2 4.9 5.6 10.5 10 14.5 12.9 4-2.9 9.6-7.3 14.5-12.9 6.4-7.3 11-15.6 11-24.2C57.5 13.9 46.1 2.5 32 2.5z"
        fill={`url(#${gid})`}
      />
      <g stroke="#fff" strokeWidth="6.5" strokeLinecap="round" fill="none">
        <path d="M23 45V19" />
        <path d="M23 32.5h13.5" />
        <path d="M36.5 45V30" />
      </g>
      <path
        d="M36.5 30.5 44 21.5"
        stroke="#fff"
        strokeWidth="6.5"
        strokeLinecap="round"
        fill="none"
      />
      <path d="M50.5 12 46.5 24.5 38.5 16z" fill="#fff" />
    </svg>
  );
}
