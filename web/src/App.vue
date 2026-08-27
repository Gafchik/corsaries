<template>
  <router-view />
</template>

<script setup>
import { onMounted } from 'vue'

// Mobile WebKit (iOS Safari and Chrome-on-iOS, which shares the same
// engine) can get its visual viewport stuck zoomed in after an orientation
// change — reported as the whole page (DOM controls and the Phaser canvas
// alike) rendering oversized and blurry, sometimes surviving a reload since
// it's the browser's own zoom state, not page JS state. The meta viewport
// tag's maximum-scale/user-scalable directives (see web/index.html) don't
// reliably prevent this — WebKit is known to still let it happen. The
// standard mitigation is to force WebKit to re-read the viewport meta tag
// (it only reprocesses on an actual content-attribute change) whenever the
// visual viewport's scale drifts from 1.
function nudgeViewport() {
  const meta = document.querySelector('meta[name="viewport"]')
  if (!meta) return
  const base = meta.getAttribute('content').replace(/,\s*shrink-to-fit=no/, '')
  meta.setAttribute('content', `${base}, shrink-to-fit=no`)
  requestAnimationFrame(() => meta.setAttribute('content', base))
}

onMounted(() => {
  window.addEventListener('orientationchange', () => setTimeout(nudgeViewport, 50))
  window.visualViewport?.addEventListener('resize', () => {
    if (Math.abs(window.visualViewport.scale - 1) > 0.01) nudgeViewport()
  })
})
</script>
