import { useState, useEffect, useCallback } from 'react';
import { Users, Check, X, Trash2, Shield, ShieldOff, Search, RefreshCw } from 'lucide-react';
import { getSupabase } from '@/lib/supabase';
import { useAuth } from '@/contexts/AuthContext';
import useStore from '@/store/useStore';
import PageHeader from '@/components/ui/PageHeader';
import Card from '@/components/ui/Card';
import Badge from '@/components/ui/Badge';
import Button from '@/components/ui/Button';
import Avatar from '@/components/ui/Avatar';
import Input from '@/components/ui/Input';
import EmptyState from '@/components/ui/EmptyState';
import ConfirmDialog from '@/components/ui/ConfirmDialog';
import Spinner from '@/components/ui/Spinner';
import { formatDate } from '@/utils/helpers';

const FILTERS = ['all', 'pending', 'approved'];

export default function AdminPage() {
  const { profile: myProfile } = useAuth();
  const { addToast } = useStore();

  const [users,   setUsers]   = useState([]);
  const [loading, setLoading] = useState(true);
  const [filter,  setFilter]  = useState('all');
  const [search,  setSearch]  = useState('');
  const [busy,    setBusy]    = useState({});
  const [confirmDelete, setConfirmDelete] = useState(null);

  const fetchUsers = useCallback(async () => {
    setLoading(true);
    try {
      const supabase = getSupabase();
      const { data, error } = await supabase
        .from('profiles')
        .select('*')
        .order('created_at', { ascending: false });
      if (error) throw error;
      setUsers(data ?? []);
    } catch (err) {
      addToast({ type: 'error', message: `Fehler: ${err.message}` });
    } finally {
      setLoading(false);
    }
  }, [addToast]);

  useEffect(() => { fetchUsers(); }, [fetchUsers]);

  const setBusyFor = (id, val) => setBusy(b => ({ ...b, [id]: val }));

  const updateProfile = async (id, updates, msg) => {
    setBusyFor(id, true);
    try {
      const supabase = getSupabase();
      const { error } = await supabase.from('profiles').update(updates).eq('id', id);
      if (error) throw error;
      setUsers(prev => prev.map(u => u.id === id ? { ...u, ...updates } : u));
      addToast({ type: 'success', message: msg });
    } catch (err) {
      addToast({ type: 'error', message: err.message });
    } finally {
      setBusyFor(id, false);
    }
  };

  const handleApprove     = u => updateProfile(u.id, { approved: true },         `${u.email} freigegeben ✓`);
  const handleRevoke      = u => updateProfile(u.id, { approved: false },        `Zugang entzogen für ${u.email}`);
  const handleToggleAdmin = u => updateProfile(u.id, { is_admin: !u.is_admin }, u.is_admin ? `Admin entfernt` : `${u.email} ist jetzt Admin`);

  const handleDelete = async () => {
    const id = confirmDelete;
    setConfirmDelete(null);
    setBusyFor(id, true);
    try {
      const supabase = getSupabase();
      const { error } = await supabase.from('profiles').delete().eq('id', id);
      if (error) throw error;
      setUsers(prev => prev.filter(u => u.id !== id));
      addToast({ type: 'success', message: 'User gelöscht.' });
    } catch (err) {
      addToast({ type: 'error', message: err.message });
    } finally {
      setBusyFor(id, false);
    }
  };

  const displayed = users.filter(u => {
    const matchSearch = u.email.toLowerCase().includes(search.toLowerCase());
    const matchFilter = filter === 'all' ? true : filter === 'pending' ? !u.approved : u.approved;
    return matchSearch && matchFilter;
  });

  const pendingCount = users.filter(u => !u.approved).length;

  return (
    <div>
      <PageHeader
        title="User Management"
        description="Freigaben, Admin-Rechte und Accounts verwalten."
        actions={
          <Button variant="outline" size="sm" leftIcon={<RefreshCw size={14} />} onClick={fetchUsers} loading={loading}>
            Refresh
          </Button>
        }
      />

      {/* Stats */}
      <div className="grid grid-cols-2 sm:grid-cols-4 gap-4 mb-6">
        {[
          { label: 'Gesamt',      value: users.length },
          { label: 'Ausstehend', value: pendingCount, warn: pendingCount > 0 },
          { label: 'Freigegeben', value: users.filter(u => u.approved).length },
          { label: 'Admins',      value: users.filter(u => u.is_admin).length },
        ].map(({ label, value, warn }) => (
          <Card key={label}>
            <Card.Content className="pt-4 pb-4">
              <p className="text-xs font-medium text-slate-500 dark:text-slate-400 uppercase tracking-wide mb-1">{label}</p>
              <p className={`font-display text-2xl font-extrabold ${warn ? 'text-amber-500' : 'text-slate-900 dark:text-white'}`}>{value}</p>
            </Card.Content>
          </Card>
        ))}
      </div>

      {/* Filter + Search */}
      <div className="flex flex-col sm:flex-row gap-3 mb-4">
        <Input
          placeholder="Nach Email suchen…"
          value={search}
          onChange={e => setSearch(e.target.value)}
          leftElement={<Search size={14} />}
          containerClassName="flex-1"
        />
        <div className="flex gap-1 rounded-lg border border-slate-200 dark:border-slate-700 p-1 bg-slate-50 dark:bg-slate-900 self-start">
          {FILTERS.map(f => (
            <button
              key={f}
              onClick={() => setFilter(f)}
              className={`px-3 py-1 rounded-md text-xs font-medium capitalize transition-all ${
                filter === f
                  ? 'bg-white dark:bg-slate-700 text-slate-900 dark:text-white shadow-sm'
                  : 'text-slate-500 dark:text-slate-400 hover:text-slate-700 dark:hover:text-slate-200'
              }`}
            >
              {f === 'all' ? 'Alle' : f === 'pending' ? 'Ausstehend' : 'Freigegeben'}
              {f === 'pending' && pendingCount > 0 && (
                <span className="ml-1.5 px-1.5 py-0.5 rounded-full bg-amber-500 text-white text-[10px] font-bold">{pendingCount}</span>
              )}
            </button>
          ))}
        </div>
      </div>

      {/* Table */}
      <Card>
        {loading ? (
          <div className="flex justify-center py-16"><Spinner size="lg" /></div>
        ) : displayed.length === 0 ? (
          <Card.Content>
            <EmptyState icon={<Users size={24} />} title="Keine User gefunden" description="Andere Filter oder Suchbegriff versuchen." />
          </Card.Content>
        ) : (
          <div className="overflow-x-auto">
            <table className="w-full text-sm">
              <thead>
                <tr className="border-b border-slate-100 dark:border-slate-800">
                  {['User', 'Registriert', 'Status', 'Rolle', 'Aktionen'].map(h => (
                    <th key={h} className="px-4 py-3 text-left text-xs font-semibold uppercase tracking-wide text-slate-500 dark:text-slate-400">{h}</th>
                  ))}
                </tr>
              </thead>
              <tbody className="divide-y divide-slate-100 dark:divide-slate-800">
                {displayed.map(user => {
                  const isMe   = user.id === myProfile?.id;
                  const isBusy = !!busy[user.id];
                  return (
                    <tr key={user.id} className="hover:bg-slate-50 dark:hover:bg-slate-800/50 transition-colors">
                      <td className="px-4 py-3">
                        <div className="flex items-center gap-3">
                          <Avatar name={user.email} size="sm" />
                          <div>
                            <p className="font-medium text-slate-800 dark:text-slate-200 truncate max-w-[200px]">{user.email}</p>
                            {isMe && <p className="text-[10px] text-brand-500 font-semibold">Du</p>}
                          </div>
                        </div>
                      </td>
                      <td className="px-4 py-3 text-slate-500 dark:text-slate-400 whitespace-nowrap text-xs">{formatDate(user.created_at)}</td>
                      <td className="px-4 py-3">
                        {user.approved
                          ? <Badge variant="success" dot>Freigegeben</Badge>
                          : <Badge variant="warning" dot>Ausstehend</Badge>}
                      </td>
                      <td className="px-4 py-3">
                        {user.is_admin
                          ? <Badge variant="primary" dot>Admin</Badge>
                          : <Badge variant="default">Member</Badge>}
                      </td>
                      <td className="px-4 py-3">
                        <div className="flex items-center gap-1">
                          {user.approved
                            ? <ActionBtn label="Zugang entziehen" icon={<X size={13} />} onClick={() => handleRevoke(user)} disabled={isMe || isBusy} hover="hover:bg-amber-100 dark:hover:bg-amber-950 hover:text-amber-700" />
                            : <ActionBtn label="Freigeben" icon={<Check size={13} />} onClick={() => handleApprove(user)} disabled={isBusy} hover="hover:bg-emerald-100 dark:hover:bg-emerald-950 hover:text-emerald-700" />
                          }
                          <ActionBtn
                            label={user.is_admin ? 'Admin entfernen' : 'Admin machen'}
                            icon={user.is_admin ? <ShieldOff size={13} /> : <Shield size={13} />}
                            onClick={() => handleToggleAdmin(user)}
                            disabled={isMe || isBusy}
                            hover="hover:bg-brand-100 dark:hover:bg-brand-950 hover:text-brand-700"
                          />
                          <ActionBtn label="Löschen" icon={<Trash2 size={13} />} onClick={() => setConfirmDelete(user.id)} disabled={isMe || isBusy} hover="hover:bg-red-100 dark:hover:bg-red-950 hover:text-red-700" />
                        </div>
                      </td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>
        )}
      </Card>

      <ConfirmDialog
        open={!!confirmDelete}
        onClose={() => setConfirmDelete(null)}
        onConfirm={handleDelete}
        title="User löschen?"
        description="Löscht das Profil. Der Auth-Account bleibt im Supabase Dashboard erhalten."
        confirmLabel="Löschen"
      />
    </div>
  );
}

function ActionBtn({ label, icon, onClick, disabled, hover }) {
  return (
    <button onClick={onClick} disabled={disabled} title={label}
      className={`p-1.5 rounded-md text-slate-400 dark:text-slate-500 transition-all ${hover} disabled:opacity-30 disabled:cursor-not-allowed`}>
      {icon}
    </button>
  );
}
