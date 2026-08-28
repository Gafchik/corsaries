<template>
  <div
    ref="base"
    class="joystick-base"
    :class="{ 'joystick-base--aim': variant === 'aim' }"
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

// 'move' drives WASD-equivalent movement (controls.setTouchVector — see
// getMoveVector); 'aim' drives the free-aim direction preview (
// controls.setAimVector — see getAimVector/updateAiming in WorldPage.vue).
// Same drag-a-knob-in-a-circle widget either way, just wired to a different
// vector so the two on-screen sticks don't fight over the same input.
const props = defineProps({ variant: { type: String, default: 'move' } })

const RADIUS = 42 // px the knob can travel from center before clamping

const base = ref(null)
const knobX = ref(0)
const knobY = ref(0)
let pointerId = null

function setVector(x, y) {
  if (props.variant === 'aim') controls.setAimVector(x, y)
  else controls.setTouchVector(x, y)
}

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
  setVector(dx / RADIUS, dy / RADIUS)
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
  setVector(0, 0)
}

// If WorldPage unmounts (navigating to a port, say) mid-drag, no pointerup
// ever reaches this component — without this the ship would keep sailing
// (or the aim cone would stay stuck showing) in whatever direction the
// thumb was last at when the page changed.
onBeforeUnmount(() => setVector(0, 0))

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
/* Gold tint on the aim stick — a weapon control, not movement, worth
   reading apart from the plain movement stick at a glance. */
.joystick-base--aim {
  border-color: rgba(217, 164, 65, 0.55);
}
.joystick-base--aim .joystick-knob {
  background: rgba(240, 201, 107, 0.4);
  border-color: rgba(240, 201, 107, 0.75);
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
