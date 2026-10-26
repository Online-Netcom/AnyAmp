<script lang="ts">
  // Pixel-Glyphen für die Transport-Knöpfe (Raster 9×8).
  const paths = {
    prev: 'M0 0h2v8H0zM2 4l4-4v8zM5 4l4-4v8z',
    play: 'M1 0l7 4-7 4z',
    pause: 'M1 0h3v8H1zM5 0h3v8H5z',
    stop: 'M1 0h7v8H1z',
    next: 'M0 0l4 4-4 4zM3 0l4 4-4 4zM7 0h2v8H7z',
    eject: 'M4.5 0l4.5 5H0zM0 6h9v2H0z',
    close: 'M1 1l7 7M8 1l-7 7',
    min: 'M1 7h7',
    shade: 'M1 2h7M1 7h7',
    unshade: 'M1 1h7v6H1z',
  } as const;

  let { name, size = 9, color = 'currentColor' }: { name: keyof typeof paths; size?: number; color?: string } = $props();
  const stroke = $derived(['close', 'min', 'shade', 'unshade'].includes(name));
</script>

<svg width={size} height={(size * 8) / 9} viewBox="0 0 9 8" aria-hidden="true">
  {#if stroke}
    <path d={paths[name]} stroke={color} stroke-width="1.5" fill="none" />
  {:else}
    <path d={paths[name]} fill={color} />
  {/if}
</svg>
