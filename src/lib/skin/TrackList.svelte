<script lang="ts">
  // Liste im Stil des Winamp-Playlist-Editors (Auswahl, Doppelklick, optional Drag & Drop).
  // Zeigt Titel und – in der Media Library – auch Alben, Playlists und Künstler.
  import { isTrack, type Item } from '$lib/ytm';

  let {
    tracks,
    selected = $bindable(new Set<number>()),
    current = -1,
    numbered = true,
    reorder,
    onActivate,
  }: {
    tracks: Item[];
    selected?: Set<number>;
    current?: number;
    numbered?: boolean;
    reorder?: (from: number, to: number) => void;
    onActivate: (index: number) => void;
  } = $props();

  const KIND = { album: 'ALBUM', playlist: 'PLAYLIST', artist: 'KÜNSTLER' };

  function row(t: Item) {
    if (isTrack(t)) return { key: t.videoId, name: `${t.artists.join(', ')} - ${t.title}`, right: t.duration, tip: `${t.title} – ${t.subtitle}` };
    if (t.kind !== 'album') {
      // Playlist/Künstler: Name links, Titelzahl rechts (aus „Dennis Gehrke • 12 Titel“)
      const count = t.subtitle.match(/(\d[\d.]*)\s*(Titel|Songs?|tracks?)/i)?.[1] ?? '';
      return { key: t.browseId, name: t.title, right: count, tip: `${KIND[t.kind]}: ${t.title} – ${t.subtitle}` };
    }
    const by = t.artists.join(', ') || t.subtitle;
    return {
      key: t.browseId,
      name: `${by} - ${t.title}`,
      right: t.year || t.type,
      tip: `${t.type || KIND[t.kind]}: ${t.title} – ${t.subtitle}`,
    };
  }

  let anchor = -1;
  let dragFrom = -1;

  function click(e: MouseEvent, i: number) {
    if (e.shiftKey && anchor >= 0) {
      const [a, b] = [Math.min(anchor, i), Math.max(anchor, i)];
      selected = new Set(Array.from({ length: b - a + 1 }, (_, k) => a + k));
    } else if (e.metaKey || e.ctrlKey) {
      const s = new Set(selected);
      s.has(i) ? s.delete(i) : s.add(i);
      selected = s;
      anchor = i;
    } else {
      selected = new Set([i]);
      anchor = i;
    }
  }
</script>

<ol class="list" role="listbox" aria-multiselectable="true">
  {#each tracks as t, i (i + row(t).key)}
    {@const r = row(t)}
    <li
      role="option"
      aria-selected={selected.has(i)}
      class:sel={selected.has(i)}
      class:cur={i === current}
      class:auto={isTrack(t) && t.auto && i > current}
      class:folder={!isTrack(t)}
      title={r.tip}
      draggable={!!reorder}
      onmousedown={(e) => click(e, i)}
      ondblclick={() => onActivate(i)}
      ondragstart={() => (dragFrom = i)}
      ondragover={(e) => reorder && e.preventDefault()}
      ondrop={() => {
        reorder?.(dragFrom, i);
        selected = new Set([i]);
      }}
    >
      <span class="name">{numbered ? `${i + 1}. ` : ''}{r.name}</span>
      <span class="dur">{r.right}</span>
    </li>
  {/each}
</ol>

<style>
  .list {
    margin: 0;
    padding: 0;
    list-style: none;
    font: 9px/12px var(--pl-font);
    color: var(--pl-normal);
    user-select: none;
  }
  li {
    display: flex;
    gap: 4px;
    padding: 0 2px;
    white-space: nowrap;
  }
  .name {
    flex: 1;
    overflow: hidden;
    text-overflow: ellipsis;
  }
  .sel {
    background: var(--pl-selected-bg);
  }
  .cur {
    color: var(--pl-current);
  }
  /* noch nicht gespielter Autoplay-Nachschub */
  .auto {
    color: var(--pl-auto);
  }
  /* Album/Playlist/Künstler: Doppelklick öffnet */
  .folder .name::before {
    content: '▸ ';
  }
</style>
