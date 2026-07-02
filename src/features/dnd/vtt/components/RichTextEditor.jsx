// A small WYSIWYG editor for handout text: a contentEditable surface with a
// formatting toolbar (bold/italic/underline, headings, lists, quote, link) —
// real toggle buttons, no markup syntax. Stores sanitized HTML via onChange.
import { useEffect, useRef } from 'react';
import { sanitizeHtml, ensureHandoutStyles } from '../lib/sanitizeHtml';

const exec = (c, v) => { try { document.execCommand(c, false, v); } catch { /* ignore */ } };
const keepSel = (e) => e.preventDefault(); // don't let the button steal the selection

function ToolBtn({ on, label, title, style }) {
  return <button type="button" title={title} onMouseDown={keepSel} onClick={on} style={{ ...S.btn, ...style }}>{label}</button>;
}

export default function RichTextEditor({ value, onChange, minHeight = 160, placeholder = 'Handout-Text…' }) {
  const ref = useRef(null);
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
        <span style={{ flex: 1 }} />
        <ToolBtn on={() => run('removeFormat')} label="⌫" title="Formatierung entfernen" />
      </div>
      <div ref={ref} contentEditable suppressContentEditableWarning className="vtt-md"
        data-ph={placeholder} style={{ ...S.editor, minHeight }}
        onInput={emit} onBlur={emit} />
    </div>
  );
}

const S = {
  wrap: { border: '1px solid var(--color-border)', borderRadius: 'var(--radius-md)', overflow: 'hidden', background: 'var(--color-surface)' },
  bar: { display: 'flex', alignItems: 'center', gap: 2, padding: '3px 4px', borderBottom: '1px solid var(--color-border)', background: 'var(--color-bg-sunken)', flexWrap: 'wrap' },
  btn: { minWidth: 26, height: 24, padding: '0 6px', background: 'transparent', color: 'var(--color-text)', border: '1px solid transparent', borderRadius: 4, cursor: 'pointer', fontSize: 12, lineHeight: 1 },
  sep: { width: 1, height: 16, background: 'var(--color-border)', margin: '0 3px' },
  editor: { padding: '8px 10px', maxHeight: 360, overflow: 'auto', outline: 'none', fontSize: 'var(--fs-sm)', lineHeight: 1.45 },
};
