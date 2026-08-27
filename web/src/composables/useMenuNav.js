// Keyboard/gamepad focus navigation for plain Vue UI screens (port, etc.) —
// the naval world has its own Phaser-side input handling, but a screen like
// PortModal is just DOM buttons, and neither a keyboard-only player nor a
// gamepad has any way to reach them without this. Reuses the same
// moveUp/moveDown/moveLeft/moveRight/action binds from services/controls.js:
// same physical keys as ship movement, different meaning in this context
// (menu, not sea).
import { onBeforeUnmount, nextTick, watch } from 'vue'
import { controls } from '@/services/controls'

const FOCUSABLE_SELECTOR = 'button:not(:disabled), input:not(:disabled), [tabindex]:not([tabindex="-1"])'
const STICK_THRESHOLD = 0.5
// Held-direction repeat, same shape as OS key-repeat: a pause before it
// starts, then a fast steady rate — not a single ±1 step for something you
// might need to nudge 40 times if a hold didn't repeat at all.
const REPEAT_DELAY_MS = 400
const REPEAT_INTERVAL_MS = 90

export function useMenuNav(containerRef, { watchSource } = {}) {
  let items = []
  let index = 0
  let stopped = false
  // action -> { since: firstHeldTimestamp, last: lastFiredTimestamp }
  const holdState = {}

  function refreshItems() {
    items = containerRef.value ? Array.from(containerRef.value.querySelectorAll(FOCUSABLE_SELECTOR)) : []
    // A disabled button drops out of this list (browsers won't focus one
    // anyway) — if focus is still sitting on something still in the list
    // (e.g. the quantity input itself, while a sibling Купить/Продать
    // button just flipped disabled), track it by its new position instead
    // of blindly reusing the old index, which could now point at a
    // completely different item after the list's composition shifted.
    const activeIdx = items.indexOf(document.activeElement)
    index = activeIdx !== -1 ? activeIdx : Math.min(index, Math.max(0, items.length - 1))
  }

  function focusCurrent() {
    items[index]?.focus()
  }

  function move(delta) {
    if (items.length === 0) return
    index = (index + delta + items.length) % items.length
    focusCurrent()
  }

  function activate() {
    const el = document.activeElement
    if (el && items.includes(el)) el.click()
    else focusCurrent()
  }

  // No keyboard on a controller — a number input (quantity picker) can't be
  // typed into, so left/right on the focused input steps it instead. Does
  // nothing when focus isn't on a number input, so it's safe to bind
  // unconditionally alongside up/down's focus movement.
  function adjustFocusedNumber(delta) {
    const el = document.activeElement
    if (!el || el.tagName !== 'INPUT' || el.type !== 'number') return
    const min = el.min !== '' ? Number(el.min) : -Infinity
    const max = el.max !== '' ? Number(el.max) : Infinity
    const next = Math.min(max, Math.max(min, (Number(el.value) || 0) + delta))
    if (next === Number(el.value)) return
    el.value = String(next)
    el.dispatchEvent(new Event('input', { bubbles: true }))
  }

  /** Runs `fn` once on the rising edge, then repeatedly while `held` stays true (after REPEAT_DELAY_MS, every REPEAT_INTERVAL_MS). */
  function pollHold(key, held, time, fn) {
    if (!held) {
      delete holdState[key]
      return
    }
    const state = holdState[key]
    if (!state) {
      holdState[key] = { since: time, last: time }
      fn()
      return
    }
    if (time - state.since >= REPEAT_DELAY_MS && time - state.last >= REPEAT_INTERVAL_MS) {
      state.last = time
      fn()
    }
  }

  function frameLoop(time) {
    if (stopped) return
    // ControlsPage's own rebind flow is waiting on the next raw press —
    // this loop reads gamepad buttons directly (not through
    // controls.onPress), so without this it'd fight over the same button
    // press, moving focus around while a rebind is trying to capture it.
    if (controls.isCapturing()) {
      requestAnimationFrame(frameLoop)
      return
    }

    const pad = controls.firstGamepad()
    const stickY = pad?.axes[1] ?? 0

    pollHold('up', controls.isDown('moveUp') || !!pad?.buttons[12]?.pressed || stickY < -STICK_THRESHOLD, time, () => move(-1))
    pollHold('down', controls.isDown('moveDown') || !!pad?.buttons[13]?.pressed || stickY > STICK_THRESHOLD, time, () => move(1))
    pollHold('left', controls.isDown('moveLeft') || !!pad?.buttons[14]?.pressed, time, () => adjustFocusedNumber(-1))
    pollHold('right', controls.isDown('moveRight') || !!pad?.buttons[15]?.pressed, time, () => adjustFocusedNumber(1))

    requestAnimationFrame(frameLoop)
  }

  let unsubAction

  nextTick(() => {
    refreshItems()
    focusCurrent()
  })
  unsubAction = controls.onPress('action', activate)
  requestAnimationFrame(frameLoop)

  onBeforeUnmount(() => {
    stopped = true
    unsubAction?.()
  })

  if (watchSource) {
    // Panel content swaps (e.g. switching tabs) change what's focusable —
    // re-scan and land on the first item so focus doesn't stay on
    // something now hidden.
    watch(watchSource, () => nextTick(() => {
      index = 0
      refreshItems()
      focusCurrent()
    }))
  }

  return { refreshItems }
}
