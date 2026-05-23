import { useEffect, useState, useCallback } from 'react';
import { useNavigate } from 'react-router-dom';
import {
  Stethoscope, RefreshCw, CheckCircle2, AlertTriangle,
  ArrowRight, Database, Bug, Swords, Calendar, Users,
} from 'lucide-react';
import { getSupabase } from '@/lib/supabase';
import useStore        from '@/store/useStore';
import PageHeader      from '@/components/ui/PageHeader';
import Card            from '@/components/ui/Card';
import Button          from '@/components/ui/Button';
import Badge           from '@/components/ui/Badge';
import Spinner         from '@/components/ui/Spinner';
import { cn, formatDate } from '@/utils/helpers';

// ─────────────────────────────────────────────────────────────────────────────
// Health Check Page
// ─────────────────────────────────────────────────────────────────────────────
// Surfaces orphaned rows, stale state, and other things an admin should look
// at. Each check returns a list of items; a check with no items shows green.
// ─────────────────────────────────────────────────────────────────────────────
//
// Adding a new check:
//   1. Append to CHECK_DEFS below: { key, label, severity, icon, run(supabase) }
//   2. `run` returns `{ items: [...], detail?: string, link?: string }`
//   3. `items` should be an array of plain objects; rendered as a key→value list.
//

const STALE_PENDING_DAYS = 7;
const STALE_BUG_DAYS     = 30;

const CHECK_DEFS = [
  // ── 1. Orphaned campaign members (character was deleted) ─────────────────
  {
    key: 'orphaned_members',
    label: 'Verwaiste Campaign-Mitgliedschaften',
    severity: 'warning',
    icon: Swords,
    link: '/database?table=dnd_campaign_members',
    async run(supabase) {
      const [{ data: members }, { data: chars }] = await Promise.all([
        supabase.from('dnd_campaign_members').select('id, campaign_id, character_id, player_name'),
        supabase.from('dnd_characters').select('id'),
      ]);
      const charSet = new Set((chars ?? []).map(c => c.id));
      const orphans = (members ?? []).filter(m => !charSet.has(m.character_id));
      return {
        items: orphans.map(m => ({
          'member id':   m.id,
          'player_name': m.player_name || '(leer)',
          'character_id': m.character_id,
        })),
        detail: 'Mitgliedschaft verweist auf einen gelöschten Charakter. Bereinigen empfohlen.',
      };
    },
  },

  // ── 2. Campaigns ohne Mitglieder (außer GM) ──────────────────────────────
  {
    key: 'empty_campaigns',
    label: 'Leere Campaigns',
    severity: 'info',
    icon: Swords,
    link: '/campaigns',
    async run(supabase) {
      const [{ data: camps }, { data: members }] = await Promise.all([
        supabase.from('dnd_campaigns').select('id, name, gm_id, created_at, join_token'),
        supabase.from('dnd_campaign_members').select('campaign_id'),
      ]);
      const counts = new Map();
      for (const m of (members ?? [])) counts.set(m.campaign_id, (counts.get(m.campaign_id) || 0) + 1);
      const empty = (camps ?? []).filter(c => (counts.get(c.id) || 0) === 0);
      return {
        items: empty.map(c => ({
          name:   c.name,
          token:  c.join_token,
          erstellt: formatDate(c.created_at),
        })),
        detail: 'Campaign hat keine Spieler. Token noch nicht geteilt oder niemand beigetreten.',
      };
    },
  },

  // ── 3. Pending users die nie freigegeben wurden ──────────────────────────
  {
    key: 'stale_pending_users',
    label: `Pending User > ${STALE_PENDING_DAYS} Tage`,
    severity: 'warning',
    icon: Users,
    link: '/users',
    async run(supabase) {
      const cutoff = new Date(Date.now() - STALE_PENDING_DAYS * 86400000).toISOString();
      const { data } = await supabase
        .from('profiles')
        .select('id, email, created_at, approved')
        .eq('approved', false)
        .lt('created_at', cutoff);
      return {
        items: (data ?? []).map(u => ({ email: u.email, registriert: formatDate(u.created_at) })),
        detail: `User wartet seit ${STALE_PENDING_DAYS}+ Tagen auf Freigabe.`,
      };
    },
  },

  // ── 4. Alte ungelöste Bugs ───────────────────────────────────────────────
  {
    key: 'stale_bugs',
    label: `Offene Bugs > ${STALE_BUG_DAYS} Tage`,
    severity: 'warning',
    icon: Bug,
    link: '/bugreports',
    async run(supabase) {
      const cutoff = new Date(Date.now() - STALE_BUG_DAYS * 86400000).toISOString();
      const { data } = await supabase
        .from('bug_reports')
        .select('id, title, priority, status, created_at')
        .in('status', ['open', 'seen', 'in_progress'])
        .lt('created_at', cutoff);
      return {
        items: (data ?? []).map(b => ({
          titel:     b.title || '(ohne Titel)',
          priorität: b.priority || '—',
          status:    b.status,
          erstellt:  formatDate(b.created_at),
        })),
        detail: `Bug seit ${STALE_BUG_DAYS}+ Tagen offen.`,
      };
    },
  },

  // ── 5. Vergangene Termine die nicht aufgeräumt wurden ────────────────────
  {
    key: 'past_events',
    label: 'Termine in der Vergangenheit',
    severity: 'info',
    icon: Calendar,
    link: '/database?table=dnd_events',
    async run(supabase) {
      const now = new Date().toISOString();
      const { data } = await supabase
        .from('dnd_events')
        .select('id, title, campaign_id, starts_at')
        .lt('starts_at', now)
        .order('starts_at', { ascending: false })
        .limit(20);
      return {
        items: (data ?? []).map(e => ({ titel: e.title, war_am: formatDate(e.starts_at, { includeTime: true }) })),
        detail: 'Vergangene Termine bleiben für die Historie erhalten — informativ, nicht kritisch.',
      };
    },
  },

  // ── 6. Bug Reports mit Logs (interessant für Debugging) ──────────────────
  {
    key: 'bugs_with_logs',
    label: 'Offene Bugs mit Logs',
    severity: 'info',
    icon: Bug,
    link: '/bugreports',
    async run(supabase) {
      const { data } = await supabase
        .from('bug_reports')
        .select('id, title, priority, status, console_log, error_log, created_at')
        .in('status', ['open', 'seen', 'in_progress']);
      const withLogs = (data ?? []).filter(b => b.console_log || b.error_log);
      return {
        items: withLogs.map(b => ({
          titel:     b.title || '(ohne Titel)',
          priorität: b.priority || '—',
          erstellt:  formatDate(b.created_at),
        })),
        detail: 'Bug Report hat Logs angehängt — gute Diagnosegrundlage.',
      };
    },
  },

  // ── 7. Share-tokens nobody imported ─────────────────────────────────────
  // Surfaces entities with a published share_token that no user has
  // imported yet. Informational — useful to see which tokens are "live"
  // but unused.
  {
    key: 'pending_imports',
    label: 'Geteilte Tokens ohne Importer',
    severity: 'info',
    icon: Database,
    link: '/database?table=mtg_imports',
    async run(supabase) {
      try {
        const tables = [
          { src: 'mtg_decks',      imp: 'mtg_imports',   label: 'MTG Deck' },
          { src: 'wh40k_armies',   imp: 'wh40k_imports', label: 'WH40K Armee' },
          { src: 'dnd_characters', imp: 'dnd_imports',   label: 'D&D Charakter' },
        ];
        const items = [];
        for (const { src, imp, label } of tables) {
          const [{ data: shared }, { data: imported }] = await Promise.all([
            supabase.from(src).select('id, name, share_token, created_at').not('share_token', 'is', null),
            supabase.from(imp).select('source_token'),
          ]);
          const usedTokens = new Set((imported ?? []).map(r => r.source_token));
          for (const row of (shared ?? [])) {
            if (!usedTokens.has(row.share_token)) {
              items.push({
                typ:     label,
                name:    row.name || '(unbenannt)',
                token:   row.share_token,
                erstellt: formatDate(row.created_at),
              });
            }
          }
        }
        return {
          items,
          detail: 'Share-Token existiert, aber niemand hat ihn bisher importiert.',
        };
      } catch {
        // Tables may not exist on older deployments — silently skip.
        return { items: [], skipped: true };
      }
    },
  },
];

const SEVERITY_CFG = {
  warning: { color: 'text-amber-500', bg: 'bg-amber-50 dark:bg-amber-950/40', border: 'border-amber-200 dark:border-amber-900' },
  info:    { color: 'text-sky-500',   bg: 'bg-sky-50 dark:bg-sky-950/40',     border: 'border-sky-200 dark:border-sky-900'     },
  critical:{ color: 'text-red-500',   bg: 'bg-red-50 dark:bg-red-950/40',     border: 'border-red-200 dark:border-red-900'     },
};

export default function HealthPage() {
  const { addToast } = useStore();
  const navigate     = useNavigate();

  const [results, setResults] = useState({});  // key -> { items, detail }
  const [loading, setLoading] = useState(true);

  const run = useCallback(async () => {
    setLoading(true);
    try {
      const supabase = getSupabase();
      const entries = await Promise.all(CHECK_DEFS.map(async def => {
        try {
          const r = await def.run(supabase);
          return [def.key, r];
        } catch (e) {
          return [def.key, { items: [], error: e.message }];
        }
      }));
      setResults(Object.fromEntries(entries));
    } catch (err) {
      addToast({ type: 'error', message: `Fehler: ${err.message}` });
    } finally {
      setLoading(false);
    }
  }, [addToast]);

  useEffect(() => { run(); }, [run]);

  const issues = CHECK_DEFS.filter(d => (results[d.key]?.items?.length ?? 0) > 0);
  const clean  = CHECK_DEFS.filter(d => (results[d.key]?.items?.length ?? 0) === 0 && !results[d.key]?.skipped && !results[d.key]?.error);

  return (
    <div>
      <PageHeader
        title="Health Check"
        description="Verwaiste Daten, hängengebliebene Vorgänge, Dinge die Aufmerksamkeit brauchen."
        actions={
          <Button variant="outline" size="sm" leftIcon={<RefreshCw size={14} />} onClick={run} loading={loading}>
            Erneut prüfen
          </Button>
        }
      />

      {loading ? (
        <div className="flex justify-center py-16"><Spinner size="lg" /></div>
      ) : (
        <>
          {/* Summary */}
          <div className="grid grid-cols-2 sm:grid-cols-4 gap-4 mb-6">
            <Card>
              <Card.Content className="pt-4 pb-4">
                <p className="text-xs font-medium text-slate-500 dark:text-slate-400 uppercase tracking-wide mb-1">Checks gelaufen</p>
                <p className="font-display text-2xl font-extrabold text-slate-900 dark:text-white">{CHECK_DEFS.length}</p>
              </Card.Content>
            </Card>
            <Card className={cn(issues.length === 0 ? 'border-emerald-200 dark:border-emerald-900' : 'border-amber-200 dark:border-amber-900')}>
              <Card.Content className="pt-4 pb-4">
                <p className="text-xs font-medium text-slate-500 dark:text-slate-400 uppercase tracking-wide mb-1">Mit Befund</p>
                <p className={cn('font-display text-2xl font-extrabold', issues.length === 0 ? 'text-emerald-500' : 'text-amber-500')}>{issues.length}</p>
              </Card.Content>
            </Card>
            <Card>
              <Card.Content className="pt-4 pb-4">
                <p className="text-xs font-medium text-slate-500 dark:text-slate-400 uppercase tracking-wide mb-1">Sauber</p>
                <p className="font-display text-2xl font-extrabold text-emerald-500">{clean.length}</p>
              </Card.Content>
            </Card>
            <Card>
              <Card.Content className="pt-4 pb-4">
                <p className="text-xs font-medium text-slate-500 dark:text-slate-400 uppercase tracking-wide mb-1">Treffer gesamt</p>
                <p className="font-display text-2xl font-extrabold text-slate-900 dark:text-white tabular-nums">
                  {Object.values(results).reduce((s, r) => s + (r?.items?.length ?? 0), 0)}
                </p>
              </Card.Content>
            </Card>
          </div>

          {/* Issues */}
          {issues.length > 0 && (
            <div className="space-y-3 mb-6">
              <h2 className="text-sm font-bold uppercase tracking-wider text-slate-500 dark:text-slate-400 flex items-center gap-2">
                <AlertTriangle size={14} className="text-amber-500" />
                Aufmerksamkeit nötig
              </h2>
              {issues.map(def => {
                const r = results[def.key];
                return (
                  <CheckCard
                    key={def.key}
                    def={def}
                    items={r.items}
                    detail={r.detail}
                    onNavigate={def.link ? () => navigate(def.link) : null}
                  />
                );
              })}
            </div>
          )}

          {/* Clean */}
          <div className="space-y-3">
            <h2 className="text-sm font-bold uppercase tracking-wider text-slate-500 dark:text-slate-400 flex items-center gap-2">
              <CheckCircle2 size={14} className="text-emerald-500" />
              Alles in Ordnung ({clean.length})
            </h2>
            <Card>
              <Card.Content className="py-4">
                <ul className="space-y-1.5">
                  {clean.map(def => {
                    const Icon = def.icon;
                    return (
                      <li key={def.key} className="flex items-center gap-2 text-sm text-slate-600 dark:text-slate-400">
                        <CheckCircle2 size={13} className="text-emerald-500 shrink-0" />
                        <Icon size={12} className="text-slate-400 shrink-0" />
                        <span className="flex-1 truncate">{def.label}</span>
                        <span className="text-[10px] text-slate-400">0 Treffer</span>
                      </li>
                    );
                  })}
                </ul>
              </Card.Content>
            </Card>
          </div>
        </>
      )}
    </div>
  );
}

function CheckCard({ def, items, detail, onNavigate }) {
  const cfg  = SEVERITY_CFG[def.severity] ?? SEVERITY_CFG.info;
  const Icon = def.icon;
  const keys = items[0] ? Object.keys(items[0]) : [];
  const preview = items.slice(0, 5);

  return (
    <Card className={cn('border-2', cfg.border)}>
      <Card.Header>
        <div className="flex items-start justify-between gap-3">
          <div className="flex items-start gap-2 min-w-0">
            <Icon size={16} className={cn('shrink-0 mt-0.5', cfg.color)} />
            <div className="min-w-0">
              <Card.Title className="truncate">{def.label}</Card.Title>
              {detail && <Card.Description className="mt-0.5">{detail}</Card.Description>}
            </div>
          </div>
          <div className="flex items-center gap-2 shrink-0">
            <Badge size="md" variant={def.severity === 'warning' ? 'warning' : 'info'}>
              {items.length} {items.length === 1 ? 'Treffer' : 'Treffer'}
            </Badge>
            {onNavigate && (
              <Button size="xs" variant="outline" rightIcon={<ArrowRight size={11} />} onClick={onNavigate}>
                Öffnen
              </Button>
            )}
          </div>
        </div>
      </Card.Header>
      <Card.Content>
        <div className="overflow-x-auto rounded-lg border border-slate-100 dark:border-slate-800">
          <table className="w-full text-xs">
            <thead className="bg-slate-50 dark:bg-slate-900">
              <tr>
                {keys.map(k => (
                  <th key={k} className="px-3 py-2 text-left font-semibold text-slate-500 dark:text-slate-400 font-mono">{k}</th>
                ))}
              </tr>
            </thead>
            <tbody className="divide-y divide-slate-100 dark:divide-slate-800">
              {preview.map((it, i) => (
                <tr key={i}>
                  {keys.map(k => (
                    <td key={k} className="px-3 py-1.5 font-mono text-slate-700 dark:text-slate-300 whitespace-nowrap max-w-xs truncate">
                      {String(it[k] ?? '—')}
                    </td>
                  ))}
                </tr>
              ))}
            </tbody>
          </table>
        </div>
        {items.length > preview.length && (
          <p className="text-[10px] text-slate-400 mt-2 italic">… und {items.length - preview.length} weitere</p>
        )}
      </Card.Content>
    </Card>
  );
}
