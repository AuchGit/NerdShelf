// A small WYSIWYG editor for handout text: a contentEditable surface with a
// formatting toolbar (bold/italic/underline, headings, lists, quote, link) —
// real toggle buttons, no markup syntax. Stores sanitized HTML via onChange.
//
// Ingame-Sprachen: das 🗣-Dropdown markiert die AUSWAHL als Passage in einer
// Sprache (<span data-lang="…">). Spieler, deren Charakter die Sprache nicht
// kennt, sehen die Passage später als Fantasieschrift (HandoutOverlay).
// „— Markierung entfernen" hebt die Markierung an der Cursor-Position auf.
import { useEffect, useRef } from 'react';
import { sanitizeHtml, ensureHandoutStyles } from '../lib/sanitizeHtml';
import { INGAME_LANGUAGES } from '../lib/fantasyLanguage';

const exec = (c, v) => { try { document.execCommand(c, false, v); } catch { /* ignore */ } };
const keepSel = (e) => e.preventDefault(); // don't let the button steal the selection

function ToolBtn({ on, label, title, style }) {
  return <button type="button" title={title} onMouseDown={keepSel} onClick={on} style={{ ...S.btn, ...style }}>{label}</button>;
}

export default function RichTextEditor({ value, onChange, minHeight = 160, placeholder = 'Handout-Text…' }) {
  const ref = useRef(null);
  // Beim Öffnen des Sprach-Dropdowns verliert der Editor die Selektion —
  // wir sichern die Range bei mousedown und stellen sie vorm Anwenden wieder her.
  const savedRange = useRef(null);
  useEffect(() => { ensureHandoutStyles(); try { document.execCommand('styleWithCSS', false, false); } catch { /* ignore */ } }, []);
  // Push external value into the DOM only when it differs (avoid caret jumps).
  useEffect(() => {
    const el = ref.current;
    if (el && el.innerHTML !== (value || '')) el.innerHTML = value || '';
  }, [value]);

  const emit = () => onChange?.(sanitizeHtml(ref.current?.innerHTML || ''));
  const run = (c, v) => { ref.current?.focus(); exec(c, v); emit(); };
  const block = (tag) => { ref.current?.focus(); exec('formatBlock', tag); emit(); };
  const link = () => { const url = window.prompt('Link-URL:'); if (url) run('createLink', url); };

  const saveRange = () => {
    const sel = window.getSelection();
    if (sel && sel.rangeCount > 0 && ref.current?.contains(sel.getRangeAt(0).commonAncestorContainer)) {
      savedRange.current = sel.getRangeAt(0).cloneRange();
    }
  };
  const applyLang = (langId) => {
    const range = savedRange.current;
    savedRange.current = null;
    if (!range || !ref.current?.contains(range.commonAncestorContainer)) return;
    if (!langId) {
      // Markierung entfernen: das umschließende [data-lang] der Auswahl unwrappen.
      let el = range.commonAncestorContainer;
      if (el.nodeType === Node.TEXT_NODE) el = el.parentElement;
      const span = el?.closest?.('[data-lang]');
      if (span && ref.current.contains(span)) span.replaceWith(...span.childNodes);
      emit();
      return;
    }
    if (range.collapsed) return; // ohne Auswahl nichts markieren
    const span = document.createElement('span');
    span.setAttribute('data-lang', langId);
    try {
      range.surroundContents(span);
    } catch {
      // Auswahl schneidet Element-Grenzen → Inhalt extrahieren und wrappen.
      try { span.appendChild(range.extractContents()); range.insertNode(span); }
      catch { return; }
    }
    emit();
  };

  return (
    <div style={S.wrap}>
      <div style={S.bar}>
        <ToolBtn on={() => run('bold')} label={<b>B</b>} title="Fett (Strg+B)" />
        <ToolBtn on={() => run('italic')} label={<i>I</i>} title="Kursiv (Strg+I)" />
        <ToolBtn on={() => run('underline')} label={<u>U</u>} title="Unterstrichen" />
        <span style={S.sep} />
        <ToolBtn on={() => block('H2')} label="H1" title="Überschrift" />
        <ToolBtn on={() => block('H3')} label="H2" title="Unterüberschrift" />
        <ToolBtn on={() => block('P')} label="¶" title="Normaler Absatz" />
        <span style={S.sep} />
        <ToolBtn on={() => run('insertUnorderedList')} label="•" title="Aufzählung" />
        <ToolBtn on={() => run('insertOrderedList')} label="1." title="Nummerierte Liste" />
        <ToolBtn on={() => block('BLOCKQUOTE')} label="❝" title="Zitat" />
        <ToolBtn on={link} label="🔗" title="Link einfügen" />
        <span style={S.sep} />
        <select style={S.langSel} value="" onMouseDown={saveRange}
          title="Ausgewählten Text als Ingame-Sprache markieren — Spieler ohne diese Sprache sehen unlesbare Fantasieschrift"
          onChange={(e) => { applyLang(e.target.value || null); e.target.value = ''; }}>
          <option value="" disabled>🗣 Sprache</option>
          {INGAME_LANGUAGES.map((l) => <option key={l.id} value={l.id}>{l.label}</option>)}
          <option value="">— Markierung entfernen</option>
        </select>
        <span style={{ flex: 1 }} />
        <ToolBtn on={() => run('removeFormat')} label="⌫" title="Formatierung entfernen" />
      </div>
      <div ref={ref} contentEditable suppressContentEditableWarning className="vtt-md vtt-md-edit"
        data-ph={placeholder} style={{ ...S.editor, minHeight }}
        onInput={emit} onBlur={emit} />
    </div>
  );
}

const S = {
  wrap: { border: '1px solid var(--color-border)', borderRadius: 'var(--radius-md)', overflow: 'hidden', background: 'var(--color-surface)' },
  bar: { display: 'flex', alignItems: 'center', gap: 2, padding: '3px 4px', borderBottom: '1px solid var(--color-border)', background: 'var(--color-bg-sunken)', flexWrap: 'wrap' },
  btn: { minWidth: 26, height: 24, padding: '0 6px', background: 'transparent', color: 'var(--color-text)', border: '1px solid transparent', borderRadius: 4, cursor: 'pointer', fontSize: 12, lineHeight: 1 },
  langSel: { height: 24, maxWidth: 110, padding: '0 2px', background: 'transparent', color: 'var(--color-text)', border: '1px solid transparent', borderRadius: 4, cursor: 'pointer', fontSize: 12 },
  sep: { width: 1, height: 16, background: 'var(--color-border)', margin: '0 3px' },
  editor: { padding: '8px 10px', maxHeight: 360, overflow: 'auto', outline: 'none', fontSize: 'var(--fs-sm)', lineHeight: 1.45 },
};
