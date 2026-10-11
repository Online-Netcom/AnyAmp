<script lang="ts">
  // Laufschrift wie im Winamp-Hauptfenster: rotiert zeichenweise, wenn der Text zu lang ist.
  import { onMount } from 'svelte';

  let { text, width }: { text: string; width: number } = $props();

  let offset = $state(0);
  let el: HTMLSpanElement;
  let overflow = $state(false);

  $effect(() => {
    text;
    offset = 0;
    queueMicrotask(() => (overflow = el ? el.scrollWidth > width : false));
  });

  const shown = $derived.by(() => {
    if (!overflow) return text;
    const loop = text + '  ***  ';
    const i = offset % loop.length;
    return loop.slice(i) + loop.slice(0, i);
  });

  onMount(() => {
    const t = setInterval(() => overflow && offset++, 220);
    return () => clearInterval(t);
  });
</script>

<span class="marquee skin-text" style:width="{width}px">
  <span bind:this={el} class="measure">{text}</span>
  {shown}
</span>

<style>
  .marquee {
    display: block;
    overflow: hidden;
    white-space: pre;
    color: var(--lcd-text);
    position: relative;
  }
  .measure {
    position: absolute;
    visibility: hidden;
    white-space: pre;
  }
</style>
