import { useState, useEffect } from 'react';
import { User } from 'lucide-react';
import Modal    from '@/components/ui/Modal';
import Button   from '@/components/ui/Button';
import Input    from '@/components/ui/Input';
import Select   from '@/components/ui/Select';
import Textarea from '@/components/ui/Textarea';

// ─── Constants ────────────────────────────────────────────────────────────────

export const CLASSES = [
  'Barbarian', 'Bard', 'Cleric', 'Druid', 'Fighter', 'Monk',
  'Paladin', 'Ranger', 'Rogue', 'Sorcerer', 'Warlock', 'Wizard',
];

export const RACES = [
  'Human', 'Elf', 'Dwarf', 'Halfling', 'Gnome', 'Half-Elf',
  'Half-Orc', 'Tiefling', 'Dragonborn', 'Aasimar', 'Tabaxi', 'Custom',
];

const STAT_FIELDS = [
  { key: 'strength',     label: 'STR' },
  { key: 'dexterity',    label: 'DEX' },
  { key: 'constitution', label: 'CON' },
  { key: 'intelligence', label: 'INT' },
  { key: 'wisdom',       label: 'WIS' },
  { key: 'charisma',     label: 'CHA' },
];

const DEFAULT_STATS = {
  strength: 10, dexterity: 10, constitution: 10,
  intelligence: 10, wisdom: 10, charisma: 10,
};

const EMPTY_FORM = {
  name:         '',
  class:        '',
  race:         '',
  level:        1,
  background:   '',
  notes:        '',
  ...DEFAULT_STATS,
};

// ─── Component ────────────────────────────────────────────────────────────────

/**
 * CharacterFormModal — used for both Create and Edit.
 *
 * @param {{ open, onClose, onSubmit, initial, loading }} props
 */
export default function CharacterFormModal({ open, onClose, onSubmit, initial = null, loading = false }) {
  const isEdit = Boolean(initial);
  const [form, setForm] = useState(EMPTY_FORM);
  const [errors, setErrors] = useState({});

  // Populate form when editing
  useEffect(() => {
    if (open) {
      setForm(initial ? { ...EMPTY_FORM, ...initial } : EMPTY_FORM);
      setErrors({});
    }
  }, [open, initial]);

  const set = (key, value) => {
    setForm((f) => ({ ...f, [key]: value }));
    setErrors((e) => ({ ...e, [key]: undefined }));
  };

  const validate = () => {
    const errs = {};
    if (!form.name.trim())  errs.name  = 'Name is required.';
    if (!form.class)        errs.class = 'Class is required.';
    if (!form.race)         errs.race  = 'Race is required.';
    const lvl = Number(form.level);
    if (!lvl || lvl < 1 || lvl > 20) errs.level = '1–20';
    STAT_FIELDS.forEach(({ key }) => {
      const v = Number(form[key]);
      if (!v || v < 1 || v > 30) errs[key] = '1–30';
    });
    return errs;
  };

  const handleSubmit = () => {
    const errs = validate();
    if (Object.keys(errs).length > 0) { setErrors(errs); return; }
    onSubmit({
      name:         form.name.trim(),
      class:        form.class,
      race:         form.race,
      level:        Number(form.level),
      background:   form.background.trim(),
      notes:        form.notes.trim(),
      strength:     Number(form.strength),
      dexterity:    Number(form.dexterity),
      constitution: Number(form.constitution),
      intelligence: Number(form.intelligence),
      wisdom:       Number(form.wisdom),
      charisma:     Number(form.charisma),
    });
  };

  return (
    <Modal
      open={open}
      onClose={onClose}
      title={isEdit ? 'Edit Character' : 'New Character'}
      description={isEdit ? 'Update your character details.' : 'Fill in the details for your new adventurer.'}
      size="lg"
      footer={
        <>
          <Button variant="outline" onClick={onClose} disabled={loading}>Cancel</Button>
          <Button onClick={handleSubmit} loading={loading}>
            {isEdit ? 'Save Changes' : 'Create Character'}
          </Button>
        </>
      }
    >
      <div className="space-y-5 py-2">
        {/* Basic info */}
        <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
          <Input
            label="Character Name"
            placeholder="Aelindra Starweave"
            value={form.name}
            onChange={(e) => set('name', e.target.value)}
            error={errors.name}
            leftElement={<User size={14} />}
            required
          />
          <Input
            label="Level"
            type="number"
            min={1} max={20}
            value={form.level}
            onChange={(e) => set('level', e.target.value)}
            error={errors.level}
            required
          />
          <Select
            label="Class"
            placeholder="Pick a class"
            options={CLASSES}
            value={form.class}
            onChange={(e) => set('class', e.target.value)}
            error={errors.class}
            required
          />
          <Select
            label="Race"
            placeholder="Pick a race"
            options={RACES}
            value={form.race}
            onChange={(e) => set('race', e.target.value)}
            error={errors.race}
            required
          />
        </div>

        <Input
          label="Background"
          placeholder="Acolyte, Criminal, Sage…"
          value={form.background}
          onChange={(e) => set('background', e.target.value)}
        />

        {/* Stats */}
        <div>
          <p className="text-sm font-medium text-slate-700 dark:text-slate-300 mb-2">
            Ability Scores
          </p>
          <div className="grid grid-cols-3 sm:grid-cols-6 gap-3">
            {STAT_FIELDS.map(({ key, label }) => (
              <div key={key} className="flex flex-col items-center gap-1">
                <label className="text-[10px] font-bold uppercase tracking-wider text-slate-500 dark:text-slate-400">
                  {label}
                </label>
                <input
                  type="number"
                  min={1} max={30}
                  value={form[key]}
                  onChange={(e) => set(key, e.target.value)}
                  className={`w-full rounded-lg border text-center font-bold text-sm py-2
                    bg-white dark:bg-slate-900 text-slate-900 dark:text-white
                    focus:outline-none focus:ring-2 focus:ring-brand-500
                    transition-colors duration-150
                    ${errors[key]
                      ? 'border-red-400 focus:ring-red-500'
                      : 'border-slate-300 dark:border-slate-600'
                    }`}
                />
                {errors[key] && (
                  <p className="text-[10px] text-red-500">{errors[key]}</p>
                )}
                {/* Modifier */}
                <span className="text-[10px] font-mono text-slate-400 dark:text-slate-500">
                  {modifier(form[key])}
                </span>
              </div>
            ))}
          </div>
        </div>

        {/* Notes */}
        <Textarea
          label="Notes"
          placeholder="Backstory, personality traits, equipment…"
          value={form.notes}
          onChange={(e) => set('notes', e.target.value)}
          rows={3}
        />
      </div>
    </Modal>
  );
}

/** Compute D&D ability modifier */
function modifier(score) {
  const n = Number(score);
  if (!n || isNaN(n)) return '—';
  const mod = Math.floor((n - 10) / 2);
  return mod >= 0 ? `+${mod}` : `${mod}`;
}
