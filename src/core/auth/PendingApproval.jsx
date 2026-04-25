// src/core/auth/PendingApproval.jsx
import { useAuth } from './AuthContext';

export default function PendingApproval() {
  const { user, signOut } = useAuth();

  return (
    <div style={S.container}>
      <div style={S.card}>
        <div style={S.icon}>⏳</div>
        <h2 style={S.title}>Warte auf Freischaltung</h2>
        <p style={S.text}>
          Dein Account (<strong>{user?.email}</strong>) wurde noch nicht freigeschaltet.
          Ein Admin wird deinen Zugang prüfen.
        </p>
        <button style={S.button} onClick={signOut}>Abmelden</button>
      </div>
    </div>
  );
}

const S = {
  container: { minHeight: '100vh', display: 'flex', alignItems: 'center', justifyContent: 'center', padding: 20 },
  card: { borderRadius: 12, padding: 40, width: 380, textAlign: 'center', border: '1px solid rgba(127,127,127,0.3)', boxShadow: '0 4px 32px rgba(0,0,0,0.1)' },
  icon: { fontSize: 48, marginBottom: 16 },
  title: { margin: '0 0 12px', fontSize: 20 },
  text: { fontSize: 14, lineHeight: 1.6, marginBottom: 20, opacity: 0.8 },
  button: { padding: '10px 20px', borderRadius: 8, border: '1px solid rgba(127,127,127,0.4)', background: 'transparent', color: 'inherit', cursor: 'pointer', fontSize: 14 },
};