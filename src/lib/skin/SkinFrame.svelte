<script lang="ts">
  // Rahmen der angedockten Fenster (275×232) aus PLEDIT.BMP – wie Winamps Playlist-Editor.
  // `playlist`: mit Original-Titelgrafik und den Knopfflächen unten (ADD/REM/SEL/MISC, LIST).
  // Sonst (Media Library, Liedtext): Titel in Skin-Schrift, unten nur Kachelmuster.
  import { skin } from './skin.svelte';
  import SkinText from './SkinText.svelte';

  let { title, playlist = false, focused = true }: { title: string; playlist?: boolean; focused?: boolean } = $props();

  const url = $derived(skin.current?.images.pledit?.url);
  const tiles = $derived(skin.current?.tiles ?? {});
  const y = $derived(focused ? 0 : 21); // aktive/inaktive Titelleiste
  const s = (x: number, yy: number) => `url('${url}') -${x}px -${yy}px no-repeat`;
  const t = (tile?: string, rep = 'repeat') => `url('${tile}') 0 0 ${rep}`;
  const top = $derived(focused ? tiles.top : tiles.topInactive);
  const labelW = $derived(title.length * 5 + 10);
</script>

<div class="frame" aria-hidden="true">
  <!-- oben: Ecke, Kacheln, Titel, Ecke -->
  <i style="left:25px;top:0;width:225px;height:20px;background:{t(top, 'repeat-x')}"></i>
  <i style="left:0;top:0;width:25px;height:20px;background:{s(0, y)}"></i>
  {#if playlist}
    <i style="left:88px;top:0;width:100px;height:20px;background:{s(26, y)}"></i>
  {:else}
    <i class="label" style="left:{Math.round(137.5 - labelW / 2)}px;width:{labelW}px">
      <SkinText text={title} chars={title.length} />
    </i>
  {/if}
  <i style="left:250px;top:0;width:25px;height:20px;background:{s(153, y)}"></i>
  <!-- Seiten -->
  <i style="left:0;top:20px;width:12px;height:174px;background:{t(tiles.left, 'repeat-y')}"></i>
  <i style="left:255px;top:20px;width:20px;height:174px;background:{t(tiles.right, 'repeat-y')}"></i>
  <!-- unten -->
  {#if playlist}
    <i style="left:0;top:194px;width:125px;height:38px;background:{s(0, 72)}"></i>
    <i style="left:125px;top:194px;width:150px;height:38px;background:{s(126, 72)}"></i>
  {:else}
    <i style="left:0;top:194px;width:275px;height:38px;background:{t(tiles.bottom, 'repeat-x')}"></i>
  {/if}
</div>

<style>
  .frame {
    position: absolute;
    inset: 0;
    pointer-events: none;
  }
  i {
    position: absolute;
    image-rendering: pixelated;
  }
  .label {
    top: 7px;
    height: 8px;
    display: grid;
    place-items: center;
    background: #000;
  }
</style>
