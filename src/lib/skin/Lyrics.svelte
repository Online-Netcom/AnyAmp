<script lang="ts">
  // Liedtext zum laufenden Song (275×232 Skin-Pixel), folgt automatisch dem Titelwechsel.
  import { player } from '$lib/player.svelte';
  import { ytm } from '$lib/ytm';
  import Icon from './Icon.svelte';

  let { onClose }: { onClose: () => void } = $props();

  let lyrics = $state<{ text: string; source: string } | null>(null);
  let phase = $state<'idle' | 'loading' | 'none' | 'error'>('idle');
  let body = $state<HTMLDivElement>();
  const cache = new Map<string, { text: string; source: string } | null>();

  const videoId = $derived(player.status?.videoId ?? player.track?.videoId ?? null);
  const title = $derived(player.track ? `${player.track.artists.join(', ')} - ${player.track.title}` : '');

  $effect(() => {
    const id = videoId;
    if (!id || !player.live) {
      lyrics = null;
      phase = 'idle';
      return;
    }
    body?.scrollTo(0, 0);
    if (cache.has(id)) {
      lyrics = cache.get(id)!;
      phase = lyrics ? 'idle' : 'none';
      return;
    }
    phase = 'loading';
    ytm
      .lyrics(id)
      .then((l) => {
        cache.set(id, l);
        if (id !== videoId) return;
        lyrics = l;
        phase = l ? 'idle' : 'none';
      })
      .catch(() => id === videoId && (phase = 'error'));
  });
</script>

<section class="ly panel" aria-label="Liedtext">
  <div class="titlebar" data-tauri-drag-region>
    <span class="label skin-text">AnyAmp! Liedtext</span>
    <button class="btn wbtn" style="left:264px" title="Liedtext schließen (I)" onclick={onClose}>
      <Icon name="close" size={7} />
    </button>
  </div>

  <div class="body inset" bind:this={body}>
    {#if title}<p class="head">{title}</p>{/if}
    {#if phase === 'loading'}
      <p class="note">Lade Liedtext …</p>
    {:else if phase === 'none'}
      <p class="note">Für diesen Titel gibt es bei YouTube Music keinen Liedtext.</p>
    {:else if phase === 'error'}
      <p class="note">Liedtext konnte nicht geladen werden.</p>
    {:else if lyrics}
      <p class="text">{lyrics.text}</p>
      <p class="source">{lyrics.source}</p>
    {:else}
      <p class="note">Spiel einen Titel ab, um seinen Liedtext zu sehen.</p>
    {/if}
  </div>
</section>

<style>
  .ly {
    position: relative;
    width: 275px;
    height: 232px;
  }
  .body {
    position: absolute;
    left: 11px;
    top: 18px;
    right: 11px;
    bottom: 10px;
    overflow-y: auto;
    padding: 4px 6px;
    box-sizing: border-box;
    background: var(--pl-bg);
    color: var(--pl-normal);
    font: 9px/13px var(--pl-font);
    user-select: text;
    -webkit-user-select: text;
  }
  .body::-webkit-scrollbar {
    width: 8px;
  }
  .body::-webkit-scrollbar-thumb {
    background: linear-gradient(90deg, var(--btn-hi), var(--btn-lo));
  }
  p {
    margin: 0;
  }
  .head {
    color: var(--pl-current);
    margin-bottom: 6px;
  }
  .text {
    white-space: pre-wrap;
  }
  .source {
    margin-top: 8px;
    color: #0a7a0a;
    font-size: 8px;
  }
  .note {
    color: #0a9a0a;
  }
</style>
