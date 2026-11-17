import brandMark from '@/assets/brand-mark.png';

interface LogoProps {
  size?: number;
}

/** Знак «Навигатора продаж» из утверждённого изображения бренда. */
export function Logo({ size = 34 }: LogoProps) {
  return <img src={brandMark} width={size} height={size} alt="" aria-hidden="true" style={{ objectFit: 'contain' }} />;
}
