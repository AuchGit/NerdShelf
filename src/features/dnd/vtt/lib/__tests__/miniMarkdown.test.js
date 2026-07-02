// The markdown importer feeds handout HTML shown to every player — the escape
// behaviour is security-relevant, the formatting is UX.
import { describe, it, expect } from 'vitest';
import { renderMarkdown } from '../miniMarkdown';

describe('renderMarkdown', () => {
  it('escaped HTML zuerst — kein Script-Injection über Handouts', () => {
    const html = renderMarkdown('<script>alert(1)</script>');
    expect(html).not.toContain('<script>');
    expect(html).toContain('&lt;script&gt;');
  });
  it('Überschriften, fett, kursiv, Code', () => {
    expect(renderMarkdown('# Titel')).toContain('<h1>Titel</h1>');
    expect(renderMarkdown('**fett**')).toContain('<strong>fett</strong>');
    expect(renderMarkdown('so *kursiv* halt')).toContain('<em>kursiv</em>');
    expect(renderMarkdown('`code`')).toContain('<code>code</code>');
  });
  it('Listen (ul + ol) und Trennlinie', () => {
    const ul = renderMarkdown('- a\n- b');
    expect(ul).toContain('<ul>');
    expect(ul).toContain('<li>a</li>');
    const ol = renderMarkdown('1. eins\n2. zwei');
    expect(ol).toContain('<ol>');
    expect(renderMarkdown('---')).toContain('<hr>');
  });
  it('Links öffnen extern', () => {
    const html = renderMarkdown('[5etools](https://5e.tools)');
    expect(html).toContain('href="https://5e.tools"');
    expect(html).toContain('target="_blank"');
  });
  it('Absätze und Blockquote', () => {
    const html = renderMarkdown('erster\n\nzweiter\n\n> zitat');
    expect(html).toContain('<p>erster</p>');
    expect(html).toContain('<p>zweiter</p>');
    expect(html).toContain('<blockquote>zitat</blockquote>');
  });
  it('leere Eingabe → leerer String', () => {
    expect(renderMarkdown('')).toBe('');
    expect(renderMarkdown(null)).toBe('');
  });
});
