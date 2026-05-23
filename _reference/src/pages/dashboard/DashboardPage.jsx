import { useEffect, useState, useCallback, useRef } from 'react';
import { useNavigate } from 'react-router-dom';
import {
  Bug, RefreshCw, ExternalLink, Database, Users,
  AlertTriangle, AlertCircle, Info, Clock, Eye,
  CheckCircle2, ArrowRight, UserCheck, Zap,
  Activity, TrendingUp, Terminal, ChevronRight,
  Wrench, Shield, WifiOff
} from 'lucide-react';
import { getSupabase }       from '@/lib/supabase';
import { getSupabaseConfig } from '@/lib/config';
import { useAuth }           from '@/contexts/AuthContext';
import useStore              from '@/store/useStore';
import Card                  from '@/components/ui/Card';
import Button                from '@/components/ui/Button';
import Spinner               from '@/components/ui/Spinner';
import Avatar                from '@/components/ui/Avatar';
import Badge                 from '@/components/ui/Badge';
import { formatDate, cn }    from '@/utils/helpers';
import { useRefreshContext }   from '@/App';

const PRIORITY_ORDER = { high: 0, medium: 1, low: 2 };
const PRIORITY_CFG = {
  high:   { label: 'High',   dot: 'bg-red-500',  text: 'text-red-600 dark:text-red-400',    bg: 'bg-red-50 dark:bg-red-950/60',    border: 'border-red-200 dark:border-red-900',    Icon: AlertTriangle },
  medium: { label: 'Medium', dot: 'bg-amber-500', text: 'text-amber-600 dark:text-amber-400', bg: 'bg-amber-50 dark:bg-amber-950/60', border: 'border-amber-200 dark:border-amber-900', Icon: AlertCircle },
  low:    { label: 'Low',    dot: 'bg-sky-400',   text: 'text-sky-600 dark:text-sky-400',     bg: 'bg-sky-50 dark:bg-sky-950/60',    border: 'border-sky-200 dark:border-sky-900',    Icon: Info },
};
const STATUS_CFG = {
  open:        { label: 'Offen',          Icon: Clock,        color: 'text-red-500'     },
  seen:        { label: 'Gesehen',        Icon: Eye,          color: 'text-amber-500'   },
  in_progress: { label: 'In Bearbeitung', Icon: Wrench,       color: 'text-sky-500'     },
  resolved:    { label: 'Gelöst',         Icon: CheckCircle2, color: 'text-emerald-500' },
  closed:      { label: 'Geschlossen',    Icon: CheckCircle2, color: 'text-slate-400'   },
};

// ─── Safe query helper — never throws ────────────────────────────────────────
async function safeQuery(fn) {
  try {
    const res = await fn();
    if (res.error) { console.warn('[Dashboard]', res.error.message); return []; }
    return res.data ?? [];
  } catch (e) {
    console.warn('[Dashboard]', e.message);
    return [];
  }
}

export default function DashboardPage() {
  const { profile }  = useAuth();
  const navigate     = useNavigate();
  const { addToast } = useStore();

  const [profiles,     setProfiles]     = useState([]);
  const [bugs,         setBugs]         = useState([]);
  const [tables,       setTables]       = useState([]);
  const [chars,        setChars]        = useState([]);
  const [campaigns,    setCampaigns]    = useState([]);
  const [events,       setEvents]       = useState([]);
  const [mtgDecks,     setMtgDecks]     = useState([]);
  const [wh40kArmies,  setWh40kArmies]  = useState([]);
  const [loading,      setLoading]      = useState(true);
  const [approving,    setApproving]    = useState({});
  const [closingBug,   setClosingBug]   = useState({});

  const { supabaseUrl } = getSupabaseConfig();
  const projectRef = supabaseUrl?.match(/https:\/\/([^.]+)/)?.[1] ?? null;

  // ── Load all data independently ───────────────────────────────────────────
  const load = useCallback(async () => {
    setLoading(true);
    const supabase = getSupabase();

    const [p, b, t, c, ca, ev, dk, ar] = await Promise.all([
      safeQuery(() => supabase.from('profiles').select('*').order('created_at', { ascending: false })),
      safeQuery(() => supabase.from('bug_reports').select('*').order('created_at', { ascending: false })),
      safeQuery(() => supabase.rpc('get_public_tables')),
      safeQuery(() => supabase.from('dnd_characters').select('id, user_id, created_at')),
      safeQuery(() => supabase.from('dnd_campaigns').select('id, gm_id, name, join_token, created_at')),
      safeQuery(() => supabase.from('dnd_events').select('id, campaign_id, title, starts_at').order('starts_at', { ascending: true })),
      safeQuery(() => supabase.from('mtg_decks').select('id, user_id')),
      safeQuery(() => supabase.from('wh40k_armies').select('id, user_id')),
    ]);

    setProfiles(p);
    setBugs(b);
    setTables(t.map(r => (typeof r === 'string' ? r : r.table_name)));
    setChars(c);
    setCampaigns(ca);
    setEvents(ev);
    setMtgDecks(dk);
    setWh40kArmies(ar);
    setLoading(false);
  }, []);

  useEffect(() => { load(); }, [load]);

  // ── Auto-refresh: react to background poll data from App-level hook ────────
  const { lastPollData, triggerRefresh } = useRefreshContext();
  const prevPollTs = useRef(null);

  useEffect(() => {
    if (!lastPollData || lastPollData.ts === prevPollTs.current) return;
    prevPollTs.current = lastPollData.ts;
    // Full reload so all derived state is consistent
    load();
  }, [lastPollData, load]);

  // ── Derived data ──────────────────────────────────────────────────────────
  const pendingUsers = profiles.filter(u => !u.approved);
  const approvedUsers = profiles.filter(u => u.approved);

  const openBugs = bugs
    .filter(b => b.status !== 'resolved' && b.status !== 'closed')
    .sort((a, b) => {
      const pd = (PRIORITY_ORDER[a.priority ?? 'medium'] ?? 1) - (PRIORITY_ORDER[b.priority ?? 'medium'] ?? 1);
      return pd !== 0 ? pd : new Date(b.created_at) - new Date(a.created_at);
    });

  const unreadBugs  = bugs.filter(b => b.status === 'open');
  const criticalBugs = bugs.filter(b => b.priority === 'high' && b.status !== 'resolved' && b.status !== 'closed');
  const withLogs     = bugs.filter(b => b.console_log || b.error_log).slice(0, 4);

  // ── Quick approve user ────────────────────────────────────────────────────
  const handleApprove = async (userId, email) => {
    setApproving(a => ({ ...a, [userId]: true }));
    try {
      const supabase = getSupabase();
      const { error } = await supabase.from('profiles').update({ approved: true }).eq('id', userId);
      if (error) throw error;
      setProfiles(prev => prev.map(u => u.id === userId ? { ...u, approved: true } : u));
      addToast({ type: 'success', message: `${email} freigegeben ✓` });
    } catch (e) {
      addToast({ type: 'error', message: e.message });
    } finally {
      setApproving(a => ({ ...a, [userId]: false }));
    }
  };

  // ── Quick close bug ───────────────────────────────────────────────────────
  const handleCloseBug = async (bugId, e) => {
    e.stopPropagation();
    setClosingBug(c => ({ ...c, [bugId]: true }));
    try {
      const supabase = getSupabase();
      const { error } = await supabase.from('bug_reports').update({ status: 'resolved' }).eq('id', bugId);
      if (error) throw error;
      setBugs(prev => prev.map(b => b.id === bugId ? { ...b, status: 'resolved' } : b));
      addToast({ type: 'success', message: 'Bug als gelöst markiert ✓' });
    } catch (e) {
      addToast({ type: 'error', message: e.message });
    } finally {
      setClosingBug(c => ({ ...c, [bugId]: false }));
    }
  };

  // ── Quick mark seen ───────────────────────────────────────────────────────
  const handleMarkSeen = async (bugId, e) => {
    e.stopPropagation();
    setClosingBug(c => ({ ...c, [bugId]: true }));
    try {
      const supabase = getSupabase();
      const { error } = await supabase.from('bug_reports').update({ status: 'seen' }).eq('id', bugId);
      if (error) throw error;
      setBugs(prev => prev.map(b => b.id === bugId ? { ...b, status: 'seen' } : b));
    } catch (e) {
      addToast({ type: 'error', message: e.message });
    } finally {
      setClosingBug(c => ({ ...c, [bugId]: false }));
    }
  };

  return (
    <div className="space-y-5">

      {/* ── Header ─────────────────────────────────────────────────────── */}
      <div className="flex items-center justify-between gap-4">
        <div>
          <h1 className="page-title">
            Hey {profile?.email?.split('@')[0] ?? 'Admin'} 👋
          </h1>
          <p className="mt-0.5 text-sm text-slate-500 dark:text-slate-400">
            Hier ist dein Projekt-Überblick.
          </p>
        </div>
        <div className="flex gap-2 shrink-0">
          {projectRef && (
            <a href={`https://supabase.com/dashboard/project/${projectRef}`} target="_blank" rel="noreferrer">
              <Button variant="outline" size="sm" rightIcon={<ExternalLink size={13} />}>Supabase</Button>
            </a>
          )}
          <Button variant="outline" size="sm" leftIcon={<RefreshCw size={13} />} onClick={() => { load(); triggerRefresh(); }} loading={loading}>
            Refresh
          </Button>
        </div>
      </div>

      {loading ? (
        <div className="flex justify-center py-24"><Spinner size="xl" /></div>
      ) : (
        <>
          {/* ── KPI Strip ────────────────────────────────────────────────── */}
          <div className="grid grid-cols-2 sm:grid-cols-3 lg:grid-cols-6 gap-3">
            <KpiCard label="Aktive User"   value={approvedUsers.length}   icon={Users}         onClick={() => navigate('/users')} />
            <KpiCard label="Ausstehend"    value={pendingUsers.length}    icon={Clock}         warn={pendingUsers.length > 0}    onClick={() => navigate('/users')} />
            <KpiCard label="Offene Bugs"   value={openBugs.length}        icon={Bug}           warn={openBugs.length > 0}        onClick={() => navigate('/bugreports')} />
            <KpiCard label="Ungelesen"     value={unreadBugs.length}      icon={Eye}           warn={unreadBugs.length > 0}      onClick={() => navigate('/bugreports')} />
            <KpiCard label="Kritisch"      value={criticalBugs.length}    icon={AlertTriangle} crit={criticalBugs.length > 0}    onClick={() => navigate('/bugreports')} />
            <KpiCard label="Charaktere"    value={chars.length}           icon={Shield}                                          onClick={() => navigate('/database?table=dnd_characters')} />
          </div>

          {/* ── Main grid ────────────────────────────────────────────────── */}
          <div className="grid grid-cols-1 lg:grid-cols-3 gap-5">

            {/* LEFT col (spans 2) */}
            <div className="lg:col-span-2 space-y-5">

              {/* Critical block — only shown when critical bugs exist */}
              {criticalBugs.length > 0 && (
                <Card className="border-red-300 dark:border-red-800">
                  <Card.Header>
                    <div className="flex items-center justify-between">
                      <div className="flex items-center gap-2">
                        <AlertTriangle size={15} className="text-red-500" />
                        <Card.Title className="text-red-700 dark:text-red-400">
                          🚨 Kritische Bugs ({criticalBugs.length})
                        </Card.Title>
                      </div>
                      <NavBtn onClick={() => navigate('/bugreports')}>Alle öffnen</NavBtn>
                    </div>
                  </Card.Header>
                  <Card.Content>
                    <div className="space-y-2">
                      {criticalBugs.slice(0, 3).map(bug => (
                        <BugRow
                          key={bug.id}
                          bug={bug}
                          onOpen={() => navigate('/bugreports')}
                          onClose={e => handleCloseBug(bug.id, e)}
                          onSeen={e => handleMarkSeen(bug.id, e)}
                          loadingClose={!!closingBug[bug.id]}
                        />
                      ))}
                      {criticalBugs.length > 3 && <MoreBtn count={criticalBugs.length - 3} onClick={() => navigate('/bugreports')} />}
                    </div>
                  </Card.Content>
                </Card>
              )}

              {/* Unread bugs */}
              <Card>
                <Card.Header>
                  <div className="flex items-center justify-between">
                    <div className="flex items-center gap-2">
                      <Card.Title>Neue / Ungelesene Bugs</Card.Title>
                      {unreadBugs.length > 0 && <CountBadge count={unreadBugs.length} color="bg-red-500" />}
                    </div>
                    <NavBtn onClick={() => navigate('/bugreports')}>Alle Bug Reports</NavBtn>
                  </div>
                  <Card.Description>Status „offen" — noch nicht angesehen, sortiert nach Priorität</Card.Description>
                </Card.Header>
                <Card.Content>
                  {unreadBugs.length === 0 ? (
                    <AllClear text="Keine ungelesenen Bugs" />
                  ) : (
                    <div className="space-y-2">
                      {unreadBugs.slice(0, 5).map(bug => (
                        <BugRow
                          key={bug.id}
                          bug={bug}
                          onOpen={() => navigate('/bugreports')}
                          onClose={e => handleCloseBug(bug.id, e)}
                          onSeen={e => handleMarkSeen(bug.id, e)}
                          loadingClose={!!closingBug[bug.id]}
                        />
                      ))}
                      {unreadBugs.length > 5 && <MoreBtn count={unreadBugs.length - 5} onClick={() => navigate('/bugreports')} />}
                    </div>
                  )}
                </Card.Content>
              </Card>

              {/* All open bugs sorted by priority */}
              <Card>
                <Card.Header>
                  <div className="flex items-center justify-between">
                    <div className="flex items-center gap-2">
                      <Card.Title>Offene Bugs</Card.Title>
                      {openBugs.length > 0 && <CountBadge count={openBugs.length} color="bg-amber-500" />}
                    </div>
                    <NavBtn onClick={() => navigate('/bugreports')}>Verwalten</NavBtn>
                  </div>
                  <Card.Description>Nicht abgeschlossen — High → Medium → Low</Card.Description>
                </Card.Header>
                <Card.Content>
                  {openBugs.length === 0 ? (
                    <AllClear text="Alle Bugs sind abgeschlossen 🎉" />
                  ) : (
                    <div className="space-y-2">
                      {openBugs.slice(0, 7).map(bug => (
                        <BugRow
                          key={bug.id}
                          bug={bug}
                          onOpen={() => navigate('/bugreports')}
                          onClose={e => handleCloseBug(bug.id, e)}
                          onSeen={e => handleMarkSeen(bug.id, e)}
                          loadingClose={!!closingBug[bug.id]}
                          showStatus
                        />
                      ))}
                      {openBugs.length > 7 && <MoreBtn count={openBugs.length - 7} onClick={() => navigate('/bugreports')} />}
                    </div>
                  )}
                </Card.Content>
              </Card>

              {/* Logs */}
              {withLogs.length > 0 && (
                <Card>
                  <Card.Header>
                    <div className="flex items-center justify-between">
                      <div className="flex items-center gap-2">
                        <Terminal size={14} className="text-slate-400" />
                        <Card.Title>Bug Reports mit Logs</Card.Title>
                      </div>
                      <NavBtn onClick={() => navigate('/bugreports')}>Details</NavBtn>
                    </div>
                  </Card.Header>
                  <Card.Content>
                    <div className="space-y-2">
                      {withLogs.map(bug => (
                        <button key={bug.id} onClick={() => navigate('/bugreports')}
                          className="w-full flex items-start gap-3 px-3 py-2.5 rounded-lg bg-slate-950 border border-slate-800 hover:border-slate-600 transition-all text-left group">
                          <Terminal size={12} className="text-green-400 shrink-0 mt-0.5" />
                          <div className="flex-1 min-w-0">
                            <p className="text-xs font-mono text-slate-300 truncate">
                              {(bug.console_log || bug.error_log)?.split('\n')[0]?.slice(0, 90) ?? '—'}
                            </p>
                            <p className="text-[10px] text-slate-600 mt-0.5">
                              {bug.user_email ?? 'anonym'} · {formatDate(bug.created_at)}
                            </p>
                          </div>
                          <ChevronRight size={13} className="text-slate-700 group-hover:text-slate-400 transition-colors shrink-0 mt-0.5" />
                        </button>
                      ))}
                    </div>
                  </Card.Content>
                </Card>
              )}
            </div>

            {/* RIGHT col */}
            <div className="space-y-5">

              {/* Quick Actions */}
              <Card>
                <Card.Header>
                  <div className="flex items-center gap-2">
                    <Zap size={14} className="text-brand-500" />
                    <Card.Title>Quick Actions</Card.Title>
                  </div>
                </Card.Header>
                <Card.Content>
                  <div className="space-y-1.5">
                    {[
                      { label: 'Bug Reports',      icon: Bug,       to: '/bugreports', badge: openBugs.length,    bColor: 'bg-red-500'    },
                      { label: 'User freigeben',   icon: UserCheck, to: '/users',      badge: pendingUsers.length, bColor: 'bg-amber-500'  },
                      { label: 'Datenbank Browser',icon: Database,  to: '/database',   badge: 0,                   bColor: ''              },
                      { label: 'Campaigns',        icon: Shield,    to: '/campaigns',  badge: campaigns.length,   bColor: 'bg-brand-500'  },
                      { label: 'Activity Feed',    icon: Activity,  to: '/activity',   badge: 0,                   bColor: ''              },
                      { label: 'Health Check',     icon: Wrench,    to: '/health',     badge: 0,                   bColor: ''              },
                    ].map(({ label, icon: Icon, to, badge, bColor }) => (
                      <button key={to + label} onClick={() => navigate(to)}
                        className="w-full flex items-center gap-3 px-3 py-2.5 rounded-lg border border-slate-200 dark:border-slate-800 hover:border-brand-300 dark:hover:border-brand-700 hover:bg-brand-50 dark:hover:bg-brand-950/40 transition-all group text-left">
                        <Icon size={14} className="text-brand-500 shrink-0" />
                        <span className="text-sm text-slate-700 dark:text-slate-300 flex-1">{label}</span>
                        {badge > 0 && <span className={cn('text-[10px] font-bold text-white px-1.5 py-0.5 rounded-full', bColor)}>{badge}</span>}
                        <ChevronRight size={13} className="text-slate-300 group-hover:text-brand-500 transition-colors" />
                      </button>
                    ))}
                  </div>
                </Card.Content>
              </Card>

              {/* Pending users with inline approve */}
              <Card className={cn(pendingUsers.length > 0 && 'border-amber-200 dark:border-amber-900')}>
                <Card.Header>
                  <div className="flex items-center justify-between">
                    <div className="flex items-center gap-2">
                      <Clock size={14} className={pendingUsers.length > 0 ? 'text-amber-500' : 'text-slate-400'} />
                      <Card.Title>Ausstehende User</Card.Title>
                      {pendingUsers.length > 0 && <CountBadge count={pendingUsers.length} color="bg-amber-500" />}
                    </div>
                    <NavBtn onClick={() => navigate('/users')}>Alle</NavBtn>
                  </div>
                </Card.Header>
                <Card.Content>
                  {pendingUsers.length === 0 ? (
                    <AllClear text="Alle User sind freigegeben" />
                  ) : (
                    <div className="space-y-2">
                      {pendingUsers.slice(0, 5).map(u => (
                        <div key={u.id} className="flex items-center gap-2.5 py-1.5 border-b border-slate-100 dark:border-slate-800 last:border-0">
                          <Avatar name={u.email} size="xs" />
                          <div className="flex-1 min-w-0">
                            <p className="text-xs font-medium text-slate-700 dark:text-slate-300 truncate">{u.email}</p>
                            <p className="text-[10px] text-slate-400">{formatDate(u.created_at)}</p>
                          </div>
                          <Button size="xs" onClick={() => handleApprove(u.id, u.email)} loading={!!approving[u.id]} leftIcon={<UserCheck size={11} />}>
                            OK
                          </Button>
                        </div>
                      ))}
                      {pendingUsers.length > 5 && <MoreBtn count={pendingUsers.length - 5} onClick={() => navigate('/users')} />}
                    </div>
                  )}
                </Card.Content>
              </Card>

              {/* User Activity */}
              <Card>
                <Card.Header>
                  <div className="flex items-center gap-2">
                    <Activity size={14} className="text-slate-400" />
                    <Card.Title>User Übersicht</Card.Title>
                  </div>
                </Card.Header>
                <Card.Content>
                  <div className="space-y-2.5">
                    {[
                      { label: 'Aktiv / freigegeben', value: approvedUsers.length,                              total: profiles.length, color: 'bg-brand-500' },
                      { label: 'Ausstehend',           value: pendingUsers.length,                               total: profiles.length, color: 'bg-amber-400' },
                      { label: 'Admins',               value: profiles.filter(u => u.is_admin).length,           total: profiles.length, color: 'bg-violet-500' },
                    ].map(({ label, value, total, color }) => {
                      const pct = total > 0 ? Math.max(Math.round((value / total) * 100), value > 0 ? 6 : 0) : 0;
                      return (
                        <div key={label}>
                          <div className="flex items-center justify-between mb-1">
                            <span className="text-xs text-slate-500 dark:text-slate-400">{label}</span>
                            <span className="text-xs font-bold text-slate-700 dark:text-slate-300 tabular-nums">{value}</span>
                          </div>
                          <div className="h-1.5 w-full bg-slate-100 dark:bg-slate-800 rounded-full overflow-hidden">
                            <div className={cn('h-full rounded-full transition-all duration-500', color)} style={{ width: `${pct}%` }} />
                          </div>
                        </div>
                      );
                    })}
                    <p className="text-[10px] text-slate-400 pt-1">{profiles.length} User gesamt</p>
                  </div>
                </Card.Content>
              </Card>

              {/* Feature counters */}
              <Card>
                <Card.Header>
                  <div className="flex items-center gap-2">
                    <TrendingUp size={14} className="text-slate-400" />
                    <Card.Title>Feature Nutzung</Card.Title>
                  </div>
                </Card.Header>
                <Card.Content>
                  <div className="divide-y divide-slate-100 dark:divide-slate-800">
                    {[
                      { label: 'D&D Charaktere', value: chars.length,                                                                                  icon: Shield,       to: '/database?table=dnd_characters' },
                      { label: 'D&D Campaigns',  value: campaigns.length,                                                                              icon: Shield,       to: '/database?table=dnd_campaigns'  },
                      { label: 'Termine',        value: events.length,                                                                                 icon: Clock,        to: '/database?table=dnd_events'     },
                      { label: 'MTG Decks',      value: mtgDecks.length,                                                                               icon: Database,     to: '/database?table=mtg_decks'      },
                      { label: 'WH40k Armeen',   value: wh40kArmies.length,                                                                            icon: Database,     to: '/database?table=wh40k_armies'   },
                      { label: 'Bug Reports',    value: bugs.length,                                                                                   icon: Bug,          to: '/bugreports'                    },
                      { label: 'Davon gelöst',   value: bugs.filter(b => b.status === 'resolved' || b.status === 'closed').length,                     icon: CheckCircle2, to: '/bugreports'                    },
                      { label: 'DB-Tabellen',    value: tables.length,                                                                                 icon: Database,     to: '/database'                      },
                    ].map(({ label, value, icon: Icon, to }) => (
                      <button key={label} onClick={() => navigate(to)}
                        className="w-full flex items-center gap-3 py-2 hover:opacity-75 transition-opacity text-left">
                        <Icon size={13} className="text-slate-400 shrink-0" />
                        <span className="text-xs text-slate-600 dark:text-slate-400 flex-1">{label}</span>
                        <span className="font-display font-bold text-slate-800 dark:text-slate-200 tabular-nums">{value}</span>
                      </button>
                    ))}
                  </div>
                </Card.Content>
              </Card>

              {/* Tables shortcut */}
              {tables.length > 0 && (
                <Card>
                  <Card.Header>
                    <div className="flex items-center justify-between">
                      <Card.Title>Tabellen</Card.Title>
                      <NavBtn onClick={() => navigate('/database')}>Browser</NavBtn>
                    </div>
                  </Card.Header>
                  <Card.Content>
                    <div className="flex flex-wrap gap-1.5">
                      {tables.map(t => (
                        <button key={t} onClick={() => navigate(`/database?table=${t}`)}
                          className="flex items-center gap-1 px-2 py-1 rounded-md text-[11px] font-mono bg-slate-100 dark:bg-slate-800 text-slate-600 dark:text-slate-400 hover:bg-brand-50 dark:hover:bg-brand-950 hover:text-brand-700 dark:hover:text-brand-300 border border-transparent hover:border-brand-200 dark:hover:border-brand-800 transition-all">
                          <Database size={9} className="shrink-0" />
                          {t}
                        </button>
                      ))}
                    </div>
                  </Card.Content>
                </Card>
              )}
            </div>
          </div>
        </>
      )}
    </div>
  );
}

// ─── Sub-components ───────────────────────────────────────────────────────────

function BugRow({ bug, onOpen, onClose, onSeen, loadingClose, showStatus = false }) {
  const p    = PRIORITY_CFG[bug.priority ?? 'medium'] ?? PRIORITY_CFG.medium;
  const s    = STATUS_CFG[bug.status]   ?? STATUS_CFG.open;
  const PIcon = p.Icon;
  const SIcon = s.Icon;
  const isUnread = bug.status === 'open';

  return (
    <div className={cn('flex items-center gap-2 px-3 py-2.5 rounded-lg border transition-all group', p.bg, p.border)}>
      <PIcon size={13} className={cn(p.text, 'shrink-0')} />

      <button onClick={onOpen} className="flex-1 min-w-0 text-left">
        <p className="text-xs font-medium text-slate-800 dark:text-slate-200 truncate">
          {bug.description?.slice(0, 70)}{(bug.description?.length ?? 0) > 70 ? '…' : ''}
        </p>
        <div className="flex items-center gap-1.5 mt-0.5">
          <span className="text-[10px] text-slate-400">{bug.user_email ?? 'anonym'}</span>
          <span className="text-[10px] text-slate-300 dark:text-slate-700">·</span>
          <span className="text-[10px] text-slate-400">{formatDate(bug.created_at)}</span>
          {showStatus && (
            <>
              <span className="text-[10px] text-slate-300 dark:text-slate-700">·</span>
              <SIcon size={10} className={s.color} />
              <span className="text-[10px] text-slate-400">{s.label}</span>
            </>
          )}
        </div>
      </button>

      {/* Action buttons */}
      <div className="flex items-center gap-1 shrink-0">
        <span className={cn('text-[10px] font-bold hidden sm:inline', p.text)}>{p.label}</span>
        {isUnread && (
          <button onClick={onSeen} disabled={loadingClose} title="Als gesehen markieren"
            className="p-1 rounded hover:bg-amber-200 dark:hover:bg-amber-900 transition-colors disabled:opacity-50"
            aria-label="Gesehen">
            <Eye size={12} className="text-amber-600 dark:text-amber-400" />
          </button>
        )}
        <button onClick={onClose} disabled={loadingClose} title="Als gelöst markieren"
          className="p-1 rounded hover:bg-emerald-200 dark:hover:bg-emerald-900 transition-colors disabled:opacity-50"
          aria-label="Gelöst">
          {loadingClose
            ? <Spinner size="xs" />
            : <CheckCircle2 size={12} className="text-emerald-600 dark:text-emerald-400" />
          }
        </button>
        <button onClick={onOpen} title="Details öffnen"
          className="p-1 rounded hover:bg-white/60 dark:hover:bg-slate-700 transition-colors">
          <ChevronRight size={12} className="text-slate-400 group-hover:text-slate-600 dark:group-hover:text-slate-300" />
        </button>
      </div>
    </div>
  );
}

function NavBtn({ onClick, children }) {
  return (
    <button onClick={onClick} className="flex items-center gap-1 text-xs font-medium text-brand-600 dark:text-brand-400 hover:underline">
      {children} <ArrowRight size={11} />
    </button>
  );
}

function MoreBtn({ count, onClick }) {
  return (
    <button onClick={onClick} className="w-full text-center text-xs text-brand-600 dark:text-brand-400 hover:underline py-1">
      + {count} weitere anzeigen
    </button>
  );
}

function CountBadge({ count, color }) {
  return (
    <span className={cn('inline-flex items-center justify-center w-5 h-5 rounded-full text-white text-[10px] font-bold', color)}>
      {count}
    </span>
  );
}

function AllClear({ text }) {
  return (
    <div className="flex items-center gap-2 py-3 text-emerald-600 dark:text-emerald-400">
      <CheckCircle2 size={15} className="shrink-0" />
      <span className="text-sm font-medium">{text}</span>
    </div>
  );
}

function KpiCard({ label, value, icon: Icon, warn = false, crit = false, onClick }) {
  return (
    <Card
      className={cn(
        'cursor-pointer transition-all duration-150 hover:-translate-y-0.5 hover:shadow-md',
        crit  && 'border-l-4 border-l-red-500 border-red-200 dark:border-red-900',
        warn && !crit && 'border-l-4 border-l-amber-400 border-amber-200 dark:border-amber-900',
      )}
      onClick={onClick}
    >
      <Card.Content className="py-3 px-4">
        <Icon size={14} className={cn('mb-1.5', crit ? 'text-red-500' : warn ? 'text-amber-500' : 'text-slate-400 dark:text-slate-600')} />
        <p className={cn('font-display text-2xl font-extrabold leading-none', crit ? 'text-red-500' : warn ? 'text-amber-500' : 'text-slate-900 dark:text-white')}>
          {value}
        </p>
        <p className="text-[11px] font-medium text-slate-500 dark:text-slate-400 mt-1">{label}</p>
      </Card.Content>
    </Card>
  );
}
