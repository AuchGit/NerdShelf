import { useState, useEffect, useCallback, useMemo } from 'react';
import {
  Bug, RefreshCw, Search, Trash2, ChevronDown, ChevronUp,
  Copy, Check, AlertTriangle, AlertCircle, Info,
  Clock, Eye, Wrench, CheckCircle2, XCircle, ArrowUpDown,
  Filter, SortAsc, SortDesc
} from 'lucide-react';
import { getSupabase }    from '@/lib/supabase';
import useStore           from '@/store/useStore';
import PageHeader         from '@/components/ui/PageHeader';
import Card               from '@/components/ui/Card';
import Badge              from '@/components/ui/Badge';
import Button             from '@/components/ui/Button';
import Input              from '@/components/ui/Input';
import Spinner            from '@/components/ui/Spinner';
import EmptyState         from '@/components/ui/EmptyState';
import ConfirmDialog      from '@/components/ui/ConfirmDialog';
import { formatDate, cn } from '@/utils/helpers';

// ─── Config ───────────────────────────────────────────────────────────────────

const PRIORITY = {
  high:   { label: 'High',   color: 'text-red-600 dark:text-red-400',    bg: 'bg-red-100 dark:bg-red-950',    border: 'border-red-300 dark:border-red-800',    dot: 'bg-red-500',    icon: AlertTriangle, order: 0 },
  medium: { label: 'Medium', color: 'text-amber-600 dark:text-amber-400', bg: 'bg-amber-100 dark:bg-amber-950', border: 'border-amber-300 dark:border-amber-800', dot: 'bg-amber-500',  icon: AlertCircle,   order: 1 },
  low:    { label: 'Low',    color: 'text-sky-600 dark:text-sky-400',     bg: 'bg-sky-100 dark:bg-sky-950',    border: 'border-sky-300 dark:border-sky-800',    dot: 'bg-sky-400',    icon: Info,          order: 2 },
};

const STATUS = {
  open:        { label: 'Offen',          icon: Clock,        variant: 'danger',  desc: 'Neu gemeldet, noch nicht gesehen' },
  seen:        { label: 'Gesehen',        icon: Eye,          variant: 'warning', desc: 'Wurde zur Kenntnis genommen' },
  in_progress: { label: 'In Bearbeitung', icon: Wrench,       variant: 'info',    desc: 'Wird aktiv bearbeitet' },
  resolved:    { label: 'Gelöst',         icon: CheckCircle2, variant: 'success', desc: 'Bug wurde behoben' },
  closed:      { label: 'Geschlossen',    icon: XCircle,      variant: 'default', desc: 'Abgeschlossen / kein Fix nötig' },
};

const PRIORITY_ORDER = { high: 0, medium: 1, low: 2 };

// ─── Main Page ────────────────────────────────────────────────────────────────

export default function BugReportsPage() {
  const { addToast } = useStore();

  const [reports,       setReports]       = useState([]);
  const [loading,       setLoading]       = useState(true);
  const [filterStatus,  setFilterStatus]  = useState('all');
  const [filterPriority,setFilterPriority]= useState('all');
  const [search,        setSearch]        = useState('');
  const [sortBy,        setSortBy]        = useState('priority'); // 'priority' | 'date' | 'status'
  const [sortDir,       setSortDir]       = useState('asc');
  const [expandedId,    setExpandedId]    = useState(null);
  const [confirmDelete, setConfirmDelete] = useState(null);
  const [busy,          setBusy]          = useState({});

  // ── Fetch ──────────────────────────────────────────────────────────────────
  const fetchReports = useCallback(async () => {
    setLoading(true);
    try {
      const supabase = getSupabase();
      const { data, error } = await supabase
        .from('bug_reports')
        .select('*')
        .order('created_at', { ascending: false });
      if (error) throw error;
      setReports(data ?? []);
    } catch (e) {
      addToast({ type: 'error', message: `Fehler: ${e.message}` });
    } finally {
      setLoading(false);
    }
  }, [addToast]);

  useEffect(() => { fetchReports(); }, [fetchReports]);

  // ── Update field ───────────────────────────────────────────────────────────
  const updateField = async (id, updates, toastMsg) => {
    setBusy(b => ({ ...b, [id]: true }));
    try {
      const supabase = getSupabase();
      const { error } = await supabase.from('bug_reports').update(updates).eq('id', id);
      if (error) throw error;
      setReports(prev => prev.map(r => r.id === id ? { ...r, ...updates } : r));
      if (toastMsg) addToast({ type: 'success', message: toastMsg });
    } catch (e) {
      addToast({ type: 'error', message: e.message });
    } finally {
      setBusy(b => ({ ...b, [id]: false }));
    }
  };

  // ── Delete ─────────────────────────────────────────────────────────────────
  const handleDelete = async () => {
    const id = confirmDelete;
    setConfirmDelete(null);
    try {
      const supabase = getSupabase();
      const { error } = await supabase.from('bug_reports').delete().eq('id', id);
      if (error) throw error;
      setReports(prev => prev.filter(r => r.id !== id));
      if (expandedId === id) setExpandedId(null);
      addToast({ type: 'success', message: 'Report gelöscht.' });
    } catch (e) {
      addToast({ type: 'error', message: e.message });
    }
  };

  // ── Save notes ─────────────────────────────────────────────────────────────
  const saveNotes = async (id, notes) => {
    await updateField(id, { admin_notes: notes }, 'Notizen gespeichert.');
  };

  // ── Sort toggle ────────────────────────────────────────────────────────────
  const toggleSort = (col) => {
    if (sortBy === col) setSortDir(d => d === 'asc' ? 'desc' : 'asc');
    else { setSortBy(col); setSortDir('asc'); }
  };

  // ── Filtered + Sorted ──────────────────────────────────────────────────────
  const displayed = useMemo(() => {
    let list = reports.filter(r => {
      const matchStatus   = filterStatus   === 'all' || r.status   === filterStatus;
      const matchPriority = filterPriority === 'all' || r.priority === filterPriority;
      const matchSearch   = !search || [r.user_email, r.description, r.app_version]
        .some(v => String(v ?? '').toLowerCase().includes(search.toLowerCase()));
      return matchStatus && matchPriority && matchSearch;
    });

    list = [...list].sort((a, b) => {
      let diff = 0;
      if (sortBy === 'priority') diff = PRIORITY_ORDER[a.priority ?? 'medium'] - PRIORITY_ORDER[b.priority ?? 'medium'];
      else if (sortBy === 'date') diff = new Date(b.created_at) - new Date(a.created_at);
      else if (sortBy === 'status') diff = a.status.localeCompare(b.status);
      return sortDir === 'asc' ? diff : -diff;
    });

    return list;
  }, [reports, filterStatus, filterPriority, search, sortBy, sortDir]);

  // ── Stats ──────────────────────────────────────────────────────────────────
  const stats = {
    total:    reports.length,
    open:     reports.filter(r => r.status === 'open').length,
    high:     reports.filter(r => r.priority === 'high' && r.status !== 'resolved' && r.status !== 'closed').length,
    resolved: reports.filter(r => r.status === 'resolved' || r.status === 'closed').length,
  };

  return (
    <div>
      <PageHeader
        title="Bug Reports"
        description="Gemeldete Fehler einsehen, priorisieren und bearbeiten."
        actions={
          <Button variant="outline" size="sm" leftIcon={<RefreshCw size={14} />} onClick={fetchReports} loading={loading}>
            Refresh
          </Button>
        }
      />

      {/* Stats row */}
      <div className="grid grid-cols-2 sm:grid-cols-4 gap-4 mb-6">
        <StatCard label="Gesamt"    value={stats.total}    color="text-slate-700 dark:text-slate-200" />
        <StatCard label="Offen"     value={stats.open}     color="text-red-500"   warn={stats.open > 0} />
        <StatCard label="High Prio" value={stats.high}     color="text-amber-500" warn={stats.high > 0} />
        <StatCard label="Gelöst"    value={stats.resolved} color="text-emerald-500" />
      </div>

      {/* Filters */}
      <div className="flex flex-col gap-3 mb-4">
        {/* Search */}
        <Input
          placeholder="Suchen nach Email, Beschreibung, Version…"
          value={search}
          onChange={e => setSearch(e.target.value)}
          leftElement={<Search size={13} />}
        />
        <div className="flex flex-wrap gap-2 items-center">
          {/* Status filter */}
          <div className="flex items-center gap-1.5">
            <Filter size={13} className="text-slate-400" />
            <span className="text-xs text-slate-500 dark:text-slate-400 font-medium">Status:</span>
          </div>
          <div className="flex gap-1 rounded-lg border border-slate-200 dark:border-slate-700 p-0.5 bg-slate-50 dark:bg-slate-900">
            <FilterChip label="Alle" active={filterStatus === 'all'} onClick={() => setFilterStatus('all')} />
            {Object.entries(STATUS).map(([key, cfg]) => (
              <FilterChip key={key} label={cfg.label} active={filterStatus === key} onClick={() => setFilterStatus(key)} />
            ))}
          </div>

          {/* Priority filter */}
          <div className="flex items-center gap-1.5 ml-2">
            <span className="text-xs text-slate-500 dark:text-slate-400 font-medium">Prio:</span>
          </div>
          <div className="flex gap-1 rounded-lg border border-slate-200 dark:border-slate-700 p-0.5 bg-slate-50 dark:bg-slate-900">
            <FilterChip label="Alle" active={filterPriority === 'all'} onClick={() => setFilterPriority('all')} />
            {Object.entries(PRIORITY).map(([key, cfg]) => (
              <FilterChip
                key={key}
                label={cfg.label}
                active={filterPriority === key}
                onClick={() => setFilterPriority(key)}
                dotColor={cfg.dot}
              />
            ))}
          </div>
        </div>
      </div>

      {/* Table */}
      {loading ? (
        <div className="flex justify-center py-20"><Spinner size="lg" /></div>
      ) : displayed.length === 0 ? (
        <EmptyState icon={<Bug size={24} />} title="Keine Bug Reports" description="Nichts gefunden mit diesen Filtern." />
      ) : (
        <div className="space-y-2">
          {/* Sort header */}
          <div className="flex items-center gap-4 px-4 py-1.5">
            <span className="text-xs text-slate-400 mr-auto">{displayed.length} Reports</span>
            {[
              { key: 'priority', label: 'Priorität' },
              { key: 'date',     label: 'Datum'     },
              { key: 'status',   label: 'Status'    },
            ].map(({ key, label }) => (
              <button
                key={key}
                onClick={() => toggleSort(key)}
                className={cn(
                  'flex items-center gap-1 text-xs font-medium transition-colors',
                  sortBy === key
                    ? 'text-brand-600 dark:text-brand-400'
                    : 'text-slate-400 hover:text-slate-600 dark:hover:text-slate-300'
                )}
              >
                {label}
                {sortBy === key
                  ? sortDir === 'asc' ? <SortAsc size={12} /> : <SortDesc size={12} />
                  : <ArrowUpDown size={12} className="opacity-40" />
                }
              </button>
            ))}
          </div>

          {/* Report rows */}
          {displayed.map(report => (
            <BugReportRow
              key={report.id}
              report={report}
              expanded={expandedId === report.id}
              onToggle={() => setExpandedId(id => id === report.id ? null : report.id)}
              onUpdateStatus={status => updateField(report.id, { status }, `Status → ${STATUS[status]?.label}`)}
              onUpdatePriority={priority => updateField(report.id, { priority }, `Priorität → ${PRIORITY[priority]?.label}`)}
              onSaveNotes={notes => saveNotes(report.id, notes)}
              onDelete={() => setConfirmDelete(report.id)}
              busy={!!busy[report.id]}
            />
          ))}
        </div>
      )}

      <ConfirmDialog
        open={!!confirmDelete}
        onClose={() => setConfirmDelete(null)}
        onConfirm={handleDelete}
        title="Bug Report löschen?"
        description="Dieser Report wird permanent entfernt."
        confirmLabel="Löschen"
      />
    </div>
  );
}

// ─── Bug Report Row (expandable) ─────────────────────────────────────────────

function BugReportRow({ report, expanded, onToggle, onUpdateStatus, onUpdatePriority, onSaveNotes, onDelete, busy }) {
  const [localNotes, setLocalNotes] = useState(report.admin_notes ?? '');
  const [notesSaved, setNotesSaved] = useState(false);

  const pCfg = PRIORITY[report.priority ?? 'medium'] ?? PRIORITY.medium;
  const sCfg = STATUS[report.status]   ?? STATUS.open;
  const PIcon = pCfg.icon;
  const SIcon = sCfg.icon;

  const handleSaveNotes = async () => {
    await onSaveNotes(localNotes);
    setNotesSaved(true);
    setTimeout(() => setNotesSaved(false), 2000);
  };

  return (
    <div className={cn(
      'rounded-xl border transition-all duration-200',
      expanded ? 'border-brand-200 dark:border-brand-800 shadow-sm' : 'border-slate-200 dark:border-slate-800',
      report.status === 'open' && report.priority === 'high' && !expanded
        ? 'border-l-4 border-l-red-500'
        : report.status === 'open' && !expanded
          ? 'border-l-4 border-l-amber-400'
          : '',
      'bg-white dark:bg-slate-900'
    )}>
      {/* ── Row summary (always visible) ─── */}
      <div
        className="flex items-center gap-3 px-4 py-3 cursor-pointer select-none"
        onClick={onToggle}
      >
        {/* Priority icon */}
        <div className={cn('shrink-0 p-1.5 rounded-lg', pCfg.bg)}>
          <PIcon size={14} className={pCfg.color} />
        </div>

        {/* Main info */}
        <div className="flex-1 min-w-0">
          <div className="flex items-center gap-2 flex-wrap">
            <span className="text-sm font-semibold text-slate-800 dark:text-slate-200 truncate max-w-xs">
              {report.description?.slice(0, 80)}{report.description?.length > 80 ? '…' : ''}
            </span>
          </div>
          <div className="flex items-center gap-3 mt-0.5 flex-wrap">
            <span className="text-xs text-slate-400 dark:text-slate-500">{report.user_email ?? 'anonym'}</span>
            <span className="text-xs text-slate-300 dark:text-slate-700">·</span>
            <span className="text-xs text-slate-400 dark:text-slate-500">{formatDate(report.created_at, { includeTime: true })}</span>
            {report.app_version && (
              <>
                <span className="text-xs text-slate-300 dark:text-slate-700">·</span>
                <span className="text-xs font-mono text-slate-400 dark:text-slate-500">v{report.app_version}</span>
              </>
            )}
          </div>
        </div>

        {/* Badges */}
        <div className="flex items-center gap-2 shrink-0">
          <PriorityBadge priority={report.priority} />
          <StatusBadge   status={report.status} />
          {expanded ? <ChevronUp size={15} className="text-slate-400" /> : <ChevronDown size={15} className="text-slate-400" />}
        </div>
      </div>

      {/* ── Expanded details ─── */}
      {expanded && (
        <div className="border-t border-slate-100 dark:border-slate-800 px-4 py-4 space-y-5">

          {/* Quick actions */}
          <div className="flex flex-wrap gap-3">
            {/* Priority selector */}
            <div className="flex flex-col gap-1">
              <span className="text-[10px] font-bold uppercase tracking-wider text-slate-400 dark:text-slate-600">Priorität</span>
              <div className="flex gap-1">
                {Object.entries(PRIORITY).map(([key, cfg]) => (
                  <button
                    key={key}
                    onClick={() => onUpdatePriority(key)}
                    disabled={busy}
                    className={cn(
                      'flex items-center gap-1.5 px-2.5 py-1.5 rounded-lg text-xs font-semibold border transition-all',
                      report.priority === key
                        ? `${cfg.bg} ${cfg.color} ${cfg.border}`
                        : 'border-slate-200 dark:border-slate-700 text-slate-500 dark:text-slate-400 hover:border-slate-300 dark:hover:border-slate-600',
                      'disabled:opacity-50'
                    )}
                  >
                    <span className={cn('w-1.5 h-1.5 rounded-full', cfg.dot)} />
                    {cfg.label}
                  </button>
                ))}
              </div>
            </div>

            {/* Status selector */}
            <div className="flex flex-col gap-1">
              <span className="text-[10px] font-bold uppercase tracking-wider text-slate-400 dark:text-slate-600">Status</span>
              <div className="flex flex-wrap gap-1">
                {Object.entries(STATUS).map(([key, cfg]) => {
                  const Icon = cfg.icon;
                  return (
                    <button
                      key={key}
                      onClick={() => onUpdateStatus(key)}
                      disabled={busy}
                      title={cfg.desc}
                      className={cn(
                        'flex items-center gap-1.5 px-2.5 py-1.5 rounded-lg text-xs font-semibold border transition-all',
                        report.status === key
                          ? 'bg-brand-600 text-white border-brand-600'
                          : 'border-slate-200 dark:border-slate-700 text-slate-500 dark:text-slate-400 hover:border-brand-300 hover:text-brand-600 dark:hover:text-brand-400',
                        'disabled:opacity-50'
                      )}
                    >
                      <Icon size={11} />
                      {cfg.label}
                    </button>
                  );
                })}
              </div>
            </div>
          </div>

          {/* Description */}
          <DetailSection label="Beschreibung">
            <p className="text-sm text-slate-700 dark:text-slate-300 leading-relaxed whitespace-pre-wrap">
              {report.description}
            </p>
          </DetailSection>

          {/* Logs */}
          {(report.console_log || report.error_log) && (
            <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
              {report.console_log && (
                <DetailSection label="Console Log">
                  <CodeBlock content={report.console_log} theme="green" />
                </DetailSection>
              )}
              {report.error_log && (
                <DetailSection label="Error Log">
                  <CodeBlock content={report.error_log} theme="red" />
                </DetailSection>
              )}
            </div>
          )}

          {/* App State */}
          {report.app_state && (
            <DetailSection label="App State (JSON)">
              <CodeBlock content={JSON.stringify(report.app_state, null, 2)} theme="default" />
            </DetailSection>
          )}

          {/* Admin Notes */}
          <DetailSection label="Admin Notizen">
            <textarea
              value={localNotes}
              onChange={e => setLocalNotes(e.target.value)}
              rows={3}
              placeholder="Interne Notizen, Lösung, Links…"
              className="w-full rounded-lg border border-slate-300 dark:border-slate-600 bg-white dark:bg-slate-800 px-3 py-2 text-sm text-slate-900 dark:text-slate-100 placeholder:text-slate-400 focus:outline-none focus:ring-2 focus:ring-brand-500 resize-y"
            />
            <div className="flex items-center gap-2 mt-2">
              <Button size="sm" onClick={handleSaveNotes} loading={busy} leftIcon={notesSaved ? <Check size={13} /> : null}>
                {notesSaved ? 'Gespeichert!' : 'Notizen speichern'}
              </Button>
              <Button size="sm" variant="ghost" className="hover:text-red-600 dark:hover:text-red-400" leftIcon={<Trash2 size={13} />} onClick={onDelete}>
                Report löschen
              </Button>
            </div>
          </DetailSection>
        </div>
      )}
    </div>
  );
}

// ─── Sub-components ───────────────────────────────────────────────────────────

function PriorityBadge({ priority }) {
  const cfg = PRIORITY[priority ?? 'medium'] ?? PRIORITY.medium;
  return (
    <span className={cn('inline-flex items-center gap-1.5 px-2 py-0.5 rounded-md text-xs font-semibold border', cfg.bg, cfg.color, cfg.border)}>
      <span className={cn('w-1.5 h-1.5 rounded-full', cfg.dot)} />
      {cfg.label}
    </span>
  );
}

function StatusBadge({ status }) {
  const cfg  = STATUS[status] ?? STATUS.open;
  const Icon = cfg.icon;
  const variantClasses = {
    danger:  'bg-red-100 dark:bg-red-950 text-red-700 dark:text-red-300 border-red-200 dark:border-red-900',
    warning: 'bg-amber-100 dark:bg-amber-950 text-amber-700 dark:text-amber-300 border-amber-200 dark:border-amber-900',
    info:    'bg-sky-100 dark:bg-sky-950 text-sky-700 dark:text-sky-300 border-sky-200 dark:border-sky-900',
    success: 'bg-emerald-100 dark:bg-emerald-950 text-emerald-700 dark:text-emerald-300 border-emerald-200 dark:border-emerald-900',
    default: 'bg-slate-100 dark:bg-slate-800 text-slate-600 dark:text-slate-400 border-slate-200 dark:border-slate-700',
  };
  return (
    <span className={cn('inline-flex items-center gap-1 px-2 py-0.5 rounded-md text-xs font-semibold border', variantClasses[cfg.variant])}>
      <Icon size={10} />
      {cfg.label}
    </span>
  );
}

function DetailSection({ label, children }) {
  return (
    <div>
      <p className="text-[10px] font-bold uppercase tracking-wider text-slate-400 dark:text-slate-600 mb-1.5">{label}</p>
      {children}
    </div>
  );
}

function CodeBlock({ content, theme = 'default' }) {
  const [copied, setCopied] = useState(false);
  const colors = {
    green:   'bg-slate-950 text-green-400',
    red:     'bg-slate-950 text-red-400',
    default: 'bg-slate-100 dark:bg-slate-800 text-slate-700 dark:text-slate-300',
  };

  const handleCopy = () => {
    navigator.clipboard.writeText(content);
    setCopied(true);
    setTimeout(() => setCopied(false), 2000);
  };

  return (
    <div className="relative group">
      <pre className={cn('text-xs font-mono p-3 rounded-lg overflow-auto max-h-48 leading-relaxed', colors[theme])}>
        {content}
      </pre>
      <button
        onClick={handleCopy}
        className="absolute top-2 right-2 opacity-0 group-hover:opacity-100 transition-opacity p-1.5 rounded-md bg-white/10 dark:bg-black/20 hover:bg-white/20 dark:hover:bg-black/40 backdrop-blur-sm"
        title="Kopieren"
      >
        {copied ? <Check size={12} className="text-emerald-400" /> : <Copy size={12} className="text-slate-300" />}
      </button>
    </div>
  );
}

function StatCard({ label, value, color, warn = false }) {
  return (
    <Card className={cn(warn && 'border-l-4', warn && color.includes('red') ? 'border-l-red-500' : warn && 'border-l-amber-400')}>
      <Card.Content className="pt-4 pb-4">
        <p className="text-xs font-medium text-slate-500 dark:text-slate-400 uppercase tracking-wide mb-1">{label}</p>
        <p className={cn('font-display text-2xl font-extrabold', color)}>{value}</p>
      </Card.Content>
    </Card>
  );
}

function FilterChip({ label, active, onClick, dotColor }) {
  return (
    <button
      onClick={onClick}
      className={cn(
        'flex items-center gap-1.5 px-2.5 py-1 rounded-md text-xs font-medium transition-all',
        active
          ? 'bg-white dark:bg-slate-700 text-slate-900 dark:text-white shadow-sm'
          : 'text-slate-500 dark:text-slate-400 hover:text-slate-700 dark:hover:text-slate-200'
      )}
    >
      {dotColor && <span className={cn('w-1.5 h-1.5 rounded-full', dotColor)} />}
      {label}
    </button>
  );
}
