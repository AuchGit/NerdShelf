import { useState } from 'react';
import { Plus, Swords, RefreshCw, Search } from 'lucide-react';
import { useCharacters }       from './hooks/useCharacters';
import CharacterCard           from './components/CharacterCard';
import CharacterFormModal      from './components/CharacterFormModal';
import PageHeader              from '@/components/ui/PageHeader';
import Button                  from '@/components/ui/Button';
import Input                   from '@/components/ui/Input';
import EmptyState              from '@/components/ui/EmptyState';
import ConfirmDialog           from '@/components/ui/ConfirmDialog';
import Spinner                 from '@/components/ui/Spinner';

export default function CharacterCreatorPage() {
  const {
    characters,
    loading,
    fetchCharacters,
    createCharacter,
    updateCharacter,
    deleteCharacter,
  } = useCharacters();

  const [search,        setSearch]        = useState('');
  const [formOpen,      setFormOpen]      = useState(false);
  const [editTarget,    setEditTarget]    = useState(null);   // character to edit
  const [deleteTarget,  setDeleteTarget]  = useState(null);   // character to delete
  const [submitting,    setSubmitting]    = useState(false);
  const [deleting,      setDeleting]      = useState(false);

  // ── Create / Edit submit ─────────────────────────────────────────────────

  const handleFormSubmit = async (payload) => {
    setSubmitting(true);
    let result;
    if (editTarget) {
      result = await updateCharacter(editTarget.id, payload);
    } else {
      result = await createCharacter(payload);
    }
    setSubmitting(false);
    if (result.success) {
      setFormOpen(false);
      setEditTarget(null);
    }
  };

  const openCreate = () => { setEditTarget(null); setFormOpen(true); };
  const openEdit   = (char) => { setEditTarget(char); setFormOpen(true); };
  const closeForm  = () => { setFormOpen(false); setEditTarget(null); };

  // ── Delete ───────────────────────────────────────────────────────────────

  const handleDeleteConfirm = async () => {
    setDeleting(true);
    await deleteCharacter(deleteTarget.id);
    setDeleting(false);
    setDeleteTarget(null);
  };

  // ── Filter ───────────────────────────────────────────────────────────────

  const filtered = characters.filter((c) => {
    const q = search.toLowerCase();
    return (
      c.name.toLowerCase().includes(q) ||
      c.class.toLowerCase().includes(q) ||
      c.race.toLowerCase().includes(q)
    );
  });

  return (
    <div>
      <PageHeader
        title="Character Creator"
        description="Build and manage your RPG adventurers."
        actions={
          <div className="flex gap-2">
            <Button
              variant="outline"
              size="sm"
              leftIcon={<RefreshCw size={14} />}
              onClick={fetchCharacters}
              loading={loading}
            >
              Refresh
            </Button>
            <Button
              size="sm"
              leftIcon={<Plus size={14} />}
              onClick={openCreate}
            >
              New Character
            </Button>
          </div>
        }
      />

      {/* Search */}
      {characters.length > 0 && (
        <div className="mb-5 max-w-sm">
          <Input
            placeholder="Search by name, class, or race…"
            value={search}
            onChange={(e) => setSearch(e.target.value)}
            leftElement={<Search size={14} />}
          />
        </div>
      )}

      {/* Loading state */}
      {loading && characters.length === 0 ? (
        <div className="flex justify-center py-20">
          <Spinner size="lg" />
        </div>
      ) : filtered.length === 0 ? (
        <EmptyState
          icon={<Swords size={24} />}
          title={search ? 'No characters match your search' : 'No characters yet'}
          description={
            search
              ? 'Try a different search term.'
              : 'Create your first character to get started on your adventure.'
          }
          action={
            !search && (
              <Button leftIcon={<Plus size={15} />} onClick={openCreate}>
                Create Character
              </Button>
            )
          }
        />
      ) : (
        /* Character grid */
        <div className="grid grid-cols-1 sm:grid-cols-2 xl:grid-cols-3 gap-4">
          {filtered.map((char) => (
            <CharacterCard
              key={char.id}
              character={char}
              onEdit={openEdit}
              onDelete={setDeleteTarget}
            />
          ))}
        </div>
      )}

      {/* Character form modal */}
      <CharacterFormModal
        open={formOpen}
        onClose={closeForm}
        onSubmit={handleFormSubmit}
        initial={editTarget}
        loading={submitting}
      />

      {/* Delete confirmation */}
      <ConfirmDialog
        open={!!deleteTarget}
        onClose={() => setDeleteTarget(null)}
        onConfirm={handleDeleteConfirm}
        loading={deleting}
        title={`Delete ${deleteTarget?.name ?? 'Character'}?`}
        description="This will permanently remove the character. This cannot be undone."
        confirmLabel="Delete Character"
      />
    </div>
  );
}
