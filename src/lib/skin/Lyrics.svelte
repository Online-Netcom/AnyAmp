<script lang="ts">
  // Liedtext zum laufenden Song (275×232 Skin-Pixel), folgt automatisch dem Titelwechsel.
  // Zeitgenau von LRCLIB (offene Liedtext-Datenbank), sonst der statische Text von YT Music.
  import { onMount, tick } from 'svelte';
  import { player } from '$lib/player.svelte';
  import { ytm, type Track } from '$lib/ytm';
  import Icon from './Icon.svelte';

  let { onClose }: { onClose: () => void } = $props();

  type Lyrics =
    | { kind: 'synced'; lines: { t: number; text: string }[]; source: string }
    | { kind: 'plain'; text: string; source: string };

  let lyrics = $state<Lyrics | null>(null);
  let phase = $state<'idle' | 'loading' | 'none' | 'error'>('idle');
  let body = $state<HTMLDivElement>();
  let active = $state(-1);
  const cache = new Map<string, Lyrics | null>();

  const track = $derived(player.track);
  const videoId = $derived(player.status?.videoId ?? track?.videoId ?? null);
  const title = $derived(track ? `${track.artists.join(', ')} - ${track.title}` : '');

  /** „[01:23.45] Text“ → Zeilen mit Startzeit in Sekunden */
  function parseLrc(lrc: string) {
    const lines: { t: number; text: string }[] = [];
    for (const row of lrc.split('\n')) {
      const m = row.match(/^\[(\d+):(\d+(?:\.\d+)?)\](.*)$/);
      if (m) lines.push({ t: +m[1] * 60 + +m[2], text: m[3].trim() });
    }
    return lines;
  }

  // Titelzusätze, die LRCLIB meist nicht kennt: „(feat. …)“, „(Radio Edit)“, „- Remastered 2011“
  const cleanTitle = (t: string) =>
    t
      .replace(/\s*[([](feat\.|ft\.|with |radio edit|remaster|official)[^)\]]*[)\]]/gi, '')
      .replace(/\s+-\s+.*remaster.*$/i, '')
      .trim();

  async function fromLrclib(t: Track, duration: number): Promise<Lyrics | null> {
    const params = new URLSearchParams({ track_name: cleanTitle(t.title), artist_name: t.artists[0] ?? '' });
    const res = await fetch(`https://lrclib.net/api/search?${params}`, {
      headers: { 'Lrclib-Client': 'AnyAmp (https://github.com/Online-Netcom/AnyAmp)' },
    });
    if (!res.ok) return null;
    const hits: { duration: number; syncedLyrics: string | null }[] = await res.json();
    // Länge muss passen (±3 s), sonst ist es eine andere Fassung
    const fits = hits.filter((h) => h.syncedLyrics && (!duration || Math.abs(h.duration - duration) <= 3));
    const best = fits.sort((a, b) => Math.abs(a.duration - duration) - Math.abs(b.duration - duration))[0];
    if (!best?.syncedLyrics) return null;
    const lines = parseLrc(best.syncedLyrics);
    return lines.length ? { kind: 'synced', lines, source: 'Zeitgenauer Text: LRCLIB' } : null;
  }

  async function load(t: Track, duration: number): Promise<Lyrics | null> {
    const synced = await fromLrclib(t, duration).catch(() => null);
    if (synced) return synced;
    const plain = await ytm.lyrics(t.videoId);
    return plain ? { kind: 'plain', text: plain.text, source: plain.source } : null;
  }

  $effect(() => {
    const id = videoId;
    const t = track;
    if (!id || !t || !player.live) {
      lyrics = null;
      phase = 'idle';
      return;
    }
    active = -1;
    body?.scrollTo(0, 0);
    if (cache.has(id)) {
      lyrics = cache.get(id)!;
      phase = lyrics ? 'idle' : 'none';
      return;
    }
    phase = 'loading';
    load(t, player.duration)
      .then((l) => {
        cache.set(id, l);
        if (id !== videoId) return;
        lyrics = l;
        phase = l ? 'idle' : 'none';
      })
      .catch(() => id === videoId && (phase = 'error'));
  });

  // Aktuelle Zeile verfolgen und mittig halten
  onMount(() => {
    const timer = setInterval(async () => {
      if (lyrics?.kind !== 'synced') return;
      const now = player.position() + 0.2; // Zeilen minimal vorziehen
      let i = -1;
      for (let k = 0; k < lyrics.lines.length && lyrics.lines[k].t <= now; k++) i = k;
      if (i === active) return;
      active = i;
      await tick();
      const el = body?.querySelector<HTMLElement>(`[data-line="${i}"]`);
      if (el && body) body.scrollTo({ top: el.offsetTop - body.clientHeight / 2 + el.offsetHeight / 2, behavior: 'smooth' });
    }, 100);
    return () => clearInterval(timer);
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
      <p class="note">Für diesen Titel gibt es keinen Liedtext.</p>
    {:else if phase === 'error'}
      <p class="note">Liedtext konnte nicht geladen werden.</p>
    {:else if lyrics?.kind === 'synced'}
      {#each lyrics.lines as line, i (i)}
        <p class="line" class:now={i === active} class:past={i < active} data-line={i}>{line.text || '♪'}</p>
      {/each}
      <p class="source">{lyrics.source}</p>
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
  .line {
    color: #0a8a0a;
    transition: color 0.2s;
  }
  .line.past {
    color: #0a6a0a;
  }
  .line.now {
    color: var(--pl-current);
    text-shadow: 0 0 4px #00ff0066;
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
