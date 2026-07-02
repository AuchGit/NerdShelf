// Tiny, dependency-free Markdown → HTML for handout bodies. HTML is ESCAPED
// first (so a handout can never inject raw markup), then a common subset is
// applied: headings, bold/italic/inline-code, links, images, lists, hr,
// blockquotes, paragraphs & line breaks. Good enough for handouts; not a full
// CommonMark parser.
const esc = (s) => String(s).replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;');

function inline(s) {
  return s
    .replace(/!\[([^\]]*)\]\(([^)\s]+)\)/g, '<img alt="$1" src="$2" style="max-width:100%;border-radius:6px">')
    .replace(/\[([^\]]+)\]\(([^)\s]+)\)/g, '<a href="$2" target="_blank" rel="noreferrer">$1</a>')
    .replace(/\*\*([^*]+)\*\*/g, '<strong>$1</strong>')
    .replace(/(^|[^*])\*([^*]+)\*/g, '$1<em>$2</em>')
    .replace(/`([^`]+)`/g, '<code>$1</code>');
}

export function renderMarkdown(md) {
  const lines = esc(md || '').split(/\r?\n/);
  const out = [];
  let list = null; // 'ul' | 'ol'
  let para = [];
  const closeList = () => { if (list) { out.push(`</${list}>`); list = null; } };
  const flushPara = () => { if (para.length) { out.push(`<p>${inline(para.join(' '))}</p>`); para = []; } };
  for (const raw of lines) {
    const line = raw.replace(/\s+$/, '');
    if (!line.trim()) { flushPara(); closeList(); continue; }
    let m;
    if ((m = /^(#{1,6})\s+(.*)$/.exec(line))) { flushPara(); closeList(); const n = m[1].length; out.push(`<h${n}>${inline(m[2])}</h${n}>`); continue; }
    if (/^(---|\*\*\*|___)\s*$/.test(line)) { flushPara(); closeList(); out.push('<hr>'); continue; }
    // NB: the text is HTML-escaped BEFORE line parsing, so a quote line starts
    // with `&gt;` here, not `>`.
    if ((m = /^&gt;\s?(.*)$/.exec(line))) { flushPara(); closeList(); out.push(`<blockquote>${inline(m[1])}</blockquote>`); continue; }
    if ((m = /^[-*+]\s+(.*)$/.exec(line))) { flushPara(); if (list !== 'ul') { closeList(); out.push('<ul>'); list = 'ul'; } out.push(`<li>${inline(m[1])}</li>`); continue; }
    if ((m = /^\d+\.\s+(.*)$/.exec(line))) { flushPara(); if (list !== 'ol') { closeList(); out.push('<ol>'); list = 'ol'; } out.push(`<li>${inline(m[1])}</li>`); continue; }
    closeList(); para.push(line);
  }
  flushPara(); closeList();
  return out.join('\n');
}
