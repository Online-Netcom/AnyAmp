// Kontextmenüs für Songs und Sammlungen – gleich in Playlist und Media Library.
import { layout, SCALES } from './layout.svelte';
import { player, type VisMode } from './player.svelte';
import { ui, type MenuEntry } from './ui.svelte';
import { isTrack, ytm, type Collection, type Item, type Track } from './ytm';

/** Alle Titel der Einträge – Alben/Playlists werden dafür geladen. */
export async function tracksOf(list: Item[]) {
  const out: Track[] = [];
  for (const it of list) {
    if (isTrack(it)) out.push(it);
    else if (it.kind === 'album' || it.kind === 'playlist') out.push(...(await ytm.open(it)).filter(isTrack));
    else if (it.kind === 'shelf') out.push(...(it.items ?? []).filter(isTrack));
  }
  return out;
}

function report(p: Promise<unknown>, what: string) {
  p.catch((e) => (player.error = `${what}: ${(e as Error).message}`));
}

/** „Zu YT-Playlist hinzufügen ▸“ mit den eigenen Playlists */
function addToYt(tracks: () => Promise<Track[]>): MenuEntry {
  const own = player.ownPlaylists;
  return {
    label: 'Zu YT-Playlist hinzufügen',
    disabled: !own.length,
    submenu: own.map((p) => ({
      label: p.title,
      action: () =>
        report(
          tracks().then(async (t) => {
            const n = await ytm.addToPlaylist(p.playlistId!, t.map((x) => x.videoId));
            player.error = `${n} TITEL ZU „${p.title.toUpperCase()}“ HINZUGEFÜGT`;
          }),
          'PLAYLIST',
        ),
    })),
  };
}

const page = (kind: 'artist' | 'album', browseId: string, title: string, artists: string[] = []): Collection => ({
  kind, browseId, playlistId: null, title, artists, subtitle: '', type: '', year: '', thumbnail: null,
});

/** Ältere Playlist-Einträge kennen Album/Künstler nur dem Namen nach → über die Suche auflösen */
async function findPage(kind: 'artist' | 'album', query: string, name: string) {
  const norm = (x: string) => x.toLowerCase().normalize('NFD').replace(/[\u0300-\u036f]/g, '');
  const hits = (await ytm.search(query, kind === 'artist' ? 'artists' : 'albums')).filter((i) => !isTrack(i)) as Collection[];
  const hit = hits.find((h) => norm(h.title) === norm(name)) ?? hits[0];
  if (!hit) throw new Error(`${name} nicht gefunden`);
  ui.goTo(hit);
}

function goTo(t: Track): MenuEntry[] {
  const artist = t.artists[0] ?? '';
  // Untertitel „Interpret • Album • Jahr“ → Albumname
  const album = t.subtitle.split(' • ').find((p, i) => i > 0 && !/^\d{4}$/.test(p) && !t.artists.includes(p)) ?? '';
  return [
    {
      label: 'Gehe zu Künstler',
      disabled: !t.artistId && !artist,
      action: () =>
        t.artistId ? ui.goTo(page('artist', t.artistId, artist)) : report(findPage('artist', artist, artist), 'KÜNSTLER'),
    },
    {
      label: 'Gehe zu Album',
      disabled: !t.albumId && !album,
      action: () =>
        t.albumId
          ? ui.goTo(page('album', t.albumId, album || 'Album', t.artists))
          : report(findPage('album', `${artist} ${album}`, album), 'ALBUM'),
    },
  ];
}

/** Menü für Songs in der AnyAmp-Playlist (`indices` = Auswahl, `at` = angeklickte Zeile) */
export function playlistMenu(e: MouseEvent, at: number, indices: Set<number>, onRemove: () => void) {
  const t = player.playlist[at];
  if (!t) return;
  const sel = [...indices].sort((a, b) => a - b).map((i) => player.playlist[i]);
  const build = (liked: boolean | null): MenuEntry[] => [
    { label: 'Abspielen', action: () => player.playIndex(at) },
    { label: 'Radio ab diesem Titel', action: () => player.startRadio(at) },
    'sep',
    likeItem(t, liked),
    addToYt(async () => sel),
    'sep',
    ...goTo(t),
    'sep',
    { label: sel.length > 1 ? `${sel.length} Titel entfernen` : 'Aus Playlist entfernen', action: onRemove },
  ];
  show(e, t, build);
}

/** Menü für Einträge der Media Library */
export function libraryMenu(e: MouseEvent, item: Item, selection: Item[], open: (c: Collection) => void) {
  const all = selection.includes(item) ? selection : [item];
  const tracks = () => tracksOf(all);
  const add = (play: boolean) =>
    report(
      tracks().then(async (t) => {
        if (play) await player.addAndPlay(t);
        else player.add(t);
      }),
      'HINZUFÜGEN',
    );
  if (!isTrack(item)) {
    const playable = item.kind === 'album' || item.kind === 'playlist' || item.kind === 'shelf';
    ui.openMenu(e, [
      { label: 'Öffnen', action: () => open(item) },
      'sep',
      { label: 'Abspielen', disabled: !playable, action: () => add(true) },
      { label: 'Zur Playlist hinzufügen', disabled: !playable, action: () => add(false) },
      ...(playable ? ['sep' as const, addToYt(tracks)] : []),
    ]);
    return;
  }
  const build = (liked: boolean | null): MenuEntry[] => [
    { label: 'Abspielen', action: () => add(true) },
    { label: all.length > 1 ? `${all.length} Einträge hinzufügen` : 'Zur Playlist hinzufügen', action: () => add(false) },
    { label: 'Radio starten', action: async () => {
      await player.addAndPlay([item]);
      await player.startRadio(player.current);
    } },
    'sep',
    likeItem(item, liked),
    addToYt(tracks),
    'sep',
    ...goTo(item),
  ];
  show(e, item, build);
}

function likeItem(t: Track, liked: boolean | null): MenuEntry {
  if (liked === null) return { label: 'Mag ich …', disabled: true };
  return {
    label: liked ? 'Mag ich nicht mehr' : 'Mag ich',
    checked: liked,
    action: () => {
      if (t.videoId === player.status?.videoId) return player.toggleLike(t.videoId);
      report(ytm.like(t.videoId, !liked), 'LIKE');
    },
  };
}

/** Menü öffnen, Like-Status nachladen und Menü dann aktualisieren */
function show(e: MouseEvent, t: Track, build: (liked: boolean | null) => MenuEntry[]) {
  ui.openMenu(e, build(null));
  const menu = ui.menu;
  const known = t.videoId === player.status?.videoId ? Promise.resolve(player.liked) : ytm.likeStatus(t.videoId);
  known
    .then((l) => ui.menu === menu && ui.updateMenu(build(l === 'LIKE')))
    .catch(() => ui.menu === menu && ui.updateMenu(build(false)));
}


/** Optionsmenü (Clutterbar „O“ oder Rechtsklick ins Hauptfenster) */
export function optionsMenu(e: MouseEvent, extra: { version: string; quit: () => void; checkUpdate?: () => void }) {
  const vis = (mode: VisMode, label: string): MenuEntry => ({
    label,
    checked: player.visMode === mode,
    action: () => player.setVis(mode),
  });
  const fps = (n: number): MenuEntry => ({
    label: `${n} FPS`,
    checked: player.visFps === n,
    action: () => player.setVis(player.visMode === 'off' ? 'spectrum' : player.visMode, n),
  });
  ui.openMenu(e, [
    { label: 'Playlist-Editor', checked: layout.playlist, action: () => (layout.playlist = !layout.playlist) },
    { label: 'Media Library', checked: layout.library, action: () => (layout.library ? (layout.library = false) : layout.openLibrary()) },
    { label: 'Liedtext', checked: layout.lyrics, action: () => (layout.lyrics = !layout.lyrics) },
    'sep',
    { label: 'Immer im Vordergrund', checked: layout.onTop, action: () => (layout.onTop = !layout.onTop) },
    { label: 'Windowshade-Modus', checked: layout.shade, action: () => (layout.shade = !layout.shade) },
    {
      label: 'Größe',
      submenu: SCALES.map((s) => ({ label: `${s}×`.replace('.', ','), checked: layout.scale === s, action: () => (layout.scale = s) })),
    },
    {
      label: 'Visualizer',
      submenu: [vis('spectrum', 'Spektrum'), vis('scope', 'Oszilloskop'), vis('off', 'Aus'), 'sep', fps(60), fps(30)],
    },
    'sep',
    { label: 'Zufallswiedergabe', checked: player.shuffle, action: () => player.toggleShuffle() },
    { label: 'Wiederholen', checked: player.repeat, action: () => player.toggleRepeat() },
    { label: 'Autoplay', checked: player.autoplay, action: () => player.toggleAutoplay() },
    'sep',
    { label: 'Nach Updates suchen …', disabled: !extra.checkUpdate, action: extra.checkUpdate },
    { label: `AnyAmp! ${extra.version}`, disabled: true },
    { label: 'Beenden', action: extra.quit },
  ]);
}
