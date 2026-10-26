<script lang="ts">
  // „Media Library“: Startseite von YT Music, Genres und Suche nach Songs, Alben, Playlists, Künstlern.
  // Alben/Playlists/Künstler lassen sich öffnen (Doppelklick) oder komplett hinzufügen;
  // Rechtsklick öffnet das Kontextmenü, Einträge lassen sich in die Playlist ziehen.
  import { player, formatTime, parseDuration } from '$lib/player.svelte';
  import { libraryMenu, tracksOf } from '$lib/menus';
  import { ui } from '$lib/ui.svelte';
  import { ytm, isTrack, type Collection, type Item, type SearchKind } from '$lib/ytm';
  import Icon from './Icon.svelte';
  import { skin } from './skin.svelte';
  import SkinFrame from './SkinFrame.svelte';
  import TrackList from './TrackList.svelte';

  let { onClose }: { onClose: () => void } = $props();

  type Tab = SearchKind | 'home' | 'genres';
  const TABS: [Tab, string][] = [
    ['home', 'HOME'],
    ['genres', 'GENRES'],
    ['songs', 'SONGS'],
    ['albums', 'ALBEN'],
    ['playlists', 'PLAYLISTS'],
    ['artists', 'KÜNSTLER'],
  ];
  const BROWSE: Tab[] = ['home', 'genres'];

  let query = $state('');
  let kind = $state<Tab>('home');
  let results = $state<Item[]>([]);
  /** Geöffnete Seiten (Zurück = eine Ebene hoch) */
  let stack = $state<{ source: Collection; items: Item[] }[]>([]);
  let selected = $state(new Set<number>());
  let busy = $state(false);
  let message = $state('');
  let input = $state<HTMLInputElement>();
  let suggestions = $state<string[]>([]);
  let searched = '';
  const cache = new Map<string, Item[]>();

  const view = $derived(stack.at(-1));
  const items = $derived(view?.items ?? results);
  const chosen = $derived(selected.size ? [...selected].sort((a, b) => a - b).map((i) => items[i]) : []);
  // Ohne Auswahl „alles“ nur in Titellisten – nicht versehentlich 20 Alben auf einmal
  const targets = $derived(chosen.length ? chosen : items.every(isTrack) ? items : []);

  export function focus() {
    input?.focus();
    input?.select();
  }

  async function busyWith<T>(fn: () => Promise<T>) {
    busy = true;
    message = '';
    try {
      return await fn();
    } catch (err) {
      message = (err as Error).message;
    } finally {
      busy = false;
    }
  }

  /** Liste laden (zwischengespeichert), verworfen wenn inzwischen ein anderer Tab/Begriff gilt */
  async function load(key: string, still: () => boolean, fetch: () => Promise<Item[]>, empty: string) {
    stack = [];
    selected = new Set();
    if (cache.has(key)) {
      results = cache.get(key)!;
      return;
    }
    results = [];
    await busyWith(async () => {
      const found = await fetch();
      cache.set(key, found);
      if (still()) results = found;
      if (!found.length) message = empty;
    });
  }

  async function search(e?: Event) {
    e?.preventDefault();
    suggestions = [];
    const q = query.trim();
    if (BROWSE.includes(kind) && e) kind = 'songs'; // Suchen aus Home/Genres heraus → Songs
    if (!player.live) return;
    if (kind === 'home') return loadHome();
    if (kind === 'genres') return load('genres', () => kind === 'genres', ytm.genres, 'Keine Genres');
    if (!q) return;
    const k = kind;
    searched = q;
    await load(`${k}:${q}`, () => kind === k && q === searched, () => ytm.search(q, k), 'Keine Treffer');
  }

  /** Startseite: „Meine Playlists“, dann die Abschnitte von YT Music und der Verlauf */
  function loadHome() {
    return load('home', () => kind === 'home', async () => {
      const shelves = await ytm.home();
      const mine: Collection = {
        kind: 'shelf', browseId: 'library', playlistId: null, title: 'Meine Playlists',
        artists: [], subtitle: 'Deine Playlists und „Musik, die ich mag“', type: '', year: '', thumbnail: null,
      };
      return [
        mine,
        ...shelves.map((s, i): Collection => ({
          kind: 'shelf', browseId: `home:${i}`, playlistId: null, title: s.title, items: s.items,
          artists: [], subtitle: `${s.items.length} Einträge`, type: '', year: '', thumbnail: null,
        })),
      ];
    }, 'Startseite leer');
  }

  function setKind(k: Tab) {
    if (k === kind && !stack.length) return;
    kind = k;
    if (BROWSE.includes(k) || query.trim()) search();
    else {
      stack = [];
      results = [];
    }
  }

  // Vorschläge beim Tippen (verzögert, nur der jeweils letzte zählt)
  let suggestTimer = 0;
  function typed() {
    clearTimeout(suggestTimer);
    const q = query.trim();
    if (q.length < 2 || !player.live) return (suggestions = []);
    suggestTimer = window.setTimeout(async () => {
      const list = await ytm.suggest(q).catch(() => []);
      if (query.trim() === q) suggestions = list.filter((s) => s.toLowerCase() !== q.toLowerCase());
    }, 200);
  }

  async function open(c: Collection) {
    await busyWith(async () => {
      const found =
        c.kind === 'shelf' ? (c.browseId === 'library' ? await ytm.library() : (c.items ?? [])) : await ytm.open(c);
      stack = [...stack, { source: c, items: found }];
      selected = new Set();
      if (!found.length) message = 'Leer';
    });
  }

  // Beim Öffnen gleich die Startseite zeigen, sobald das Konto bereit ist
  let homeShown = false;
  $effect(() => {
    if (homeShown || !player.account?.loggedIn || player.account.premium === false) return;
    homeShown = true;
    if (kind === 'home' && !stack.length) loadHome();
  });

  // „Gehe zu Album/Künstler“ aus einem Kontextmenü
  $effect(() => {
    const c = ui.navigate;
    if (!c) return;
    ui.navigate = null;
    open(c);
  });

  function back() {
    stack = stack.slice(0, -1);
    selected = new Set();
  }

  async function add(play: boolean) {
    await busyWith(async () => {
      const tracks = await tracksOf(targets);
      if (play) await player.addAndPlay(tracks);
      else player.add(tracks);
      message = `${tracks.length} Titel hinzugefügt`;
    });
  }

  function activate(i: number) {
    const it = items[i];
    if (isTrack(it)) player.addAndPlay([it]);
    else open(it);
  }

  function keydown(e: KeyboardEvent) {
    if (e.target === input) return;
    if (e.key === 'Enter' && selected.size) {
      e.preventDefault();
      activate(Math.min(...selected));
    } else if ((e.key === 'Backspace' || e.key === 'Escape') && stack.length) {
      e.preventDefault();
      back();
    } else if ((e.metaKey || e.ctrlKey) && e.key === 'a') {
      e.preventDefault();
      selected = new Set(items.map((_, i) => i));
    }
  }

  const status = $derived.by(() => {
    if (busy) return 'Lade …';
    if (message) return message;
    if (view) {
      const tracks = view.items.filter(isTrack);
      const total = tracks.reduce((s, t) => s + parseDuration(t.duration), 0);
      const folders = view.items.length - tracks.length;
      const parts = [];
      if (tracks.length) parts.push(`${tracks.length} Titel${total ? ` · ${formatTime(total)}` : ''}`);
      if (folders) parts.push(`${folders} ${view.source.kind === 'genre' ? 'Playlists' : 'Alben/Playlists'}`);
      return parts.join(' · ') || 'Leer';
    }
    return `${player.account?.name ?? ''} · Premium`;
  });

  const heading = $derived.by(() => {
    if (!view) return '';
    const c = view.source;
    const by = c.artists.join(', ');
    return c.kind === 'album' || c.kind === 'playlist'
      ? `${c.title}${by ? ` – ${by}` : ''}${c.year ? ` (${c.year})` : ''}`
      : c.title;
  });

  const account = $derived(player.account);
  const skinned = $derived(skin.has('pledit'));
</script>

<!-- svelte-ignore a11y_no_noninteractive_tabindex, a11y_no_noninteractive_element_interactions -->
<section class="ml panel" class:skinned aria-label="Media Library" tabindex="0" onkeydown={keydown}>
  {#if skinned}
    <SkinFrame title="AnyAmp! Media Library" />
    <div class="skin-drag" data-tauri-drag-region></div>
    <button class="hot" style="left:264px;top:3px;width:9px;height:9px" title="Schließen" onclick={onClose}></button>
  {:else}
  <div class="titlebar" data-tauri-drag-region>
    <span class="label skin-text">AnyAmp! Media Library</span>
    <button class="btn wbtn" style="left:264px" title="Schließen" onclick={onClose}>
      <Icon name="close" size={7} />
    </button>
  </div>
  {/if}

  {#if !account || account.error}
    <p class="note">{account?.error ?? 'Verbinde mit YouTube Music …'}</p>
  {:else if !account.loggedIn}
    <div class="note">
      <p>Melde dich mit deinem YouTube-Music-Premium-Konto an.</p>
      <button class="btn cta skin-text" onclick={() => ytm.login()}>Anmelden</button>
    </div>
  {:else if account.premium === false}
    <p class="note warn">AnyAmp! benötigt ein aktives YouTube-Premium- bzw. Music-Premium-Abo.</p>
  {:else}
    <form onsubmit={search}>
      <input
        bind:this={input}
        bind:value={query}
        oninput={typed}
        list="ml-suggest"
        placeholder="YouTube Music durchsuchen …"
        spellcheck="false"
        autocomplete="off"
      />
      <datalist id="ml-suggest">
        {#each suggestions as s (s)}<option value={s}></option>{/each}
      </datalist>
      <button class="btn go skin-text" disabled={busy}>SUCHE</button>
    </form>

    <div class="tabs">
      {#if view}
        <button class="btn tab skin-text back" title="Zurück (Esc)" onclick={back}>◂ ZURÜCK</button>
        <span class="heading" title={heading}>{heading}</span>
      {:else}
        {#each TABS as [k, label] (k)}
          <button class="btn tab skin-text" class:down={k === kind} onclick={() => setKind(k)}>{label}</button>
        {/each}
      {/if}
    </div>

    <div class="body inset">
      <TrackList
        tracks={items}
        bind:selected
        numbered={!!view && (view.source.kind === 'album' || view.source.kind === 'playlist')}
        dragOut
        onContext={(e, i) => libraryMenu(e, items[i], chosen, open)}
        onActivate={activate}
      />
    </div>

    <div class="bottom">
      <button
        class="btn pbtn skin-text"
        style="left:11px;width:44px"
        title="Zur Playlist hinzufügen (Alben/Playlists komplett)"
        disabled={busy || !targets.length}
        onclick={() => add(false)}
      >{chosen.length ? '+AUSWAHL' : '+ALLE'}</button>
      <button
        class="btn pbtn skin-text"
        style="left:57px;width:26px"
        title="Hinzufügen und abspielen"
        disabled={busy || !targets.length}
        onclick={() => add(true)}
      ><Icon name="play" size={6} /></button>
      <span class="status skin-text" title={status}>{status}</span>
    </div>
  {/if}
</section>

<style>
  /* Mit Skin: Winamp-Rahmen (oben 20, unten 38, Seiten 12/20) */
  .skinned form {
    left: 12px;
    right: 20px;
    top: 22px;
  }
  .skinned .tabs {
    left: 12px;
    right: 20px;
    top: 38px;
  }
  .skinned .body {
    left: 12px;
    right: 20px;
    top: 51px;
    bottom: 38px;
  }
  .skinned .bottom .pbtn {
    top: 205px;
  }
  .skinned .status {
    top: 209px;
    right: 20px;
  }
  .skin-drag {
    position: absolute;
    left: 0;
    top: 0;
    right: 12px;
    height: 14px;
  }
  .hot {
    all: unset;
    position: absolute;
    z-index: 1;
  }
  .ml {
    position: relative;
    width: 275px;
    height: 232px;
    outline: none;
  }
  form {
    position: absolute;
    left: 11px;
    right: 11px;
    top: 18px;
    display: flex;
    gap: 3px;
  }
  input {
    flex: 1;
    min-width: 0;
    height: 13px;
    box-sizing: border-box;
    border: 0;
    padding: 0 3px;
    background: var(--pl-bg);
    color: var(--pl-normal);
    font: 9px var(--pl-font);
    box-shadow: inset 1px 1px 0 var(--frame-lo), inset -1px -1px 0 var(--frame-hi);
    outline: none;
  }
  input::placeholder {
    color: #0a7a0a;
  }
  .go {
    position: static;
    width: 30px;
    height: 13px;
    font-size: 5px;
  }
  .tabs {
    position: absolute;
    left: 11px;
    right: 11px;
    top: 34px;
    height: 10px;
    display: flex;
    gap: 2px;
    align-items: center;
  }
  .tab {
    position: static;
    flex: 1;
    height: 10px;
    font-size: 5px;
  }
  .tab.back {
    flex: 0 0 40px;
  }
  .heading {
    flex: 1;
    min-width: 0;
    padding-left: 3px;
    font: 8px var(--pl-font);
    color: var(--pl-current);
    white-space: nowrap;
    overflow: hidden;
    text-overflow: ellipsis;
  }
  .body {
    position: absolute;
    left: 11px;
    right: 11px;
    top: 47px;
    bottom: 24px;
    overflow-y: auto;
  }
  .body::-webkit-scrollbar {
    width: 8px;
  }
  .body::-webkit-scrollbar-thumb {
    background: linear-gradient(90deg, var(--btn-hi), var(--btn-lo));
  }
  .bottom .pbtn {
    top: 213px;
    height: 13px;
    font-size: 5px;
  }
  .status {
    position: absolute;
    left: 88px;
    right: 11px;
    top: 216px;
    font-size: 5px;
    color: #9a9ab4;
    white-space: nowrap;
    overflow: hidden;
    text-overflow: ellipsis;
  }
  .note {
    margin: 30px 16px;
    font: 10px/1.4 var(--pl-font);
    color: var(--pl-normal);
    text-align: center;
  }
  .warn {
    color: #ffb347;
  }
  .cta {
    position: static;
    margin: 10px auto 0;
    width: 70px;
    height: 16px;
    font-size: 6px;
    background: linear-gradient(#ffd34d, #e0a000);
  }
</style>
