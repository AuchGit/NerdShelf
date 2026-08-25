# Screenshots fürs Handbuch

PNG-Dateien hier ablegen — `handbuch.html` bindet sie automatisch ein und
blendet den gestrichelten Platzhalter aus. Fehlt eine Datei, bleibt einfach
der Platzhalter stehen; nichts bricht.

| Dateiname             | Zeigt                                              |
| --------------------- | -------------------------------------------------- |
| `dnd-dashboard.png`   | DnD → Characters, Übersicht mit Charakterkacheln     |
| `dnd-sheet.png`       | Charakterbogen, Reiter *Overview*                    |
| `vtt-overview.png`    | Spieltisch mit geöffneten Panels und Initiative-Leiste |
| `mtg-builder.png`     | Deck-Builder: Vorschau links, Suche, Deck-Panel rechts |
| `w40k-combat.png`     | Combat Helper während einer Partie                   |

Die nummerierten Markierungen liegen in `handbuch.html` als Prozentwerte am
jeweiligen `<figure class="shot">` (`style="left:…;top:…"`). Passt eine
Markierung nach dem Einfügen eines Screenshots nicht, dort die Prozentwerte
nachziehen — der Rahmen übernimmt automatisch das Seitenverhältnis des Bildes,
die Prozentwerte beziehen sich also direkt auf das Bild.
