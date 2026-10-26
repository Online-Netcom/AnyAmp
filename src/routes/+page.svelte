<script lang="ts">
  import '@fontsource/silkscreen/latin-400.css';
  import '@fontsource/silkscreen/latin-ext-400.css';
  import '@fontsource/dseg7-classic/latin-400.css';
  import '$lib/skin/skin.css';
  import { onMount, tick } from 'svelte';
  import { getCurrentWindow, LogicalSize } from '@tauri-apps/api/window';
  import { player } from '$lib/player.svelte';
  import { ytm } from '$lib/ytm';
  import Main from '$lib/skin/Main.svelte';
  import Playlist from '$lib/skin/Playlist.svelte';
  import Library from '$lib/skin/Library.svelte';

  const LAYOUT_KEY = 'anyamp.layout.v1';
  // Größenstufen (Winamp-Original = 1× ist auf heutigen Displays zu klein)
  const SCALES = [1.5, 2, 2.5, 3];
  let layout = $state({ scale: 2, playlist: true, library: false });
  try {
    Object.assign(layout, JSON.parse(localStorage.getItem(LAYOUT_KEY) ?? '{}'));
  } catch {}
  if (!SCALES.includes(layout.scale)) layout.scale = 2;

  /** Nächste/vorige Größenstufe; ohne Richtung reihum. */
  function resize(dir?: 1 | -1) {
    const i = SCALES.indexOf(layout.scale);
    layout.scale = dir
      ? SCALES[Math.min(SCALES.length - 1, Math.max(0, i + dir))]
      : SCALES[(i + 1) % SCALES.length];
  }

  let library: Library | undefined = $state();

  // Fenstergröße folgt den sichtbaren Bereichen (wie Winamps angedockte Fenster).
  $effect(() => {
    const h = 116 + (layout.playlist ? 232 : 0) + (layout.library ? 232 : 0);
    try {
      localStorage.setItem(LAYOUT_KEY, JSON.stringify(layout));
    } catch {}
    if (player.live) getCurrentWindow().setSize(new LogicalSize(275 * layout.scale, h * layout.scale));
  });

  // Nativer Visualizer liegt über der LCD-Fläche (Skin-Position 25/43) – Lage, Bildrate und
  // Lautstärke (für den Ausgleich) melden. $derived: nur bei echten Änderungen neu senden.
  const volume = $derived(player.status?.volume ?? 100);
  $effect(() => {
    const s = layout.scale;
    if (player.live) ytm.visConfig(player.visFps, 25 * s, 43 * s, s, volume).catch(() => {});
  });

  async function openLibrary() {
    layout.library = true;
    await tick();
    library?.focus();
  }

  onMount(() => player.init());

  // Winamp-Tastenkürzel
  function keydown(e: KeyboardEvent) {
    const target = e.target as HTMLElement;
    if (target.tagName === 'INPUT' && (target as HTMLInputElement).type !== 'range') return;
    if (e.metaKey || e.ctrlKey) {
      const dir = { d: 0, '+': 1, '=': 1, '-': -1 }[e.key.toLowerCase()];
      if (dir !== undefined) {
        e.preventDefault();
        resize(dir === 0 ? undefined : (dir as 1 | -1));
        return;
      }
    }
    if (e.metaKey || e.ctrlKey || e.altKey) return;
    const actions: Record<string, () => unknown> = {
      z: () => player.prev(),
      x: () => player.play(),
      c: () => player.pause(),
      v: () => player.stop(),
      b: () => player.next(),
      s: () => player.toggleShuffle(),
      r: () => player.toggleRepeat(),
      a: () => player.toggleAutoplay(),
      l: openLibrary,
      ArrowLeft: () => player.seek(player.time - 5),
      ArrowRight: () => player.seek(player.time + 5),
      ArrowUp: () => player.volume((player.status?.volume ?? 100) + 5),
      ArrowDown: () => player.volume((player.status?.volume ?? 100) - 5),
    };
    const fn = actions[e.key.length === 1 ? e.key.toLowerCase() : e.key];
    if (fn) {
      e.preventDefault();
      fn();
    }
  }
</script>

<svelte:window onkeydown={keydown} />

<div class="app" style:zoom={layout.scale}>
  <Main
    scale={layout.scale}
    playlistOpen={layout.playlist}
    onToggleScale={() => resize()}
    onTogglePlaylist={() => (layout.playlist = !layout.playlist)}
    onOpenLibrary={openLibrary}
  />
  {#if layout.playlist}
    <Playlist onAdd={openLibrary} onClose={() => (layout.playlist = false)} />
  {/if}
  {#if layout.library}
    <Library bind:this={library} onClose={() => (layout.library = false)} />
  {/if}
</div>

<style>
  :global(html, body) {
    margin: 0;
    background: #000;
    overflow: hidden;
    user-select: none;
    -webkit-user-select: none;
    cursor: default;
  }
  :global(*) {
    -webkit-tap-highlight-color: transparent;
  }
  :global(button:focus-visible) {
    outline: 1px dotted var(--lcd-text);
  }
  .app {
    width: 275px;
  }
</style>
