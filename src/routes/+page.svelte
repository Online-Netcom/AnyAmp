<script lang="ts">
  import '@fontsource/silkscreen/latin-400.css';
  import '@fontsource/silkscreen/latin-ext-400.css';
  import '@fontsource/dseg7-classic/latin-400.css';
  import '$lib/skin/skin.css';
  import { onMount, tick } from 'svelte';
  import { getCurrentWindow, LogicalSize } from '@tauri-apps/api/window';
  import { layout } from '$lib/layout.svelte';
  import { player } from '$lib/player.svelte';
  import { ui } from '$lib/ui.svelte';
  import { updater } from '$lib/updater.svelte';
  import { ytm } from '$lib/ytm';
  import Main from '$lib/skin/Main.svelte';
  import Playlist from '$lib/skin/Playlist.svelte';
  import Library from '$lib/skin/Library.svelte';
  import Lyrics from '$lib/skin/Lyrics.svelte';
  import Menu from '$lib/skin/Menu.svelte';

  let library: Library | undefined = $state();

  // Fenstergröße folgt den sichtbaren Bereichen (wie Winamps angedockte Fenster).
  $effect(() => {
    const h = layout.height;
    layout.save();
    if (player.live) getCurrentWindow().setSize(new LogicalSize(275 * layout.scale, h * layout.scale));
  });

  $effect(() => {
    if (player.live) getCurrentWindow().setAlwaysOnTop(layout.onTop);
  });

  // Nativer Visualizer liegt über der LCD-Fläche (Skin-Position 25/43) – Lage, Modus, Bildrate und
  // Lautstärke (für den Ausgleich) melden. Im Windowshade-Modus gibt es keine LCD-Fläche.
  // $derived: nur bei echten Änderungen neu senden.
  const volume = $derived(player.status?.volume ?? 100);
  $effect(() => {
    const s = layout.scale;
    // Offenes Kontextmenü: das native Overlay läge sonst darüber
    const off = player.visMode === 'off' || layout.shade || !!ui.menu;
    if (player.live) ytm.visConfig(off ? 0 : player.visFps, player.visMode, 25 * s, 43 * s, s, volume).catch(() => {});
  });

  layout.openLibrary = async () => {
    layout.library = true;
    await tick();
    library?.focus();
  };

  // „Gehe zu Album/Künstler“ braucht die Media Library
  $effect(() => {
    if (ui.navigate) layout.library = true;
  });

  onMount(() => {
    const stop = player.init();
    // still nach Updates schauen, kurz nach dem Start
    const t = player.live ? window.setTimeout(() => updater.check(true), 8000) : 0;
    return () => {
      stop();
      clearTimeout(t);
    };
  });

  // Winamp-Tastenkürzel
  function keydown(e: KeyboardEvent) {
    const target = e.target as HTMLElement;
    if (target.tagName === 'INPUT' && (target as HTMLInputElement).type !== 'range') return;
    if (e.metaKey || e.ctrlKey) {
      const dir = { d: 0, '+': 1, '=': 1, '-': -1 }[e.key.toLowerCase()];
      if (dir !== undefined) {
        e.preventDefault();
        layout.resize(dir === 0 ? undefined : (dir as 1 | -1));
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
      l: layout.openLibrary,
      i: () => (layout.lyrics = !layout.lyrics),
      f: () => player.toggleLike(),
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
  <Main />
  {#if layout.playlist}
    <Playlist onAdd={layout.openLibrary} onClose={() => (layout.playlist = false)} />
  {/if}
  {#if layout.library}
    <Library bind:this={library} onClose={() => (layout.library = false)} />
  {/if}
  {#if layout.lyrics}
    <Lyrics onClose={() => (layout.lyrics = false)} />
  {/if}
</div>

<Menu scale={layout.scale} />

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
