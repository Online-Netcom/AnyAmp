<script lang="ts">
  // „Media Library“: Suche in YouTube Music nach Songs, Alben, Playlists und Künstlern.
  // Alben/Playlists/Künstler lassen sich öffnen (Doppelklick) oder komplett hinzufügen.
  import { player, formatTime, parseDuration } from '$lib/player.svelte';
  import { ytm, isTrack, type Collection, type Item, type SearchKind, type Track } from '$lib/ytm';
  import Icon from './Icon.svelte';
  import TrackList from './TrackList.svelte';

  let { onClose }: { onClose: () => void } = $props();

  type Tab = SearchKind | 'mine' | 'genres';
  const TABS: [Tab, string][] = [
    ['mine', 'MEINE'],
    ['genres', 'GENRES'],
    ['songs', 'SONGS'],
    ['albums', 'ALBEN'],
    ['playlists', 'PLAYLISTS'],
    ['artists', 'KÜNSTLER'],
  ];

  let query = $state('');
  let kind = $state<Tab>('songs');
  let results = $state<Item[]>([]);
  /** Geöffnete Alben/Playlists/Künstler (Zurück = eine Ebene hoch) */
  let stack = $state<{ source: Collection; items: Item[] }[]>([]);
  let selected = $state(new Set<number>());
  let busy = $state(false);
  let message = $state('');
  let input = $state<HTMLInputElement>();
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

  async function search(e?: Event) {
    e?.preventDefault();
    const q = query.trim();
    // Suchen aus „Meine“/„Genres“ heraus → Songs
    if ((kind === 'mine' || kind === 'genres') && e) kind = 'songs';
    if (kind === 'mine') return loadMine();
    if (kind === 'genres') return loadGenres();
    if (!q || !player.live) return;
    const k = kind;
    const key = `${k}:${q}`;
    stack = [];
    selected = new Set();
    searched = q;
    if (cache.has(key)) {
      results = cache.get(key)!;
      return;
    }
    results = [];
    await busyWith(async () => {
      const found = await ytm.search(q, k);
      cache.set(key, found);
      if (kind === k && q === searched) results = found; // inzwischen anderer Tab/Begriff → verwerfen
      if (!found.length) message = 'Keine Treffer';
    });
  }

  function setKind(k: Tab) {
    if (k === kind && !stack.length) return;
    kind = k;
    if (k === 'mine' || k === 'genres' || query.trim()) search();
    else {
      stack = [];
      results = [];
    }
  }

  /** Eigene Playlists des Kontos – immer frisch, Änderungen in YT Music sollen sofort sichtbar sein */
  async function loadMine() {
    stack = [];
    selected = new Set();
    results = [];
    await busyWith(async () => {
      const mine = await ytm.library();
      if (kind === 'mine') results = mine;
      if (!mine.length) message = 'Keine eigenen Playlists';
    });
  }

  /** Genres und Stimmungen von YT Music – ändern sich selten, daher zwischengespeichert */
  async function loadGenres() {
    stack = [];
    selected = new Set();
    if (cache.has('genres')) {
      results = cache.get('genres')!;
      return;
    }
    results = [];
    await busyWith(async () => {
      const list = await ytm.genres();
      cache.set('genres', list);
      if (kind === 'genres') results = list;
    });
  }

  async function open(c: Collection) {
    await busyWith(async () => {
      const found = await ytm.open(c);
      stack = [...stack, { source: c, items: found }];
      selected = new Set();
      if (!found.length) message = 'Leer';
    });
  }

  function back() {
    stack = stack.slice(0, -1);
    selected = new Set();
  }

  /** Alle Titel der Einträge – Alben/Playlists werden dafür geladen. */
  async function tracksOf(list: Item[]) {
    const out: Track[] = [];
    for (const it of list) {
      if (isTrack(it)) out.push(it);
      else if (it.kind === 'album' || it.kind === 'playlist') out.push(...(await ytm.open(it)).filter(isTrack));
    }
    return out;
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
    return c.kind === 'artist' || c.kind === 'genre' ? c.title : `${c.title}${by ? ` – ${by}` : ''}${c.year ? ` (${c.year})` : ''}`;
  });

  const account = $derived(player.account);
</script>

<!-- svelte-ignore a11y_no_noninteractive_tabindex, a11y_no_noninteractive_element_interactions -->
<section class="ml panel" aria-label="Media Library" tabindex="0" onkeydown={keydown}>
  <div class="titlebar" data-tauri-drag-region>
    <span class="label skin-text">AnyAmp! Media Library</span>
    <button class="btn wbtn" style="left:264px" title="Schließen" onclick={onClose}>
      <Icon name="close" size={7} />
    </button>
  </div>

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
      <input bind:this={input} bind:value={query} placeholder="YouTube Music durchsuchen …" spellcheck="false" />
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
      <TrackList tracks={items} bind:selected numbered={!!view && (view.source.kind === 'album' || view.source.kind === 'playlist')} onActivate={activate} />
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
