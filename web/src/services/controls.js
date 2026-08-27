// A small input-abstraction layer: game code asks "is moveUp down?" or
// "was action just pressed?" and never touches a raw key code or gamepad
// button index directly. That's what makes rebinding possible at all —
// WorldPage.vue doesn't care whether 'action' is bound to F, a gamepad
// button, or (after a rebind) something else entirely.

const STORAGE_KEY = 'corsaries_controls_v1'

export const MOVE_ACTIONS = ['moveUp', 'moveDown', 'moveLeft', 'moveRight']
export const PRESS_ACTIONS = ['fireLeft', 'fireRight', 'action', 'inventory', 'back']
export const ACTIONS = [...MOVE_ACTIONS, ...PRESS_ACTIONS]

export const ACTION_LABELS = {
  moveUp: 'Вперёд',
  moveDown: 'Назад (движение)',
  moveLeft: 'Влево',
  moveRight: 'Вправо',
  fireLeft: 'Огонь — левый борт',
  fireRight: 'Огонь — правый борт',
  action: 'Действие (порт / абордаж)',
  inventory: 'Инвентарь',
  back: 'Отмена / выйти',
}

// KeyboardEvent.code values — layout-independent (WASD stays WASD on an
// AZERTY keyboard too, unlike .key).
const DEFAULT_KEYBOARD = {
  moveUp: 'KeyW', moveDown: 'KeyS', moveLeft: 'KeyA', moveRight: 'KeyD',
  fireLeft: 'KeyQ', fireRight: 'KeyE', action: 'KeyF', inventory: 'KeyI', back: 'Escape',
}

// Movement isn't in here on purpose — a gamepad's left stick drives
// movement directly (see getMoveVector), the same way it does in every
// other game; only the discrete face/shoulder buttons are rebindable.
const DEFAULT_GAMEPAD = {
  fireLeft: 4, // LB / L1
  fireRight: 5, // RB / R1
  action: 0, // A / Cross
  inventory: 3, // Y / Triangle
  back: 1, // B / Circle
}

export const GAMEPAD_BUTTON_LABELS = {
  0: 'A / Cross', 1: 'B / Circle', 2: 'X / Square', 3: 'Y / Triangle',
  4: 'LB / L1', 5: 'RB / R1', 6: 'LT / L2', 7: 'RT / R2',
  8: 'Select', 9: 'Start', 10: 'L3', 11: 'R3',
  12: 'D-pad ↑', 13: 'D-pad ↓', 14: 'D-pad ←', 15: 'D-pad →',
}

// Tab-cycling on Port/Controls always means physical L1/R1 — deliberately
// NOT looked up through this.bindings.gamepad. It used to piggyback on
// whatever fireLeft/fireRight were bound to, which meant rebinding your
// fire controls (say, to L2/R2) silently dragged tab-navigation along with
// it — L1 stopped doing anything, and whatever fire got moved to started
// switching tabs instead. Same idea as useMenuNav's own d-pad polling:
// a menu-navigation shortcut, not a rebindable game action.
const FIXED_GAMEPAD_BUTTONS = { tabPrev: 4, tabNext: 5 }

const STICK_DEADZONE = 0.2

function loadBindings() {
  try {
    const raw = JSON.parse(localStorage.getItem(STORAGE_KEY) ?? '{}')
    return {
      keyboard: { ...DEFAULT_KEYBOARD, ...raw.keyboard },
      gamepad: { ...DEFAULT_GAMEPAD, ...raw.gamepad },
    }
  } catch {
    return { keyboard: { ...DEFAULT_KEYBOARD }, gamepad: { ...DEFAULT_GAMEPAD } }
  }
}

class Controls {
  constructor() {
    this.bindings = loadBindings()
    this.keysDown = new Set()
    this.pressCallbacks = new Map() // action -> Set<fn>
    this.gamepadPrevPressed = {} // action -> bool, for edge detection
    this.fixedGamepadPrevPressed = {} // same, for FIXED_GAMEPAD_BUTTONS
    this.capture = null // { deviceType, resolve } while a rebind is in progress
    this.captureArmed = false // true once whatever activated capture mode has been released — see captureNext
    this.touchVector = { x: 0, y: 0 } // set by the on-screen joystick, see setTouchVector
    this.touchHeld = new Set() // actions currently held via a touch button — see touchHoldStart

    window.addEventListener('keydown', this.handleKeydown)
    window.addEventListener('keyup', this.handleKeyup)

    // Self-driving now, not dependent on some page's own render loop
    // remembering to call update() — that's what left the gamepad dead on
    // the menu and the controls settings screen, since only WorldPage's
    // Phaser scene was ever calling it. One rAF loop for the whole app's
    // lifetime, started once here.
    this._loop = this._loop.bind(this)
    requestAnimationFrame(this._loop)
  }

  _loop() {
    this.update()
    requestAnimationFrame(this._loop)
  }

  handleKeydown = (e) => {
    if (this.capture?.deviceType === 'keyboard') {
      // Entering capture mode is itself usually a keypress (Действие on
      // whatever's currently bound to it, to "click" the rebind button) —
      // that key can still be physically held down, or mid-autorepeat,
      // right as capture starts. Without waiting for captureArmed (see
      // handleKeyup) that same activating key would immediately resolve
      // the capture with itself, before the player ever gets to press the
      // key they actually meant to bind.
      if (!this.captureArmed) return
      this.capture.resolve(e.code === 'Escape' ? null : e.code)
      this.capture = null
      e.preventDefault()
      return
    }

    // Browsers auto-repeat keydown while a key is held — without this guard
    // a single held press would fire the action every repeat tick instead
    // of once on the actual press.
    if (this.keysDown.has(e.code)) return
    this.keysDown.add(e.code)

    const action = Object.keys(this.bindings.keyboard).find((a) => this.bindings.keyboard[a] === e.code)
    if (action) this.emit(action)
  }

  handleKeyup = (e) => {
    this.keysDown.delete(e.code)
    // Arms keyboard capture once every key is genuinely released — see the
    // matching comment in handleKeydown for why this can't just accept the
    // very next keydown unconditionally.
    if (this.capture?.deviceType === 'keyboard' && this.keysDown.size === 0) {
      this.captureArmed = true
    }
  }

  emit(action) {
    // One broken/stale subscriber (e.g. a leftover callback from a
    // component that didn't clean up) must not stop the rest from
    // running — this is a Set of independent listeners, not a pipeline.
    for (const cb of this.pressCallbacks.get(action) ?? []) {
      try {
        cb()
      } catch (e) {
        console.error(`controls: '${action}' handler failed`, e)
      }
    }
  }

  /** Registers a callback for a discrete press (fire/action/inventory). Returns an unsubscribe function. */
  onPress(action, cb) {
    if (!this.pressCallbacks.has(action)) this.pressCallbacks.set(action, new Set())
    this.pressCallbacks.get(action).add(cb)
    return () => this.pressCallbacks.get(action)?.delete(cb)
  }

  isDown(action) {
    return this.keysDown.has(this.bindings.keyboard[action])
  }

  firstGamepad() {
    return navigator.getGamepads?.().find((g) => g) ?? null
  }

  getMoveVector() {
    let x = 0
    let y = 0
    if (this.isDown('moveLeft')) x -= 1
    if (this.isDown('moveRight')) x += 1
    if (this.isDown('moveUp')) y -= 1
    if (this.isDown('moveDown')) y += 1

    const pad = this.firstGamepad()
    if (pad) {
      const sx = pad.axes[0] ?? 0
      const sy = pad.axes[1] ?? 0
      if (Math.abs(sx) > STICK_DEADZONE) x += sx
      if (Math.abs(sy) > STICK_DEADZONE) y += sy
    }

    // Already normalized to [-1, 1] by the joystick component itself (see
    // TouchJoystick.vue) — no deadzone needed here, it clamps at its own radius.
    x += this.touchVector.x
    y += this.touchVector.y

    const len = Math.hypot(x, y)
    if (len > 1) {
      x /= len
      y /= len
    }
    return { x, y }
  }

  /** Fed by the on-screen joystick's drag position, both already in [-1, 1]. */
  setTouchVector(x, y) {
    this.touchVector.x = x
    this.touchVector.y = y
  }

  /** A touch button standing in for a discrete keypress/gamepad-button press — same emit() path, same listeners. */
  touchPress(action) {
    this.emit(action)
  }

  /**
   * Hold-state for a touch button, e.g. the broadside rings' aim-preview
   * (see WorldPage.vue) — a touch is a DOM pointer event on an element
   * outside the Phaser canvas, so it can't be polled the way a keyboard key
   * or gamepad button can (see isDown/WorldScene's own gamepad check);
   * this Set is the only record that it's currently held.
   */
  touchHoldStart(action) {
    this.touchHeld.add(action)
  }
  touchHoldEnd(action) {
    this.touchHeld.delete(action)
  }
  isTouchHeld(action) {
    return this.touchHeld.has(action)
  }

  /** Call once per frame (e.g. from the Phaser scene's update()) — gamepad buttons have no native press event, only polling. */
  update() {
    const pad = this.firstGamepad()
    if (!pad) return

    if (this.capture?.deviceType === 'gamepad') {
      // Same "must release before it counts" rule as keyboard capture (see
      // handleKeydown) — capture mode is entered by pressing whatever's
      // bound to Действие, and that button is still physically down on the
      // very next poll tick after this.capture gets set. Without waiting
      // for a clean release first, that same activating button would
      // immediately get captured as the new binding.
      if (!this.captureArmed) {
        if (!pad.buttons.some((b) => b.pressed)) this.captureArmed = true
        return
      }
      const idx = pad.buttons.findIndex((b) => b.pressed)
      if (idx !== -1) {
        this.capture.resolve(idx)
        this.capture = null
        this.captureArmed = false
      }
      return
    }

    for (const action of PRESS_ACTIONS) {
      const btnIndex = this.bindings.gamepad[action]
      const pressed = !!pad.buttons[btnIndex]?.pressed
      if (pressed && !this.gamepadPrevPressed[action]) this.emit(action)
      this.gamepadPrevPressed[action] = pressed
    }

    for (const [action, btnIndex] of Object.entries(FIXED_GAMEPAD_BUTTONS)) {
      const pressed = !!pad.buttons[btnIndex]?.pressed
      if (pressed && !this.fixedGamepadPrevPressed[action]) this.emit(action)
      this.fixedGamepadPrevPressed[action] = pressed
    }
  }

  getBindings() {
    return this.bindings
  }

  setBinding(deviceType, action, value) {
    this.bindings[deviceType][action] = value
    // The button that was just captured is very likely still physically
    // held (that's the whole reason captureArmed exists) — without this,
    // the next poll tick sees it go from "not tracked for this action" to
    // "pressed" and reads that as a fresh press, firing the action once
    // immediately as an unwanted side effect of the rebind itself.
    if (deviceType === 'gamepad') this.gamepadPrevPressed[action] = true
    this.persist()
  }

  resetBindings() {
    this.bindings = { keyboard: { ...DEFAULT_KEYBOARD }, gamepad: { ...DEFAULT_GAMEPAD } }
    this.persist()
  }

  persist() {
    // localStorage is just a fast, synchronous cache now — the account row
    // is the source of truth (see loadFromServer). Keeping both means the
    // very first paint after reload already has last-known bindings instead
    // of a flash of defaults while the request is in flight.
    localStorage.setItem(STORAGE_KEY, JSON.stringify(this.bindings))
    this.persistToServer()
  }

  // A dynamic import, not a static one — api.js has no reason to know about
  // controls.js, and a static import the other way would make the two
  // modules circular. Fire-and-forget: an unauthenticated request (e.g.
  // this somehow fired before login) just 401s and gets logged, the local
  // cache is already saved either way.
  async persistToServer() {
    try {
      const { api } = await import('./api')
      await api.saveControls(this.bindings)
    } catch (e) {
      console.error('controls: failed to save bindings to server', e)
    }
  }

  /**
   * Pulls this account's saved bindings from the server and applies them,
   * overriding whatever localStorage had cached. Call once auth is
   * established (see boot/auth.js and LoginPage.vue) — deliberately not
   * gated on hasRebindableInput() here: on a phone with no controller
   * there's simply nothing saved to apply, so it's a harmless no-op, and
   * gating it would just be re-deriving the same condition twice.
   */
  async loadFromServer() {
    try {
      const { api } = await import('./api')
      const { bindings } = await api.getControls()
      if (!bindings) return // nothing saved yet — keep the defaults/local cache
      this.bindings = {
        keyboard: { ...DEFAULT_KEYBOARD, ...bindings.keyboard },
        gamepad: { ...DEFAULT_GAMEPAD, ...bindings.gamepad },
      }
      localStorage.setItem(STORAGE_KEY, JSON.stringify(this.bindings))
    } catch (e) {
      console.error('controls: failed to load bindings from server', e)
    }
  }

  /** Resolves with the next captured KeyboardEvent.code (deviceType 'keyboard') or gamepad button index (deviceType 'gamepad'). Null if cancelled with Escape. */
  captureNext(deviceType) {
    this.capture = null
    // Only starts disarmed if something's actually already held right now
    // — that's the activating key/button (Действие on a gamepad, or
    // Enter/Space if a keyboard-only player triggered the rebind button),
    // which has to be released before a press counts, or it'd capture
    // itself. But rebinding is just as often started with a plain mouse
    // click, where NOTHING is held — disarming unconditionally there had
    // the opposite bug: the player's real first keypress got silently
    // eaten waiting for a "release" that already happened before capture
    // even began, and only their *second* press ever got captured.
    this.captureArmed = deviceType === 'gamepad'
      ? !this.firstGamepad()?.buttons.some((b) => b.pressed)
      : this.keysDown.size === 0
    return new Promise((resolve) => {
      this.capture = { deviceType, resolve }
    })
  }

  cancelCapture() {
    if (this.capture) {
      this.capture.resolve(null)
      this.capture = null
    }
    this.captureArmed = false
  }

  /** True while ControlsPage is waiting on a rebind — other input consumers (useMenuNav) should stand down so a capturing button press isn't also read as menu navigation. */
  isCapturing() {
    return this.capture !== null
  }
}

// One instance for the whole app — bindings and held-key state don't need
// to be per-component.
export const controls = new Controls()

/**
 * Keyboard/gamepad rebinding only makes sense where there's a keyboard or a
 * gamepad to bind — but a touch-primary device (a phone, or the Telegram
 * Mini App) isn't proof there's no gamepad: a Bluetooth controller paired
 * to a phone shows up in the Gamepad API from the browser too. So this
 * isn't "is this a desktop" so much as "is there something to rebind" —
 * true on anything with a real keyboard, or anywhere a gamepad is actually
 * detected right now, touch-primary or not.
 *
 * Caveat inherent to the Gamepad API itself, not fixable here: a gamepad
 * only becomes visible to the page after its first button press (privacy
 * measure), so a paired-but-untouched controller won't count yet — see
 * onGamepadChange for how callers can stay reactive to that.
 */
export function hasRebindableInput() {
  if (controls.firstGamepad()) return true
  return !isPhone()
}

/**
 * Touch-primary device, i.e. no physical keyboard to rebind — a coarse
 * pointer is the actual signal (not "mobile" by user agent), so this also
 * catches a tablet-in-browser and stays right if a phone-turned-desktop
 * mode ever changes the pointer type. Used to hide the keyboard tab on
 * ControlsPage when a phone has a Bluetooth gamepad paired (there IS
 * something to rebind then — see hasRebindableInput — just not a keyboard).
 */
export function isPhone() {
  return !!window.matchMedia?.('(pointer: coarse)').matches
}

/** Re-invokes `cb` whenever gamepad connection state might have changed, so a UI decision made from hasRebindableInput() can stay live. Returns a cleanup function. */
export function onGamepadChange(cb) {
  window.addEventListener('gamepadconnected', cb)
  window.addEventListener('gamepaddisconnected', cb)
  // 'gamepadconnected' isn't reliably fired in every browser — a light
  // poll catches what the event misses.
  const poll = setInterval(cb, 1000)
  return () => {
    window.removeEventListener('gamepadconnected', cb)
    window.removeEventListener('gamepaddisconnected', cb)
    clearInterval(poll)
  }
}
