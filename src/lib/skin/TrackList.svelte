<script lang="ts">
  // Liste im Stil des Winamp-Playlist-Editors (Auswahl, Doppelklick, optional Drag & Drop).
  // Zeigt Titel und – in der Media Library – auch Alben, Playlists und Künstler.
  import { ui } from '$lib/ui.svelte';
  import { isTrack, type Item } from '$lib/ytm';

  let {
    tracks,
    selected = $bindable(new Set<number>()),
    dropAt = $bindable(-1),
    dragging = $bindable(-1),
    current = -1,
    numbered = true,
    reorder,
    dragOut = false,
    onDropItems,
    onContext,
    onActivate,
  }: {
    tracks: Item[];
    selected?: Set<number>;
    /** Einfügeposition beim Ziehen (0 … Länge), -1 = keine; wird als Linie angezeigt */
    dropAt?: number;
    /** Index der gerade gezogenen Zeile (Umsortieren), -1 = keine */
    dragging?: number;
    current?: number;
    numbered?: boolean;
    reorder?: (from: number, to: number) => void;
    /** Einträge lassen sich herausziehen (Media Library → Playlist) */
    dragOut?: boolean;
    /** hereingezogene Einträge an Position einfügen (Playlist) */
    onDropItems?: (at: number, items: Item[]) => void;
    onContext?: (e: MouseEvent, index: number) => void;
    onActivate: (index: number) => void;
  } = $props();

  const KIND = { album: 'ALBUM', playlist: 'PLAYLIST', artist: 'KÜNSTLER', genre: 'GENRE', shelf: 'BEREICH' };

  function row(t: Item) {
    if (isTrack(t)) return { key: t.videoId, name: `${t.artists.join(', ')} - ${t.title}`, right: t.duration, tip: `${t.title} – ${t.subtitle}` };
    if (t.kind !== 'album') {
      // Playlist/Künstler: Name links, Titelzahl rechts (aus „Dennis Gehrke • 12 Titel“)
      const count = t.subtitle.match(/(\d[\d.]*)\s*(Titel|Songs?|tracks?)/i)?.[1] ?? '';
      return { key: t.browseId + (t.params ?? ''), name: t.title, right: count, tip: `${KIND[t.kind]}: ${t.title} – ${t.subtitle}` };
    }
    const by = t.artists.join(', ') || t.subtitle;
    // Singles/EPs kennzeichnen, damit sie sich von Alben abheben
    const tag = t.type && !/^album$/i.test(t.type) ? ` (${t.type})` : '';
    return {
      key: t.browseId,
      name: `${by} - ${t.title}${tag}`,
      right: t.year || t.type,
      tip: `${t.type || KIND[t.kind]}: ${t.title} – ${t.subtitle}`,
    };
  }

  let anchor = -1;

  /** Eigenes Zugbild: kompakt, rechts unterhalb des Mauszeigers – das Standardbild
   *  (die ganze Zeile) läge genau über der Einfügelinie. */
  function dragImage(e: DragEvent, li: HTMLElement, count: number) {
    const g = document.createElement('div');
    g.className = 'anyamp-ghost';
    const label = document.createElement('span');
    label.textContent = count > 1 ? `${count} Einträge` : (li.querySelector('.name')?.textContent ?? '');
    g.appendChild(label);
    li.parentElement!.appendChild(g); // im gezoomten Bereich, damit die Größe passt
    e.dataTransfer?.setDragImage(g, 0, 0);
    setTimeout(() => g.remove());
  }

  /** obere Zeilenhälfte → davor, untere → dahinter */
  function over(e: DragEvent, i: number) {
    if (!(reorder || (onDropItems && ui.drag))) return;
    e.preventDefault();
    e.stopPropagation();
    const r = (e.currentTarget as HTMLElement).getBoundingClientRect();
    dropAt = e.clientY - r.top < r.height / 2 ? i : i + 1;
  }

  function dropped(e: DragEvent) {
    e.preventDefault();
    e.stopPropagation();
    const at = dropAt;
    dropAt = -1;
    if (at < 0) return;
    if (ui.drag && onDropItems) {
      onDropItems(at, ui.drag);
      ui.drag = null;
    } else if (reorder && dragging >= 0) {
      // Position nach dem Herausnehmen: alles hinter `dragging` rückt eins nach vorn
      const to = at > dragging ? at - 1 : at;
      reorder(dragging, to);
      selected = new Set([to]);
    }
    dragging = -1;
  }

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
      class:drop-before={dropAt === i}
      class:drop-after={dropAt === tracks.length && i === tracks.length - 1}
      title={r.tip}
      draggable={!!reorder || dragOut}
      onmousedown={(e) => {
        // Rechtsklick auf eine Zeile außerhalb der Auswahl wählt nur diese aus
        if (e.button !== 2 || !selected.has(i)) click(e, i);
      }}
      oncontextmenu={(e) => onContext?.(e, i)}
      ondblclick={() => onActivate(i)}
      ondragstart={(e) => {
        dragging = i;
        e.dataTransfer?.setData('text/plain', 'anyamp');
        dragImage(e, e.currentTarget as HTMLElement, selected.has(i) && dragOut ? selected.size : 1);
        if (dragOut) {
          const pick = selected.has(i) ? [...selected].sort((a, b) => a - b) : [i];
          ui.drag = pick.map((k) => tracks[k]);
        }
      }}
      ondragend={() => {
        ui.drag = null;
        dropAt = -1;
        dragging = -1;
      }}
      ondragover={(e) => over(e, i)}
      ondrop={dropped}
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
  /* Zugbild: oben/links transparenter Abstand, damit die Einfügelinie frei bleibt */
  :global(.anyamp-ghost) {
    position: absolute;
    top: -1000px;
    left: 0;
    padding: 10px 0 0 12px;
  }
  :global(.anyamp-ghost span) {
    display: block;
    max-width: 160px;
    padding: 1px 4px;
    overflow: hidden;
    white-space: nowrap;
    text-overflow: ellipsis;
    font: 9px/12px var(--pl-font);
    color: var(--pl-current);
    background: var(--pl-selected-bg);
    box-shadow: 0 0 0 1px #000;
  }
  /* Einfügelinie beim Ziehen */
  li {
    position: relative;
  }
  .drop-before::before,
  .drop-after::after {
    content: '';
    position: absolute;
    left: 0;
    right: 0;
    height: 2px;
    background: var(--pl-current);
    box-shadow: 0 0 3px var(--pl-current);
    pointer-events: none;
    z-index: 1;
  }
  .drop-before::before {
    top: -1px;
  }
  .drop-after::after {
    bottom: -1px;
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
