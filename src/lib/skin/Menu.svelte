<script lang="ts">
  // Kontextmenü im Winamp-Stil (grau, Pixelschrift, Untermenüs). Liegt außerhalb der
  // gezoomten Oberfläche und skaliert selbst mit, damit es an der Mausposition erscheint.
  import { ui, type MenuEntry } from '$lib/ui.svelte';

  let { scale }: { scale: number } = $props();

  let open = $state<number | null>(null); // geöffnetes Untermenü
  let el = $state<HTMLDivElement>();
  let pos = $state({ left: 0, top: 0 });

  // Im Fenster halten: notfalls nach links/oben ausweichen
  $effect(() => {
    const m = ui.menu;
    open = null;
    if (!m || !el) return;
    const w = el.offsetWidth * scale;
    const h = el.offsetHeight * scale;
    pos = {
      left: Math.max(0, Math.min(m.x, innerWidth - w)) / scale,
      top: Math.max(0, Math.min(m.y, innerHeight - h)) / scale,
    };
  });

  /** Untermenü im Fenster halten (das Fenster ist nur so breit wie der Player):
   *  rechts kein Platz → links daneben; geht beides nicht → so weit nach links schieben,
   *  dass es passt (überlappt dann das Hauptmenü). Unten überstehend → nach oben. */
  function fit(node: HTMLElement, sub: boolean) {
    if (!sub) return;
    const parent = node.parentElement!.getBoundingClientRect();
    const r = node.getBoundingClientRect();
    if (r.right > innerWidth) {
      if (parent.left - r.width >= 0) {
        node.style.left = 'auto';
        node.style.right = '100%';
      } else {
        node.style.left = `${(innerWidth - r.width - parent.left) / scale}px`;
      }
    }
    const over = r.bottom - innerHeight;
    if (over > 0) node.style.top = `${-2 - over / scale}px`;
  }

  function run(entry: MenuEntry) {
    if (entry === 'sep' || entry.disabled || entry.submenu) return;
    ui.closeMenu();
    entry.action?.();
  }
</script>

<svelte:window
  onmousedown={(e) => {
    if (ui.menu && !el?.contains(e.target as Node)) ui.closeMenu();
  }}
  onkeydown={(e) => {
    if (ui.menu && e.key === 'Escape') ui.closeMenu();
  }}
  onblur={() => ui.closeMenu()}
/>

{#snippet list(entries: MenuEntry[], sub: boolean)}
  <div class="menu" class:sub role="menu" use:fit={sub}>
    {#each entries as entry, i (i)}
      {#if entry === 'sep'}
        <div class="sep"></div>
      {:else}
        <div
          class="item"
          class:disabled={entry.disabled}
          class:open={!sub && open === i}
          role="menuitem"
          tabindex="-1"
          onmouseenter={() => !sub && (open = entry.submenu ? i : null)}
          onclick={() => run(entry)}
          onkeydown={() => {}}
        >
          <span class="check">{entry.checked ? '✓' : ''}</span>
          <span class="label">{entry.label}</span>
          {#if entry.submenu}<span class="arrow">▸</span>{/if}
          {#if entry.submenu && !sub && open === i}
            {@render list(entry.submenu, true)}
          {/if}
        </div>
      {/if}
    {/each}
  </div>
{/snippet}

{#if ui.menu}
  <div class="root" bind:this={el} style:zoom={scale} style:left="{pos.left}px" style:top="{pos.top}px">
    {@render list(ui.menu.entries, false)}
  </div>
{/if}

<style>
  .root {
    position: fixed;
    z-index: 100;
  }
  .menu {
    min-width: 110px;
    max-width: 180px;
    padding: 2px 0;
    background: #e8e8f0;
    color: #000;
    font: 8px/11px var(--pl-font);
    box-shadow: inset 1px 1px 0 #fff, inset -1px -1px 0 #808090, 1px 1px 0 #000, 2px 2px 3px #0006;
  }
  .sub {
    position: absolute;
    z-index: 1;
    left: 100%;
    top: -2px;
    max-height: 200px;
    overflow-y: auto;
  }
  .item {
    position: relative;
    display: flex;
    align-items: center;
    padding: 0 6px 0 2px;
    white-space: nowrap;
    cursor: default;
  }
  .item:hover:not(.disabled),
  .item.open {
    background: #0a246a;
    color: #fff;
  }
  .disabled {
    color: #8a8a96;
  }
  .check {
    width: 9px;
    flex: none;
    text-align: center;
  }
  .label {
    flex: 1;
    overflow: hidden;
    text-overflow: ellipsis;
  }
  .arrow {
    margin-left: 8px;
  }
  .sep {
    height: 1px;
    margin: 2px 1px;
    background: #808090;
    box-shadow: 0 1px 0 #fff;
  }
</style>
