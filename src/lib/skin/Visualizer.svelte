<script lang="ts">
  // Winamp-Spektrumanalyse: 19 Balken à 3 px + 1 px Abstand, 16 px hoch, mit fallenden Spitzen.
  // Abfall zeitbasiert (wie Winamps „Falloff“), damit es bei jeder Bildrate gleich wirkt.
  import { onMount } from 'svelte';

  let { bars, fps = 60, scale = 1 }: { bars: number[]; fps?: number; scale?: number } = $props();

  // VISCOLOR.TXT-Stil: oben rot, unten grün
  const COLORS = [
    '#ef3110', '#ce2910', '#d65a00', '#d66600', '#d67300', '#c67b08', '#dea518', '#d6b521',
    '#bdde29', '#94de21', '#29ce10', '#32be10', '#39b510', '#319c08', '#299400', '#188408',
  ];
  const PEAK = '#969696';
  const BAR_FALL = 40; // px/s
  const PEAK_HOLD = 0.4; // s
  const PEAK_FALL = 14; // px/s

  let canvas: HTMLCanvasElement;
  const level = Array(19).fill(0);
  const peaks = Array(19).fill(0);
  const hold = Array(19).fill(0);

  onMount(() => {
    let raf = 0;
    let last = 0;
    let lastDraw = 0;
    const draw = (now: number) => {
      raf = requestAnimationFrame(draw);
      // 30 FPS: nur jedes zweite Bild zeichnen (wie Winamps „Normal“-Refresh)
      if (fps && fps < 60 && now - lastDraw < 1000 / fps - 2) return;
      lastDraw = now;
      const dt = Math.min(0.1, last ? (now - last) / 1000 : 0);
      last = now;

      const ratio = Math.ceil(scale * devicePixelRatio);
      if (canvas.width !== 76 * ratio) {
        canvas.width = 76 * ratio;
        canvas.height = 16 * ratio;
      }
      const ctx = canvas.getContext('2d')!;
      ctx.setTransform(ratio, 0, 0, ratio, 0, 0);
      ctx.clearRect(0, 0, 76, 16);
      // Rasterpunkte im Hintergrund wie im Original
      ctx.fillStyle = '#18181e';
      for (let x = 1; x < 76; x += 2) for (let y = 1; y < 16; y += 2) ctx.fillRect(x, y, 1, 1);
      if (!fps) return;

      for (let i = 0; i < 19; i++) {
        const target = Math.max(0, Math.min(16, bars[i] ?? 0));
        // steigt sofort, fällt gleichmäßig
        level[i] = target >= level[i] ? target : Math.max(target, level[i] - BAR_FALL * dt);
        const h = Math.round(level[i]);
        for (let y = 16 - h; y < 16; y++) {
          ctx.fillStyle = COLORS[y];
          ctx.fillRect(i * 4, y, 3, 1);
        }
        if (level[i] >= peaks[i]) {
          peaks[i] = level[i];
          hold[i] = PEAK_HOLD;
        } else if (hold[i] > 0) hold[i] -= dt;
        else peaks[i] = Math.max(0, peaks[i] - PEAK_FALL * dt);
        if (peaks[i] >= 1) {
          ctx.fillStyle = PEAK;
          ctx.fillRect(i * 4, 16 - Math.ceil(peaks[i]), 3, 1);
        }
      }
    };
    raf = requestAnimationFrame(draw);
    return () => cancelAnimationFrame(raf);
  });
</script>

<canvas bind:this={canvas} style="width:76px;height:16px;image-rendering:pixelated"></canvas>
