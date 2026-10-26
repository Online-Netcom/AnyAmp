// Fensteraufbau wie bei Winamp: Hauptfenster, darunter angedockt Playlist, Media Library, Liedtext.
// Wird gespeichert und von Hauptfenster, Menüs und Tastenkürzeln gemeinsam geschaltet.

const KEY = 'anyamp.layout.v1';
/** Größenstufen (Winamp-Original = 1× ist auf heutigen Displays zu klein) */
export const SCALES = [1.5, 2, 2.5, 3];

class Layout {
  scale = $state(2);
  playlist = $state(true);
  library = $state(false);
  lyrics = $state(false);
  /** Windowshade: Hauptfenster als schmale Leiste */
  shade = $state(false);
  /** immer im Vordergrund */
  onTop = $state(false);

  /** öffnet die Media Library (die Seite hängt Fokus/Suche an) */
  openLibrary = () => {
    this.library = true;
  };

  constructor() {
    try {
      const saved = JSON.parse(localStorage.getItem(KEY) ?? '{}');
      for (const k of ['scale', 'playlist', 'library', 'lyrics', 'shade', 'onTop'] as const) {
        if (typeof saved[k] === typeof this[k]) (this as Record<string, unknown>)[k] = saved[k];
      }
    } catch {}
    if (!SCALES.includes(this.scale)) this.scale = 2;
  }

  /** Höhe in Skin-Pixeln */
  get height() {
    return (this.shade ? 14 : 116) + (this.playlist ? 232 : 0) + (this.library ? 232 : 0) + (this.lyrics ? 232 : 0);
  }

  save() {
    const { scale, playlist, library, lyrics, shade, onTop } = this;
    try {
      localStorage.setItem(KEY, JSON.stringify({ scale, playlist, library, lyrics, shade, onTop }));
    } catch {}
  }

  /** Nächste/vorige Größenstufe; ohne Richtung reihum. */
  resize(dir?: 1 | -1) {
    const i = SCALES.indexOf(this.scale);
    this.scale = dir ? SCALES[Math.min(SCALES.length - 1, Math.max(0, i + dir))] : SCALES[(i + 1) % SCALES.length];
  }
}

export const layout = new Layout();
