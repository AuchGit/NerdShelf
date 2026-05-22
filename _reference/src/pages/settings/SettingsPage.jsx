import { useState, useEffect } from 'react';
import {
  Save, Sun, Moon, Monitor, Eye, EyeOff,
  RotateCcw, Server, Power, Bell, BellOff,
  Monitor as MonitorIcon, Info
} from 'lucide-react';
import { useTheme }          from '@/contexts/ThemeContext';
import { useAuth }           from '@/contexts/AuthContext';
import { getSupabaseConfig, saveSupabaseConfig } from '@/lib/config';
import { resetSupabaseClient }                   from '@/lib/supabase';
import useStore              from '@/store/useStore';
import PageHeader            from '@/components/ui/PageHeader';
import Card                  from '@/components/ui/Card';
import Button                from '@/components/ui/Button';
import Input                 from '@/components/ui/Input';
import Badge                 from '@/components/ui/Badge';
import { isTauri, setAutostart, getAutostart } from '@/hooks/useTauriNotifications';
import { cn }                from '@/utils/helpers';

export default function SettingsPage() {
  const { theme, setTheme } = useTheme();
  const { profile }         = useAuth();
  const { addToast }        = useStore();

  // ── Supabase config ───────────────────────────────────────────────────────
  const saved = getSupabaseConfig();
  const [supabaseUrl,     setSupabaseUrl]     = useState(saved.supabaseUrl);
  const [supabaseKey,     setSupabaseKey]     = useState(saved.supabaseAnonKey);
  const [showKey,         setShowKey]         = useState(false);
  const [savingSupabase,  setSavingSupabase]  = useState(false);

  // ── Tauri / Desktop ───────────────────────────────────────────────────────
  const isDesktop = isTauri();
  const [autostartEnabled, setAutostartEnabled] = useState(false);
  const [autostartLoading, setAutostartLoading] = useState(false);

  useEffect(() => {
    if (isDesktop) {
      getAutostart().then(val => setAutostartEnabled(!!val));
    }
  }, [isDesktop]);

  const handleToggleAutostart = async () => {
    setAutostartLoading(true);
    const newVal = !autostartEnabled;
    const ok = await setAutostart(newVal);
    if (ok !== false) {
      setAutostartEnabled(newVal);
      addToast({
        type: 'success',
        message: newVal ? 'Autostart aktiviert ✓' : 'Autostart deaktiviert',
      });
    } else {
      addToast({ type: 'error', message: 'Autostart konnte nicht geändert werden.' });
    }
    setAutostartLoading(false);
  };

  const handleSaveSupabase = async () => {
    if (!supabaseUrl.startsWith('https://')) {
      addToast({ type: 'error', message: 'URL muss mit https:// beginnen' });
      return;
    }
    if (!supabaseKey) {
      addToast({ type: 'error', message: 'Anon Key darf nicht leer sein' });
      return;
    }
    setSavingSupabase(true);
    saveSupabaseConfig({ supabaseUrl, supabaseAnonKey: supabaseKey });
    resetSupabaseClient();
    await new Promise(r => setTimeout(r, 500));
    setSavingSupabase(false);
    addToast({ type: 'success', message: 'Gespeichert — Seite neu laden zum Verbinden.' });
  };

  const handleResetSupabase = () => {
    saveSupabaseConfig(null);
    resetSupabaseClient();
    setSupabaseUrl(import.meta.env.VITE_SUPABASE_URL     || '');
    setSupabaseKey(import.meta.env.VITE_SUPABASE_ANON_KEY || '');
    addToast({ type: 'info', message: 'Zurückgesetzt auf .env Werte.' });
  };

  return (
    <div>
      <PageHeader title="Einstellungen" description="App-Konfiguration und Präferenzen." />

      <div className="grid gap-5 max-w-2xl">

        {/* Account */}
        <Card>
          <Card.Header>
            <Card.Title>Account</Card.Title>
          </Card.Header>
          <Card.Content>
            <div className="space-y-3">
              <InfoRow label="Email"   value={profile?.email} />
              <InfoRow label="Rolle"   value={profile?.is_admin ? 'Admin' : 'Member'} />
              <InfoRow label="Status"  value={profile?.approved ? 'Freigegeben' : 'Ausstehend'} />
            </div>
          </Card.Content>
        </Card>

        {/* Theme */}
        <Card>
          <Card.Header>
            <Card.Title>Erscheinungsbild</Card.Title>
            <Card.Description>Hell, Dunkel oder automatisch nach Systemeinstellung.</Card.Description>
          </Card.Header>
          <Card.Content>
            <div className="grid grid-cols-3 gap-3">
              {[
                { value: 'light',  label: 'Hell',   icon: Sun     },
                { value: 'system', label: 'System', icon: Monitor },
                { value: 'dark',   label: 'Dunkel', icon: Moon    },
              ].map(({ value, label, icon: Icon }) => (
                <button
                  key={value}
                  onClick={() => setTheme(value)}
                  className={cn(
                    'flex flex-col items-center gap-2 rounded-xl border-2 p-4 transition-all cursor-pointer',
                    theme === value
                      ? 'border-brand-500 bg-brand-50 dark:bg-brand-950/50 text-brand-700 dark:text-brand-300'
                      : 'border-slate-200 dark:border-slate-700 hover:border-slate-300 dark:hover:border-slate-600 text-slate-500 dark:text-slate-400'
                  )}
                >
                  <Icon size={20} />
                  <span className="text-sm font-medium">{label}</span>
                </button>
              ))}
            </div>
          </Card.Content>
        </Card>

        {/* Desktop / Tauri Settings */}
        <Card className={cn(!isDesktop && 'opacity-60')}>
          <Card.Header>
            <div className="flex items-center justify-between">
              <div className="flex items-center gap-2">
                <MonitorIcon size={16} className="text-slate-400" />
                <Card.Title>Desktop-Einstellungen</Card.Title>
              </div>
              {isDesktop
                ? <Badge variant="success" size="sm" dot>Desktop App</Badge>
                : <Badge variant="default" size="sm">Nur Desktop</Badge>
              }
            </div>
            <Card.Description>
              Diese Optionen sind nur verfügbar wenn SupaManager als Desktop-App (Tauri) läuft.
            </Card.Description>
          </Card.Header>
          <Card.Content>
            <div className="space-y-4">

              {/* Autostart toggle */}
              <div className="flex items-center justify-between py-3 border-b border-slate-100 dark:border-slate-800">
                <div>
                  <p className="text-sm font-semibold text-slate-800 dark:text-slate-200">
                    Mit Windows starten
                  </p>
                  <p className="text-xs text-slate-500 dark:text-slate-400 mt-0.5">
                    SupaManager startet automatisch minimiert in der Taskleiste.
                  </p>
                </div>
                <button
                  onClick={handleToggleAutostart}
                  disabled={!isDesktop || autostartLoading}
                  className={cn(
                    'relative inline-flex h-6 w-11 items-center rounded-full transition-colors duration-200',
                    'focus:outline-none focus:ring-2 focus:ring-brand-500 focus:ring-offset-2',
                    autostartEnabled ? 'bg-brand-600' : 'bg-slate-300 dark:bg-slate-700',
                    (!isDesktop || autostartLoading) && 'opacity-50 cursor-not-allowed'
                  )}
                  role="switch"
                  aria-checked={autostartEnabled}
                >
                  <span className={cn(
                    'inline-block h-4 w-4 transform rounded-full bg-white shadow transition-transform duration-200',
                    autostartEnabled ? 'translate-x-6' : 'translate-x-1'
                  )} />
                </button>
              </div>

              {/* Notifications info */}
              <div className="flex items-start gap-3 py-2">
                <Bell size={16} className="text-slate-400 shrink-0 mt-0.5" />
                <div>
                  <p className="text-sm font-semibold text-slate-800 dark:text-slate-200">
                    System-Benachrichtigungen
                  </p>
                  <p className="text-xs text-slate-500 dark:text-slate-400 mt-0.5">
                    Automatisch aktiv — du wirst benachrichtigt wenn neue Bug Reports oder neue User ankommen, auch wenn das Fenster minimiert ist.
                  </p>
                  {isDesktop && (
                    <p className="text-xs text-emerald-600 dark:text-emerald-400 mt-1 font-medium">
                      ✓ Aktiv — prüft alle 60 Sekunden
                    </p>
                  )}
                </div>
              </div>

              {/* Close-to-tray info */}
              <div className="flex items-start gap-3 py-2 border-t border-slate-100 dark:border-slate-800">
                <Info size={16} className="text-slate-400 shrink-0 mt-0.5" />
                <div>
                  <p className="text-sm font-semibold text-slate-800 dark:text-slate-200">
                    Fenster schließen → minimiert in Tray
                  </p>
                  <p className="text-xs text-slate-500 dark:text-slate-400 mt-0.5">
                    Klick auf X minimiert die App in den System-Tray statt sie zu beenden.
                    Rechtsklick auf das Tray-Icon → "Beenden" zum vollständigen Schließen.
                  </p>
                </div>
              </div>
            </div>
          </Card.Content>
        </Card>

        {/* Supabase Config */}
        <Card>
          <Card.Header>
            <div className="flex items-center gap-2">
              <Server size={16} className="text-slate-400" />
              <Card.Title>Supabase Konfiguration</Card.Title>
            </div>
            <Card.Description>
              Überschreibt die .env-Werte. Wird lokal gespeichert.
            </Card.Description>
          </Card.Header>
          <Card.Content>
            <div className="space-y-4">
              <Input
                label="Supabase Project URL"
                placeholder="https://xxxxxxxxxxxx.supabase.co"
                value={supabaseUrl}
                onChange={e => setSupabaseUrl(e.target.value)}
                hint="Project Settings → Data API → Project URL"
              />
              <Input
                label="Anon / Public Key"
                type={showKey ? 'text' : 'password'}
                placeholder="eyJhbGciOiJIUzI1NiIs..."
                value={supabaseKey}
                onChange={e => setSupabaseKey(e.target.value)}
                hint="Project Settings → Data API → anon public"
                rightElement={
                  <button type="button" onClick={() => setShowKey(v => !v)}
                    className="hover:text-slate-700 dark:hover:text-slate-200 transition-colors" tabIndex={-1}>
                    {showKey ? <EyeOff size={15} /> : <Eye size={15} />}
                  </button>
                }
              />
              <div className="flex gap-2 pt-1">
                <Button variant="outline" size="sm" leftIcon={<RotateCcw size={14} />} onClick={handleResetSupabase}>
                  .env verwenden
                </Button>
                <Button size="sm" leftIcon={<Save size={14} />} onClick={handleSaveSupabase} loading={savingSupabase}>
                  Speichern
                </Button>
              </div>
            </div>
          </Card.Content>
        </Card>

        {/* About */}
        <Card>
          <Card.Header><Card.Title>Über SupaManager</Card.Title></Card.Header>
          <Card.Content>
            <div className="space-y-2">
              <InfoRow label="Version"    value="1.0.0" />
              <InfoRow label="Framework"  value="React + Vite" />
              <InfoRow label="Desktop"    value={isDesktop ? 'Tauri ✓' : 'Browser (kein Tauri)'} />
              <InfoRow label="Backend"    value="Supabase" />
            </div>
          </Card.Content>
        </Card>
      </div>
    </div>
  );
}

function InfoRow({ label, value }) {
  return (
    <div className="flex items-center justify-between py-1.5 border-b border-slate-100 dark:border-slate-800 last:border-0">
      <span className="text-sm text-slate-500 dark:text-slate-400">{label}</span>
      <span className="text-sm font-semibold text-slate-800 dark:text-slate-200">{value}</span>
    </div>
  );
}
