import { createRoot } from 'react-dom/client';
import { ClerkProvider, SignedIn, SignedOut, SignInButton, UserButton } from '@clerk/react';

import App from './App';
import { ErrorBoundary } from '@/components/error-boundary';
import './index.css';

const publishableKey = import.meta.env.VITE_CLERK_PUBLISHABLE_KEY;

function Root() {
  if (!publishableKey) {
    return <div className="empty-state">
      <h1>Не настроена авторизация</h1>
      <p>Добавьте CLERK_PUBLISHABLE_KEY в переменные окружения приложения и пересоберите frontend.</p>
    </div>;
  }

  return <ClerkProvider publishableKey={publishableKey} proxyUrl="/api/__clerk">
    <SignedIn>
      <div style={{ position: 'fixed', right: 20, top: 16, zIndex: 50 }}><UserButton /></div>
      <ErrorBoundary><App /></ErrorBoundary>
    </SignedIn>
    <SignedOut>
      <div className="empty-state" style={{ minHeight: '100vh', display: 'flex', justifyContent: 'center', alignItems: 'center' }}>
        <div>
          <h1>Навигатор продаж</h1>
          <p>Войдите, чтобы подключить маркетплейсы и просматривать данные.</p>
          <SignInButton mode="modal"><button className="btn btn-primary">Войти</button></SignInButton>
        </div>
      </div>
    </SignedOut>
  </ClerkProvider>;
}

createRoot(document.getElementById('root')!, {
  onCaughtError: (error, errorInfo) => {
    console.error(error, errorInfo.componentStack);
  },
}).render(<Root />);
