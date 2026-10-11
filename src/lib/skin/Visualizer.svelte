<script lang="ts">
  // Fläche des Winamp-Spektrums (76×16 Skin-Pixel). Hier nur das statische Punktraster –
  // Balken und Spitzen zeichnet AnyAmp nativ darüber (src-tauri/native/macos_vis.m).
  const GRID = `url("data:image/svg+xml,${encodeURIComponent(
    '<svg xmlns="http://www.w3.org/2000/svg" width="2" height="2"><rect x="1" y="1" width="1" height="1" fill="#18181e"/></svg>',
  )}")`;
</script>

<div class="vis" style:background-image={GRID}></div>

<style>
  .vis {
    width: 76px;
    height: 16px;
    background-size: 2px 2px;
    image-rendering: pixelated;
  }
</style>
