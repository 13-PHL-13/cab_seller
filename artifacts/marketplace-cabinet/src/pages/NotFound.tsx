import { Link } from 'wouter';
import { MapPin } from 'lucide-react';

export default function NotFoundPage() {
  return (
    <div className="card">
      <div className="empty-state">
        <div className="icon">
          <MapPin size={22} />
        </div>
        <div style={{ fontWeight: 800, fontSize: 15, color: 'var(--text)' }}>Страница не найдена</div>
        <div style={{ marginTop: 4, fontSize: 13 }}>Проверьте адрес или вернитесь на дашборд.</div>
        <div style={{ marginTop: 14 }}>
          <Link href="/" className="btn btn-primary">На дашборд</Link>
        </div>
      </div>
    </div>
  );
}
