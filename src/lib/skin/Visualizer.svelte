<script lang="ts">
  // Winamp-Spektrumanalyse: 19 Balken à 3 px + 1 px Abstand, 16 px hoch, mit fallenden Spitzen.
  import { onMount } from 'svelte';

  let { bars, scale = 1 }: { bars: number[]; scale?: number } = $props();

  // VISCOLOR.TXT-Stil: oben rot, unten grün
  const COLORS = [
    '#ef3110', '#ce2910', '#d65a00', '#d66600', '#d67300', '#c67b08', '#dea518', '#d6b521',
    '#bdde29', '#94de21', '#29ce10', '#32be10', '#39b510', '#319c08', '#299400', '#188408',
  ];
  const PEAK = '#969696';

  let canvas: HTMLCanvasElement;
  const peaks = Array(19).fill(0);
  const peakHold = Array(19).fill(0);

  onMount(() => {
    let raf = 0;
    const draw = () => {
      raf = requestAnimationFrame(draw);
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
      bars.forEach((v, i) => {
        const h = Math.max(0, Math.min(16, v));
        for (let y = 16 - h; y < 16; y++) {
          ctx.fillStyle = COLORS[y];
          ctx.fillRect(i * 4, y, 3, 1);
        }
        if (h >= peaks[i]) {
          peaks[i] = h;
          peakHold[i] = 12;
        } else if (peakHold[i] > 0) peakHold[i]--;
        else peaks[i] = Math.max(0, peaks[i] - 0.25);
        if (peaks[i] > 0) {
          ctx.fillStyle = PEAK;
          ctx.fillRect(i * 4, 16 - Math.ceil(peaks[i]), 3, 1);
        }
      });
    };
    draw();
    return () => cancelAnimationFrame(raf);
  });
</script>

<canvas bind:this={canvas} style="width:76px;height:16px;image-rendering:pixelated"></canvas>
