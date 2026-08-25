# VTT ↔ NerdShelf — Übergabe / Handoff

**Zweck dieser Datei:** Wer neu am VTT weiterarbeitet, soll hiermit
**alles** wissen, um nahtlos weiterzumachen: was gebaut wurde, wie, warum, was
noch offen ist und wie es weitergehen soll. Lies das zuerst komplett.

Stand: Der VTT ist als Foundry-artige Battlemap **in NerdShelf integriert**,
läuft in `npm run tauri dev`, der Vite-Build ist grün. Alles liegt auf Branch
**`vtt-integration`** (noch **nicht committet** — bewusst, zum Review). Die
Live-Daten brauchen einmalig die SQL-Migration (siehe §6).

---

## 0. TL;DR für den nächsten Schritt
**Erledigt (✓ A, ✓ B, ✓ C, ✓ D):**
- **A — Token ↔ Charakter-Bindung:** gebundene Tokens spiegeln HP/Conditions
  des echten `dnd_characters`, Schreibzugriff über RPC `dnd_patch_combat_state`.
- **B — Sheet als Overlay:** Token-Kontextmenü → „📋 Sheet öffnen" spawnt das
  vorhandene Sheet-Popout-Fenster (`lib/sheetPopout.js`) für `token.characterId`
  (Owner: editierbares Sheet; GM: read-only GM-Sheet).
- **C — NPC/Monster aus Bestiary:** GM-„Bestiary"-Panel (Suche über
  `monsters.json` der Edition) → Klick setzt NPC-Token mit Name/HP/Größe aus
  dem Statblock (`createTokenFromStatblock`).
- **D — 5e.tools-Import:** Bestiary-URL ins „Bestiary"-Panel einfügen →
  `parseFiveEUrl`/`lookupEntry`(+`lookupEntryLive`) → NPC-Token. `fiveeImporter`
  unterstützt jetzt `monster` (lokal + Live-Bestiary). NPC-Token zeigen das
  5etools-Tokenbild (Fallback: farbige Scheibe).
- **E (teilweise) — Dynamisches Licht:** Beleuchtung wird gerendert
  (`LightLayer`: Glow + Wand-Schatten), Lichtquellen aus UVTT-Import +
  „Leucht-Tokens" (Fackel/Laterne/Kerze im Token-Kontextmenü). DM kann Licht
  pro Map abschalten (Map-Settings). **Offen:** Sicht-Gating („Spieler sieht
  nur, was beleuchtet UND in Sicht ist") — braucht Mask-Intersection + Tuning.

**⚠ DB-Migration neu anwenden:** `scripts/vtt-schema.sql` erneut im Supabase-
SQL-Editor ausführen (idempotent) — Tabelle `vtt_lights` + Spalten
`vtt_tokens.light`, `vtt_tokens.ac`, `vtt_tokens.statblock`,
`vtt_maps.lighting_enabled`.
**⚠ Rust neu bauen:** neues `tauri-plugin-http` (Cargo + lib.rs + capability) —
`npm run tauri dev` baut das automatisch (cargo zieht `tauri-plugin-http`).
`npm install` lief schon (JS-Plugin im Lockfile).

GUI: linke **Icon-Tab-Leiste** am Fensterrand — ein Button pro Kategorie
(🗺 Karten · ⚙ Grid·Fog·Licht · 🪜 Ebenen · 👤 Tokens · 🐉 Bestiary · ⚔ Initiative);
Klick öffnet die jeweilige Sidebar (mehrere gleichzeitig, nebeneinander). Die
Panels-Komponenten rendern reinen Inhalt; VttApp liefert Rahmen/Titel/×. Icons
sind Emoji-Platzhalter mit `iconSrc`-Hook → später SVGs aus `public/Assets/vtt/`.
Zone-/Wand-Editor erscheinen kontextuell rechts bei Auswahl.
Initiative: **🎲-Wurf pro Eintrag** = d20 + automatischer Initiative-Bonus
(gebundener Charakter via `computeCharacter().initiative`, sonst NPC-DEX-Mod aus
dem Statblock). DM würfelt für alle, Spieler für ihr eigenes Token.

Außerdem in dieser Runde: **Demo-Map** wieder da; **Panning-Clip-Bug** behoben;
**AC an Gegner-Tokens** (nur DM); **Doppelklick → Statblock/Sheet-Overlay**
(verschiebbar, mehrere gleichzeitig; NPC = Statblock, Spieler = Char-Stats +
Sheet-Button); **Spieler-Token gezielt pro Mitglied oder „alle"** (TokenPanel,
kein Auto-Spawn mehr); **Tür öffnen ändert Auswahl nicht**; **Token-Licht mit
eigener ft-Eingabe**; **5e.tools-Tokenbilder** auf NPC-Tokens (CORS-frei via
Tauri-HTTP, Fallback farbige Scheibe).

Als Nächstes: **§9 E Rest** (Sicht-Gating Licht), dann **§9 F** (Audio via WebRTC).

---

## 1. Was der VTT kann (fertig & verifiziert im Standalone-Prototyp)
- **Maps:** Bild-Import (komprimiert → WebP) **und Universal-VTT-Import**
  (`.uvtt`/`.dd2vtt` → Bild + Grid + Wände + Türen). Aktivieren für alle +
  Spieler-Sichtbarkeit pro Map (aktive immer oben in der Spieler-Nav).
- **Grid:** Größe-Slider, „Karte auf volle Felder snappen", Offset, Farbe/
  Deckkraft/Dicke, Stil (durchgängig/gestrichelt/punkte). 1 Feld = 5 ft.
- **Tokens:** kreisrunde Portraits, Grid-Snap-Drag (**Strg** = frei), **WASD**
  feldweise, **Shift** = Multi-Select, Marquee-Box-Auswahl, Größen 1×1…3×3,
  HP-Bar, Condition-Badges (SVG) in den Ecken, Rechtsklick-Kontextmenü
  (Conditions toggeln, HP per Zahl±Enter, Größe, entfernen).
- **Zonen/AoE:** Kreis/Kegel/Linie(=verstellbares Rechteck)/Quadrat, in ft mit
  Live-Größenlabel, betroffene Felder hervorgehoben, nachträglich auswählbar
  (verschieben/drehen/skalieren/Farbe/Deckkraft/löschen).
- **Wände:** 3 Typen — *Licht+Bewegung*, *nur Bewegung*, *Tür*; als
  zusammenhängende Ketten gezeichnet (schließen mit „klebrigem" Startpunkt +
  Puls-Effekt, Tool bleibt aktiv). Movement-Collision (Drag + WASD; DM darf
  durch Wände). **Türen** nur auf Wänden platzierbar (splitten die Wand),
  einfach/doppelt (Doppeltür = 2 Felder, 1 zentriertes Icon), per Klick
  öffnen/schließen — auch durch Spieler.
- **Fog of War:** kein / manuell (Rechtecke) / **dynamisch (Sichtlinie)**.
  Spieler sehen nur, was ihr Token durch lichtblockende Wände sieht; Tokens in
  ungesehenem/verschattetem Bereich sind verborgen. **Explored-Memory:** schon
  gesehene, aktuell unsichtbare Bereiche in echtem **Graustufen-S/W inkl. Grid**;
  zuletzt gesehene Tokens als grauer „Geist", der verschwindet, sobald man das
  Token woanders live sieht. **DM-Token-Preview:** wählt der DM ein Token, sieht
  er alles in Graustufen außer der aktuellen Sicht des Tokens (DM sieht immer
  alles).
- **Kampf:** Multi-Select → Kampf starten; **Initiative-Overlay** oben über der
  Map (Foundry-Stil, Token-Portraits in Reihenfolge, aktiver Zug hervorgehoben,
  Runden-Zähler, vor/zurück).
- **Levels/Ebenen:** mehrere Stockwerke pro Map; Entities pro Ebene; **Treppen/
  Leitern** verbinden Felder über Ebenen (zweiseitig, mehrere Ausgänge möglich),
  Spieler wechselt beim Betreten automatisch die Ebene (bei mehreren Ausgängen
  Auswahl-Popup).
- **Layout:** Map = Vollbild-Hintergrund, Panels/Toolbars schweben darüber →
  Ein-/Ausklappen verschiebt die Map nie. Linke Sidebar einklappbar.
- **Realtime:** optimistisch lokal + Broadcast + DB-Write + postgres_changes-
  Backstop + Snapshot-Hydration beim Join. Rollen (DM/Spieler) per Permission.

Der **Standalone-Prototyp** liegt unter `c:\Coding\VTT` (eigenes Vite+React-
Projekt). Dort: `README.md` (Steuerung/Features) + `docs/INTEGRATION.md`
(Datenmodell, Roadmap, Budget). Er ist die schnelle Sandbox (Zwei-Tab-Test ohne
Supabase via `LocalAdapter`/BroadcastChannel) — **nicht löschen**, bis NerdShelf
rund läuft.

---

## 2. Architektur (renderer- & sync-agnostisch — wichtig)
Op-basierter Store ist die einzige Quelle der Wahrheit. Jede Mutation ist eine
`op` (`{type, ...}`) → `store.apply(op)` → (1) lokal anwenden (sofort), (2) an
den `SyncAdapter` zum Broadcasten/Persistieren geben. Inbound-Ops von Peers →
`applyRemote(op)` (kein Re-Broadcast). Die UI weiß nie, ob lokal oder vernetzt.

- **`state/store.js`** — Store (useSyncExternalStore), Reducer, `connectSync`,
  Snapshot-Handshake (`__reqState`/`__snapshot`), `serialize`/`hydrate`.
- **`state/actions.js`** — alle „Verben" (Action-Creators), das Op-Vokabular.
- **`state/useVtt.js`** — React-Selektor-Hooks.
- **`sync/SyncAdapter.js`** — Contract + `LocalAdapter` (BroadcastChannel, nur
  Standalone-Prototyp; in NerdShelf ungenutzt).
- **`sync/SupabaseAdapter.js`** — die echte Verdrahtung (siehe §5).
- **`render/`** — **PixiJS v8 imperativ** (kein @pixi/react). `PixiStage.jsx`
  (React-Wrapper, erzeugt die Pixi-Application, StrictMode-sicher),
  `VttRenderer.js` (Controller: Layer, Viewport, alles Input-Handling,
  reconcile aus dem Store), `viewport.js`, `textures.js`,
  `render/layers/*` (grid, tokens, zones, walls, transitions, fog, pings, ruler).
- **`lib/`** — `geometry.js` (Grid-Mathe/Snapping, Map-Space-Koordinaten),
  `visibility.js` (Line-of-Sight-Polygon + Segment-Schnitt), `constants.js`
  (Conditions, Zonen, Wandtypen, Fog-Modi, Asset-Pfade), `mapImage.js`
  (Bild→WebP-Kompression), `uvtt.js` (UVTT-Parser), `mapStorage.js`
  (Storage-Upload, **NerdShelf-only**).
- **`components/`** — DOM-UI: Toolbar, MapManager, GridControls, LevelPanel,
  TokenPanel, InitiativeTracker, InitiativeBar, TokenContextMenu, ZoneEditor,
  WallEditor, TransitionPrompt, Collapsible.
- **`VttApp.jsx`** — Shell. In NerdShelf Props: `{campaignId, userId, isGM,
  playerName, onExit}`; setzt die Session und verbindet den `SupabaseAdapter`.

**Schlüssel-Designentscheidungen (nicht umwerfen):**
- Alles in **Map-Space** gespeichert (Bild-Pixel/Grid), Pan/Zoom nur als
  Viewport-Transform. Token-Pos = `{x,y}` in Map-Pixeln.
- **PixiJS rendert SVG-Image-Texturen in WebGL schwarz** → SVGs werden erst auf
  ein Canvas gerastert (`render/textures.js`: `loadIcon`, `loadSvgTinted`).
  Niemals `Assets.load`/`Texture.from(img)` direkt für SVGs nutzen.
- Masken in Pixi v8 zuverlässiger als **Kind** des maskierten Containers; eine
  Masken-Graphics, die nicht mehr Maske ist, **rendert als weiße Fläche** →
  immer `clear()` (siehe `disableMemoryVision`).
- IDs sind **client-generiert (text)**, `tok_…`/`wall_…` etc. → DB-PKs sind `text`.

---

## 3. Wo alles in NerdShelf liegt
```
src/features/dnd/vtt/                  ← der ganze VTT-Feature-Ordner
src/features/dnd/character-builder/pages/VttPage.jsx   ← lädt Rolle, mountet VttApp
src/features/dnd/character-builder/DndCharacterApp.jsx ← Route /campaign/:id/vtt
src/features/dnd/character-builder/pages/CampaignDetailPage.jsx ← 🗺 VTT-Button + Spieler-Einstieg
public/Assets/conditions/*.svg, public/Assets/map/*.svg ← Icons (mitkopiert)
scripts/vtt-schema.sql                 ← DB-Migration (muss 1× angewandt werden)
package.json                            ← + "pixi.js": "^8.6.6"
```

---

## 4. Einstieg / Routing (so ist es verdrahtet)
- **Session = VTT:** Bei aktiver Session sehen Spieler in der Campaign-Ansicht
  **„▶ Zur Session"** → `/campaign/:id/vtt` (direkt ins VTT).
- **DM:** Button **„🗺 VTT"** oben in der Campaign-Ansicht → `/campaign/:id/vtt`
  (Vorbereiten + Spielen). „▶ Session starten" setzt `session_active=true` und
  geht (wie bisher) zur Session-Übersicht (`SessionPage`).
- `VttPage` ermittelt `isGM = campaign.gm_id === user.id`, sonst `playerName`
  aus der Mitgliedschaft, und mountet `VttApp` als Vollbild-Overlay.

---

## 5. Sync: SupabaseAdapter (`src/features/dnd/vtt/sync/SupabaseAdapter.js`)
- `connect()`: lädt **Snapshot** (alle `vtt_*`-Rows der Campaign) → `__snapshot`
  in den Store; abonniert Channel `vtt:<campaignId>` mit **broadcast `op`** +
  **postgres_changes** auf allen Tabellen (Backstop).
- `send(op)`: lokale UI-/transiente Ops werden nicht gesendet; sonst sofort
  **broadcast** + **DB-Persist**. **Token-Drags** (`token/move`) sind pro Token
  **gedrosselt** (250ms trailing) gegen das Free-Tier-Budget.
- **Ops↔Rows-Mapping** (camelCase↔snake_case) in den `*ToRow`/`rowTo*`-Helfern.
  Maps: DB hält `image_path` (Storage), Client bekommt Public-URL
  (`publicUrl`). `addMap` führt zusätzlich `imagePath` mit.
- `MapManager` (NerdShelf) lädt Map-Bilder via `lib/mapStorage.js` in den Bucket
  `vtt-maps` (Pfad `<campaignId>/<sha256>.webp`, Dedup per Hash).

---

## 6. Datenbank — MUSS einmal angewandt werden
**`scripts/vtt-schema.sql`** im Supabase-SQL-Editor ausführen (idempotent).
Legt an: Tabellen `vtt_campaign_state, vtt_maps, vtt_tokens, vtt_zones,
vtt_walls, vtt_transitions, vtt_fog`; RLS über eure Helfer
`dnd_is_campaign_gm(uuid)` / `dnd_is_campaign_member(uuid)`
(Members lesen; GM schreibt alles; Spieler updaten **eigenes** Token; Members
verwalten **eigene** Zonen; `vtt_toggle_door`-RPC für Türen); Realtime-
Publication; Storage-Bucket `vtt-maps` (public read, auth write).
- `campaign_id` = uuid (→ `dnd_campaigns`), `character_id` = bigint
  (→ `dnd_characters`), VTT-PKs = `text`.
Ohne diesen Schritt lädt die UI, aber Snapshot/Upload/Sync schlagen fehl.

---

## 7. Testen
1. `scripts/vtt-schema.sql` in Supabase ausführen.
2. `npm install` (Lockfile geändert: pixi.js) — falls noch nicht geschehen.
3. `npm run tauri dev`.
4. Campaign → **🗺 VTT** → Map importieren (Bild oder `.uvtt`) → aktivieren.
   Wände/Türen/Ebenen/Tokens vorbereiten; **Session starten**.
5. Zweiter Account als Spieler → Campaign → **▶ Zur Session** → live im selben
   VTT. HP/Tokens/Wände/Türen/Fog persistieren & syncen.

**Steuerung:** Pan = Mittel-/Rechts-Drag oder Space+Drag; Zoom = Rad; Token =
Auswahl-Tool ziehen (Strg = frei, WASD = feldweise); Multi-Select = Shift-Klick/
Marquee; Rechtsklick Token = Kontextmenü; Tür = Wände-Tool→„Tür"→auf Wand
klicken; Tür öffnen = anklicken; Fog/Levels über die Panels.

---

## 8. Release-Workflow
Kompatibel. VTT = Quellcode + Dependency (pixi.js) + `public/Assets/` → wird vom
normalen `vite build` → `tauri build` → Updater eingebacken. Vor Release:
Branch **`vtt-integration` → `main` mergen**, `npm install` auf dem Build-Rechner,
und **`vtt-schema.sql` einmalig auf dem Prod-Supabase** ausführen (nicht Teil des
App-Bundles). Bundle wächst ~0.5 MB (Pixi-Chunk).

---

## 9. Nächste Schritte (priorisiert, mit konkreten Ankern)

### A) Token ↔ Charakter-Bindung ✓ ERLEDIGT
Ziel: gebundenes Token (`token.characterId`) ist eine Projektion des echten
Charakters. Umgesetzt in **`vtt/sync/characterBinding.js`** (Singleton, in
`VttApp` per `connectCharacterBinding`/`disconnectCharacterBinding` an den
Lebenszyklus gehängt — neben dem `SupabaseAdapter`):
- **Laden:** beim Verbinden `listMembers` + `dnd_characters`-Rows (GM: alle
  Member; Spieler: nur sein eigener — RLS). Dazu Realtime-Channel
  `vtt-chars:<campaignId>` auf `dnd_characters`-UPDATE (Merge wie SessionPage).
- **Projektion:** für jedes Token mit `characterId` werden `hp`/`hpMax`/
  `conditions` aus dem Charakter (`computeCharacter(data).hp.max`,
  `data.status.currentHp`/`.conditions`) **lokal** in den Store geschrieben
  (`applyLocal` → nicht gebroadcastet/persistiert; jeder Client leitet dieselbe
  Projektion aus der geteilten Charakter-Row ab). Diff-geschützt → keine Loops.
- **Schreibpfad:** `vtt/state/actions.js` → `applyHpDelta`/`toggleCondition`
  routen gebundene Tokens über `patchCombat(characterId, …)` →
  `dnd_patch_combat_state` (Owner **oder** GM). So sind VTT, SessionPage und
  Sheet konsistent. Optimistisch + Revert (wie SessionPage). Ungebundene
  NPC-Tokens behalten ihren eigenen Schreibpfad (`updateToken`).
- **Spawn:** RLS macht Token-INSERT **GM-only** (Spieler dürfen nur ihr eigenes
  Token *updaten*). Darum erzeugt der **GM-Client** einmal pro Session ein
  gebundenes Token pro Member ohne Token (`spawnMemberTokens`, Name/Portrait aus
  `card`). Der Spieler kann es danach bewegen/HP-Conditions setzen (Owner).
- **Nebenfix:** `addToken` setzt jetzt `mapId: activeMapId` (Spalte `map_id` ist
  `NOT NULL` — vorher hätten manuell gespawnte Tokens beim Persistieren gefehlt).
- Conditions-IDs matchen 1:1 (siehe unten). `concentration` (VTT-Extra) wird
  derzeit **nicht** synthetisiert — Projektion nimmt nur `status.conditions`.
- **Conditions-IDs matchen schon 1:1** (`vtt/lib/constants.js` ↔
  `character-builder/lib/conditions.js`, beide 14 SRD-IDs; VTT hat zusätzlich
  `concentration`). Die VTT-Condition-SVGs (`public/Assets/conditions/`) können
  auch im Sheet/der Session-Übersicht genutzt werden.

### B) Sheet als Overlay (Foundry-Stil) ✓ ERLEDIGT
Umgesetzt als **eigenes Always-on-Top-Popout-Fenster** neben dem VTT (statt
In-VTT-Overlay) — nutzt das vorhandene Sheet im `?popout=1`-Layout (`PopoutStatBar`
ist dessen Top-Bar):
- Die Spawn-Logik wurde aus `CharacterSheetPage.jsx` in
  **`character-builder/lib/sheetPopout.js`** (`openSheetPopout`) extrahiert,
  damit der VTT sie ohne das schwere Sheet-Modul importieren kann.
  `CharacterSheetPage` nutzt jetzt diese Funktion (Verhalten unverändert).
- **`vtt/components/TokenContextMenu.jsx`:** für Tokens mit `characterId` ein
  Button „📋 Sheet öffnen". Route je Rolle: **Owner** → `#/character/<id>`
  (editierbar); **GM** (nicht-eigenes Token) → `#/campaign/<cid>/character/<id>`
  (GM-Read-only-Sheet). Tauri spawnt ein `WebviewWindow` (alwaysOnTop), im
  Browser Fallback `window.open`.
- **Offen/„später":** echtes In-VTT-Overlay (statt OS-Fenster) bzw. das volle
  `CharacterSheetPage` direkt über der Map einblenden.

### C) NPC/Monster aus Bestiary ✓ ERLEDIGT
- **`vtt/components/MonsterPanel.jsx`** (GM-only, in der linken Sidebar): lädt
  `loadCreatureList(edition)` (dieselben gebundelten 5etools-Daten wie der
  Character-Builder) und filtert per Suchfeld. Klick auf einen Treffer →
  NPC-Token auf der Map (Spawn in Map-Mitte, GM zieht's hin).
- **`vtt/state/actions.js` → `createTokenFromStatblock(monster)`:** mappt
  Statblock → Token: `name`, `hp`/`hpMax` aus `hp.average`, Footprint aus
  `size` (T/S/M=1×1, L=2×2, H=3×3, G=4×4 — aus den Daten, nicht hardcoded).
- **Edition-Fluss:** `VttPage` reicht `campaign.edition` an `VttApp` → `MonsterPanel`.
- **Offen/„später":** Token-Art/Portrait (5etools-Tokenbilder sind nicht
  gebundled → aktuell farbiger Kreis); Statblock-Anzeige/Angriffe im VTT;
  Drag-&-Drop auf exakte Zielzelle statt Spawn-in-Mitte.

### D) 5e.tools-Import ✓ ERLEDIGT (für NPCs/Monster)
- **`fiveeImporter.js` erweitert um `monster`:** `lookupEntry` hat jetzt einen
  `monster`-Loader (`loadCreatureList`) und matcht **Name+Source** bevorzugt
  (wichtig bei gleichnamigen Kreaturen aus verschiedenen Quellen, Fallback
  name-only — Verhalten für spell/feat/item unverändert). `lookupEntryLive`/
  `_fetchLiveEntry` haben einen Bestiary-Zweig (`/data/bestiary/index.json` →
  `bestiary-<src>.json`); Homebrew-Live (`_fetchLiveHomebrew`) greift generisch.
- **`MonsterPanel.jsx`:** Feld „5e.tools-Bestiary-URL" → `parseFiveEUrl`, dann
  lokal `lookupEntry`, sonst live `lookupEntryLive` → `createTokenFromStatblock`.
- **Offen/„später":** Item-Import in den VTT (NPC-Tokens haben noch kein
  Inventar — der bestehende Item-Pfad zielt auf Charakter-`custom.*`).

### E) Dynamisches Licht — ✓ TEILWEISE (Beleuchtung), Sicht-Gating offen
Umgesetzt:
- **Daten:** `lights`-Slice im Store; Ops `light/add|addMany|update|remove`;
  Actions `addLight`/`addLights`/`updateLight`/`removeLight`. Persistenz/Sync
  über neue Tabelle `vtt_lights` (SupabaseAdapter: Snapshot, persist,
  rowEventToOp, Mapper). Konstanten `DEFAULT_LIGHT` + `LIGHT_PRESETS`.
- **UVTT:** `uvtt.js` skaliert Lichtpositionen (Zellen→px) + Range→ft, mappt
  ARGB-Farbe; `MapManager` ruft `addLights` beim Import.
- **Leucht-Tokens:** `token.light` ({preset,brightFt,dimFt,color}); Cycle im
  Token-Kontextmenü (`cycleTokenLight`, off→Fackel→Laterne→Kerze→off). Licht
  folgt dem Token. Persistiert via `vtt_tokens.light` (jsonb).
- **Render:** `render/layers/lightLayer.js` — additiver Glow (gestapelte Ringe
  als Falloff) je Quelle, geclippt an `visibilityPolygon` gegen lichtblockende
  Wände (= Schatten). In `liveGroup` zwischen Zonen und Tokens.
- **DM-Schalter:** `map.lightingEnabled` (Map-Settings-Checkbox), persistiert.
- ⚠ **Nicht** runtime-verifiziert (Pixi nicht im Build testbar) — nur Build/Lint.

**Offen (nächster Unterschritt):** Sicht-Gating — der Spieler soll nur sehen,
was in Sicht UND beleuchtet ist. Dafür die aktuelle Vision-Maske
(`currentMaskGfx`) mit der Vereinigung der Licht-Polygone schneiden (z.B. Licht
in eine RenderTexture rendern und als zusätzliche Maske multiplizieren). Plus
Darkvision-Radius pro Token als „eigenes Licht". Braucht Laufzeit-Tuning.

### F) Audio (ganz am Ende)
- DM streamt Mic/Tab-Audio an alle via **WebRTC**; Supabase Realtime nur als
  Signaling. Eigener `AudioChannel` neben dem `SyncAdapter`.

---

## 10. Bekannte Punkte / Gotchas
- **`window.__vtt` / `window.__vttRenderer` / `window.__vttMove`** sind Debug-/
  Test-Hooks. `__vttRenderer`/`__vttMove` sind DEV-gated; `window.__vtt` (in
  `store.js`) ist ungated — vor Prod ggf. hinter `import.meta.env.DEV` legen.
- **Overlay-Layout:** Map-Bereiche **unter** den Panels sind nicht klickbar
  (gewollt; DM pannt/klappt ein, wie in Foundry).
- **`src-tauri` war versehentlich gelöscht** und wurde per `git restore`
  wiederhergestellt — falls es nochmal passiert: `git restore src-tauri`.
- `sync/SyncAdapter.js` (LocalAdapter) ist in NerdShelf ungenutzt (nur Standalone).
- Branch `vtt-integration`, **nicht committet**. Diff: `git status` (ignoriere
  `src-tauri`-Einträge — die sind wiederhergestellt/unverändert).

---

## 11. Quellen
- Standalone-Prototyp: `c:\Coding\VTT` — `README.md`, `docs/INTEGRATION.md`
  (ausführliches Datenmodell, Budget-Strategie, Roadmap mit SQL-Skizzen).
- Diese Datei: der NerdShelf-spezifische Integrations-Stand.
