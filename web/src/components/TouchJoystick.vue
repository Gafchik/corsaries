<template>
  <div
    ref="base"
    class="joystick-base"
    @pointerdown="start"
    @pointermove="move"
    @pointerup="end"
    @pointercancel="end"
  >
    <div class="joystick-knob" :style="knobStyle"></div>
  </div>
</template>

<script setup>
import { ref, computed, onBeforeUnmount } from 'vue'
import { controls } from '@/services/controls'

const RADIUS = 42 // px the knob can travel from center before clamping

const base = ref(null)
const knobX = ref(0)
const knobY = ref(0)
let pointerId = null

function update(e) {
  const rect = base.value.getBoundingClientRect()
  let dx = e.clientX - (rect.left + rect.width / 2)
  let dy = e.clientY - (rect.top + rect.height / 2)
  const dist = Math.hypot(dx, dy)
  if (dist > RADIUS) {
    dx = (dx / dist) * RADIUS
    dy = (dy / dist) * RADIUS
  }
  knobX.value = dx
  knobY.value = dy
  controls.setTouchVector(dx / RADIUS, dy / RADIUS)
}

function start(e) {
  pointerId = e.pointerId
  // Capture failing shouldn't lose the touch — the knob should still track
  // to the initial press point (via update below), it just won't keep
  // receiving move events if the finger slides off the base's hit area.
  try {
    base.value.setPointerCapture(pointerId)
  } catch (err) {
    console.error('joystick: pointer capture failed', err)
  }
  update(e)
}

function move(e) {
  if (e.pointerId !== pointerId) return
  update(e)
}

function end(e) {
  if (e.pointerId !== pointerId) return
  pointerId = null
  knobX.value = 0
  knobY.value = 0
  controls.setTouchVector(0, 0)
}

// If WorldPage unmounts (navigating to a port, say) mid-drag, no pointerup
// ever reaches this component — without this the ship would keep sailing
// in whatever direction the thumb was last at when the page changed.
onBeforeUnmount(() => controls.setTouchVector(0, 0))

const knobStyle = computed(() => ({ transform: `translate(${knobX.value}px, ${knobY.value}px)` }))
</script>

<style scoped>
.joystick-base {
  position: relative;
  width: 116px;
  height: 116px;
  border-radius: 50%;
  background: rgba(255, 255, 255, 0.07);
  border: 2px solid rgba(255, 255, 255, 0.25);
  touch-action: none;
}
.joystick-knob {
  position: absolute;
  top: 50%;
  left: 50%;
  width: 50px;
  height: 50px;
  margin: -25px 0 0 -25px;
  border-radius: 50%;
  background: rgba(255, 255, 255, 0.35);
  border: 2px solid rgba(255, 255, 255, 0.65);
  pointer-events: none;
}
</style>
