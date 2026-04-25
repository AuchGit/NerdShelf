// src/core/auth/AuthGate.jsx
import { useEffect, useState } from 'react';
import { useAuth } from './AuthContext';
import { supabase } from '../supabase/client';
import LoginPage from './LoginPage';
import PendingApproval from './PendingApproval';

export default function AuthGate({ children }) {
  const { user, loading } = useAuth();
  const [approval, setApproval] = useState('checking');

  useEffect(() => {
    if (!user) {
      setApproval('checking');
      return;
    }
    let cancelled = false;
    setApproval('checking');
    (async () => {
      try {
        const { data } = await supabase
          .from('profiles')
          .select('approved')
          .eq('id', user.id)
          .single();
        if (cancelled) return;
        setApproval(data?.approved ? 'approved' : 'pending');
      } catch {
        if (!cancelled) setApproval('pending');
      }
    })();
    return () => { cancelled = true; };
  }, [user]);

  if (loading) {
    return <div style={S.center}>Laden...</div>;
  }

  if (!user) {
    return <LoginPage />;
  }

  if (approval === 'checking') {
    return <div style={S.center}>Laden...</div>;
  }

  if (approval === 'pending') {
    return <PendingApproval />;
  }

  return children;
}

const S = {
  center: { minHeight: '100vh', display: 'flex', alignItems: 'center', justifyContent: 'center', opacity: 0.7 },
};