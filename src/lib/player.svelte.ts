// Player-Kern: eigene Playlist + Steuerung des YTM-Players (über die Bridge).
import { isTauri } from '@tauri-apps/api/core';
import { ytm, onBridge, type Account, type Collection, type LikeStatus, type PlayerState, type Track } from './ytm';

const STORE_KEY = 'anyamp.player.v1';

interface Persisted {
  playlist: Track[];
  current: number;
  shuffle: boolean;
  repeat: boolean;
  autoplay: boolean;
  visFps: number;
  visMode: VisMode;
}

/** Winamp: Klick auf den Visualizer wechselt Spektrum → Oszilloskop → aus */
export type VisMode = 'spectrum' | 'scope' | 'off';

function load(): Partial<Persisted> {
  try {
    return JSON.parse(localStorage.getItem(STORE_KEY) ?? '{}');
  } catch {
    return {};
  }
}

class Player {
  readonly live = isTauri();

  account = $state<Account | null>(null);
  status = $state<PlayerState | null>(null);
  error = $state('');

  playlist = $state<Track[]>([]);
  current = $state(-1);
  shuffle = $state(false);
  repeat = $state(false);
  /** Am Playlist-Ende passende Titel anhängen (YT-Music-Radio) */
  autoplay = $state(true);
  /** Visualizer-Bildrate (Winamp „Refresh rate“): 60 oder 30 */
  visFps = $state(60);
  visMode = $state<VisMode>('spectrum');
  stopped = $state(true);
  /** „Mag ich“-Status des laufenden Songs */
  liked = $state<LikeStatus>('INDIFFERENT');
  /** eigene YT-Music-Playlists (Ziel für „Zu YT-Playlist hinzufügen“) */
  ownPlaylists = $state<Collection[]>([]);
  #likeFor: string | null = null;

  #history: number[] = [];
  #filling: Promise<void> | null = null;

  track = $derived(this.playlist[this.current] ?? null);
  canPlay = $derived(this.account?.loggedIn === true && this.account.premium === true);
  /** 1 = spielt, 2 = pausiert, 0 = gestoppt */
  mode = $derived(this.stopped ? 0 : this.status?.state === 2 ? 2 : 1);
  time = $derived(this.stopped ? 0 : (this.status?.time ?? 0));
  duration = $derived(this.status?.duration || parseDuration(this.track?.duration));

  constructor() {
    const saved = load();
    this.playlist = saved.playlist ?? [];
    this.current = saved.current ?? -1;
    this.shuffle = saved.shuffle ?? false;
    this.repeat = saved.repeat ?? false;
    this.autoplay = saved.autoplay ?? true;
    // ältere Einstellung: 0 FPS bedeutete „aus“
    this.visFps = saved.visFps === 30 ? 30 : 60;
    this.visMode = saved.visMode ?? (saved.visFps === 0 ? 'off' : 'spectrum');
  }

  #save() {
    try {
      const data: Persisted = {
        playlist: this.playlist,
        current: this.current,
        shuffle: this.shuffle,
        repeat: this.repeat,
        autoplay: this.autoplay,
        visFps: this.visFps,
        visMode: this.visMode,
      };
      localStorage.setItem(STORE_KEY, JSON.stringify(data));
    } catch {}
  }

  /** Verbindet sich mit der Bridge. Gibt eine Aufräumfunktion zurück. */
  init(): () => void {
    if (!this.live) return this.#demo();
    const unlisten = onBridge({
      ready: (a) => {
        this.account = a;
        if (a.loggedIn) {
          ytm.setVisible(false);
          this.loadOwnPlaylists();
        }
      },
      state: (s) => {
        this.status = s;
        if (s.videoId && s.videoId !== this.#likeFor) {
          this.#likeFor = s.videoId;
          this.liked = 'INDIFFERENT';
          ytm.likeStatus(s.videoId).then((l) => s.videoId === this.#likeFor && (this.liked = l)).catch(() => {});
        }
        if (s.state === 1 && s.videoId === this.track?.videoId) this.stopped = false;
      },
      // Media-Tasten / Kontrollzentrum: Vor/Zurück in AnyAmps Playlist
      media: (cmd) => (cmd === 'next' ? this.next() : this.prev()),
      ended: (videoId) => {
        if (videoId === this.track?.videoId) this.next(true);
      },
    });
    // Das „ready“-Event kann verloren gehen, wenn YTM vor der Oberfläche lädt – nachfragen.
    const poll = setInterval(() => {
      if (this.account) return clearInterval(poll);
      ytm.account(3000).then((a) => (this.account ??= a)).catch(() => {});
    }, 3000);
    return () => {
      clearInterval(poll);
      unlisten.then((f) => f());
    };
  }

  #run<T>(p: Promise<T>) {
    return p.catch((e) => {
      this.error = (e as Error).message;
    });
  }

  // --- Transport ---

  async playIndex(i: number) {
    const t = this.playlist[i];
    if (!t || !this.canPlay) return;
    if (this.current >= 0 && this.current !== i) this.#history.push(this.current);
    this.current = i;
    this.stopped = false;
    this.#save();
    // Letzter Titel läuft: Nachschub schon jetzt anhängen, damit man weiterskippen kann.
    if (i === this.playlist.length - 1) this.#autofill();
    await this.#run(ytm.play(t.videoId));
  }

  /** Hängt Radio-Titel zum letzten Song an (sofern Autoplay greift). */
  #autofill() {
    const seed = this.playlist.at(-1);
    if (!seed || !this.autoplay || this.repeat || this.shuffle || !this.live) return Promise.resolve();
    this.#filling ??= ytm
      .radio(seed.videoId)
      .then((tracks) => {
        const known = new Set(this.playlist.map((t) => t.videoId));
        const fresh = tracks.filter((t) => !known.has(t.videoId)).slice(0, 25);
        if (fresh.length) this.add(fresh.map((t) => ({ ...t, auto: true })));
      })
      .catch((e) => {
        this.error = `AUTOPLAY: ${(e as Error).message}`;
      })
      .finally(() => (this.#filling = null));
    return this.#filling;
  }

  /** Winamp „Play“: fortsetzen, nach Stop von vorn, sonst ersten Titel starten. */
  async play() {
    if (this.mode === 2) return this.#run(ytm.resume());
    if (this.current < 0) return this.playIndex(0);
    if (this.stopped && this.status?.videoId === this.track?.videoId) {
      this.stopped = false;
      return this.#run(ytm.resume());
    }
    return this.playIndex(this.current);
  }

  /** Winamp „Pause“: schaltet zwischen Pause und Wiedergabe um. */
  pause() {
    if (this.mode === 1) return this.#run(ytm.pause());
    if (this.mode === 2) return this.#run(ytm.resume());
  }

  stop() {
    this.stopped = true;
    return this.#run(ytm.stop());
  }

  async next(auto = false) {
    const n = this.playlist.length;
    if (!n) return;
    let i: number;
    if (this.shuffle && n > 1) {
      do i = Math.floor(Math.random() * n);
      while (i === this.current);
    } else {
      i = this.current + 1;
      if (i >= n && !this.repeat) {
        // Nachschub abwarten (falls er noch lädt), sonst wie Winamp: Ende bzw. von vorn
        await this.#autofill();
        if (this.playlist.length <= i) {
          if (auto) return this.stop();
          i = 0;
        }
      } else if (i >= n) i = 0;
    }
    return this.playIndex(i);
  }

  prev() {
    if (this.time > 3) return this.seek(0);
    const last = this.shuffle ? this.#history.pop() : undefined;
    const i = last ?? (this.current > 0 ? this.current - 1 : this.repeat ? this.playlist.length - 1 : 0);
    if (last !== undefined) this.current = -1; // nicht erneut in die Historie schreiben
    return this.playIndex(i);
  }

  seek(seconds: number) {
    if (this.stopped) return;
    return this.#run(ytm.seek(Math.max(0, seconds)));
  }

  volume(percent: number) {
    return this.#run(ytm.volume(Math.round(Math.min(100, Math.max(0, percent)))));
  }

  toggleShuffle() {
    this.shuffle = !this.shuffle;
    this.#save();
  }

  toggleRepeat() {
    this.repeat = !this.repeat;
    this.#save();
  }

  /** Song liken bzw. Like entfernen (Standard: der laufende Song) */
  async toggleLike(videoId = this.status?.videoId ?? this.track?.videoId) {
    if (!videoId || !this.canPlay) return;
    const on = videoId === this.#likeFor ? this.liked !== 'LIKE' : true;
    const before = this.liked;
    if (videoId === this.#likeFor) this.liked = on ? 'LIKE' : 'INDIFFERENT'; // sofort anzeigen
    try {
      const now = await ytm.like(videoId, on);
      if (videoId === this.#likeFor) this.liked = now;
    } catch (e) {
      if (videoId === this.#likeFor) this.liked = before;
      this.error = `LIKE: ${(e as Error).message}`;
    }
  }

  /** Eigene, bearbeitbare Playlists (für das Kontextmenü) */
  async loadOwnPlaylists() {
    const mine = await ytm.library().catch(() => []);
    const me = this.account?.name;
    this.ownPlaylists = mine.filter((p) => p.playlistId?.startsWith('PL') && (!me || p.subtitle.includes(me)));
  }

  /** „Radio starten“: passende Titel direkt nach `index` einreihen */
  async startRadio(index: number) {
    const seed = this.playlist[index];
    if (!seed) return;
    try {
      const tracks = await ytm.radio(seed.videoId);
      const known = new Set(this.playlist.map((t) => t.videoId));
      const fresh = tracks.filter((t) => !known.has(t.videoId)).slice(0, 25);
      this.insert(index + 1, fresh.map((t) => ({ ...t, auto: true })));
    } catch (e) {
      this.error = `RADIO: ${(e as Error).message}`;
    }
  }

  /** Titel an einer Stelle einfügen (Drag & Drop, Radio) */
  insert(at: number, tracks: Track[]) {
    if (!tracks.length) return;
    const cur = this.track;
    const list = [...this.playlist];
    list.splice(at, 0, ...tracks);
    this.playlist = list;
    this.current = cur ? list.indexOf(cur) : -1;
    this.#save();
  }

  /** Klick auf den Visualizer: Spektrum → Oszilloskop → aus */
  cycleVis() {
    this.setVis(this.visMode === 'spectrum' ? 'scope' : this.visMode === 'scope' ? 'off' : 'spectrum');
  }

  setVis(mode: VisMode, fps = this.visFps) {
    this.visMode = mode;
    this.visFps = fps;
    this.#save();
  }

  toggleAutoplay() {
    this.autoplay = !this.autoplay;
    this.#save();
    if (this.autoplay && !this.stopped && this.current === this.playlist.length - 1) this.#autofill();
  }

  // --- Playlist ---

  /** Hängt Titel an; eigene Titel kommen vor noch nicht gespielten Autoplay-Nachschub. Gibt die Position zurück. */
  add(tracks: Track[]) {
    let at = this.playlist.length;
    if (!tracks[0]?.auto) {
      const k = this.playlist.findIndex((t, i) => t.auto && i > this.current);
      if (k >= 0) at = k;
    }
    const list = [...this.playlist];
    list.splice(at, 0, ...tracks);
    this.playlist = list;
    this.#save();
    return at;
  }

  /** Hängt Titel an und spielt den ersten davon (ein bereits letzter Titel wird nicht doppelt angehängt). */
  addAndPlay(tracks: Track[]) {
    if (!tracks.length) return;
    const at = this.add(tracks);
    // Doppelklick auf denselben Titel: nicht mehrfach einreihen
    if (tracks.length === 1 && this.playlist[at - 1]?.videoId === tracks[0].videoId) {
      this.remove(new Set([at]));
      return this.playIndex(at - 1);
    }
    return this.playIndex(at);
  }

  remove(indices: Set<number>) {
    const cur = this.track;
    this.playlist = this.playlist.filter((_, i) => !indices.has(i));
    this.current = cur ? this.playlist.indexOf(cur) : -1;
    this.#history = [];
    this.#save();
  }

  move(from: number, to: number) {
    if (from === to) return;
    const cur = this.track;
    const list = [...this.playlist];
    const [t] = list.splice(from, 1);
    list.splice(to, 0, t);
    this.playlist = list;
    this.current = cur ? list.indexOf(cur) : -1;
    this.#save();
  }

  randomize() {
    const cur = this.track;
    const list = [...this.playlist];
    for (let i = list.length - 1; i > 0; i--) {
      const j = Math.floor(Math.random() * (i + 1));
      [list[i], list[j]] = [list[j], list[i]];
    }
    this.playlist = list;
    this.current = cur ? list.indexOf(cur) : -1;
    this.#save();
  }

  clear() {
    this.stop();
    this.playlist = [];
    this.current = -1;
    this.#history = [];
    this.#save();
  }

  /** Vorschau im normalen Browser (ohne Tauri): Beispieldaten für die Gestaltung. */
  #demo() {
    this.account = { loggedIn: true, premium: true, name: 'Demo' };
    if (!this.playlist.length)
      this.playlist = [
        ['Mon Amour (Original von Hecht)', 'Marc Eggers, Aditotoro und Paul Frege', '3:03'],
        ['Around the World', 'Daft Punk', '7:10'],
        ['Mon Amour', 'Mosimann und MARUV', '3:06'],
        ['One More Time (Radio Edit)', 'Daft Punk', '5:21'],
      ].map(([title, artist, duration], i) => ({
        videoId: `demo${i}`,
        title,
        artists: [artist],
        subtitle: artist,
        duration,
        thumbnail: null,
      }));
    this.current = 0;
    this.stopped = false;
    this.status = {
      videoId: 'demo0', title: '', author: '', state: 1, time: 83, duration: 183,
      volume: 70, adShowing: false, kbps: 256, khz: 44,
    };
    return () => {};
  }
}

export function parseDuration(s?: string) {
  if (!s) return 0;
  return s.split(':').reduce((acc, p) => acc * 60 + Number(p), 0);
}

export function formatTime(s: number) {
  const m = Math.floor(s / 60);
  return `${m}:${String(Math.floor(s % 60)).padStart(2, '0')}`;
}

export const player = new Player();
