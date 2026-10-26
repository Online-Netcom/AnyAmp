<p align="center"><img src="design/logo.png" width="160" alt="AnyAmp! Logo"></p>

# AnyAmp!

Ein schlanker Winamp-Klon für **YouTube Music** – mit deinem eigenen, aktiven **YouTube-(Music-)Premium-Abo**.
Wiedergabe ausschließlich über den offiziellen YT-Music-Player in deiner angemeldeten Sitzung; ohne Premium spielt AnyAmp nichts ab.

## Funktionen

- Winamp-2-Oberfläche (Hauptfenster, Playlist-Editor, Media Library), skalierbar 1,5×–3×
- Suche nach Songs, Alben, Playlists und Künstlern; Alben/Playlists komplett hinzufügen
- Alben-Suche mit kompletter Diskografie, wenn der Begriff ein Künstler ist
- Kuratierte YouTube-Music-Playlists in der Suche und unter „Genres“ (Stimmungen & Genres)
- Eigene YT-Music-Playlists und „Musik, die ich mag“
- Playlist mit Shuffle, Repeat und Autoplay (hängt am Ende passende Titel an)
- Like-Knopf, HOME (Mixe, Empfehlungen, Verlauf), Kontextmenüs, Drag & Drop, Suchvorschläge
- Live-Liedtext mit hervorgehobener Zeile (LRCLIB), sonst Liedtext von YT Music
- Media-Tasten, Windowshade, Immer im Vordergrund, Auto-Update
- Echter Spektrum-Visualizer (oder Oszilloskop) mit 60 FPS und Winamp-Falloff, unabhängig von der Lautstärke (macOS: Core Audio Process Tap, nativ gezeichnet)

## Entwicklung

Voraussetzungen: Node.js, Rust (rustup), Xcode Command Line Tools.

```bash
npm install
npm run tauri dev
```

Den Visualizer bitte mit dem gebündelten App-Paket testen (im Dev-Modus ordnet macOS den Ton der startenden App zu):

```bash
npm run tauri build -- --debug --bundles app
```

## Veröffentlichen

```bash
./scripts/release.sh 0.0.4 notes.md
```

Setzt die Version, baut signiert, lädt Zip, Update-Paket und `latest.json` als GitHub-Release hoch.
Installierte Versionen prüfen beim Start auf Updates (Optionsmenü → „Update installieren“).
Der Signaturschlüssel liegt außerhalb des Repos unter `~/.tauri/anyamp-updater.key` – ohne ihn
lassen sich keine Updates mehr ausliefern, also sicher aufbewahren.
Lokale Release-Builds brauchen ihn ebenfalls (`TAURI_SIGNING_PRIVATE_KEY=$(cat ~/.tauri/anyamp-updater.key)`).

## Aufbau

- `src-tauri/src/lib.rs` – verstecktes YT-Music-Fenster, Befehle zwischen Oberfläche und Bridge
- `src-tauri/src/bridge.js` – läuft in music.youtube.com: Status, Steuerung, Suche (InnerTube der Sitzung)
- `src-tauri/src/spectrum.rs`, `src-tauri/native/macos_tap.m` – Audio-Abgriff und FFT für den Visualizer
- `src/lib/player.svelte.ts` – Player-Kern (Playlist, Transport, Autoplay)
- `src/lib/skin/` – Winamp-Skin (Svelte)
