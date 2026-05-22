import { Pencil, Trash2 } from 'lucide-react';
import Badge   from '@/components/ui/Badge';
import Button  from '@/components/ui/Button';
import Card    from '@/components/ui/Card';
import { formatDate, cn } from '@/utils/helpers';

/**
 * CharacterCard
 * Liest alle Anzeige-Daten aus character.data (jsonb).
 * Welche Felder angezeigt werden, hängt davon ab was dein Creator speichert.
 * Aktuell werden angezeigt: name, class/klasse, race/rasse, level, und alle
 * weiteren Felder die in data vorhanden sind.
 */

const CLASS_COLORS = {
  Barbarian: 'bg-red-100 dark:bg-red-950 text-red-700 dark:text-red-300',
  Bard:      'bg-pink-100 dark:bg-pink-950 text-pink-700 dark:text-pink-300',
  Cleric:    'bg-yellow-100 dark:bg-yellow-950 text-yellow-700 dark:text-yellow-300',
  Druid:     'bg-lime-100 dark:bg-lime-950 text-lime-700 dark:text-lime-300',
  Fighter:   'bg-orange-100 dark:bg-orange-950 text-orange-700 dark:text-orange-300',
  Monk:      'bg-cyan-100 dark:bg-cyan-950 text-cyan-700 dark:text-cyan-300',
  Paladin:   'bg-amber-100 dark:bg-amber-950 text-amber-700 dark:text-amber-300',
  Ranger:    'bg-green-100 dark:bg-green-950 text-green-700 dark:text-green-300',
  Rogue:     'bg-slate-100 dark:bg-slate-800 text-slate-700 dark:text-slate-300',
  Sorcerer:  'bg-violet-100 dark:bg-violet-950 text-violet-700 dark:text-violet-300',
  Warlock:   'bg-purple-100 dark:bg-purple-950 text-purple-700 dark:text-purple-300',
  Wizard:    'bg-blue-100 dark:bg-blue-950 text-blue-700 dark:text-blue-300',
};

// Standard-Ability-Scores falls dein Creator sie speichert
const STAT_KEYS = [
  { key: 'strength',     abbr: 'STR' },
  { key: 'dexterity',    abbr: 'DEX' },
  { key: 'constitution', abbr: 'CON' },
  { key: 'intelligence', abbr: 'INT' },
  { key: 'wisdom',       abbr: 'WIS' },
  { key: 'charisma',     abbr: 'CHA' },
];

function modifier(score) {
  const mod = Math.floor((Number(score) - 10) / 2);
  return mod >= 0 ? `+${mod}` : `${mod}`;
}

export default function CharacterCard({ character, onEdit, onDelete }) {
  // Alle Charakter-Daten kommen aus dem data-JSONB-Feld
  const d = character.data ?? {};

  // Unterstützt sowohl englische als auch deutsche Feldnamen
  const charClass = d.class   ?? d.klasse   ?? null;
  const charRace  = d.race    ?? d.rasse    ?? null;
  const charLevel = d.level   ?? d.stufe    ?? null;
  const charNotes = d.notes   ?? d.notizen  ?? d.beschreibung ?? null;
  const charBg    = d.background ?? d.hintergrund ?? null;

  const classColor = CLASS_COLORS[charClass] ?? 'bg-slate-100 dark:bg-slate-800 text-slate-700 dark:text-slate-300';

  // Prüfen ob Stats vorhanden sind
  const hasStats = STAT_KEYS.some(({ key }) => d[key] != null);

  return (
    <Card className="group hover:shadow-md hover:-translate-y-0.5 transition-all duration-200">
      {/* Header */}
      <Card.Header className="pb-3">
        <div className="flex items-start justify-between gap-2">
          <div className="min-w-0">
            <h3 className="font-display text-lg font-bold text-slate-900 dark:text-white truncate">
              {character.name}
            </h3>
            <div className="flex items-center gap-2 mt-1.5 flex-wrap">
              {charClass && (
                <span className={cn('text-xs font-semibold px-2 py-0.5 rounded-md', classColor)}>
                  {charClass}
                </span>
              )}
              {charRace && <Badge variant="default" size="sm">{charRace}</Badge>}
              {charBg   && <Badge variant="default" size="sm">{charBg}</Badge>}
            </div>
          </div>

          {/* Level Badge */}
          {charLevel && (
            <div className="flex flex-col items-center justify-center h-11 w-11 rounded-xl bg-brand-50 dark:bg-brand-950 border border-brand-200 dark:border-brand-800 shrink-0">
              <span className="text-[10px] font-bold text-brand-500 uppercase tracking-wider leading-none">Lvl</span>
              <span className="font-display text-xl font-extrabold text-brand-700 dark:text-brand-300 leading-none">
                {charLevel}
              </span>
            </div>
          )}
        </div>
      </Card.Header>

      {/* Ability Scores — nur wenn vorhanden */}
      {hasStats && (
        <Card.Content className="py-3 border-t border-slate-100 dark:border-slate-800">
          <div className="grid grid-cols-6 gap-1 text-center">
            {STAT_KEYS.map(({ key, abbr }) => {
              const score = d[key];
              if (score == null) return null;
              const mod = modifier(score);
              return (
                <div key={key} className="flex flex-col items-center">
                  <span className="text-[10px] font-bold text-slate-400 dark:text-slate-500 uppercase">{abbr}</span>
                  <span className="font-display text-base font-extrabold text-slate-800 dark:text-slate-200 leading-tight">
                    {score}
                  </span>
                  <span className={cn(
                    'text-[10px] font-mono font-semibold',
                    Number(mod) >= 0 ? 'text-emerald-600 dark:text-emerald-400' : 'text-red-500 dark:text-red-400'
                  )}>
                    {mod}
                  </span>
                </div>
              );
            })}
          </div>
        </Card.Content>
      )}

      {/* Notes / Beschreibung */}
      {charNotes && (
        <div className="px-5 pb-3">
          <p className="text-xs text-slate-500 dark:text-slate-400 line-clamp-2 leading-relaxed italic">
            "{charNotes}"
          </p>
        </div>
      )}

      {/* Erstellt am */}
      <div className="px-5 pb-2">
        <p className="text-[10px] text-slate-400 dark:text-slate-600">
          Erstellt: {formatDate(character.created_at)}
        </p>
      </div>

      {/* Actions */}
      <Card.Footer className="justify-end gap-2 pt-3">
        <Button
          variant="ghost"
          size="sm"
          leftIcon={<Pencil size={13} />}
          onClick={() => onEdit(character)}
        >
          Bearbeiten
        </Button>
        <Button
          variant="ghost"
          size="sm"
          leftIcon={<Trash2 size={13} />}
          className="hover:bg-red-50 dark:hover:bg-red-950 hover:text-red-600 dark:hover:text-red-400"
          onClick={() => onDelete(character)}
        >
          Löschen
        </Button>
      </Card.Footer>
    </Card>
  );
}
