import { useEffect, useState } from 'react';
import {
  Shield, Swords, Sparkles, BookOpen, Bug, Calendar, Crown,
  ExternalLink, Mail, Clock, CheckCircle2,
} from 'lucide-react';
import { getSupabase } from '@/lib/supabase';
import Modal           from '@/components/ui/Modal';
import Avatar          from '@/components/ui/Avatar';
import Badge           from '@/components/ui/Badge';
import Spinner         from '@/components/ui/Spinner';
import { formatDate, cn } from '@/utils/helpers';

// ─────────────────────────────────────────────────────────────────────────────
// Full breakdown of everything a user has across NerdShelf:
//   • D&D characters     (count + names)
//   • D&D campaigns      (as GM vs as player)
//   • D&D events created
//   • MTG decks
//   • WH40k armies
//   • Bug reports filed
// ─────────────────────────────────────────────────────────────────────────────
export default function UserDetailModal({ user, onClose }) {
  const [loading, setLoading] = useState(true);
  const [data,    setData]    = useState(null);

  useEffect(() => {
    if (!user) return;
    let cancelled = false;
    (async () => {
      setLoading(true);
      const supabase = getSupabase();
      const safe = async (q) => {
        try { const r = await q; return r.data ?? []; } catch { return []; }
      };
      const [chars, gmCamps, memberOf, evts, decks, armies, bugs] = await Promise.all([
        safe(supabase.from('dnd_characters').select('id, name, created_at, data').eq('user_id', user.id).order('created_at', { ascending: false })),
        safe(supabase.from('dnd_campaigns').select('id, name, join_token, created_at').eq('gm_id', user.id).order('created_at', { ascending: false })),
        safe(supabase.from('dnd_campaign_members').select('id, campaign_id, character_id, player_name, joined_at, card').eq('user_id', user.id).order('joined_at', { ascending: false })),
        safe(supabase.from('dnd_events').select('id, campaign_id, title, starts_at').eq('created_by', user.id).order('starts_at', { ascending: false })),
        safe(supabase.from('mtg_decks').select('id, name, created_at').eq('user_id', user.id).order('created_at', { ascending: false })),
        safe(supabase.from('wh40k_armies').select('id, name, created_at').eq('user_id', user.id).order('created_at', { ascending: false })),
        safe(supabase.from('bug_reports').select('id, title, status, priority, created_at').eq('user_id', user.id).order('created_at', { ascending: false })),
      ]);

      // Resolve campaign names for memberships (some campaigns may be the
      // user's own, others another GM's — we just need the names).
      let memberCampaignNames = {};
      if (memberOf.length > 0) {
        const ids = [...new Set(memberOf.map(m => m.campaign_id))];
        const { data: cs } = await supabase.from('dnd_campaigns').select('id, name').in('id', ids);
        memberCampaignNames = Object.fromEntries((cs ?? []).map(c => [c.id, c.name]));
      }

      if (cancelled) return;
      setData({ chars, gmCamps, memberOf, evts, decks, armies, bugs, memberCampaignNames });
      setLoading(false);
    })();
    return () => { cancelled = true; };
  }, [user]);

  if (!user) return null;

  const isAdmin = !!user.is_admin;

  return (
    <Modal open onClose={onClose} size="2xl" title={null} closable>
      <div className="-mt-2">
        {/* Header */}
        <div className="flex items-center gap-3 pb-4 border-b border-slate-100 dark:border-slate-800">
          <Avatar name={user.email} size="lg" />
          <div className="min-w-0 flex-1">
            <div className="flex items-center gap-2">
              <p className="font-display font-bold text-lg text-slate-900 dark:text-white truncate">{user.email}</p>
              {isAdmin && <Badge variant="primary" dot>Admin</Badge>}
              {user.approved
                ? <Badge variant="success" dot>Freigegeben</Badge>
                : <Badge variant="warning" dot>Ausstehend</Badge>}
            </div>
            <p className="text-xs text-slate-500 dark:text-slate-400 mt-0.5">
              <Mail size={10} className="inline-block mr-1" />
              registriert {formatDate(user.created_at)}
              {' · '}
              <span className="font-mono text-[10px]">{user.id?.slice(0, 8)}…</span>
            </p>
          </div>
        </div>

        {/* Body */}
        {loading || !data ? (
          <div className="flex justify-center py-12"><Spinner /></div>
        ) : (
          <div className="py-4 max-h-[65vh] overflow-y-auto space-y-4">

            {/* Top counters */}
            <div className="grid grid-cols-3 sm:grid-cols-6 gap-2">
              <CountTile icon={Shield}   label="Charaktere" value={data.chars.length}    color="text-violet-500" />
              <CountTile icon={Crown}    label="GM"         value={data.gmCamps.length}  color="text-amber-500"  />
              <CountTile icon={Swords}   label="Spielt in"  value={data.memberOf.length} color="text-brand-500"  />
              <CountTile icon={Calendar} label="Termine"    value={data.evts.length}     color="text-sky-500"    />
              <CountTile icon={Sparkles} label="Decks"      value={data.decks.length}    color="text-sky-500"    />
              <CountTile icon={BookOpen} label="Armeen"     value={data.armies.length}   color="text-amber-500"  />
            </div>

            <Section icon={Shield} label="D&D Charaktere" count={data.chars.length} accent="violet">
              {data.chars.length === 0
                ? <EmptyLine text="Keine Charaktere angelegt." />
                : (
                  <ul className="space-y-1">
                    {data.chars.slice(0, 12).map(c => (
                      <Row
                        key={c.id}
                        primary={c.name || c.data?.info?.name || '(unbenannt)'}
                        secondary={`${classLine(c.data) || '—'} · erstellt ${formatDate(c.created_at)}`}
                        href={`/database?table=dnd_characters`}
                      />
                    ))}
                    {data.chars.length > 12 && <More count={data.chars.length - 12} />}
                  </ul>
                )}
            </Section>

            <Section icon={Crown} label="Campaigns als GM" count={data.gmCamps.length} accent="amber">
              {data.gmCamps.length === 0
                ? <EmptyLine text="Keine eigenen Campaigns." />
                : (
                  <ul className="space-y-1">
                    {data.gmCamps.map(c => (
                      <Row
                        key={c.id}
                        primary={c.name}
                        secondary={`Token: ${c.join_token} · erstellt ${formatDate(c.created_at)}`}
                        href="/campaigns"
                      />
                    ))}
                  </ul>
                )}
            </Section>

            <Section icon={Swords} label="Mitglied in" count={data.memberOf.length} accent="brand">
              {data.memberOf.length === 0
                ? <EmptyLine text="Spielt aktuell in keiner Campaign mit." />
                : (
                  <ul className="space-y-1">
                    {data.memberOf.map(m => (
                      <Row
                        key={m.id}
                        primary={data.memberCampaignNames[m.campaign_id] ?? `(Campaign ${m.campaign_id.slice(0, 8)})`}
                        secondary={`als „${m.player_name || '?'}" mit ${m.card?.name || 'Charakter'} · seit ${formatDate(m.joined_at)}`}
                        href="/campaigns"
                      />
                    ))}
                  </ul>
                )}
            </Section>

            <Section icon={Calendar} label="Erstellte Termine" count={data.evts.length} accent="sky">
              {data.evts.length === 0
                ? <EmptyLine text="Keine Termine erstellt." />
                : (
                  <ul className="space-y-1">
                    {data.evts.slice(0, 10).map(e => {
                      const past = new Date(e.starts_at) < new Date();
                      return (
                        <Row
                          key={e.id}
                          primary={e.title}
                          secondary={`${formatDate(e.starts_at, { includeTime: true })}${past ? ' · vorbei' : ''}`}
                          href={`/database?table=dnd_events`}
                          dim={past}
                        />
                      );
                    })}
                    {data.evts.length > 10 && <More count={data.evts.length - 10} />}
                  </ul>
                )}
            </Section>

            <Section icon={Sparkles} label="MTG Decks" count={data.decks.length} accent="sky">
              {data.decks.length === 0
                ? <EmptyLine text="Keine Decks." />
                : (
                  <ul className="space-y-1">
                    {data.decks.slice(0, 10).map(d => (
                      <Row key={d.id} primary={d.name || '(unbenannt)'} secondary={formatDate(d.created_at)} href={`/database?table=mtg_decks`} />
                    ))}
                    {data.decks.length > 10 && <More count={data.decks.length - 10} />}
                  </ul>
                )}
            </Section>

            <Section icon={BookOpen} label="WH40k Armeen" count={data.armies.length} accent="amber">
              {data.armies.length === 0
                ? <EmptyLine text="Keine Armeen." />
                : (
                  <ul className="space-y-1">
                    {data.armies.slice(0, 10).map(a => (
                      <Row key={a.id} primary={a.name || '(unbenannt)'} secondary={formatDate(a.created_at)} href={`/database?table=wh40k_armies`} />
                    ))}
                    {data.armies.length > 10 && <More count={data.armies.length - 10} />}
                  </ul>
                )}
            </Section>

            <Section icon={Bug} label="Bug Reports" count={data.bugs.length} accent="red">
              {data.bugs.length === 0
                ? <EmptyLine text="Keine Bug Reports eingereicht." />
                : (
                  <ul className="space-y-1">
                    {data.bugs.map(b => {
                      const done = b.status === 'resolved' || b.status === 'closed';
                      return (
                        <li key={b.id} className="flex items-center gap-2 px-2.5 py-1.5 rounded-md bg-slate-50 dark:bg-slate-900 border border-slate-100 dark:border-slate-800 text-xs">
                          {done
                            ? <CheckCircle2 size={11} className="text-emerald-500 shrink-0" />
                            : <Clock size={11} className="text-amber-500 shrink-0" />}
                          <span className="flex-1 truncate text-slate-700 dark:text-slate-300">{b.title || '(ohne Titel)'}</span>
                          <Badge size="sm" variant={b.priority === 'high' ? 'danger' : b.priority === 'medium' ? 'warning' : 'info'}>{b.priority}</Badge>
                          <span className="text-[10px] text-slate-400 tabular-nums">{formatDate(b.created_at)}</span>
                        </li>
                      );
                    })}
                  </ul>
                )}
            </Section>
          </div>
        )}
      </div>
    </Modal>
  );
}

// ─────────────────────────────────────────────────────────────────────────────
// Helpers / sub-components
// ─────────────────────────────────────────────────────────────────────────────
function classLine(charData) {
  const cs = charData?.classes ?? [];
  if (!cs.length) return '';
  const line = cs.map(c => `${c.classId} ${c.level || 1}`).join(' / ');
  const total = cs.reduce((s, c) => s + (c.level || 0), 0);
  return cs.length > 1 ? `${line} · L${total}` : line;
}

function CountTile({ icon: Icon, label, value, color }) {
  return (
    <div className="rounded-lg border border-slate-200 dark:border-slate-800 bg-slate-50 dark:bg-slate-900/50 px-2 py-2 text-center">
      <Icon size={14} className={cn('mx-auto mb-1', color)} />
      <p className="font-display text-lg font-extrabold tabular-nums text-slate-900 dark:text-white leading-none">{value}</p>
      <p className="text-[9px] uppercase tracking-wider text-slate-400 mt-0.5">{label}</p>
    </div>
  );
}

const ACCENT_DOT = {
  brand:  'bg-brand-500',
  violet: 'bg-violet-500',
  amber:  'bg-amber-500',
  sky:    'bg-sky-500',
  red:    'bg-red-500',
};

function Section({ icon: Icon, label, count, accent, children }) {
  return (
    <div>
      <div className="flex items-center gap-2 mb-2 pb-1.5 border-b border-slate-100 dark:border-slate-800">
        <span className={cn('inline-block w-1.5 h-1.5 rounded-full', ACCENT_DOT[accent] ?? ACCENT_DOT.brand)} />
        <Icon size={13} className="text-slate-500" />
        <p className="text-xs font-bold uppercase tracking-wider text-slate-600 dark:text-slate-300">{label}</p>
        <span className="text-[10px] text-slate-400 tabular-nums">({count})</span>
      </div>
      {children}
    </div>
  );
}

function Row({ primary, secondary, href, dim }) {
  return (
    <li className={cn('flex items-center gap-2 px-2.5 py-1.5 rounded-md bg-slate-50 dark:bg-slate-900 border border-slate-100 dark:border-slate-800 text-xs', dim && 'opacity-60')}>
      <div className="flex-1 min-w-0">
        <p className="font-medium text-slate-700 dark:text-slate-300 truncate">{primary}</p>
        <p className="text-[10px] text-slate-400 truncate">{secondary}</p>
      </div>
      {href && (
        <a href={href} onClick={e => e.stopPropagation()} title="Im Browser öffnen"
          className="p-1 rounded text-slate-400 hover:bg-brand-100 dark:hover:bg-brand-950 hover:text-brand-700 transition-all shrink-0">
          <ExternalLink size={10} />
        </a>
      )}
    </li>
  );
}

function EmptyLine({ text }) {
  return <p className="text-xs text-slate-400 italic px-2.5">{text}</p>;
}

function More({ count }) {
  return <p className="text-[10px] text-slate-400 italic px-2.5 pt-0.5">… und {count} weitere</p>;
}
