# Benutzerhandbuch pflegen

`public/handbuch.html` ist das Benutzerhandbuch der App. Es ist eine **einzelne,
eigenständige HTML-Datei** (CSS und JS stecken inline drin, nichts wird
gebündelt), liegt in `public/` und wird dadurch vom normalen Build mit
ausgeliefert. Im Programm öffnet es der `?`-Knopf in der Sidebar, im
Mobile-Menü „Mehr" und in der VTT-Kopfzeile — die Sprungziele stehen in
`src/shared/help/openHandbook.js`.

## Grundregel

**Wer eine für Benutzer sichtbare Änderung macht, aktualisiert das Handbuch in
derselben Änderung mit.**

Für Benutzer sichtbar heißt: neue oder geänderte Knöpfe, Reiter, Felder,
Menüpunkte, Tastenkürzel, Einstellungen, Abläufe, Import-/Exportformate oder
Fehlermeldungen, die jemand liest. Reine Umbauten unter der Haube (Refactoring,
Performance, Tests, Datenbank) brauchen keine Handbuch-Änderung.

## Beim Bearbeiten beachten

- **Sprache:** Deutsch, per „du", aus Sicht der Benutzer — beschreibe, was man
  sieht und klickt, nicht wie es programmiert ist. Keine Dateinamen, keine
  Komponenten-, Tabellen- oder Feldnamen aus dem Code im Fließtext.
- **Beschriftungen wörtlich zitieren:** Knöpfe und Reiter genau so schreiben,
  wie sie in der App stehen, in `<span class="ui">…</span>`. Ändert sich eine
  Beschriftung im Code, hier mitziehen.
- **Struktur:** Ein Thema = ein `<section id="…">`. Neue Abschnitte brauchen
  1. die `<section id>`,
  2. einen Eintrag in der Seitennavigation `.nav`,
  3. bei Bedarf einen Anker in `SECTION_BY_HASH` / `SECTION_BY_PATH` in
     `src/shared/help/openHandbook.js`, damit der `?`-Knopf dorthin springt.

  Bestehende `id`s **nicht umbenennen** — sie sind Sprungziele.
- **Wiederkehrende Bausteine:** `.path` (Wo finde ich das), `ol.steps`
  (Schritt für Schritt), `.tablewrap > table` (Übersichten), `.note` /
  `.note.tip` / `.note.warn` (Hinweise), `kbd` (Tasten), `.term` mit `data-def`
  (Glossarbegriff, per Alt+Hover erklärt). Begriffe, die im Glossar
  (`#ref-glossar`) stehen, brauchen kein eigenes `data-def` — die Erklärung wird
  von dort geholt.
- **Neue Tastenkürzel** zusätzlich in `#ref-kuerzel` eintragen; VTT-Kürzel
  parallel in `src/features/dnd/vtt/components/ShortcutOverlay.jsx`.
- **Screenshots** liegen in `public/handbuch-img/` (siehe README dort). Fehlt
  eine Datei, zeigt das Handbuch einen Platzhalter — das ist in Ordnung.
- **Keine Emojis** als Schmuck; Emojis nur, wenn sie Teil einer echten
  Beschriftung in der App sind (z. B. „🗺 Karten" im VTT).
- Nach dem Bearbeiten gegenprüfen, dass jeder `.nav`-Link ein Ziel hat und die
  Datei sauber verschachtelt ist.

## Ausliefern

Nichts Zusätzliches nötig: `vite build` kopiert `public/` nach `dist/`, der
Tauri-Build bündelt `dist/`. Für die installierte PWA sorgt
`navigateFallbackDenylist` in `vite.config.js` dafür, dass der Service Worker
`handbuch.html` nicht durch `index.html` ersetzt.
