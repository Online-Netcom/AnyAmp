<script lang="ts">
  // Hauptfenster mit geladenem .wsz-Skin: alles aus den Skin-Bitmaps an den Original-Koordinaten
  // von Winamp 2 (275×116). Bedienelemente liegen unsichtbar darüber.
  import { getCurrentWindow } from '@tauri-apps/api/window';
  import { getVersion } from '@tauri-apps/api/app';
  import { layout } from '$lib/layout.svelte';
  import { optionsMenu } from '$lib/menus';
  import { player, formatTime } from '$lib/player.svelte';
  import { updater } from '$lib/updater.svelte';
  import { skin } from './skin.svelte';
  import SkinText from './SkinText.svelte';

  let dragPos = $state<number | null>(null);
  let dragVol = $state<number | null>(null);
  let focused = $state(true);

  const pos = $derived(dragPos ?? player.time);
  const vol = $derived(dragVol ?? player.status?.volume ?? 100);
  const dur = $derived(player.duration);

  const title = $derived.by(() => {
    const a = player.account;
    if (!a) return 'VERBINDE MIT YOUTUBE MUSIC ...';
    if (a.error) return a.error;
    if (!a.loggedIn) return 'BITTE BEI YOUTUBE MUSIC ANMELDEN';
    if (a.premium === false) return 'ANYAMP! BENOETIGT YOUTUBE PREMIUM';
    if (player.error) return player.error;
    if (updater.message) return updater.message;
    const t = player.track;
    if (!t) return `ANYAMP! - ${a.name ?? 'YOUTUBE MUSIC PREMIUM'}`;
    return `${player.current + 1}. ${t.artists.join(', ')} - ${t.title} (${formatTime(dur)})`;
  });

  // Laufschrift wie Winamp: 31 Zeichen, rotiert zeichenweise
  let offset = $state(0);
  const shown = $derived.by(() => {
    if (title.length <= 31) return title;
    const loop = `${title}  ***  `;
    const i = offset % loop.length;
    return loop.slice(i) + loop.slice(0, i);
  });
  $effect(() => {
    void title;
    offset = 0;
    const t = setInterval(() => offset++, 220);
    return () => clearInterval(t);
  });

  const digits = $derived.by(() => {
    const t = Math.min(pos, 5999);
    return `${String(Math.floor(t / 60)).padStart(2, '0')}${String(Math.floor(t % 60)).padStart(2, '0')}`;
  });
  const numbers = $derived(skin.has('nums_ex') ? 'nums_ex' : 'numbers');

  const win = player.live ? getCurrentWindow() : null;
  let version = $state('');
  if (player.live) {
    getVersion().then((v) => (version = v));
    win?.onFocusChanged(({ payload }) => (focused = payload));
  }
  const options = (e: MouseEvent) => optionsMenu(e, { version, quit: () => win?.close() });

  // Lautstärke-Hintergrund: 28 Stufen à 15 px untereinander
  const volFrame = $derived(Math.round((vol / 100) * 27));
  const volThumb = $derived(skin.current?.images.volume && skin.current.images.volume.height >= 433);
  const balThumb = $derived(skin.current?.images.balance && skin.current.images.balance.height >= 433);
  const vis = $derived(skin.current?.vis);
  const hex = (c: number) => `#${c.toString(16).padStart(6, '0')}`;
  const posX = $derived(dur ? Math.round((Math.min(pos, dur) / dur) * (248 - 29)) : 0);
</script>

{#snippet sprite(image: Parameters<typeof skin.bg>[0], x: number, y: number, left: number, top: number, w: number, h: number, extra = '')}
  <div class="spr" style="left:{left}px;top:{top}px;width:{w}px;height:{h}px;{skin.bg(image, x, y)}{extra}"></div>
{/snippet}

{#if layout.shade}
  <!-- svelte-ignore a11y_no_static_element_interactions -->
  <div class="main shade" oncontextmenu={options}>
    {@render sprite('titlebar', 27, focused ? 29 : 42, 0, 0, 275, 14)}
    <div class="drag" data-tauri-drag-region ondblclick={() => (layout.shade = false)}></div>
    <div class="stime"><SkinText text={player.mode ? `${digits.slice(0, 2)}:${digits.slice(2)}` : ''} chars={5} /></div>
    <button class="hot" style="left:6px;top:3px;width:9px;height:9px" title="Optionen" onclick={options}></button>
    <button class="hot" style="left:169px;top:2px;width:7px;height:10px" title="Zurück" onclick={() => player.prev()}></button>
    <button class="hot" style="left:176px;top:2px;width:10px;height:10px" title="Abspielen" onclick={() => player.play()}></button>
    <button class="hot" style="left:186px;top:2px;width:9px;height:10px" title="Pause" onclick={() => player.pause()}></button>
    <button class="hot" style="left:195px;top:2px;width:9px;height:10px" title="Stopp" onclick={() => player.stop()}></button>
    <button class="hot" style="left:204px;top:2px;width:7px;height:10px" title="Weiter" onclick={() => player.next()}></button>
    <button class="hot" style="left:212px;top:2px;width:9px;height:10px" title="Suchen" onclick={layout.openLibrary}></button>
    <button class="hot" style="left:244px;top:3px;width:9px;height:9px" title="Minimieren" onclick={() => win?.minimize()}></button>
    <button class="hot" style="left:254px;top:3px;width:9px;height:9px" title="Windowshade aus" onclick={() => (layout.shade = false)}></button>
    <button class="hot" style="left:264px;top:3px;width:9px;height:9px" title="Beenden" onclick={() => win?.close()}></button>
  </div>
{:else}
  <!-- svelte-ignore a11y_no_static_element_interactions -->
  <div class="main" oncontextmenu={options}>
    {@render sprite('main', 0, 0, 0, 0, 275, 116)}
    {@render sprite('titlebar', 27, focused ? 0 : 15, 0, 0, 275, 14)}
    <div class="drag" data-tauri-drag-region ondblclick={() => (layout.shade = true)}></div>

    <!-- Titelleiste -->
    <button class="hot" style="left:6px;top:3px;width:9px;height:9px" title="Optionen" onclick={options}></button>
    <button class="hot" style="left:244px;top:3px;width:9px;height:9px" title="Minimieren" onclick={() => win?.minimize()}></button>
    <button class="hot" style="left:254px;top:3px;width:9px;height:9px" title="Windowshade" onclick={() => (layout.shade = true)}></button>
    <button class="hot" style="left:264px;top:3px;width:9px;height:9px" title="Beenden" onclick={() => win?.close()}></button>

    <!-- Clutterbar O A I D V -->
    {@render sprite('titlebar', 304, 0, 10, 22, 8, 43)}
    <button class="hot" style="left:10px;top:25px;width:8px;height:8px" title="Optionen" onclick={options}></button>
    <button class="hot" style="left:10px;top:33px;width:8px;height:7px" class:lit={layout.onTop} title="Immer im Vordergrund" onclick={() => (layout.onTop = !layout.onTop)}></button>
    <button class="hot" style="left:10px;top:40px;width:8px;height:8px" class:lit={layout.lyrics} title="Liedtext (I)" onclick={() => (layout.lyrics = !layout.lyrics)}></button>
    <button class="hot" style="left:10px;top:48px;width:8px;height:7px" title="Größe {layout.scale}×" onclick={() => layout.resize()}></button>
    <button class="hot" style="left:10px;top:55px;width:8px;height:8px" title="Visualizer umschalten" onclick={() => player.cycleVis()}></button>

    <!-- Status, Zeit -->
    {#if skin.has('playpaus')}
      {@render sprite('playpaus', player.mode === 1 ? 0 : player.mode === 2 ? 9 : 18, 0, 26, 28, 9, 9)}
    {/if}
    {#if player.mode !== 0}
      <div class:blink={player.mode === 2}>
        {#each [48, 60, 78, 90] as x, i (x)}
          {@render sprite(numbers, +digits[i] * 9, 0, x, 26, 9, 13)}
        {/each}
      </div>
    {/if}
    <!-- Visualizer-Fläche: Hintergrund/Punkte aus VISCOLOR.TXT, Balken zeichnet AnyAmp nativ darüber -->
    <div class="visbg" style="--bg:{hex(vis?.[0] ?? 0)};--dot:{hex(vis?.[1] ?? 0x18181e)}"></div>
    <button class="hot" style="left:24px;top:43px;width:76px;height:16px" title="Visualizer umschalten" onclick={() => player.cycleVis()}></button>

    <!-- Titel, kbps, kHz, mono/stereo -->
    <div class="text" style="left:111px;top:27px"><SkinText text={shown} chars={31} /></div>
    <div class="text" style="left:111px;top:43px"><SkinText text={player.mode ? String(player.status?.kbps ?? '').padStart(3) : ''} chars={3} /></div>
    <div class="text" style="left:156px;top:43px"><SkinText text={player.mode ? String(player.status?.khz ?? '').padStart(2) : ''} chars={2} /></div>
    {#if skin.has('monoster')}
      {@render sprite('monoster', 29, 12, 212, 41, 27, 12)}
      {@render sprite('monoster', 0, player.mode ? 0 : 12, 239, 41, 29, 12)}
    {/if}

    <!-- Lautstärke, Balance -->
    {#if skin.has('volume')}
      {@render sprite('volume', 0, volFrame * 15, 107, 57, 68, 13)}
      {#if volThumb}{@render sprite('volume', 15, 422, 107 + Math.round((vol / 100) * 54), 58, 14, 11)}{/if}
    {/if}
    <input
      class="range"
      style="left:107px;top:57px;width:68px;height:13px"
      type="range"
      min="0"
      max="100"
      value={vol}
      title="Lautstärke: {vol}%"
      oninput={(e) => (dragVol = +e.currentTarget.value)}
      onchange={async (e) => {
        await player.volume(+e.currentTarget.value);
        dragVol = null;
      }}
    />
    {#if skin.has('balance')}
      {@render sprite('balance', 9, 0, 177, 57, 38, 13)}
      {#if balThumb}{@render sprite('balance', 15, 422, 189, 58, 14, 11)}{/if}
    {/if}

    <!-- EQ / PL -->
    {#if skin.has('shufrep')}
      {@render sprite('shufrep', 0, 61, 219, 58, 23, 12)}
      {@render sprite('shufrep', 23, layout.playlist ? 73 : 61, 242, 58, 23, 12)}
    {/if}
    <button class="hot" style="left:242px;top:58px;width:23px;height:12px" title="Playlist-Editor" onclick={() => (layout.playlist = !layout.playlist)}></button>

    <!-- Positionsbalken -->
    {#if skin.has('posbar')}
      {@render sprite('posbar', 0, 0, 16, 72, 248, 10)}
      {#if player.mode !== 0 && dur}{@render sprite('posbar', 248, 0, 16 + posX, 72, 29, 10)}{/if}
    {/if}
    <input
      class="range"
      style="left:16px;top:72px;width:248px;height:10px"
      type="range"
      min="0"
      max={dur || 1}
      value={pos}
      disabled={player.mode === 0 || !dur}
      title={formatTime(pos)}
      oninput={(e) => (dragPos = +e.currentTarget.value)}
      onchange={async (e) => {
        await player.seek(+e.currentTarget.value);
        setTimeout(() => (dragPos = null), 600);
      }}
    />

    <!-- Transport (gedrückt = untere Hälfte von CBUTTONS) -->
    {#each [['prev', 0, 16, 23, () => player.prev()], ['play', 23, 39, 23, () => player.play()], ['pause', 46, 62, 23, () => player.pause()], ['stop', 69, 85, 23, () => player.stop()], ['next', 92, 108, 22, () => player.next()]] as const as [name, sx, x, w, fn] (name)}
      <button class="cb" style="left:{x}px;top:88px;width:{w}px;height:18px;--n:url('{skin.current?.images.cbuttons?.url}');--x:-{sx}px" title={name} onclick={fn}></button>
    {/each}
    <button class="cb" style="left:136px;top:89px;width:22px;height:16px;--n:url('{skin.current?.images.cbuttons?.url}');--x:-114px;--dy:-16px" title="Suchen / hinzufügen (L)" onclick={layout.openLibrary}></button>

    <!-- Shuffle / Repeat -->
    {#if skin.has('shufrep')}
      {@render sprite('shufrep', 28, player.shuffle ? 30 : 0, 164, 89, 47, 15)}
      {@render sprite('shufrep', 0, player.repeat ? 30 : 0, 210, 89, 28, 15)}
    {/if}
    <button class="hot" style="left:164px;top:89px;width:47px;height:15px" title="Zufallswiedergabe (S)" onclick={() => player.toggleShuffle()}></button>
    <button class="hot" style="left:210px;top:89px;width:28px;height:15px" title="Wiederholen (R)" onclick={() => player.toggleRepeat()}></button>

    <!-- Like (AnyAmp-Zusatz, kein Winamp-Element) -->
    <button
      class="like"
      class:on={player.liked === 'LIKE'}
      disabled={!player.status?.videoId}
      title={player.liked === 'LIKE' ? 'Mag ich nicht mehr (F)' : 'Mag ich (F)'}
      onclick={() => player.toggleLike()}
    >♥</button>
  </div>
{/if}

<style>
  .main {
    position: relative;
    width: 275px;
    height: 116px;
    overflow: hidden;
    background: #000;
  }
  .shade {
    height: 14px;
  }
  .spr {
    position: absolute;
    image-rendering: pixelated;
    pointer-events: none;
  }
  .visbg {
    position: absolute;
    left: 24px;
    top: 43px;
    width: 76px;
    height: 16px;
    background: radial-gradient(circle at 1.5px 1.5px, var(--dot) 0.5px, transparent 0.6px) 0 0 / 2px 2px, var(--bg);
    image-rendering: pixelated;
  }
  .drag {
    position: absolute;
    left: 0;
    top: 0;
    width: 275px;
    height: 14px;
  }
  .hot {
    all: unset;
    position: absolute;
  }
  .hot.lit {
    box-shadow: inset 0 0 0 1px #3cff3c88;
  }
  .text,
  .stime {
    position: absolute;
    line-height: 0;
  }
  .stime {
    left: 127px;
    top: 4px;
  }
  .range {
    position: absolute;
    margin: 0;
    opacity: 0;
    -webkit-appearance: none;
    appearance: none;
  }
  .cb {
    all: unset;
    position: absolute;
    background: var(--n) var(--x) 0 no-repeat;
    image-rendering: pixelated;
  }
  .cb:active {
    background-position: var(--x) var(--dy, -18px);
  }
  .like {
    all: unset;
    position: absolute;
    left: 253px;
    top: 91px;
    width: 13px;
    height: 15px;
    text-align: center;
    font: 11px/15px Arial, sans-serif;
    color: #ffffff30;
    text-shadow: 1px 1px 0 #000;
  }
  .like.on {
    color: #ff3c5a;
  }
  .blink {
    animation: blink 1s steps(2) infinite;
  }
  @keyframes blink {
    50% {
      visibility: hidden;
    }
  }
</style>
