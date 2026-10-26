<script lang="ts" module>
  // Zeichen → Position im Raster von TEXT.BMP (5×6 Pixel je Zeichen), wie in Winamp 2.
  const ROW0 = 'abcdefghijklmnopqrstuvwxyz"@';
  const ROW1 = '0123456789….:()-\'!_+\\/[]^&%,=$#';
  const EXTRA: Record<string, [number, number]> = {
    ' ': [0, 30], 'å': [2, 0], 'ö': [2, 1], 'ä': [2, 2], '?': [2, 3], '*': [2, 4],
    '<': [1, 22], '>': [1, 23], '{': [1, 22], '}': [1, 23], 'ü': [0, 20], 'ß': [0, 18],
  };

  export function glyph(ch: string): [number, number] {
    const c = ch.toLowerCase();
    if (EXTRA[c]) return EXTRA[c];
    let i = ROW0.indexOf(c);
    if (i >= 0) return [0, i];
    i = ROW1.indexOf(c);
    if (i >= 0) return [1, i];
    return EXTRA[' '];
  }
</script>

<script lang="ts">
  import { skin } from './skin.svelte';

  // Text in der Pixelschrift des Skins; `chars` begrenzt die Länge (Rest wird abgeschnitten)
  let { text, chars }: { text: string; chars: number } = $props();

  const url = $derived(skin.current?.images.text?.url);
  const cells = $derived([...text.padEnd(chars).slice(0, chars)].map(glyph));
</script>

<span class="st" style:width="{chars * 5}px">
  {#each cells as [row, col], i (i)}
    <i style="background:url('{url}') -{col * 5}px -{row * 6}px"></i>
  {/each}
</span>

<style>
  .st {
    display: flex;
    height: 6px;
    overflow: hidden;
  }
  i {
    flex: none;
    width: 5px;
    height: 6px;
    image-rendering: pixelated;
  }
</style>
