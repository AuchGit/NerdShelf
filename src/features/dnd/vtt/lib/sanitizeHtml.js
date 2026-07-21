// Whitelist sanitizer for handout HTML (the rich-text editor's output is shown
// to every player, so strip anything unsafe). Keeps a small set of formatting
// tags; removes unknown tags (unwrapping their content), all on* handlers and
// javascript: URLs.
const ALLOWED = new Set(['P', 'BR', 'STRONG', 'B', 'EM', 'I', 'U', 'S', 'H1', 'H2', 'H3', 'H4', 'UL', 'OL', 'LI', 'A', 'BLOCKQUOTE', 'IMG', 'HR', 'DIV', 'SPAN', 'CODE', 'PRE']);
// data-lang = Ingame-Sprach-Markierung einer Passage (Handout-Sprachen).
const OK_ATTR = new Set(['href', 'src', 'alt', 'title', 'target', 'rel', 'data-lang']);

export function sanitizeHtml(html) {
  if (typeof document === 'undefined') return '';
  const tpl = document.createElement('template');
  tpl.innerHTML = String(html || '');
  for (const el of [...tpl.content.querySelectorAll('*')]) {
    if (!ALLOWED.has(el.tagName)) { el.replaceWith(...el.childNodes); continue; }
    for (const attr of [...el.attributes]) {
      const n = attr.name.toLowerCase();
      if (!OK_ATTR.has(n)) { el.removeAttribute(attr.name); continue; }
      if ((n === 'href' || n === 'src') && /^\s*javascript:/i.test(attr.value)) el.removeAttribute(attr.name);
    }
    if (el.tagName === 'A') { el.setAttribute('target', '_blank'); el.setAttribute('rel', 'noreferrer'); }
  }
  return tpl.content.firstChild ? tpl.innerHTML : '';
}

// Shared rendering CSS for handout HTML (.vtt-md), injected once.
let injected = false;
export function ensureHandoutStyles() {
  if (injected || typeof document === 'undefined') return;
  injected = true;
  const css = '.vtt-md{word-break:break-word}.vtt-md h1{font-size:1.5em;margin:.4em 0}.vtt-md h2{font-size:1.3em;margin:.4em 0}.vtt-md h3{font-size:1.12em;margin:.3em 0}.vtt-md p{margin:.4em 0}.vtt-md ul,.vtt-md ol{margin:.3em 0 .3em 1.3em;padding:0}.vtt-md li{margin:.15em 0}.vtt-md blockquote{margin:.4em 0;padding-left:.8em;border-left:3px solid var(--color-border);color:var(--color-text-muted)}.vtt-md a{color:var(--color-accent)}.vtt-md code{background:var(--color-bg-sunken);padding:0 4px;border-radius:4px}.vtt-md hr{border:none;border-top:1px solid var(--color-border);margin:.6em 0}.vtt-md img{max-width:100%;border-radius:6px}.vtt-md:empty:before{content:attr(data-ph);color:var(--color-text-muted);opacity:.6}'
    // Ingame-Sprach-Passagen: dezente gepunktete Unterstreichung; im EDITOR
    // (.vtt-md-edit) zusätzlich ein kleines Sprach-Tag hinter der Passage,
    // damit der DM seine Markierungen sieht. Unbekannte Schrift (Spieler-
    // Ansicht nach Transform) wirkt kursiv/fremdartig.
    + '.vtt-md [data-lang]{border-bottom:1px dotted var(--color-accent)}'
    + '.vtt-md-edit [data-lang]::after{content:"‹" attr(data-lang) "›";font-size:.72em;color:var(--color-accent);margin-left:2px;opacity:.8}'
    + '.vtt-md [data-lang-unknown]{font-style:italic;letter-spacing:.4px;opacity:.92;border-bottom:1px dotted var(--color-text-muted)}';
  const st = document.createElement('style');
  st.textContent = css;
  document.head.appendChild(st);
}
