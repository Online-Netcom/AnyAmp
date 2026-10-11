<script lang="ts">
  // Hauptfenster im Winamp-2-Layout (275×116 Skin-Pixel).
  import { getCurrentWindow } from '@tauri-apps/api/window';
  import { player, formatTime } from '$lib/player.svelte';
  import { ytm } from '$lib/ytm';
  import Icon from './Icon.svelte';
  import Marquee from './Marquee.svelte';
  import Visualizer from './Visualizer.svelte';

  let {
    scale,
    playlistOpen,
    onToggleScale,
    onTogglePlaylist,
    onOpenLibrary,
  }: {
    scale: number;
    playlistOpen: boolean;
    onToggleScale: () => void;
    onTogglePlaylist: () => void;
    onOpenLibrary: () => void;
  } = $props();

  // Während des Ziehens lokale Position anzeigen statt der vom Player gemeldeten.
  let dragPos = $state<number | null>(null);
  let dragVol = $state<number | null>(null);

  const pos = $derived(dragPos ?? player.time);
  const vol = $derived(dragVol ?? player.status?.volume ?? 100);
  const clock = $derived.by(() => {
    const t = Math.min(pos, 5999);
    return `${String(Math.floor(t / 60)).padStart(2, '0')}:${String(Math.floor(t % 60)).padStart(2, '0')}`;
  });

  const title = $derived.by(() => {
    const a = player.account;
    if (!a) return 'VERBINDE MIT YOUTUBE MUSIC ...';
    if (a.error) return a.error;
    if (!a.loggedIn) return 'BITTE BEI YOUTUBE MUSIC ANMELDEN';
    if (a.premium === false) return 'ANYAMP! BENOETIGT YOUTUBE PREMIUM';
    if (player.error) return player.error;
    const t = player.track;
    if (!t) return `ANYAMP! - ${a.name ?? 'YOUTUBE MUSIC PREMIUM'}`;
    return `${player.current + 1}. ${t.artists.join(', ')} - ${t.title} (${formatTime(player.duration)})`;
  });

  const win = player.live ? getCurrentWindow() : null;
</script>

<div class="main panel">
  <div class="titlebar" data-tauri-drag-region>
    <button class="btn wbtn" style="left:6px" title="Über AnyAmp!" aria-label="Über AnyAmp!">
      <span class="skin-text" style="font-size:7px">A</span>
    </button>
    <span class="label skin-text">AnyAmp!</span>
    <button class="btn wbtn" style="left:254px" title="Minimieren" onclick={() => win?.minimize()}>
      <Icon name="min" size={7} />
    </button>
    <button class="btn wbtn" style="left:264px" title="Beenden" onclick={() => win?.close()}>
      <Icon name="close" size={7} />
    </button>
  </div>

  <!-- Clutterbar -->
  <div class="clutter skin-text">
    <span>O</span><span>A</span><span>I</span>
    <button class="on" title="Größe {scale}× – klicken für nächste Stufe (⌘D, ⌘+ / ⌘−)" onclick={onToggleScale}>D</button>
    <span>V</span>
  </div>

  <!-- LCD: Status, Zeit, Visualizer -->
  <div class="lcd inset">
    <div class="state">
      {#if player.mode === 1}<Icon name="play" size={7} color="var(--led-on)" />
      {:else if player.mode === 2}<Icon name="pause" size={7} color="var(--lcd-text)" />
      {:else}<Icon name="stop" size={7} color="var(--lcd-text)" />{/if}
    </div>
    <div class="time">
      <span class="ghost">88:88</span>
      <span class:blink={player.mode === 2}>{player.mode === 0 ? '' : clock}</span>
    </div>
    <button
      class="vis"
      title="Visualizer: {player.visFps ? `${player.visFps} FPS` : 'aus'} – klicken zum Umschalten"
      onclick={() => player.cycleVis()}
    ><Visualizer /></button>
  </div>

  <!-- Titel-Laufschrift -->
  <div class="title inset" title={title}>
    <Marquee text={title} width={153} />
  </div>

  <!-- kbps / kHz / mono / stereo -->
  <div class="info skin-text">
    <span class="box inset" style="left:109px;width:17px">{player.mode ? (player.status?.kbps ?? '') : ''}</span>
    <span style="left:128px">KBPS</span>
    <span class="box inset" style="left:154px;width:12px">{player.mode ? (player.status?.khz ?? '') : ''}</span>
    <span style="left:168px">KHZ</span>
    <span style="left:208px" class="led">MONO</span>
    <span style="left:234px" class="led" class:on={player.mode !== 0}>STEREO</span>
  </div>

  <!-- Lautstärke / Balance -->
  <input
    class="slider volume"
    type="range"
    min="0"
    max="100"
    value={vol}
    title="Lautstärke: {vol}%"
    style="--v:{vol}%"
    oninput={(e) => (dragVol = +e.currentTarget.value)}
    onchange={async (e) => {
      await player.volume(+e.currentTarget.value);
      dragVol = null;
    }}
  />
  <input class="slider balance" type="range" min="-100" max="100" value="0" disabled title="Balance (folgt mit dem EQ)" />

  <button class="btn toggle skin-text" style="left:219px" disabled title="Equalizer (folgt)">EQ</button>
  <button class="btn toggle skin-text" class:lit={playlistOpen} style="left:242px" title="Playlist-Editor" onclick={onTogglePlaylist}>PL</button>

  <!-- Positionsbalken -->
  <input
    class="slider posbar"
    type="range"
    min="0"
    max={player.duration || 1}
    value={pos}
    disabled={player.mode === 0 || !player.duration}
    title={formatTime(pos)}
    oninput={(e) => (dragPos = +e.currentTarget.value)}
    onchange={async (e) => {
      await player.seek(+e.currentTarget.value);
      setTimeout(() => (dragPos = null), 600);
    }}
  />

  <!-- Transport -->
  <div class="transport">
    <button class="btn" style="left:16px" title="Zurück (Z)" onclick={() => player.prev()}><Icon name="prev" /></button>
    <button class="btn" style="left:39px" title="Abspielen (X)" onclick={() => player.play()}><Icon name="play" /></button>
    <button class="btn" style="left:62px" title="Pause (C)" onclick={() => player.pause()}><Icon name="pause" /></button>
    <button class="btn" style="left:85px" title="Stopp (V)" onclick={() => player.stop()}><Icon name="stop" /></button>
    <button class="btn" style="left:108px;width:22px" title="Weiter (B)" onclick={() => player.next()}><Icon name="next" /></button>
    <button class="btn eject" title="Suchen / hinzufügen (L)" onclick={onOpenLibrary}><Icon name="eject" /></button>
  </div>

  <button class="btn sw skin-text" style="left:164px;width:47px" title="Zufallswiedergabe (S)" onclick={() => player.toggleShuffle()}>
    <i class:on={player.shuffle}></i>SHUFFLE
  </button>
  <button class="btn sw skin-text" style="left:211px;width:28px" title="Wiederholen (R)" onclick={() => player.toggleRepeat()}>
    <i class:on={player.repeat}></i>REP
  </button>

  {#if player.account && !player.account.loggedIn}
    <button class="btn login skin-text" onclick={() => ytm.login()}>ANMELDEN</button>
  {:else}
    <div class="logo skin-text" title="AnyAmp!">A!</div>
  {/if}
</div>

<style>
  .main {
    position: relative;
    width: 275px;
    height: 116px;
    overflow: hidden;
  }

  .clutter {
    position: absolute;
    left: 10px;
    top: 22px;
    width: 8px;
    height: 43px;
    display: flex;
    flex-direction: column;
    justify-content: space-between;
    align-items: center;
    background: var(--frame-lo);
    color: #6a6a80;
    font-size: 6px;
    padding: 1px 0;
    box-sizing: border-box;
  }
  .clutter button {
    all: unset;
    color: inherit;
  }
  .clutter .on {
    color: var(--led-on);
  }

  .lcd {
    position: absolute;
    left: 22px;
    top: 22px;
    width: 82px;
    height: 41px;
  }
  .state {
    position: absolute;
    left: 4px;
    top: 6px;
  }
  .time {
    position: absolute;
    left: 15px;
    top: 4px;
    font-family: 'DSEG7 Classic', monospace;
    font-size: 11px;
    line-height: 13px;
    color: var(--lcd-text);
  }
  .time span {
    position: absolute;
    left: 0;
    top: 0;
    white-space: nowrap;
  }
  .time .ghost {
    color: var(--lcd-dim);
  }
  .blink {
    animation: blink 1s steps(2) infinite;
  }
  @keyframes blink {
    50% {
      visibility: hidden;
    }
  }
  .vis {
    all: unset;
    position: absolute;
    left: 3px;
    top: 21px;
    line-height: 0;
  }

  .title {
    position: absolute;
    left: 109px;
    top: 23px;
    width: 157px;
    height: 12px;
    padding: 3px 2px 0;
    box-sizing: border-box;
  }

  .info span {
    position: absolute;
    top: 42px;
    color: #9a9ab4;
    font-size: 6px;
  }
  .info .box {
    top: 40px;
    height: 9px;
    line-height: 9px;
    text-align: center;
    color: var(--lcd-text);
    font-size: 8px;
  }
  .led {
    color: var(--led-off) !important;
  }
  .led.on {
    color: var(--led-on) !important;
  }

  .volume {
    left: 107px;
    top: 57px;
    width: 68px;
    height: 13px;
  }
  .volume::-webkit-slider-runnable-track {
    background: linear-gradient(90deg, #1e8a1e, #c8c81e 60%, #d22a1e) 0 / var(--v) 100% no-repeat, #141420;
    box-shadow: inset 1px 1px 0 #000, inset -1px -1px 0 var(--frame-hi);
    margin: 3px 0;
    height: 7px;
  }
  .volume::-webkit-slider-thumb {
    width: 14px;
    height: 11px;
    margin-top: -2px;
  }
  .balance {
    left: 177px;
    top: 57px;
    width: 38px;
    height: 13px;
  }
  .balance::-webkit-slider-runnable-track {
    background: #141420;
    box-shadow: inset 1px 1px 0 #000, inset -1px -1px 0 var(--frame-hi);
    margin: 3px 0;
    height: 7px;
  }

  .toggle {
    top: 58px;
    width: 23px;
    height: 12px;
    font-size: 6px;
  }
  .toggle.lit {
    color: #0a7a0a;
  }

  .posbar {
    left: 16px;
    top: 72px;
    width: 248px;
    height: 10px;
  }
  .posbar::-webkit-slider-runnable-track {
    background: #10101a;
    box-shadow: inset 1px 1px 0 #000, inset -1px -1px 0 var(--frame-hi);
  }
  .posbar::-webkit-slider-thumb {
    width: 29px;
    height: 10px;
  }

  .transport .btn {
    top: 88px;
    width: 23px;
    height: 18px;
  }
  .transport .eject {
    left: 136px;
    top: 89px;
    width: 22px;
    height: 16px;
  }

  .sw {
    top: 89px;
    height: 15px;
    font-size: 6px;
    gap: 3px;
  }
  .sw i {
    width: 4px;
    height: 4px;
    background: var(--led-off);
    box-shadow: inset 0 0 0 1px #0006;
  }
  .sw i.on {
    background: var(--led-on);
  }

  .logo {
    position: absolute;
    left: 248px;
    top: 92px;
    width: 18px;
    height: 13px;
    line-height: 13px;
    text-align: center;
    color: #f0c020;
    font-weight: 700;
    font-size: 8px;
    text-shadow: 1px 1px 0 #000;
  }
  .login {
    left: 242px;
    top: 89px;
    width: 30px;
    height: 15px;
    font-size: 5px;
    background: linear-gradient(#ffd34d, #e0a000);
  }
</style>
