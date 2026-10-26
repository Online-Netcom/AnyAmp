// Client für das YouTube-Music-Fenster (Bridge in src-tauri/src/bridge.js).
import { invoke } from '@tauri-apps/api/core';
import { listen } from '@tauri-apps/api/event';

export interface Account {
  loggedIn: boolean;
  premium: boolean | null; // null = unbekannt
  name: string | null;
  error?: string;
}

export interface Track {
  videoId: string;
  title: string;
  artists: string[];
  subtitle: string;
  duration: string;
  thumbnail: string | null;
  /** vom Autoplay angehängt */
  auto?: boolean;
  /** für „Gehe zu Album/Künstler“ */
  albumId?: string | null;
  artistId?: string | null;
}

/** Album, Playlist oder Künstler – lässt sich öffnen bzw. komplett hinzufügen. */
export interface Collection {
  kind: 'album' | 'playlist' | 'artist' | 'genre' | 'shelf';
  browseId: string;
  playlistId: string | null;
  /** Zusatzparameter der Seite (Genres) */
  params?: string;
  /** Abschnitt der Startseite: Inhalt liegt schon vor */
  items?: Item[];
  title: string;
  artists: string[];
  subtitle: string;
  type: string; // „Album“, „Single“, „EP“ …
  year: string;
  thumbnail: string | null;
}

export type Item = Track | Collection;
export type SearchKind = 'songs' | 'albums' | 'playlists' | 'artists';

export const isTrack = (i: Item): i is Track => 'videoId' in i;
export type LikeStatus = 'LIKE' | 'INDIFFERENT' | 'DISLIKE';

export interface PlayerState {
  videoId: string | null;
  title: string;
  author: string;
  state: number; // -1 unstarted, 0 ended, 1 playing, 2 paused, 3 buffering
  time: number;
  /** genaue Position (s) zum Zeitpunkt `at` (ms seit Epoche) */
  exact?: number;
  at?: number;
  duration: number;
  volume: number;
  adShowing: boolean;
  kbps: number | null;
  khz: number | null;
}

type BridgeEvent =
  | { type: 'ready'; account: Account }
  | ({ type: 'state' } & PlayerState)
  | { type: 'ended'; videoId: string }
  | { type: 'media'; cmd: 'next' | 'prev' }
  | { type: 'result'; id: number; ok: boolean; data?: unknown; error?: string };

const pending = new Map<number, { resolve: (v: any) => void; reject: (e: Error) => void }>();
let nextId = 1;

export function onBridge(handlers: {
  ready?: (account: Account) => void;
  state?: (state: PlayerState) => void;
  ended?: (videoId: string) => void;
  media?: (cmd: 'next' | 'prev') => void;
}) {
  return listen<BridgeEvent>('ytm', ({ payload }) => {
    if (payload.type === 'result') {
      const p = pending.get(payload.id);
      pending.delete(payload.id);
      if (payload.ok) p?.resolve(payload.data);
      else p?.reject(new Error(payload.error));
    } else if (payload.type === 'ready') handlers.ready?.(payload.account);
    else if (payload.type === 'state') handlers.state?.(payload);
    else if (payload.type === 'ended') handlers.ended?.(payload.videoId);
    else if (payload.type === 'media') handlers.media?.(payload.cmd);
  });
}

function call<T>(cmd: string, args?: Record<string, unknown>, timeoutMs = 15000): Promise<T> {
  const id = nextId++;
  return new Promise<T>((resolve, reject) => {
    pending.set(id, { resolve, reject });
    setTimeout(() => {
      if (pending.delete(id)) reject(new Error(`Zeitüberschreitung: ${cmd}`));
    }, timeoutMs);
    invoke('ytm_call', { request: { id, cmd, args } }).catch((e) => {
      pending.delete(id);
      reject(new Error(String(e)));
    });
  });
}

export const ytm = {
  account: (timeoutMs?: number) => call<Account>('account', undefined, timeoutMs),
  search: (query: string, kind: SearchKind) => call<Item[]>('search', { query, kind }),
  /** Inhalt eines Albums / einer Playlist (Tracks) bzw. eines Künstlers (Top-Songs + Alben) */
  open: (c: Collection) =>
    call<{ items: Item[] }>('open', { browseId: c.browseId, playlistId: c.playlistId, params: c.params }, 90000).then(
      (r) => r.items,
    ),
  /** Genres und Stimmungen von YT Music; öffnen liefert deren kuratierte Playlists */
  genres: () => call<Collection[]>('genres'),
  /** Startseite: Abschnitte samt Inhalt (Mixe, Empfehlungen, Neuerscheinungen …) und Verlauf */
  home: () => call<{ title: string; items: Item[] }[]>('home', undefined, 45000),
  suggest: (input: string) => call<string[]>('suggest', { input }),
  likeStatus: (videoId: string) => call<LikeStatus>('likeStatus', { videoId }),
  like: (videoId: string, on: boolean) => call<LikeStatus>('like', { videoId, on }),
  lyrics: (videoId: string) => call<{ text: string; source: string } | null>('lyrics', { videoId }),
  addToPlaylist: (playlistId: string, videoIds: string[]) => call<number>('addToPlaylist', { playlistId, videoIds }),
  /** Eigene Playlists aus der YT-Music-Bibliothek (inkl. „Musik, die ich mag“) */
  library: () => call<Collection[]>('library'),
  /** Passende Titel zum Weiterhören (YT-Music-Radio) */
  radio: (videoId: string) => call<Track[]>('radio', { videoId }),
  play: (videoId: string) => call<void>('play', { videoId }),
  pause: () => call<void>('pause'),
  resume: () => call<void>('resume'),
  stop: () => call<void>('stop'),
  seek: (seconds: number) => call<void>('seek', { seconds }),
  volume: (percent: number) => call<void>('volume', { percent }),
  login: () => invoke<void>('ytm_login'),
  setVisible: (visible: boolean) => invoke<void>('ytm_set_visible', { visible }),
  reload: () => invoke<void>('ytm_reload'),
  /** Nativer Visualizer: Bildrate (0 = aus), Lage im Fenster in Punkten, Player-Lautstärke (Ausgleich) */
  visConfig: (fps: number, mode: string, x: number, y: number, px: number, volume: number) =>
    invoke<void>('vis_config', { fps, mode, x, y, px, volume }),
};
