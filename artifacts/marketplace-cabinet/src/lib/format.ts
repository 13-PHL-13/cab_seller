/** Форматирование денежных значений и чисел (ru-RU). */

export function formatMoney(value: number): string {
  if (Math.abs(value) >= 1_000_000) {
    const millions = value / 1_000_000;
    return `${millions.toFixed(2).replace('.', ',').replace(/,?0+$/, '')} млн ₽`;
  }
  return `${Math.round(value).toLocaleString('ru-RU')} ₽`;
}

export function formatNumber(value: number): string {
  return Math.round(value).toLocaleString('ru-RU');
}

export function formatPercent(value: number, digits = 1): string {
  const sign = value > 0 ? '+' : '';
  return `${sign}${value.toFixed(digits).replace('.', ',')}%`;
}

export function formatDate(iso: string): string {
  const d = new Date(iso);
  return d.toLocaleDateString('ru-RU', { day: '2-digit', month: '2-digit' });
}

export function formatDateFull(iso: string): string {
  return new Date(iso).toLocaleDateString('ru-RU', {
    day: 'numeric',
    month: 'long',
    year: 'numeric',
  });
}

export function formatDateTime(ms: number): string {
  return new Date(ms).toLocaleString('ru-RU', {
    day: '2-digit',
    month: '2-digit',
    hour: '2-digit',
    minute: '2-digit',
  });
}

/** «5 минут назад» по смещению в секундах. */
export function timeAgo(secondsAgo: number): string {
  if (secondsAgo < 60) return 'только что';
  const minutes = Math.floor(secondsAgo / 60);
  if (minutes < 60) {
    const m10 = minutes % 10;
    const m100 = minutes % 100;
    const word =
      m10 === 1 && m100 !== 11 ? 'минуту' : m10 >= 2 && m10 <= 4 && (m100 < 10 || m100 >= 20) ? 'минуты' : 'минут';
    return `${minutes} ${word} назад`;
  }
  const hours = Math.floor(minutes / 60);
  if (hours < 24) {
    const h10 = hours % 10;
    const h100 = hours % 100;
    const word =
      h10 === 1 && h100 !== 11 ? 'час' : h10 >= 2 && h10 <= 4 && (h100 < 10 || h100 >= 20) ? 'часа' : 'часов';
    return `${hours} ${word} назад`;
  }
  const days = Math.floor(hours / 24);
  const word = days === 1 ? 'день' : days < 5 ? 'дня' : 'дней';
  return `${days} ${word} назад`;
}
