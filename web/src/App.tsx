import { useEffect, useState } from 'react';
import { useQuery } from '@tanstack/react-query';
import { api } from './lib/api.ts';
import Login from './pages/Login.tsx';
import Invite from './pages/Invite.tsx';
import ResetPassword from './pages/ResetPassword.tsx';
import Admin from './pages/Admin.tsx';
import Planner from './pages/Planner.tsx';

/** Küçük yönlendirici — tek sayfalık uygulama için harici kütüphaneye gerek yok. */
export function navigate(path: string) {
  window.history.pushState({}, '', path);
  window.dispatchEvent(new PopStateEvent('popstate'));
}

export default function App() {
  const [path, setPath] = useState(window.location.pathname);

  useEffect(() => {
    const onPop = () => setPath(window.location.pathname);
    window.addEventListener('popstate', onPop);
    return () => window.removeEventListener('popstate', onPop);
  }, []);

  const me = useQuery({ queryKey: ['me'], queryFn: api.me, retry: false });

  // Oturum gerektirmeyen ekranlar
  const inviteToken = path.match(/^\/davet\/(.+)$/)?.[1];
  if (inviteToken) return <Invite token={inviteToken} />;

  const resetToken = path.match(/^\/sifre-sifirla\/(.+)$/)?.[1];
  if (resetToken) return <ResetPassword token={resetToken} />;

  if (me.isLoading) {
    return (
      <div className="center-page loading-screen" role="status" aria-live="polite">
        <span className="spinner" aria-hidden="true" />
        <span>Planner hazırlanıyor…</span>
      </div>
    );
  }
  if (me.isError || !me.data) return <Login />;

  if (path.startsWith('/admin')) return <Admin user={me.data.user} />;
  return <Planner user={me.data.user} />;
}
