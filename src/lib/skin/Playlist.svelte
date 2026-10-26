<script lang="ts">
  // Playlist-Editor (275×232 Skin-Pixel).
  import { player, formatTime, parseDuration } from '$lib/player.svelte';
  import { playlistMenu, tracksOf } from '$lib/menus';
  import { ui } from '$lib/ui.svelte';
  import type { Item } from '$lib/ytm';
  import { skin } from './skin.svelte';
  import SkinFrame from './SkinFrame.svelte';
  import Icon from './Icon.svelte';
  import TrackList from './TrackList.svelte';

  let { onAdd, onClose }: { onAdd: () => void; onClose: () => void } = $props();

  let selected = $state(new Set<number>());
  let dropAt = $state(-1);
  let dragging = $state(-1);

  const total = $derived(player.playlist.reduce((s, t) => s + parseDuration(t.duration), 0));
  const selTime = $derived([...selected].reduce((s, i) => s + parseDuration(player.playlist[i]?.duration), 0));

  /** Aus der Media Library hereingezogen: an Position einfügen (Alben/Playlists komplett) */
  async function dropped(at: number, items: Item[]) {
    try {
      player.insert(at, await tracksOf(items));
    } catch (e) {
      player.error = (e as Error).message;
    }
  }

  const skinned = $derived(skin.has('pledit'));

  /** LIST-Knopf des Skins: was im Standard-Look eigene Knöpfe hat */
  function listMenu(e: MouseEvent) {
    ui.openMenu(e, [
      { label: 'Autoplay', checked: player.autoplay, action: () => player.toggleAutoplay() },
      { label: 'Reihenfolge mischen', action: () => player.randomize() },
      'sep',
      { label: 'Playlist leeren', disabled: !player.playlist.length, action: () => player.clear() },
    ]);
  }

  function removeSelected() {
    player.remove(selected);
    selected = new Set();
  }

  function keydown(e: KeyboardEvent) {
    if ((e.key === 'Delete' || e.key === 'Backspace') && selected.size) {
      e.preventDefault();
      removeSelected();
    } else if (e.key === 'Enter' && selected.size) {
      player.playIndex(Math.min(...selected));
    } else if ((e.metaKey || e.ctrlKey) && e.key === 'a') {
      e.preventDefault();
      selected = new Set(player.playlist.map((_, i) => i));
    }
  }
</script>

<!-- svelte-ignore a11y_no_noninteractive_tabindex, a11y_no_noninteractive_element_interactions -->
<section class="pl panel" class:skinned aria-label="Playlist" tabindex="0" onkeydown={keydown}>
  {#if skinned}
    <SkinFrame title="AnyAmp! Playlist" playlist />
    <div class="skin-drag" data-tauri-drag-region></div>
    <button class="hot" style="left:264px;top:3px;width:9px;height:9px" title="Playlist schließen" onclick={onClose}></button>
  {:else}
    <div class="titlebar" data-tauri-drag-region>
      <span class="label skin-text">AnyAmp! Playlist</span>
      <button class="btn wbtn" style="left:264px" title="Playlist schließen" onclick={onClose}>
        <Icon name="close" size={7} />
      </button>
    </div>
  {/if}

  <div
    class="body inset"
    role="list"
    ondragover={(e) => {
      // freie Fläche unter der Liste: ans Ende
      e.preventDefault();
      dropAt = player.playlist.length;
    }}
    ondragleave={(e) => {
      if (!(e.currentTarget as HTMLElement).contains(e.relatedTarget as Node)) dropAt = -1;
    }}
    ondrop={(e) => {
      e.preventDefault();
      const at = dropAt;
      dropAt = -1;
      if (ui.drag) dropped(player.playlist.length, ui.drag);
      else if (at >= 0 && dragging >= 0) {
        player.move(dragging, player.playlist.length - 1);
        selected = new Set([player.playlist.length - 1]);
      }
      dragging = -1;
      ui.drag = null;
    }}
  >
    {#if player.playlist.length}
      <TrackList
        tracks={player.playlist}
        bind:selected
        bind:dropAt
        bind:dragging
        current={player.current}
        reorder={(a, b) => player.move(a, b)}
        onDropItems={dropped}
        onContext={(e, i) => playlistMenu(e, i, selected.has(i) ? selected : new Set([i]), () => {
          player.remove(selected.has(i) ? selected : new Set([i]));
          selected = new Set();
        })}
        onActivate={(i) => player.playIndex(i)}
      />
    {:else}
      <p class="empty">Playlist leer – mit <b>+ADD</b> suchen oder aus der Media Library hierher ziehen</p>
    {/if}
  </div>

  {#if skinned}
    <!-- Knopfflächen der Skin-Grafik (ADD, REM, SEL, MISC … LIST) -->
    <button class="hot" style="left:14px;top:206px;width:25px;height:18px" title="Songs suchen und hinzufügen" onclick={onAdd}></button>
    <button class="hot" style="left:43px;top:206px;width:25px;height:18px" title="Auswahl entfernen (Entf)" onclick={removeSelected}></button>
    <button class="hot" style="left:72px;top:206px;width:25px;height:18px" title="Alles / nichts auswählen" onclick={() => (selected = selected.size ? new Set() : new Set(player.playlist.map((_, i) => i)))}></button>
    <button class="hot" style="left:101px;top:206px;width:25px;height:18px" title="Reihenfolge mischen" onclick={() => player.randomize()}></button>
    <button class="hot" style="left:228px;top:206px;width:25px;height:18px" title="Optionen (Autoplay, Leeren …)" onclick={listMenu}></button>
  {:else}
  <div class="bottom">
    <button class="btn pbtn skin-text" style="left:11px" title="Songs suchen und hinzufügen" onclick={onAdd}>+ADD</button>
    <button class="btn pbtn skin-text" style="left:40px" title="Auswahl entfernen (Entf)" disabled={!selected.size} onclick={removeSelected}>-REM</button>
    <button
      class="btn pbtn skin-text"
      style="left:69px"
      title="Alles / nichts auswählen"
      onclick={() => (selected = selected.size ? new Set() : new Set(player.playlist.map((_, i) => i)))}
    >SEL</button>
    <button class="btn pbtn skin-text" style="left:98px" title="Reihenfolge mischen" onclick={() => player.randomize()}>MISC</button>

    <button
      class="btn pbtn sw skin-text"
      style="left:127px;width:30px"
      title="Autoplay (A): am Ende passende Titel anhängen"
      onclick={() => player.toggleAutoplay()}
    ><i class:on={player.autoplay}></i>AUTO</button>

    <div class="mini inset skin-text">
      <span>{selected.size ? `${formatTime(selTime)}/` : ''}{formatTime(total)}</span>
      <span class="cur">{player.mode ? formatTime(player.time) : ''}</span>
    </div>

    <button class="btn pbtn skin-text" style="left:232px;width:32px" title="Playlist leeren" disabled={!player.playlist.length} onclick={() => player.clear()}>CLEAR</button>
  </div>
  {/if}
</section>

<style>
  .pl {
    position: relative;
    width: 275px;
    height: 232px;
    outline: none;
  }
  /* Mit Skin: Geometrie des Winamp-Playlist-Editors (Rahmen 20/20/38/12) */
  .skinned {
    background: var(--pl-bg);
  }
  .skinned .body {
    left: 12px;
    top: 20px;
    right: 20px;
    bottom: 38px;
    box-shadow: none;
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
  .body {
    position: absolute;
    left: 11px;
    top: 18px;
    right: 11px;
    bottom: 24px;
    overflow-y: auto;
    background: var(--pl-bg);
  }
  .body::-webkit-scrollbar {
    width: 8px;
  }
  .body::-webkit-scrollbar-thumb {
    background: linear-gradient(90deg, var(--btn-hi), var(--btn-lo));
  }
  .empty {
    margin: 8px;
    font: 9px var(--pl-font);
    color: var(--pl-normal);
  }
  .bottom .pbtn {
    top: 213px;
    width: 26px;
    height: 13px;
    font-size: 5px;
  }
  .sw {
    gap: 2px;
  }
  .sw i {
    width: 3px;
    height: 3px;
    background: var(--led-off);
    box-shadow: inset 0 0 0 1px #0006;
  }
  .sw i.on {
    background: var(--led-on);
  }
  .mini {
    position: absolute;
    left: 160px;
    top: 212px;
    width: 68px;
    height: 15px;
    display: flex;
    justify-content: space-between;
    align-items: center;
    padding: 0 3px;
    box-sizing: border-box;
    color: var(--lcd-text);
    font-size: 6px;
  }
</style>
