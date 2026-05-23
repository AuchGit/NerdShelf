import { useEffect, useState, useCallback, useMemo } from 'react';
import {
  Swords, RefreshCw, Search, Trash2, Calendar, Users, Crown,
  ChevronRight, ChevronDown, Hash, Copy, ExternalLink, AlertCircle,
} from 'lucide-react';
import { getSupabase } from '@/lib/supabase';
import useStore        from '@/store/useStore';
import PageHeader      from '@/components/ui/PageHeader';
import Card            from '@/components/ui/Card';
import Button          from '@/components/ui/Button';
import Input           from '@/components/ui/Input';
import Badge           from '@/components/ui/Badge';
import Spinner         from '@/components/ui/Spinner';
import EmptyState      from '@/components/ui/EmptyState';
import ConfirmDialog   from '@/components/ui/ConfirmDialog';
import Avatar          from '@/components/ui/Avatar';
import { formatDate, cn } from '@/utils/helpers';

// ─────────────────────────────────────────────────────────────────────────────
// Campaigns Admin
// ─────────────────────────────────────────────────────────────────────────────
// Cross-tenant view of every D&D campaign in the database — independent of who
// is the GM. Admin can inspect members + events, copy the join token, jump to
// the underlying tables in the database browser, and force-delete a campaign
// (cascade removes members + events).
// ─────────────────────────────────────────────────────────────────────────────
export default function CampaignsAdminPage() {
  const { addToast } = useStore();

  const [campaigns, setCampaigns] = useState([]);
  const [profiles,  setProfiles]  = useState([]);   // gm lookup
  const [members,   setMembers]   = useState([]);
  const [events,    setEvents]    = useState([]);
  const [loading,   setLoading]   = useState(true);
  const [search,    setSearch]    = useState('');
  const [expanded,  setExpanded]  = useState(null); // campaign id
  const [confirmDelete, setConfirmDelete] = useState(null);
  const [busy, setBusy] = useState(false);

  const load = useCallback(async () => {
    setLoading(true);
    try {
      const supabase = getSupabase();
      const [c, p, m, e] = await Promise.all([
        supabase.from('dnd_campaigns').select('*').order('created_at', { ascending: false }),
        supabase.from('profiles').select('id, email'),
        supabase.from('dnd_campaign_members').select('*'),
        supabase.from('dnd_events').select('*').order('starts_at', { ascending: true }),
      ]);
      setCampaigns(c.data ?? []);
      setProfiles(p.data ?? []);
      setMembers(m.data ?? []);
      setEvents(e.data ?? []);
    } catch (err) {
      addToast({ type: 'error', message: `Fehler: ${err.message}` });
    } finally {
      setLoading(false);
    }
  }, [addToast]);

  useEffect(() => { load(); }, [load]);

  // ── Lookups ────────────────────────────────────────────────
  const emailById = useMemo(() => {
    const m = {};
    for (const p of profiles) m[p.id] = p.email;
    return m;
  }, [profiles]);

  const membersByCampaign = useMemo(() => {
    const m = {};
    for (const r of members) (m[r.campaign_id] = m[r.campaign_id] || []).push(r);
    return m;
  }, [members]);

  const eventsByCampaign = useMemo(() => {
    const m = {};
    for (const r of events) (m[r.campaign_id] = m[r.campaign_id] || []).push(r);
    return m;
  }, [events]);

  // ── Filter ─────────────────────────────────────────────────
  const filtered = useMemo(() => {
    const q = search.trim().toLowerCase();
    if (!q) return campaigns;
    return campaigns.filter(c => {
      const gmEmail = emailById[c.gm_id] ?? '';
      return (
        c.name?.toLowerCase().includes(q) ||
        c.join_token?.toLowerCase().includes(q) ||
        gmEmail.toLowerCase().includes(q)
      );
    });
  }, [campaigns, search, emailById]);

  const handleDelete = async () => {
    const id = confirmDelete;
    setConfirmDelete(null);
    setBusy(true);
    try {
      const supabase = getSupabase();
      const { error } = await supabase.from('dnd_campaigns').delete().eq('id', id);
      if (error) throw error;
      setCampaigns(prev => prev.filter(c => c.id !== id));
      setMembers(prev  => prev.filter(m => m.campaign_id !== id));
      setEvents(prev   => prev.filter(e => e.campaign_id !== id));
      addToast({ type: 'success', message: 'Campaign gelöscht.' });
    } catch (err) {
      addToast({ type: 'error', message: err.message });
    } finally {
      setBusy(false);
    }
  };

  const copyToken = async (token) => {
    try {
      await navigator.clipboard.writeText(token);
      addToast({ type: 'success', message: `Token ${token} kopiert.` });
    } catch {
      addToast({ type: 'error', message: 'Konnte nicht kopiert werden.' });
    }
  };

  const totalMembers = members.length;
  const totalEvents  = events.length;
  const upcomingEvents = events.filter(e => new Date(e.starts_at) >= new Date()).length;

  return (
    <div>
      <PageHeader
        title="Campaigns"
        description="Alle D&D Campaigns über alle Spielleiter — Mitglieder, Termine, Force-Delete."
        actions={
          <Button variant="outline" size="sm" leftIcon={<RefreshCw size={14} />} onClick={load} loading={loading}>
            Refresh
          </Button>
        }
      />

      {/* Stats */}
      <div className="grid grid-cols-2 sm:grid-cols-4 gap-4 mb-6">
        {[
          { label: 'Campaigns',  value: campaigns.length },
          { label: 'Mitglieder', value: totalMembers },
          { label: 'Termine',    value: totalEvents },
          { label: 'Kommend',    value: upcomingEvents, warn: upcomingEvents > 0 },
        ].map(({ label, value, warn }) => (
          <Card key={label}>
            <Card.Content className="pt-4 pb-4">
              <p className="text-xs font-medium text-slate-500 dark:text-slate-400 uppercase tracking-wide mb-1">{label}</p>
              <p className={cn('font-display text-2xl font-extrabold', warn ? 'text-amber-500' : 'text-slate-900 dark:text-white')}>{value}</p>
            </Card.Content>
          </Card>
        ))}
      </div>

      {/* Search */}
      <div className="mb-4">
        <Input
          placeholder="Nach Campaign, Token oder GM-Email suchen…"
          value={search}
          onChange={e => setSearch(e.target.value)}
          leftElement={<Search size={14} />}
        />
      </div>

      {/* List */}
      <Card>
        {loading ? (
          <div className="flex justify-center py-16"><Spinner size="lg" /></div>
        ) : filtered.length === 0 ? (
          <Card.Content>
            <EmptyState
              icon={<Swords size={24} />}
              title={campaigns.length === 0 ? 'Noch keine Campaigns' : 'Nichts gefunden'}
              description={campaigns.length === 0 ? 'Sobald jemand eine Campaign erstellt erscheint sie hier.' : 'Andere Suche probieren.'}
            />
          </Card.Content>
        ) : (
          <div className="divide-y divide-slate-100 dark:divide-slate-800">
            {filtered.map(c => {
              const isOpen   = expanded === c.id;
              const cMembers = membersByCampaign[c.id] ?? [];
              const cEvents  = eventsByCampaign[c.id] ?? [];
              const next = cEvents.find(e => new Date(e.starts_at) >= new Date());
              return (
                <div key={c.id}>
                  {/* Row */}
                  <button
                    onClick={() => setExpanded(isOpen ? null : c.id)}
                    className="w-full flex items-center gap-3 px-4 py-3 hover:bg-slate-50 dark:hover:bg-slate-800/50 transition-colors text-left"
                  >
                    {isOpen
                      ? <ChevronDown size={14} className="text-slate-400 shrink-0" />
                      : <ChevronRight size={14} className="text-slate-400 shrink-0" />}
                    <div className="flex-1 min-w-0">
                      <div className="flex items-center gap-2">
                        <p className="font-medium text-slate-800 dark:text-slate-200 truncate">{c.name}</p>
                        <Badge variant="primary" size="sm">
                          <Hash size={9} /> {c.join_token}
                        </Badge>
                      </div>
                      <p className="text-xs text-slate-500 dark:text-slate-400 truncate">
                        GM: {emailById[c.gm_id] ?? <span className="italic text-amber-500">unbekannt ({c.gm_id?.slice(0, 8)}…)</span>}
                        {' · '}erstellt {formatDate(c.created_at)}
                      </p>
                    </div>
                    <div className="hidden sm:flex items-center gap-3 text-xs text-slate-500 dark:text-slate-400 shrink-0">
                      <span className="flex items-center gap-1"><Users size={11} /> {cMembers.length}</span>
                      <span className="flex items-center gap-1"><Calendar size={11} /> {cEvents.length}</span>
                    </div>
                    <button
                      onClick={(e) => { e.stopPropagation(); copyToken(c.join_token); }}
                      title="Token kopieren"
                      className="p-1.5 rounded-md text-slate-400 dark:text-slate-500 hover:bg-brand-100 dark:hover:bg-brand-950 hover:text-brand-700 transition-all"
                    >
                      <Copy size={13} />
                    </button>
                    <button
                      onClick={(e) => { e.stopPropagation(); setConfirmDelete(c.id); }}
                      title="Campaign löschen"
                      className="p-1.5 rounded-md text-slate-400 dark:text-slate-500 hover:bg-red-100 dark:hover:bg-red-950 hover:text-red-700 transition-all"
                    >
                      <Trash2 size={13} />
                    </button>
                  </button>

                  {/* Expanded */}
                  {isOpen && (
                    <div className="px-4 pb-4 bg-slate-50/50 dark:bg-slate-900/50 border-l-2 border-brand-500/40 ml-4 mr-2 mb-2 rounded-r-lg">
                      {c.description && (
                        <p className="pt-3 text-xs text-slate-600 dark:text-slate-400 italic">{c.description}</p>
                      )}

                      {/* Members */}
                      <div className="pt-3">
                        <div className="flex items-center gap-2 mb-2">
                          <Users size={12} className="text-slate-400" />
                          <p className="text-[10px] font-bold uppercase tracking-wider text-slate-500 dark:text-slate-400">
                            Mitglieder ({cMembers.length})
                          </p>
                        </div>
                        {cMembers.length === 0 ? (
                          <p className="text-xs text-slate-400 italic">Noch keine Spieler beigetreten.</p>
                        ) : (
                          <div className="grid grid-cols-1 sm:grid-cols-2 gap-2">
                            {cMembers.map(m => (
                              <div key={m.id} className="flex items-center gap-2 px-2.5 py-1.5 rounded-md bg-white dark:bg-slate-900 border border-slate-200 dark:border-slate-700">
                                <Avatar name={emailById[m.user_id] ?? m.user_id} size="xs" />
                                <div className="flex-1 min-w-0">
                                  <p className="text-xs font-medium text-slate-700 dark:text-slate-300 truncate">
                                    {m.player_name || '(kein Name)'}
                                  </p>
                                  <p className="text-[10px] text-slate-400 truncate">
                                    {emailById[m.user_id] ?? m.user_id?.slice(0, 8) + '…'}
                                    {m.card?.name && ` · ${m.card.name}`}
                                  </p>
                                </div>
                                {c.gm_id === m.user_id && (
                                  <Crown size={11} className="text-amber-500 shrink-0" title="GM" />
                                )}
                              </div>
                            ))}
                          </div>
                        )}
                      </div>

                      {/* Events */}
                      <div className="pt-3 pb-3">
                        <div className="flex items-center gap-2 mb-2">
                          <Calendar size={12} className="text-slate-400" />
                          <p className="text-[10px] font-bold uppercase tracking-wider text-slate-500 dark:text-slate-400">
                            Termine ({cEvents.length})
                          </p>
                          {next && (
                            <Badge variant="info" size="sm">
                              nächster {formatDate(next.starts_at, { includeTime: true })}
                            </Badge>
                          )}
                        </div>
                        {cEvents.length === 0 ? (
                          <p className="text-xs text-slate-400 italic">Keine Termine geplant.</p>
                        ) : (
                          <ul className="space-y-1">
                            {cEvents.slice(0, 5).map(e => {
                              const past = new Date(e.starts_at) < new Date();
                              return (
                                <li key={e.id} className={cn(
                                  'flex items-center gap-2 px-2.5 py-1.5 rounded-md bg-white dark:bg-slate-900 border border-slate-200 dark:border-slate-700 text-xs',
                                  past && 'opacity-50'
                                )}>
                                  <Calendar size={10} className={past ? 'text-slate-400' : 'text-brand-500'} />
                                  <span className="flex-1 truncate text-slate-700 dark:text-slate-300">{e.title}</span>
                                  <span className="text-slate-400 tabular-nums">{formatDate(e.starts_at, { includeTime: true })}</span>
                                </li>
                              );
                            })}
                            {cEvents.length > 5 && (
                              <li className="text-[10px] text-slate-400 italic px-2.5">… und {cEvents.length - 5} weitere</li>
                            )}
                          </ul>
                        )}
                      </div>

                      {/* Quick links */}
                      <div className="flex flex-wrap gap-1.5 pb-3 pt-1">
                        <a
                          href={`/database?table=dnd_campaign_members`}
                          className="inline-flex items-center gap-1 px-2 py-1 rounded text-[10px] font-mono bg-slate-100 dark:bg-slate-800 text-slate-600 dark:text-slate-400 hover:bg-brand-50 dark:hover:bg-brand-950 hover:text-brand-700 transition-all"
                        >
                          <ExternalLink size={9} /> members im DB-Browser
                        </a>
                        <a
                          href={`/database?table=dnd_events`}
                          className="inline-flex items-center gap-1 px-2 py-1 rounded text-[10px] font-mono bg-slate-100 dark:bg-slate-800 text-slate-600 dark:text-slate-400 hover:bg-brand-50 dark:hover:bg-brand-950 hover:text-brand-700 transition-all"
                        >
                          <ExternalLink size={9} /> events im DB-Browser
                        </a>
                      </div>
                    </div>
                  )}
                </div>
              );
            })}
          </div>
        )}
      </Card>

      <ConfirmDialog
        open={!!confirmDelete}
        onClose={() => setConfirmDelete(null)}
        onConfirm={handleDelete}
        loading={busy}
        title="Campaign löschen?"
        description="Cascade entfernt alle Mitglieder und Termine. Charaktere bleiben erhalten."
        confirmLabel="Löschen"
      />
    </div>
  );
}
