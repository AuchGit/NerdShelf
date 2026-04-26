// src/core/auth/LoginPage.jsx
import { useState } from 'react';
import { supabase } from '../supabase/client';

export default function LoginPage() {
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [playerName, setPlayerName] = useState('');
  const [error, setError] = useState(null);
  const [success, setSuccess] = useState(null);
  const [loading, setLoading] = useState(false);
  const [attempt, setAttempt] = useState(0);
  const [mode, setMode] = useState('login');

  async function handleLogin() {
    setLoading(true); setError(null); setSuccess(null);
    for (let i = 0; i < 3; i++) {
      setAttempt(i + 1);
      try {
        const { error: authErr } = await supabase.auth.signInWithPassword({ email, password });
        if (!authErr) { setLoading(false); return; }
        if (authErr.status && authErr.status < 500) {
          if (authErr.message?.includes('Email not confirmed')) {
            setError('Bitte bestätige zuerst deine Email-Adresse. Prüfe dein Postfach.');
          } else {
            setError('Login fehlgeschlagen. Email oder Passwort falsch.');
          }
          setLoading(false); return;
        }
      } catch (e) { /* retry */ }
      if (i < 2) await new Promise(r => setTimeout(r, 2000));
    }
    setError('Verbindung fehlgeschlagen. Bitte prüfe dein Netz und versuche es erneut.');
    setLoading(false);
  }

  async function handleSignup() {
    const trimmedPlayer = playerName.trim();
    if (trimmedPlayer.length < 2) { setError('Bitte einen Player-Namen mit mindestens 2 Zeichen eingeben.'); return; }
    if (trimmedPlayer.length > 50) { setError('Player-Name darf maximal 50 Zeichen haben.'); return; }
    if (!email.trim()) { setError('Bitte Email eingeben.'); return; }
    if (password.length < 6) { setError('Passwort muss mindestens 6 Zeichen haben.'); return; }
    setLoading(true); setError(null); setSuccess(null);
    const { data: signupData, error: signupErr } = await supabase.auth.signUp({ email, password });
    if (signupErr) {
      setLoading(false);
      setError(signupErr.message?.includes('already registered')
        ? 'Diese Email ist bereits registriert.'
        : signupErr.message);
      return;
    }
    const newUserId = signupData?.user?.id;
    if (newUserId) {
      // Try update first (row may exist via DB trigger); fall back to insert.
      const { data: upd, error: updErr } = await supabase
        .from('profiles')
        .update({ player_name: trimmedPlayer })
        .eq('id', newUserId)
        .select()
        .maybeSingle();
      if (updErr || !upd) {
        const { error: insErr } = await supabase
          .from('profiles')
          .insert({ id: newUserId, player_name: trimmedPlayer });
        if (insErr) console.warn('[signup] could not save player_name:', insErr.message);
      }
    }
    setLoading(false);
    setSuccess('Account erstellt! Bitte bestätige deine Email und warte auf die Freischaltung durch einen Admin.');
    setMode('login');
  }

  function handleSubmit() {
    mode === 'login' ? handleLogin() : handleSignup();
  }

  return (
    <div style={S.container}>
      <div style={S.card}>
        <h1 style={S.title}>NerdShelf</h1>
        <p style={S.subtitle}>
          {mode === 'login' ? 'Melde dich an um weiterzumachen' : 'Neuen Account erstellen'}
        </p>
        {mode === 'signup' && (
          <input
            style={S.input} type="text" placeholder="Player-Name" maxLength={50}
            value={playerName} onChange={e => setPlayerName(e.target.value)}
          />
        )}
        <input
          style={S.input} type="email" placeholder="Email"
          value={email} onChange={e => setEmail(e.target.value)}
        />
        <input
          style={S.input} type="password" placeholder="Passwort"
          value={password} onChange={e => setPassword(e.target.value)}
          onKeyDown={e => e.key === 'Enter' && handleSubmit()}
        />
        {error && <p style={S.error}>{error}</p>}
        {success && <p style={S.success}>{success}</p>}
        <button style={S.button} onClick={handleSubmit} disabled={loading}>
          {loading
            ? (attempt > 1 ? `Versuch ${attempt}/3…` : 'Einen Moment...')
            : mode === 'login' ? 'Anmelden' : 'Account erstellen'}
        </button>
        <button
          style={S.switchBtn}
          onClick={() => {
            setMode(mode === 'login' ? 'signup' : 'login');
            setError(null); setSuccess(null);
          }}
        >
          {mode === 'login'
            ? 'Noch kein Account? → Registrieren'
            : 'Bereits registriert? → Anmelden'}
        </button>
        {mode === 'signup' && (
          <p style={S.hint}>
            Nach der Registrierung musst du deine Email bestätigen und auf die Freischaltung durch einen Admin warten.
          </p>
        )}
      </div>
    </div>
  );
}

const S = {
  container: { minHeight: '100vh', display: 'flex', alignItems: 'center', justifyContent: 'center', padding: 20 },
  card: { borderRadius: 12, padding: 40, width: 380, display: 'flex', flexDirection: 'column', gap: 16, border: '1px solid rgba(127,127,127,0.3)', boxShadow: '0 4px 32px rgba(0,0,0,0.1)' },
  title: { textAlign: 'center', margin: 0, fontSize: 24 },
  subtitle: { textAlign: 'center', margin: 0, fontSize: 14, opacity: 0.7 },
  input: { padding: 12, borderRadius: 8, border: '1px solid rgba(127,127,127,0.4)', background: 'transparent', color: 'inherit', fontSize: 16 },
  button: { padding: 12, borderRadius: 8, border: 'none', background: '#4a7fc1', color: '#fff', fontSize: 16, fontWeight: 'bold', cursor: 'pointer' },
  switchBtn: { background: 'none', border: 'none', color: 'inherit', opacity: 0.7, fontSize: 13, cursor: 'pointer', textAlign: 'center', textDecoration: 'underline' },
  error: { color: '#cc3333', fontSize: 13, textAlign: 'center', margin: 0, lineHeight: 1.5 },
  success: { color: '#2d8a2d', fontSize: 13, textAlign: 'center', margin: 0, lineHeight: 1.5 },
  hint: { fontSize: 11, textAlign: 'center', margin: 0, lineHeight: 1.5, opacity: 0.5 },
};