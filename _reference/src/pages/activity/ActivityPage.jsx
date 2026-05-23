import { useEffect, useState, useCallback, useMemo } from 'react';
import { useNavigate } from 'react-router-dom';
import {
  Activity, RefreshCw, Shield, Swords, Sparkles, BookOpen,
  Bug, UserPlus, Calendar, Filter,
} from 'lucide-react';
import { getSupabase }   from '@/lib/supabase';
import useStore          from '@/store/useStore';
import PageHeader        from '@/components/ui/PageHeader';
import Card              from '@/components/ui/Card';
import Button            from '@/components/ui/Button';
import Badge             from '@/components/ui/Badge';
import Spinner           from '@/components/ui/Spinner';
import EmptyState        from '@/components/ui/EmptyState';
import Avatar            from '@/components/ui/Avatar';
import { cn } from '@/utils/helpers';

// ─────────────────────────────────────────────────────────────────────────────
// Activity Feed
// ─────────────────────────────────────────────────────────────────────────────
// Cross-table firehose. Pulls the most-recent inserts from every NerdShelf
// table, normalises them into a single timeline, and shows who did what when.
// Useful for spotting bursts of activity, new sign-ups, or whether the app is
// being used at all.
// ─────────────────────────────────────────────────────────────────────────────

const LIMIT_PER_SOURCE = 50;

// Each source maps a table to (a) how to fetch and (b) how to render the row.
const SOURCES = [
  {
    key:   'profile',
    label: 'Sign-up',
    icon:  UserPlus,
    color: 'text-emerald-500',
    table: 'profiles',
    select: 'id, email, created_at',
    timeField: 'created_at',
    render: r => ({ primary: r.email, secondary: 'hat sich registriert' }),
    userField: 'id',
    emailField: 'email',
  },
  {
    key:   'character',
    label: 'Charakter',
    icon:  Shield,
    color: 'text-violet-500',
    table: 'dnd_characters',
    select: 'id, name, user_id, created_at',
    timeField: 'created_at',
    render: r => ({ primary: r.name || '(unbenannt)', secondary: 'Charakter erstellt' }),
    userField: 'user_id',
  },
  {
    key:   'campaign',
    label: 'Campaign',
    icon:  Swords,
    color: 'text-brand-500',
    table: 'dnd_campaigns',
    select: 'id, name, gm_id, created_at',
    timeField: 'created_at',
    render: r => ({ primary: r.name, secondary: 'Campaign erstellt' }),
    userField: 'gm_id',
  },
  {
    key:   'member',
    label: 'Beitritt',
    icon:  UserPlus,
    color: 'text-sky-500',
    table: 'dnd_campaign_members',
    select: 'id, campaign_id, user_id, player_name, joined_at, card',
    timeField: 'joined_at',
    render: r => ({
      primary: r.player_name || '(Spieler)',
      secondary: `ist Campaign beigetreten${r.card?.name ? ` als ${r.card.name}` : ''}`,
    }),
    userField: 'user_id',
  },
  {
    key:   'event',
    label: 'Termin',
    icon:  Calendar,
    color: 'text-amber-500',
    table: 'dnd_events',
    select: 'id, title, campaign_id, created_by, created_at, starts_at',
    timeField: 'created_at',
    render: r => ({ primary: r.title, secondary: 'Termin angelegt' }),
    userField: 'created_by',
  },
  {
    key:   'deck',
    label: 'MTG Deck',
    icon:  Sparkles,
    color: 'text-sky-500',
    table: 'mtg_decks',
    select: 'id, name, user_id, created_at',
    timeField: 'created_at',
    render: r => ({ primary: r.name || '(unbenannt)', secondary: 'Deck angelegt' }),
    userField: 'user_id',
  },
  {
    key:   'army',
    label: 'WH40k Armee',
    icon:  BookOpen,
    color: 'text-amber-500',
    table: 'wh40k_armies',
    select: 'id, name, user_id, created_at',
    timeField: 'created_at',
    render: r => ({ primary: r.name || '(unbenannt)', secondary: 'Armee angelegt' }),
    userField: 'user_id',
  },
  {
    key:   'bug',
    label: 'Bug Report',
    icon:  Bug,
    color: 'text-red-500',
    table: 'bug_reports',
    select: 'id, title, user_id, priority, status, created_at',
    timeField: 'created_at',
    render: r => ({
      primary: r.title || '(ohne Titel)',
      secondary: `Bug Report (${r.priority || 'unknown'})`,
    }),
    userField: 'user_id',
  },
];

const FILTERS = [
  { key: 'all',       label: 'Alle' },
  { key: 'profile',   label: 'Users' },
  { key: 'character', label: 'Charaktere' },
  { key: 'campaign',  label: 'Campaigns' },
  { key: 'event',     label: 'Termine' },
  { key: 'bug',       label: 'Bugs' },
];

export default function ActivityPage() {
  const { addToast } = useStore();
  const navigate     = useNavigate();

  const [items,    setItems]    = useState([]);   // merged timeline
  const [profiles, setProfiles] = useState([]);
  const [loading,  setLoading]  = useState(true);
  const [filter,   setFilter]   = useState('all');

  const load = useCallback(async () => {
    setLoading(true);
    try {
      const supabase = getSupabase();

      // Profiles for email lookup
      const { data: ps } = await supabase.from('profiles').select('id, email');
      const emails = Object.fromEntries((ps ?? []).map(p => [p.id, p.email]));
      setProfiles(ps ?? []);

      // Pull from every source in parallel.
      const results = await Promise.all(SOURCES.map(async src => {
        try {
          const { data } = await supabase
            .from(src.table)
            .select(src.select)
            .order(src.timeField, { ascending: false })
            .limit(LIMIT_PER_SOURCE);
          return (data ?? []).map(r => {
            const { primary, secondary } = src.render(r);
            const userId = src.userField ? r[src.userField] : null;
            const email  = (src.emailField && r[src.emailField]) || (userId && emails[userId]) || null;
            return {
              sourceKey: src.key,
              label:     src.label,
              icon:      src.icon,
              color:     src.color,
              ts:        r[src.timeField],
              primary,
              secondary,
              userId,
              email,
            };
          });
        } catch {
          return [];
        }
      }));

      const merged = results.flat().sort((a, b) => new Date(b.ts) - new Date(a.ts));
      setItems(merged);
    } catch (err) {
      addToast({ type: 'error', message: `Fehler: ${err.message}` });
    } finally {
      setLoading(false);
    }
  }, [addToast]);

  useEffect(() => { load(); }, [load]);

  const filtered = useMemo(
    () => filter === 'all' ? items : items.filter(i => i.sourceKey === filter),
    [items, filter]
  );

  // Group by day
  const grouped = useMemo(() => {
    const buckets = new Map();
    for (const it of filtered) {
      const d = new Date(it.ts);
      const key = `${d.getFullYear()}-${d.getMonth()}-${d.getDate()}`;
      if (!buckets.has(key)) buckets.set(key, { date: d, label: dayLabel(d), items: [] });
      buckets.get(key).items.push(it);
    }
    return [...buckets.values()];
  }, [filtered]);

  return (
    <div>
      <PageHeader
        title="Activity Feed"
        description="Was wann im NerdShelf passiert ist — neue User, Charaktere, Campaigns, Bugs."
        actions={
          <Button variant="outline" size="sm" leftIcon={<RefreshCw size={14} />} onClick={load} loading={loading}>
            Refresh
          </Button>
        }
      />

      {/* Filter */}
      <div className="flex flex-wrap items-center gap-1 mb-4 rounded-lg border border-slate-200 dark:border-slate-700 p-1 bg-slate-50 dark:bg-slate-900 self-start w-fit">
        <Filter size={12} className="ml-2 mr-1 text-slate-400" />
        {FILTERS.map(f => (
          <button
            key={f.key}
            onClick={() => setFilter(f.key)}
            className={cn(
              'px-3 py-1 rounded-md text-xs font-medium transition-all',
              filter === f.key
                ? 'bg-white dark:bg-slate-700 text-slate-900 dark:text-white shadow-sm'
                : 'text-slate-500 dark:text-slate-400 hover:text-slate-700 dark:hover:text-slate-200'
            )}
          >
            {f.label}
          </button>
        ))}
      </div>

      {/* Feed */}
      {loading ? (
        <div className="flex justify-center py-16"><Spinner size="lg" /></div>
      ) : grouped.length === 0 ? (
        <Card>
          <Card.Content>
            <EmptyState icon={<Activity size={24} />} title="Keine Aktivität" description="Mit aktuellem Filter ist nichts zu sehen." />
          </Card.Content>
        </Card>
      ) : (
        <div className="space-y-5">
          {grouped.map(bucket => (
            <Card key={bucket.label}>
              <Card.Header>
                <div className="flex items-center justify-between">
                  <Card.Title>{bucket.label}</Card.Title>
                  <Badge size="sm" variant="default">{bucket.items.length}</Badge>
                </div>
              </Card.Header>
              <Card.Content>
                <ol className="relative border-l-2 border-slate-100 dark:border-slate-800 pl-4 space-y-3">
                  {bucket.items.map((it, i) => {
                    const Icon = it.icon;
                    return (
                      <li key={`${it.sourceKey}-${i}-${it.ts}`} className="relative">
                        <span className={cn(
                          'absolute -left-[22px] top-1 flex h-4 w-4 items-center justify-center rounded-full bg-white dark:bg-slate-900 border-2 border-slate-200 dark:border-slate-700',
                        )}>
                          <Icon size={9} className={it.color} />
                        </span>
                        <div className="flex items-start gap-3">
                          <div className="flex-1 min-w-0">
                            <div className="flex items-center gap-2 flex-wrap">
                              <Badge size="sm" variant="default">{it.label}</Badge>
                              <p className="text-sm font-medium text-slate-800 dark:text-slate-200 truncate">{it.primary}</p>
                            </div>
                            <p className="text-xs text-slate-500 dark:text-slate-400 mt-0.5 truncate">
                              {it.secondary}
                            </p>
                          </div>
                          <div className="flex items-center gap-2 shrink-0">
                            {it.email && (
                              <button
                                onClick={() => navigate('/users')}
                                className="flex items-center gap-1.5 hover:bg-slate-100 dark:hover:bg-slate-800 rounded px-1 py-0.5 transition-colors"
                                title={it.email}
                              >
                                <Avatar name={it.email} size="xs" />
                                <span className="hidden md:inline text-[10px] text-slate-500 dark:text-slate-400 truncate max-w-[140px]">
                                  {it.email}
                                </span>
                              </button>
                            )}
                            <span className="text-[10px] text-slate-400 tabular-nums whitespace-nowrap">
                              {timeOnly(it.ts)}
                            </span>
                          </div>
                        </div>
                      </li>
                    );
                  })}
                </ol>
              </Card.Content>
            </Card>
          ))}
        </div>
      )}
    </div>
  );
}

// ─────────────────────────────────────────────────────────────────────────────
// Helpers
// ─────────────────────────────────────────────────────────────────────────────
function dayLabel(d) {
  const today = new Date(); today.setHours(0, 0, 0, 0);
  const yest  = new Date(today); yest.setDate(yest.getDate() - 1);
  const tgt   = new Date(d);     tgt.setHours(0, 0, 0, 0);
  if (tgt.getTime() === today.getTime()) return 'Heute';
  if (tgt.getTime() === yest.getTime())  return 'Gestern';
  return d.toLocaleDateString('de-DE', { weekday: 'long', day: '2-digit', month: '2-digit', year: 'numeric' });
}

function timeOnly(iso) {
  return new Date(iso).toLocaleTimeString('de-DE', { hour: '2-digit', minute: '2-digit' });
}
