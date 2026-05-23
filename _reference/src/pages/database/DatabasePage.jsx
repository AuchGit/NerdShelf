import { useEffect, useState, useCallback, useMemo } from 'react';
import { useSearchParams } from 'react-router-dom';
import {
  Database, RefreshCw, ChevronLeft, ChevronRight,
  Search, Download, AlertCircle, Hash, Trash2, FileJson,
  Copy, Check,
} from 'lucide-react';
import { getSupabase }  from '@/lib/supabase';
import { groupTables }  from '@/lib/tableRegistry';
import useStore         from '@/store/useStore';
import PageHeader       from '@/components/ui/PageHeader';
import Card             from '@/components/ui/Card';
import Button           from '@/components/ui/Button';
import Input            from '@/components/ui/Input';
import Badge            from '@/components/ui/Badge';
import Spinner          from '@/components/ui/Spinner';
import EmptyState       from '@/components/ui/EmptyState';
import ConfirmDialog    from '@/components/ui/ConfirmDialog';
import { cn, truncate } from '@/utils/helpers';

const PAGE_SIZE = 25;

// Tables we know have a non-`id` primary key — used by the row-delete button
// to pick the right filter column. Defaults to `id` for anything not listed.
const PK_BY_TABLE = {
  profiles: 'id',
};

export default function DatabasePage() {
  const [searchParams, setSearchParams] = useSearchParams();
  const selectedTable = searchParams.get('table') ?? '';
  const { addToast } = useStore();

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
  const [cellModal, setCellModal] = useState(null);  // { col, raw, isJson }
  const [rowModal,  setRowModal]  = useState(null);  // entire row inspector
  const [confirmDelete, setConfirmDelete] = useState(null); // { row, pk }
  const [deleting,  setDeleting]  = useState(false);
  const [copied,    setCopied]    = useState(false);

  // ── Load table list via RPC ────────────────────────────────────────────────
  useEffect(() => {
    let cancelled = false;
    (async () => {
      setTblLoad(true);
      try {
        const supabase = getSupabase();
        const { data, error: err } = await supabase.rpc('get_public_tables');
        if (err) throw err;
        if (cancelled) return;
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
        if (!cancelled) setError(`Tabellen konnten nicht geladen werden: ${e.message}. Stelle sicher dass du supabase-extras.sql ausgeführt hast.`);
      } finally {
        if (!cancelled) setTblLoad(false);
      }
    })();
    return () => { cancelled = true; };
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

  // ── Pick a sensible PK column for delete/inspect ──────────────────────────
  const pkColumn = useMemo(() => {
    if (PK_BY_TABLE[selectedTable]) return PK_BY_TABLE[selectedTable];
    if (columns.includes('id')) return 'id';
    return columns[0];
  }, [columns, selectedTable]);

  // ── CSV Export ────────────────────────────────────────────────────────────
  const exportCSV = async () => {
    try {
      const supabase = getSupabase();
      const { data } = await supabase.from(selectedTable).select('*');
      if (!data?.length) {
        addToast({ type: 'warning', message: 'Tabelle ist leer.' });
        return;
      }
      const cols = Object.keys(data[0]);
      const csv  = [
        cols.join(','),
        ...data.map(r => cols.map(c => {
          const v = r[c];
          const s = v === null ? '' : typeof v === 'object' ? JSON.stringify(v) : String(v);
          return `"${s.replace(/"/g, '""')}"`;
        }).join(','))
      ].join('\n');
      triggerDownload(`${selectedTable}.csv`, csv, 'text/csv');
      addToast({ type: 'success', message: `${data.length} Zeilen als CSV exportiert.` });
    } catch (e) {
      addToast({ type: 'error', message: `CSV-Export: ${e.message}` });
    }
  };

  // ── JSON Export ───────────────────────────────────────────────────────────
  const exportJSON = async () => {
    try {
      const supabase = getSupabase();
      const { data } = await supabase.from(selectedTable).select('*');
      if (!data?.length) {
        addToast({ type: 'warning', message: 'Tabelle ist leer.' });
        return;
      }
      triggerDownload(`${selectedTable}.json`, JSON.stringify(data, null, 2), 'application/json');
      addToast({ type: 'success', message: `${data.length} Zeilen als JSON exportiert.` });
    } catch (e) {
      addToast({ type: 'error', message: `JSON-Export: ${e.message}` });
    }
  };

  // ── Row delete ────────────────────────────────────────────────────────────
  const handleDelete = async () => {
    const { row, pk } = confirmDelete;
    setDeleting(true);
    try {
      const supabase = getSupabase();
      const { error: err } = await supabase.from(selectedTable).delete().eq(pk, row[pk]);
      if (err) throw err;
      addToast({ type: 'success', message: 'Zeile gelöscht.' });
      setConfirmDelete(null);
      setRowModal(null);
      loadRows();
    } catch (e) {
      addToast({ type: 'error', message: `Löschen: ${e.message}` });
    } finally {
      setDeleting(false);
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

  // ── Open the right modal for a cell ───────────────────────────────────────
  const openCell = (col, val) => {
    if (val === null || val === undefined) return;
    const isObj = typeof val === 'object';
    setCellModal({
      col,
      raw: isObj ? JSON.stringify(val, null, 2) : String(val),
      isJson: isObj,
    });
  };

  const copyCell = async () => {
    if (!cellModal) return;
    try {
      await navigator.clipboard.writeText(cellModal.raw);
      setCopied(true);
      setTimeout(() => setCopied(false), 1500);
    } catch {
      addToast({ type: 'error', message: 'Konnte nicht kopiert werden.' });
    }
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
                {pkColumn && (
                  <Badge variant="info" size="sm" title="Primary key column">
                    pk: {pkColumn}
                  </Badge>
                )}
              </div>
              <div className="flex gap-2 shrink-0">
                <Button variant="outline" size="sm" leftIcon={<Download size={13} />} onClick={exportCSV}>
                  CSV
                </Button>
                <Button variant="outline" size="sm" leftIcon={<FileJson size={13} />} onClick={exportJSON}>
                  JSON
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
                          {col === pkColumn && <span className="ml-1 text-brand-500" title="Primary key">★</span>}
                        </th>
                      ))}
                      <th className="px-3 py-2.5 text-right font-semibold text-slate-400 dark:text-slate-600 whitespace-nowrap w-20">Aktion</th>
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
                                  onClick={() => openCell(col, val)}
                                  className="text-violet-500 dark:text-violet-400 hover:text-violet-700 dark:hover:text-violet-300 hover:underline transition-colors"
                                >
                                  {Array.isArray(val) ? `[${val.length}]` : '{…}'}
                                </button>
                              ) : isBool ? (
                                <Badge variant={val ? 'success' : 'danger'} size="sm">{val ? 'true' : 'false'}</Badge>
                              ) : (
                                <button
                                  onClick={() => openCell(col, val)}
                                  className="text-left text-slate-700 dark:text-slate-300 hover:text-brand-600 dark:hover:text-brand-400 transition-colors"
                                  title="Vollwert anzeigen"
                                >
                                  {truncate(String(val), 80)}
                                </button>
                              )}
                            </td>
                          );
                        })}
                        <td className="px-3 py-2 text-right whitespace-nowrap">
                          <button
                            onClick={() => setRowModal(row)}
                            title="Zeile inspizieren"
                            className="p-1 rounded-md text-slate-400 hover:bg-brand-100 dark:hover:bg-brand-950 hover:text-brand-700 transition-all"
                          >
                            <FileJson size={12} />
                          </button>
                          <button
                            onClick={() => setConfirmDelete({ row, pk: pkColumn })}
                            disabled={!pkColumn}
                            title={pkColumn ? 'Zeile löschen' : 'Kein PK erkannt'}
                            className="p-1 rounded-md text-slate-400 hover:bg-red-100 dark:hover:bg-red-950 hover:text-red-700 transition-all disabled:opacity-30 disabled:cursor-not-allowed"
                          >
                            <Trash2 size={12} />
                          </button>
                        </td>
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

      {/* ── Cell viewer modal ─────────────────────────────────────────────── */}
      {cellModal && (
        <CellViewer
          cell={cellModal}
          onClose={() => setCellModal(null)}
          onCopy={copyCell}
          copied={copied}
        />
      )}

      {/* ── Row inspector modal ───────────────────────────────────────────── */}
      {rowModal && (
        <RowInspector
          row={rowModal}
          tableName={selectedTable}
          pk={pkColumn}
          onClose={() => setRowModal(null)}
          onDelete={() => setConfirmDelete({ row: rowModal, pk: pkColumn })}
        />
      )}

      <ConfirmDialog
        open={!!confirmDelete}
        onClose={() => setConfirmDelete(null)}
        onConfirm={handleDelete}
        loading={deleting}
        title="Zeile löschen?"
        description={confirmDelete
          ? `Löscht ${selectedTable}.${confirmDelete.pk} = "${String(confirmDelete.row?.[confirmDelete.pk] ?? '').slice(0, 60)}". Cascade-Beziehungen folgen.`
          : ''}
        confirmLabel="Löschen"
      />
    </div>
  );
}

// ─────────────────────────────────────────────────────────────────────────────
// Helpers
// ─────────────────────────────────────────────────────────────────────────────
function triggerDownload(filename, text, mime) {
  const a = Object.assign(document.createElement('a'), {
    href:     URL.createObjectURL(new Blob([text], { type: mime })),
    download: filename,
  });
  document.body.appendChild(a);
  a.click();
  setTimeout(() => {
    URL.revokeObjectURL(a.href);
    a.remove();
  }, 0);
}

// ─────────────────────────────────────────────────────────────────────────────
// Cell viewer — pretty-printed JSON or full-length string
// ─────────────────────────────────────────────────────────────────────────────
function CellViewer({ cell, onClose, onCopy, copied }) {
  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center p-4" onClick={onClose}>
      <div className="absolute inset-0 bg-black/50 backdrop-blur-sm" />
      <div
        className="relative w-full max-w-3xl max-h-[80vh] flex flex-col rounded-2xl border border-slate-200 dark:border-slate-700 bg-white dark:bg-slate-900 shadow-xl"
        onClick={e => e.stopPropagation()}
      >
        <div className="flex items-center justify-between px-5 py-4 border-b border-slate-100 dark:border-slate-800 shrink-0">
          <div className="flex items-center gap-2 min-w-0">
            <p className="font-mono font-bold text-slate-900 dark:text-white truncate">{cell.col}</p>
            {cell.isJson && <Badge variant="info" size="sm">JSON</Badge>}
            <span className="text-[10px] text-slate-400">{cell.raw.length.toLocaleString()} Zeichen</span>
          </div>
          <div className="flex gap-2 shrink-0">
            <Button size="xs" variant="outline" leftIcon={copied ? <Check size={11} /> : <Copy size={11} />} onClick={onCopy}>
              {copied ? 'Kopiert' : 'Kopieren'}
            </Button>
            <Button size="xs" variant="ghost" onClick={onClose}>✕</Button>
          </div>
        </div>
        <pre className="flex-1 overflow-auto p-5 text-xs font-mono text-slate-700 dark:text-slate-300 leading-relaxed whitespace-pre-wrap break-all">
          {cell.raw}
        </pre>
      </div>
    </div>
  );
}

// ─────────────────────────────────────────────────────────────────────────────
// Row inspector — every column at a glance, plus copy / delete actions
// ─────────────────────────────────────────────────────────────────────────────
function RowInspector({ row, tableName, pk, onClose, onDelete }) {
  const json = JSON.stringify(row, null, 2);
  const copy = async () => {
    try { await navigator.clipboard.writeText(json); } catch { /* ignore */ }
  };
  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center p-4" onClick={onClose}>
      <div className="absolute inset-0 bg-black/50 backdrop-blur-sm" />
      <div
        className="relative w-full max-w-3xl max-h-[85vh] flex flex-col rounded-2xl border border-slate-200 dark:border-slate-700 bg-white dark:bg-slate-900 shadow-xl"
        onClick={e => e.stopPropagation()}
      >
        <div className="flex items-center justify-between px-5 py-4 border-b border-slate-100 dark:border-slate-800 shrink-0">
          <div className="min-w-0">
            <p className="font-mono font-bold text-slate-900 dark:text-white truncate">{tableName}</p>
            {pk && (
              <p className="text-[10px] text-slate-400 font-mono truncate">
                {pk} = {String(row[pk] ?? '')}
              </p>
            )}
          </div>
          <div className="flex gap-2 shrink-0">
            <Button size="xs" variant="outline" leftIcon={<Copy size={11} />} onClick={copy}>Kopieren</Button>
            <Button size="xs" variant="danger" leftIcon={<Trash2 size={11} />} onClick={onDelete}>Löschen</Button>
            <Button size="xs" variant="ghost" onClick={onClose}>✕</Button>
          </div>
        </div>
        <div className="flex-1 overflow-auto p-5">
          <div className="grid grid-cols-1 sm:grid-cols-[180px_1fr] gap-y-2 gap-x-4 text-xs">
            {Object.entries(row).map(([k, v]) => {
              const isObj = v !== null && typeof v === 'object';
              const isNull = v === null || v === undefined;
              return (
                <RowField key={k} k={k} v={v} isObj={isObj} isNull={isNull} />
              );
            })}
          </div>
        </div>
      </div>
    </div>
  );
}

function RowField({ k, v, isObj, isNull }) {
  return (
    <>
      <div className="font-mono font-semibold text-slate-500 dark:text-slate-400 break-all">{k}</div>
      <div className="font-mono text-slate-700 dark:text-slate-300 break-all min-w-0">
        {isNull ? (
          <span className="text-slate-400 italic">null</span>
        ) : isObj ? (
          <pre className="text-[11px] bg-slate-50 dark:bg-slate-950 border border-slate-200 dark:border-slate-800 rounded p-2 overflow-x-auto whitespace-pre-wrap">
            {JSON.stringify(v, null, 2)}
          </pre>
        ) : typeof v === 'boolean' ? (
          <Badge variant={v ? 'success' : 'danger'} size="sm">{v ? 'true' : 'false'}</Badge>
        ) : (
          String(v)
        )}
      </div>
    </>
  );
}
