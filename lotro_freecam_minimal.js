// LOTRO Freecam (minimal) - a free-flying camera and nothing else.
//
// This is the camera half of the project on its own. It does not touch render distance,
// grass, terrain materials, textures or LOD, and it draws no overlay. If you want the
// view extended as well, use lotro_freecam_cinematic.js instead; if you only want to
// detach the camera and keep the game exactly as it renders normally, use this.
//
// How it works: the client already contains a FlightCameraController, used by the
// engine's own cinematics. Rather than simulating a camera, this pushes that controller
// onto the camera stack and drives it through the engine's three axis functions. So the
// camera behaves exactly like the engine's camera, because it is the engine's camera.
//
// Your character never moves. No position is written, nothing is sent to the server, and
// nothing is written to disk. Two camera cvars are changed while flying (collision off,
// move speed) and both are restored on detach.
//
// Supported builds (see BUILDS below). The script picks its address table from the
// module size, then re-checks the first bytes of every function it hooks or calls
// before installing anything. If either check fails it refuses to run rather than
// write to the wrong offsets.
//
//   4900.0070.8146.4007   module size 0x22bd000   <- current live client
//   4808.0070.7360.4034   module size 0x22b4000
'use strict';

const MODULE_NAME = 'lotroclient64.exe';

// Every address is an RVA into that exact binary. The 4900 column was derived from the
// 4808 one by masked-signature transfer (rip displacements and rel32 branch targets
// wildcarded) and then confirmed instruction-by-instruction over the full function body;
// data addresses were resolved through their referencing instructions and cross-checked
// across every xref site, all of which agreed.
const BUILDS = {
  0x22bd000: {
    name: '4900.0070.8146.4007',
    rva: {
      // Per-frame camera input tick. Hooked so movement is applied in step with the
      // engine's own camera update rather than from a timer.
      cameraInputTick: 0x976bf0,
      // Camera stack push/pop. push returns a token that pop must be given back.
      pushCamera: 0x9763e0,
      popCamera: 0x97f280,
      // Puts the camera into the free-look mode the flight controller expects.
      makeFpsSlow: 0x97dc60,
      // The engine's three movement axes. Each takes the controller and a signed delta.
      // They are byte-identical to each other apart from the direction vector each reads
      // (forward 0x156f060, strafe 0x156f050, vertical 0x156f070), which is what pins
      // this ordering down.
      moveForward: 0x97e2e0,
      moveStrafe: 0x97e460,
      moveVertical: 0x97e5e0,
      // Used to confirm a resolved pointer really is a FlightCameraController.
      flightVtable: 0x15701e0,
      // Camera cvars: collision/physics, and the movement speed multiplier.
      usePhysics: 0x1a157ea,
      moveSpeedScale: 0x1a1589c
    }
  },
  0x22b4000: {
    name: '4808.0070.7360.4034',
    rva: {
      cameraInputTick: 0x973b00,
      pushCamera: 0x9732f0,
      popCamera: 0x97c190,
      makeFpsSlow: 0x97ab70,
      moveForward: 0x97b1f0,
      moveStrafe: 0x97b370,
      moveVertical: 0x97b4f0,
      flightVtable: 0x1568d40,
      usePhysics: 0x1a0c7ea,
      moveSpeedScale: 0x1a0c89c
    }
  }
};

// First bytes of each function this script hooks or calls. '??' marks a byte that is a
// rip displacement or a rel32 branch target - those move with the build, the rest do not.
// These happen to be identical on both supported builds, so one table covers them.
//
// This is the safety net that matters: if a future patch shifts these functions, the
// address table silently points into the middle of something else, and attaching a hook
// or calling through it crashes the client. Checking the prologue first turns that into
// a refusal to start.
const PROLOGUE = {
  cameraInputTick: '48 8b c4 55 53 56 57 41 54 41 56',
  pushCamera: '48 89 5c 24 08 57 48 81 ec b0 00 00 00',
  popCamera: '48 89 5c 24 10 48 89 6c 24 18',
  makeFpsSlow: '40 55 53 56 57 48 8b ec 48 83 ec 48',
  moveForward: '40 53 48 81 ec 80 00 00 00 f3 0f 10 05 ?? ?? ??',
  moveStrafe: '40 53 48 81 ec 80 00 00 00 f3 0f 10 05 ?? ?? ??',
  moveVertical: '40 53 48 81 ec 80 00 00 00 f3 0f 10 05 ?? ?? ??'
};

// Movement is read as raw virtual-key codes, so the physical key depends on the
// keyboard layout. The OEM codes below land on different letters per layout:
//   VK_OEM_1 (0xba): ';' on US, 'S' on Turkish-Q
//   VK_OEM_7 (0xde): "'" on US, 'I' on Turkish-Q
//   VK_OEM_4 (0xdb): '[' on US, 'G' on Turkish-Q
// The set is the P/L/O cluster plus the three keys to their right, chosen so it does
// not collide with WASD.
const VK = {
  CONTROL: 0xa2,
  SHIFT: 0xa0,
  F8: 0x77,
  FORWARD: 0x50,        // P
  BACKWARD: 0xba,       // VK_OEM_1
  STRAFE_LEFT: 0x4c,    // L
  STRAFE_RIGHT: 0xde,   // VK_OEM_7
  UP: 0x4f,             // O
  DOWN: 0xdb            // VK_OEM_4
};

const FLIGHT_SPEED = 5.0;
// Clamp the per-frame delta. Without this, a long hitch (alt-tab, a streaming stall)
// produces one enormous dt and the camera teleports across the map on the next frame.
const MAX_FRAME_DELTA = 0.05;
const FAST_MULTIPLIER = 4.0;
const PRECISE_MULTIPLIER = 0.25;
const FOREGROUND_POLL_MS = 50;

const mod = Process.getModuleByName(MODULE_NAME);
const build = BUILDS[mod.size];
if (build === undefined) {
  throw new Error(
    'Unsupported LOTRO build: module size 0x' + mod.size.toString(16) +
    '. Known: ' + Object.keys(BUILDS).map(function (s) {
      return '0x' + Number(s).toString(16) + ' (' + BUILDS[s].name + ')';
    }).join(', ')
  );
}

const base = mod.base;
const RVA = build.rva;

// Compares the bytes actually in the process against PROLOGUE. Reads through Frida
// rather than off disk on purpose: this sees the real mapped image, including anything
// another tool has already patched in.
function verifyPrologue(name) {
  const expected = PROLOGUE[name];
  if (expected === undefined) return true;
  const parts = expected.split(' ');
  const actual = base.add(RVA[name]).readByteArray(parts.length);
  const bytes = new Uint8Array(actual);
  const seen = [];
  let ok = true;
  for (let i = 0; i < parts.length; i++) {
    seen.push(('0' + bytes[i].toString(16)).slice(-2));
    if (parts[i] === '??') continue;
    if (bytes[i] !== parseInt(parts[i], 16)) ok = false;
  }
  if (!ok) {
    console.log('[freecam] ' + name + ' @ +0x' + RVA[name].toString(16) +
      '\n           expected ' + expected +
      '\n           found    ' + seen.join(' '));
  }
  return ok;
}

const mismatched = Object.keys(PROLOGUE).filter(function (name) {
  return !verifyPrologue(name);
});
if (mismatched.length > 0) {
  throw new Error(
    'Refusing to install: ' + mismatched.length + ' function(s) do not match the ' +
    build.name + ' address table (' + mismatched.join(', ') + '). ' +
    'The client has changed since these offsets were derived - nothing was hooked ' +
    'and the game is untouched.'
  );
}

const flightVtable = base.add(RVA.flightVtable);
const usePhysics = base.add(RVA.usePhysics);
const moveSpeedScale = base.add(RVA.moveSpeedScale);
const originalUsePhysics = usePhysics.readU8();
const originalMoveSpeedScale = moveSpeedScale.readFloat();

const user32 = Process.getModuleByName('user32.dll');
const getAsyncKeyState = new NativeFunction(
  user32.getExportByName('GetAsyncKeyState'), 'int16', ['int']
);
const getForegroundWindow = new NativeFunction(
  user32.getExportByName('GetForegroundWindow'), 'pointer', []
);
const getWindowThreadProcessId = new NativeFunction(
  user32.getExportByName('GetWindowThreadProcessId'), 'uint32', ['pointer', 'pointer']
);
const pushCamera = new NativeFunction(
  base.add(RVA.pushCamera), 'uint',
  ['pointer', 'uint', 'uint', 'float', 'float']
);
const popCamera = new NativeFunction(
  base.add(RVA.popCamera), 'uint',
  ['pointer', 'uint', 'uint', 'uint']
);
const makeFpsSlow = new NativeFunction(base.add(RVA.makeFpsSlow), 'uint', []);
const moveForward = new NativeFunction(
  base.add(RVA.moveForward), 'void', ['pointer', 'float']
);
const moveStrafe = new NativeFunction(
  base.add(RVA.moveStrafe), 'void', ['pointer', 'float']
);
const moveVertical = new NativeFunction(
  base.add(RVA.moveVertical), 'void', ['pointer', 'float']
);

function log(message) {
  console.log('[freecam] ' + message);
}

const foregroundProcessId = Memory.alloc(4);
let foregroundCheckedAt = 0;
let lotroHasForeground = false;

// Without this check the hotkeys would fire while the game is in the background: typing
// in a browser would fly the camera and toggle it. Throttled because it runs from the
// per-frame camera tick and each call is two Win32 round-trips.
function isLotroForeground() {
  const now = Date.now();
  if (now - foregroundCheckedAt < FOREGROUND_POLL_MS) return lotroHasForeground;
  foregroundCheckedAt = now;
  try {
    const window = getForegroundWindow();
    if (window.isNull()) {
      lotroHasForeground = false;
      return false;
    }
    foregroundProcessId.writeU32(0);
    getWindowThreadProcessId(window, foregroundProcessId);
    lotroHasForeground = foregroundProcessId.readU32() === Process.id;
  } catch (_) {
    lotroHasForeground = false;
  }
  return lotroHasForeground;
}

function down(vk) {
  if (!isLotroForeground()) return false;
  return (getAsyncKeyState(vk) & 0x8000) !== 0;
}

// Walks the camera state machine to the active controller, then confirms the vtable
// matches FlightCameraController before returning it. The layout differs depending on
// how the machine was set up, hence the fallback through the list head at +0x10.
//
// These three offsets are the same on both supported builds - the camera manager tick
// still reads machine+0x30, machine+0x10 and state+0x70 in 4900.
function resolveFlightController(machine) {
  try {
    let state = machine.add(0x30).readPointer();
    if (state.isNull()) {
      const head = machine.add(0x10).readPointer();
      if (head.isNull()) return NULL;
      state = head.readPointer();
    }
    if (state.isNull()) return NULL;
    const controller = state.add(0x70).readPointer();
    if (controller.isNull() || !controller.readPointer().equals(flightVtable)) return NULL;
    return controller;
  } catch (_) {
    return NULL;
  }
}

let machine = NULL;
let controller = NULL;
let token = 0;
let active = false;
let f8WasDown = false;
let lastTickAt = 0;
let stopRequested = false;
let cleanupComplete = false;
let cvarsModified = false;
let hook = null;

function restoreCvars() {
  if (!cvarsModified) return;
  usePhysics.writeU8(originalUsePhysics);
  moveSpeedScale.writeFloat(originalMoveSpeedScale);
  cvarsModified = false;
}

function enableFlight() {
  makeFpsSlow();
  // Collision off, or the camera stops at the first wall or hillside.
  usePhysics.writeU8(0);
  moveSpeedScale.writeFloat(FLIGHT_SPEED);
  cvarsModified = true;
  token = pushCamera(machine, 4, 0, 0.2, 0.2);
  controller = resolveFlightController(machine);
  active = true;
  lastTickAt = Date.now();
  log('ON  token=' + token + '  speed=' + FLIGHT_SPEED +
    '  (Ctrl+F8 to stop, mouse to look)');
}

function disableFlight(reason) {
  if (!active) return;
  // Pop with the same token push handed out, or the camera stack is left unbalanced.
  popCamera(machine, token, 0, 0);
  restoreCvars();
  controller = NULL;
  active = false;
  token = 0;
  log('OFF (' + reason + ')');
}

// Everything happens inside the engine's own camera tick: it is the correct thread, and
// it gives movement the same cadence as the camera update it feeds.
hook = Interceptor.attach(base.add(RVA.cameraInputTick), {
  onEnter(args) {
    this.machine = args[1];
  },
  onLeave() {
    if (this.machine === undefined || this.machine.isNull()) return;
    machine = this.machine;

    // Shutdown is requested from the RPC thread but performed here, because popping the
    // camera stack from another thread while the engine is mid-update is not safe.
    if (stopRequested) {
      disableFlight('SHUTDOWN');
      cleanupComplete = true;
      stopRequested = false;
      return;
    }

    // Ctrl has to be held at the instant F8 goes down. Testing it on the edge rather
    // than every frame means holding F8 and then tapping Ctrl does not toggle. Ctrl is
    // required so the hotkey cannot collide with the player's own F8 binding.
    const f8IsDown = down(VK.F8);
    if (f8IsDown && !f8WasDown && down(VK.CONTROL)) {
      if (active) disableFlight('CTRL+F8');
      else enableFlight();
    }
    f8WasDown = f8IsDown;
    if (!active) return;

    if (controller.isNull()) controller = resolveFlightController(machine);
    if (controller.isNull()) return;

    const now = Date.now();
    let dt = (now - lastTickAt) / 1000.0;
    lastTickAt = now;
    if (dt <= 0) return;
    if (dt > MAX_FRAME_DELTA) dt = MAX_FRAME_DELTA;

    let multiplier = 1.0;
    if (down(VK.SHIFT)) multiplier = FAST_MULTIPLIER;
    else if (down(VK.CONTROL)) multiplier = PRECISE_MULTIPLIER;
    dt *= multiplier;

    // Movement keys are deliberately not behind Ctrl: Ctrl is the precision modifier,
    // and these are only meaningful while the camera is already flying.
    const forward = (down(VK.FORWARD) ? 1 : 0) - (down(VK.BACKWARD) ? 1 : 0);
    const strafe = (down(VK.STRAFE_RIGHT) ? 1 : 0) - (down(VK.STRAFE_LEFT) ? 1 : 0);
    const vertical = (down(VK.UP) ? 1 : 0) - (down(VK.DOWN) ? 1 : 0);
    if (forward !== 0) moveForward(controller, forward * dt);
    if (strafe !== 0) moveStrafe(controller, strafe * dt);
    if (vertical !== 0) moveVertical(controller, vertical * dt);
  }
});

log('=== LOTRO FREECAM (minimal - camera only, no render changes) ===');
log('build ' + build.name + '  (module size 0x' + mod.size.toString(16) + ')');
log('Ctrl+F8 start/stop | mouse look | LShift 4x faster | LCtrl precise');
log('Move (US layout)   P forward | ; back | L left | \' right | O up | [ down');
log('Move (Turkish-Q)   P forward | S back | L left | I right | O up | G down');
log('Your character does not move and nothing is sent to the server.');

rpc.exports = {
  // Queue shutdown for the camera tick, then poll isRestoreComplete().
  requestRestore: function () {
    stopRequested = true;
    cleanupComplete = false;
    return true;
  },
  isRestoreComplete: function () {
    return cleanupComplete && !active;
  },
  // Detach and put the cvars back. Call requestRestore() first and wait for it: if the
  // camera is still active here, the hook is gone before the tick could pop the stack.
  restore: function () {
    if (active) {
      log('WARNING: still flying - call requestRestore() and wait for isRestoreComplete().');
    }
    try { if (hook !== null) hook.detach(); } catch (_) {}
    hook = null;
    restoreCvars();
    log('restore complete (active=' + active + ')');
    return !active;
  },
  status: function () {
    return {
      build: build.name,
      moduleSize: '0x' + mod.size.toString(16),
      active: active,
      token: token,
      controller: controller.toString(),
      cvarsModified: cvarsModified,
      cleanupComplete: cleanupComplete,
      speed: FLIGHT_SPEED
    };
  }
};
