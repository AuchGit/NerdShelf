import { useEffect, useState, useCallback } from 'react';
import { useSearchParams } from 'react-router-dom';
import {
  Database, RefreshCw, ChevronLeft, ChevronRight,
  Search, Download, AlertCircle, Hash
} from 'lucide-react';
import { getSupabase } from '@/lib/supabase';
import { groupTables } from '@/lib/tableRegistry';
import PageHeader  from '@/components/ui/PageHeader';
import Card        from '@/components/ui/Card';
import Button      from '@/components/ui/Button';
import Input       from '@/components/ui/Input';
import Badge       from '@/components/ui/Badge';
import Spinner     from '@/components/ui/Spinner';
import EmptyState  from '@/components/ui/EmptyState';
import { cn, truncate } from '@/utils/helpers';

const PAGE_SIZE = 25;

export default function DatabasePage() {
  const [searchParams, setSearchParams] = useSearchParams();
  const selectedTable = searchParams.get('table') ?? '';

  const [groups,    setGroups]    = useState([]);   // grouped table list
  const [allTables, setAllTables] = useState([]);   // flat list with row counts
  const [rows,      setRows]      = useState([]);
  const [columns,   setColumns]   = useState([]);
  const [count,     setCount]     = useState(0);
  const [page,      setPage]      = useState(0);
  const [search,    setSearch]    = useState('');
  const [loading,   setLoading]   = useState(false);
  const [tblLoad,   setTblLoad]   = useState(true);
  const [error,     setError]     = useState(null);
  const [cellModal, setCellModal] = useState(null);

  // ── Load table list via RPC ────────────────────────────────────────────────
  useEffect(() => {
    (async () => {
      setTblLoad(true);
      try {
        const supabase = getSupabase();
        const { data, error: err } = await supabase.rpc('get_public_tables');
        if (err) throw err;
        const names  = (data ?? []).map(r => r.table_name);
        const counts = Object.fromEntries((data ?? []).map(r => [r.table_name, r.row_estimate]));
        setAllTables(data ?? []);
        setGroups(groupTables(names).map(g => ({
          ...g,
          tables: g.tables.map(t => ({ name: t, rows: counts[t] ?? 0 })),
        })));
        // Auto-select first table if none selected
        if (!selectedTable && names.length > 0) {
          setSearchParams({ table: names[0] }, { replace: true });
        }
      } catch (e) {
        setError(`Tabellen konnten nicht geladen werden: ${e.message}. Stelle sicher dass du supabase-extras.sql ausgeführt hast.`);
      } finally {
        setTblLoad(false);
      }
    })();
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  // ── Load rows ─────────────────────────────────────────────────────────────
  const loadRows = useCallback(async () => {
    if (!selectedTable) return;
    setLoading(true);
    setError(null);
    try {
      const supabase = getSupabase();
      const from = page * PAGE_SIZE;
      const to   = from + PAGE_SIZE - 1;

      const { data, error: err, count: total } = await supabase
        .from(selectedTable)
        .select('*', { count: 'exact' })
        .range(from, to);

      if (err) throw err;
      setColumns(data?.length > 0 ? Object.keys(data[0]) : []);
      setRows(data ?? []);
      setCount(total ?? 0);
    } catch (e) {
      setError(e.message);
      setRows([]);
      setColumns([]);
    } finally {
      setLoading(false);
    }
  }, [selectedTable, page]);

  useEffect(() => { setPage(0); setSearch(''); }, [selectedTable]);
  useEffect(() => { loadRows(); }, [loadRows]);

  // ── CSV Export ────────────────────────────────────────────────────────────
  const exportCSV = async () => {
    try {
      const supabase = getSupabase();
      const { data } = await supabase.from(selectedTable).select('*');
      if (!data?.length) return;
      const cols = Object.keys(data[0]);
      const csv  = [
        cols.join(','),
        ...data.map(r => cols.map(c => {
          const v = r[c];
          const s = v === null ? '' : typeof v === 'object' ? JSON.stringify(v) : String(v);
          return `"${s.replace(/"/g, '""')}"`;
        }).join(','))
      ].join('\n');
      const a    = Object.assign(document.createElement('a'), {
        href:     URL.createObjectURL(new Blob([csv], { type: 'text/csv' })),
        download: `${selectedTable}.csv`,
      });
      a.click();
    } catch (e) {
      console.error(e);
    }
  };

  const filtered   = search
    ? rows.filter(r => Object.values(r).some(v => String(v ?? '').toLowerCase().includes(search.toLowerCase())))
    : rows;
  const totalPages = Math.ceil(count / PAGE_SIZE);

  const selectTable = (name) => {
    setSearchParams({ table: name });
    setSearch('');
  };

  return (
    <div className="flex gap-0 h-full -m-4 sm:-m-6 lg:-m-8 overflow-hidden" style={{ height: 'calc(100vh - 56px)' }}>

      {/* ── Sidebar ────────────────────────────────────────────────────────── */}
      <div className="w-56 shrink-0 border-r border-slate-200 dark:border-slate-800 bg-white dark:bg-slate-950 overflow-y-auto flex flex-col">
        <div className="px-3 pt-4 pb-2">
          <p className="text-[10px] font-bold uppercase tracking-widest text-slate-400 dark:text-slate-600">
            Tabellen
          </p>
        </div>

        {tblLoad ? (
          <div className="flex justify-center py-8"><Spinner /></div>
        ) : groups.length === 0 ? (
          <div className="px-3 py-4">
            <p className="text-xs text-red-500">Keine Tabellen. Führe<br/>supabase-extras.sql aus.</p>
          </div>
        ) : (
          <div className="flex-1 pb-4">
            {groups.map(({ group, tables }) => (
              <div key={group.id} className="mb-2">
                {/* Group header */}
                <div className="flex items-center gap-1.5 px-3 py-1.5">
                  <span className="text-sm leading-none">{group.icon}</span>
                  <span className={cn('text-[10px] font-bold uppercase tracking-wider', group.color)}>
                    {group.label}
                  </span>
                </div>
                {/* Tables */}
                {tables.map(({ name, rows: rowCount }) => (
                  <button
                    key={name}
                    onClick={() => selectTable(name)}
                    className={cn(
                      'w-full flex items-center justify-between gap-2 px-3 py-1.5 text-left transition-all group',
                      selectedTable === name
                        ? 'bg-brand-50 dark:bg-brand-950'
                        : 'hover:bg-slate-50 dark:hover:bg-slate-900'
                    )}
                  >
                    <div className="flex items-center gap-2 min-w-0">
                      <Database size={11} className={cn(
                        'shrink-0',
                        selectedTable === name ? 'text-brand-500' : 'text-slate-400 dark:text-slate-600'
                      )} />
                      <span className={cn(
                        'font-mono text-xs truncate',
                        selectedTable === name
                          ? 'text-brand-700 dark:text-brand-300 font-semibold'
                          : 'text-slate-600 dark:text-slate-400'
                      )}>
                        {name}
                      </span>
                    </div>
                    <span className="text-[10px] text-slate-400 dark:text-slate-600 shrink-0 tabular-nums">
                      {rowCount > 0 ? rowCount : ''}
                    </span>
                  </button>
                ))}
              </div>
            ))}
          </div>
        )}
      </div>

      {/* ── Main area ──────────────────────────────────────────────────────── */}
      <div className="flex-1 min-w-0 flex flex-col overflow-hidden">
        {!selectedTable ? (
          <div className="flex-1 flex items-center justify-center">
            <EmptyState
              icon={<Database size={24} />}
              title="Tabelle auswählen"
              description="Wähle links eine Tabelle um die Daten zu sehen."
            />
          </div>
        ) : (
          <>
            {/* Topbar */}
            <div className="flex items-center gap-3 px-5 py-3 border-b border-slate-200 dark:border-slate-800 bg-white dark:bg-slate-950 shrink-0">
              <div className="flex items-center gap-2 flex-1 min-w-0">
                <Database size={15} className="text-brand-500 shrink-0" />
                <h1 className="font-mono font-bold text-slate-900 dark:text-white truncate">
                  {selectedTable}
                </h1>
                <Badge variant="default" size="sm">
                  <Hash size={10} /> {count} Zeilen
                </Badge>
              </div>
              <div className="flex gap-2 shrink-0">
                <Button variant="outline" size="sm" leftIcon={<Download size={13} />} onClick={exportCSV}>
                  CSV
                </Button>
                <Button variant="outline" size="sm" leftIcon={<RefreshCw size={13} />} onClick={loadRows} loading={loading}>
                  Refresh
                </Button>
              </div>
            </div>

            {/* Search bar */}
            <div className="px-5 py-2.5 border-b border-slate-100 dark:border-slate-800 bg-white dark:bg-slate-950 shrink-0">
              <Input
                placeholder={`Auf dieser Seite suchen…`}
                value={search}
                onChange={e => setSearch(e.target.value)}
                leftElement={<Search size={13} />}
              />
            </div>

            {/* Error banner */}
            {error && (
              <div className="mx-5 mt-3 flex items-start gap-3 rounded-xl border border-red-200 dark:border-red-900 bg-red-50 dark:bg-red-950/50 px-4 py-3 text-sm text-red-700 dark:text-red-400 shrink-0">
                <AlertCircle size={16} className="shrink-0 mt-0.5" />
                <p>{error}</p>
              </div>
            )}

            {/* Table */}
            <div className="flex-1 overflow-auto">
              {loading ? (
                <div className="flex justify-center py-16"><Spinner size="lg" /></div>
              ) : filtered.length === 0 ? (
                <div className="p-8">
                  <EmptyState icon={<Database size={22} />} title="Keine Daten" description="Tabelle ist leer oder nichts passt zum Suchbegriff." />
                </div>
              ) : (
                <table className="w-full text-xs min-w-max">
                  <thead className="sticky top-0 z-10">
                    <tr className="bg-slate-50 dark:bg-slate-900 border-b border-slate-200 dark:border-slate-700">
                      <th className="px-3 py-2.5 text-left font-semibold text-slate-300 dark:text-slate-700 w-8 tabular-nums">#</th>
                      {columns.map(col => (
                        <th key={col} className="px-3 py-2.5 text-left font-semibold text-slate-500 dark:text-slate-400 whitespace-nowrap font-mono">
                          {col}
                        </th>
                      ))}
                    </tr>
                  </thead>
                  <tbody className="divide-y divide-slate-100 dark:divide-slate-800">
                    {filtered.map((row, i) => (
                      <tr key={i} className="hover:bg-slate-50 dark:hover:bg-slate-800/40 transition-colors">
                        <td className="px-3 py-2 text-slate-300 dark:text-slate-700 tabular-nums">
                          {page * PAGE_SIZE + i + 1}
                        </td>
                        {columns.map(col => {
                          const val    = row[col];
                          const isNull = val === null;
                          const isObj  = !isNull && typeof val === 'object';
                          const isBool = typeof val === 'boolean';

                          return (
                            <td key={col} className="px-3 py-2 font-mono whitespace-nowrap max-w-xs">
                              {isNull ? (
                                <span className="text-slate-300 dark:text-slate-700 italic">null</span>
                              ) : isObj ? (
                                <button
                                  onClick={() => setCellModal({ col, val: JSON.stringify(val, null, 2) })}
                                  className="text-violet-500 dark:text-violet-400 hover:text-violet-700 dark:hover:text-violet-300 hover:underline transition-colors"
                                >
                                  {Array.isArray(val) ? `[${val.length}]` : '{…}'}
                                </button>
                              ) : isBool ? (
                                <Badge variant={val ? 'success' : 'danger'} size="sm">{val ? 'true' : 'false'}</Badge>
                              ) : (
                                <span className="text-slate-700 dark:text-slate-300">
                                  {truncate(String(val), 80)}
                                </span>
                              )}
                            </td>
                          );
                        })}
                      </tr>
                    ))}
                  </tbody>
                </table>
              )}
            </div>

            {/* Pagination */}
            {totalPages > 1 && (
              <div className="flex items-center justify-between px-5 py-3 border-t border-slate-100 dark:border-slate-800 bg-white dark:bg-slate-950 shrink-0">
                <p className="text-xs text-slate-500 dark:text-slate-400">
                  Seite {page + 1} / {totalPages} · {count} Zeilen gesamt
                </p>
                <div className="flex gap-1">
                  <Button variant="outline" size="xs" onClick={() => setPage(p => p - 1)} disabled={page === 0} leftIcon={<ChevronLeft size={13} />}>
                    Zurück
                  </Button>
                  <Button variant="outline" size="xs" onClick={() => setPage(p => p + 1)} disabled={page >= totalPages - 1} rightIcon={<ChevronRight size={13} />}>
                    Weiter
                  </Button>
                </div>
              </div>
            )}
          </>
        )}
      </div>

      {/* ── JSON Cell Modal ───────────────────────────────────────────────── */}
      {cellModal && (
        <div className="fixed inset-0 z-50 flex items-center justify-center p-4" onClick={() => setCellModal(null)}>
          <div className="absolute inset-0 bg-black/50 backdrop-blur-sm" />
          <div
            className="relative w-full max-w-2xl max-h-[80vh] flex flex-col rounded-2xl border border-slate-200 dark:border-slate-700 bg-white dark:bg-slate-900 shadow-xl"
            onClick={e => e.stopPropagation()}
          >
            <div className="flex items-center justify-between px-5 py-4 border-b border-slate-100 dark:border-slate-800 shrink-0">
              <p className="font-mono font-bold text-slate-900 dark:text-white">{cellModal.col}</p>
              <div className="flex gap-2">
                <Button size="xs" variant="outline" onClick={() => navigator.clipboard.writeText(cellModal.val)}>
                  Kopieren
                </Button>
                <Button size="xs" variant="ghost" onClick={() => setCellModal(null)}>✕</Button>
              </div>
            </div>
            <pre className="flex-1 overflow-auto p-5 text-xs font-mono text-slate-700 dark:text-slate-300 leading-relaxed">
              {cellModal.val}
            </pre>
          </div>
        </div>
      )}
    </div>
  );
}
