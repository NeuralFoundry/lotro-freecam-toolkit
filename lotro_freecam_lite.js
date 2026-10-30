// LOTRO Freecam (lite) - free-flying camera + LIGHT terrain streaming.
//
// This is the minimal camera plus one thing: it widens the engine's own land-streaming
// radius so the world keeps rendering as you fly out, WITHOUT the cinematic script's
// heavy grass/frill/provider/cache machinery (which is what loads the client down).
// Renderer/streaming and camera only: no player position, physics, packet or network
// writes. Your character does not move and nothing is sent to the server.
//
// What it does and does NOT do:
//   - It enlarges the streaming bubble around YOUR CHARACTER (up to ~32 landblocks).
//     Fly the camera anywhere inside that bubble and terrain/static scenery render.
//   - It does NOT re-center streaming on the camera itself. Fly far beyond the bubble
//     and it still thins out - that true camera-following needs the full cinematic.
//   This is the old light behaviour: a big resident bubble, cheap on the client.
//
// Addresses are 5000.0071.3771.4007 (module size 0x22d6000), ported & prologue-checked.
// SmartBox field offsets (0x243/0x244, stream +0x20/+0x38/+0x3c) are the ones the
// working cinematic uses on this exact build.
'use strict';

const MODULE_NAME = 'lotroclient64.exe';

const BUILDS = [
  {
    size: 0x22d6000,
    name: '5000.0071.3771.4007',
    rva: {
      // camera (same 10 the minimal script uses, verified)
      cameraInputTick: 0x97d540,
      pushCamera: 0x97cd30,
      popCamera: 0x985bd0,
      makeFpsSlow: 0x9845b0,
      moveForward: 0x984c30,
      moveStrafe: 0x984db0,
      moveVertical: 0x984f30,
      flightVtable: 0x1584ae0,
      usePhysics: 0x1a2d80a,
      moveSpeedScale: 0x1a2d8bc,
      // light streaming
      smartBoxGlobal: 0x1e6ad10,   // land-stream manager global
      farRadiusApply: 0x9766c0,    // applies range changes (called on the main tick)
      mainThreadTick: 0x97b830     // per-frame tick (apply point)
    }
  }
];

// First bytes of each function; '??' marks a rip displacement or rel32 target.
const PROLOGUE = {
  cameraInputTick: '48 8b c4 55 53 56 57 41 54 41 56',
  pushCamera: '48 89 5c 24 08 57 48 81 ec b0 00 00 00',
  popCamera: '48 89 5c 24 10 48 89 6c 24 18',
  makeFpsSlow: '40 55 53 56 57 48 8b ec 48 83 ec 48',
  moveForward: '40 53 48 81 ec 80 00 00 00 f3 0f 10 05 ?? ?? ??',
  moveStrafe: '40 53 48 81 ec 80 00 00 00 f3 0f 10 05 ?? ?? ??',
  moveVertical: '40 53 48 81 ec 80 00 00 00 f3 0f 10 05 ?? ?? ??',
  farRadiusApply: '40 53 48 83 ec 20 48 8b 1d ?? ?? ?? ??',
  mainThreadTick: '48 8b c4 48 89 58 10 44 88 40 18'
};

const VK = {
  CONTROL: 0xa2, SHIFT: 0xa0, F8: 0x77,
  FORWARD: 0x50, BACKWARD: 0xba, STRAFE_LEFT: 0x4c, STRAFE_RIGHT: 0xde, UP: 0x4f, DOWN: 0xdb
};
const FLIGHT_SPEED = 5.0;
const MAX_FRAME_DELTA = 0.05;
const FAST_MULTIPLIER = 4.0;
const PRECISE_MULTIPLIER = 0.25;
const FOREGROUND_POLL_MS = 50;

// Streaming bubble radius in landblocks (160 units each). 32 is the engine's practical
// ceiling; past it the resident budget thrashes with no visible gain. setRadius() moves it.
let STREAM_RADIUS = 24;
const STREAM_RADIUS_MAX = 32;

const mod = Process.getModuleByName(MODULE_NAME);

function selectBuild(base, size) {
  const sized = BUILDS.filter(function (b) { return b.size === size; });
  if (sized.length === 0) return { build: null, scores: [] };
  const scores = sized.map(function (b) {
    let hit = 0, total = 0;
    const miss = [];
    Object.keys(PROLOGUE).forEach(function (name) {
      const rva = b.rva[name];
      if (rva === undefined || rva === null) return;
      total++;
      const want = PROLOGUE[name].split(' ');
      let bytes;
      try { bytes = new Uint8Array(base.add(rva).readByteArray(want.length)); }
      catch (e) { miss.push(name + '(unreadable)'); return; }
      for (let i = 0; i < want.length; i++) {
        if (want[i] === '??') continue;
        if (bytes[i] !== parseInt(want[i], 16)) {
          miss.push(name + ' got[' + Array.prototype.map.call(bytes, function (x) { return ('0' + x.toString(16)).slice(-2); }).join(' ') + ']');
          return;
        }
      }
      hit++;
    });
    return { build: b, hit: hit, total: total, miss: miss };
  });
  scores.sort(function (x, y) { return y.hit - x.hit; });
  const best = scores[0];
  if (best && best.total > 0 && best.hit === best.total) return { build: best.build, scores: scores };
  return { build: null, scores: scores };
}

const picked = selectBuild(mod.base, mod.size);
const build = picked.build;
if (build === null) {
  throw new Error(
    'Unsupported LOTRO build: module size 0x' + mod.size.toString(16) +
    (picked.scores.length
      ? '. Prologue match: ' + picked.scores.map(function (s) { return s.build.name + ' ' + s.hit + '/' + s.total; }).join(', ') +
        ' - mismatched: ' + ((picked.scores[0] && picked.scores[0].miss) || []).join(', ')
      : '. Known: ' + BUILDS.map(function (b) { return b.name + ' (0x' + b.size.toString(16) + ')'; }).join(', '))
  );
}

const base = mod.base;
const RVA = build.rva;
const NULL = ptr(0);

function log(m) { console.log('[freecam-lite] ' + m); }

const user32 = Process.getModuleByName('user32.dll');
const getAsyncKeyState = new NativeFunction(user32.getExportByName('GetAsyncKeyState'), 'int16', ['int']);
const getForegroundWindow = new NativeFunction(user32.getExportByName('GetForegroundWindow'), 'pointer', []);
const getWindowThreadProcessId = new NativeFunction(user32.getExportByName('GetWindowThreadProcessId'), 'uint32', ['pointer', 'pointer']);

const pushCamera = new NativeFunction(base.add(RVA.pushCamera), 'uint', ['pointer', 'uint', 'uint', 'float', 'float']);
const popCamera = new NativeFunction(base.add(RVA.popCamera), 'uint', ['pointer', 'uint', 'uint', 'uint']);
const makeFpsSlow = new NativeFunction(base.add(RVA.makeFpsSlow), 'uint', []);
const moveForward = new NativeFunction(base.add(RVA.moveForward), 'void', ['pointer', 'float']);
const moveStrafe = new NativeFunction(base.add(RVA.moveStrafe), 'void', ['pointer', 'float']);
const moveVertical = new NativeFunction(base.add(RVA.moveVertical), 'void', ['pointer', 'float']);
const usePhysics = base.add(RVA.usePhysics);
const moveSpeedScale = base.add(RVA.moveSpeedScale);
const flightVtable = base.add(RVA.flightVtable);
const originalUsePhysics = usePhysics.readU8();
const originalMoveSpeedScale = moveSpeedScale.readFloat();

// ---- light streaming over the engine's SmartBox land manager ----
const smartBoxGlobal = base.add(RVA.smartBoxGlobal);
const farRadiusApply = new NativeFunction(base.add(RVA.farRadiusApply), 'void', []);
let smartBox = NULL, streamObject = NULL, streamSaved = null, streamOn = false, applyPending = false;

function looksPtr(p) {
  try { return !p.isNull() && p.compare(ptr('0x10000')) > 0 && p.compare(ptr('0x7fffffffffff')) < 0; }
  catch (_) { return false; }
}
function resolveSmartBox() {
  try {
    const sb = smartBoxGlobal.readPointer();
    if (!looksPtr(sb)) return false;
    const root = sb.readPointer();
    const so = looksPtr(root) ? root.add(0x20).readPointer() : NULL;
    if (smartBox.isNull() || !sb.equals(smartBox)) {
      smartBox = sb;
      streamObject = looksPtr(so) ? so : NULL;
      if (streamSaved === null && !streamObject.isNull()) {
        streamSaved = {
          en: sb.add(0x243).readU8(), rad: sb.add(0x244).readU32(),
          far: streamObject.add(0x38).readU32(), near: streamObject.add(0x3c).readU32()
        };
      }
    }
    return true;
  } catch (_) { smartBox = NULL; streamObject = NULL; return false; }
}
// Matches the working light approach (cinematic_stream2): widen the override radius and
// the stream object's far radius; do NOT touch LoadWorldForPlayer (leaving it player-
// centred is what actually keeps the bubble filled). farRadiusApply() commits it.
function applyStream() {
  if (!resolveSmartBox()) return;
  try {
    smartBox.add(0x243).writeU8(1);
    smartBox.add(0x244).writeU32(STREAM_RADIUS);
    if (!streamObject.isNull()) streamObject.add(0x38).writeU32(STREAM_RADIUS);
    applyPending = true;
  } catch (_) {}
}
function enableStream() { streamOn = true; applyStream(); log('stream ON radius=' + STREAM_RADIUS + ' blocks (~' + (STREAM_RADIUS * 160) + 'u bubble around your character)'); }
function disableStream() {
  streamOn = false;
  if (resolveSmartBox() && streamSaved) {
    try {
      smartBox.add(0x243).writeU8(streamSaved.en);
      smartBox.add(0x244).writeU32(streamSaved.rad);
      if (!streamObject.isNull()) {
        streamObject.add(0x38).writeU32(streamSaved.far);
        streamObject.add(0x3c).writeU32(streamSaved.near);
      }
      applyPending = true;
    } catch (_) {}
  }
  log('stream OFF (original radius restored)');
}

const foregroundProcessId = Memory.alloc(4);
let foregroundCheckedAt = 0, lotroHasForeground = false;
function isLotroForeground() {
  const now = Date.now();
  if (now - foregroundCheckedAt < FOREGROUND_POLL_MS) return lotroHasForeground;
  foregroundCheckedAt = now;
  try {
    const w = getForegroundWindow();
    if (w.isNull()) { lotroHasForeground = false; return false; }
    foregroundProcessId.writeU32(0);
    getWindowThreadProcessId(w, foregroundProcessId);
    lotroHasForeground = foregroundProcessId.readU32() === Process.id;
  } catch (_) { lotroHasForeground = false; }
  return lotroHasForeground;
}
function down(vk) { if (!isLotroForeground()) return false; return (getAsyncKeyState(vk) & 0x8000) !== 0; }

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
  } catch (_) { return NULL; }
}

let machine = NULL, controller = NULL, token = 0, active = false, f8WasDown = false;
let lastTickAt = 0, stopRequested = false, cleanupComplete = false, cvarsModified = false, hook = null;

function restoreCvars() {
  if (!cvarsModified) return;
  usePhysics.writeU8(originalUsePhysics);
  moveSpeedScale.writeFloat(originalMoveSpeedScale);
  cvarsModified = false;
}
function enableFlight() {
  makeFpsSlow();
  usePhysics.writeU8(0);                 // collision off, or the camera stops at walls
  moveSpeedScale.writeFloat(FLIGHT_SPEED);
  cvarsModified = true;
  token = pushCamera(machine, 4, 0, 0.2, 0.2);
  controller = resolveFlightController(machine);
  active = true;
  lastTickAt = Date.now();
  enableStream();                        // widen the render bubble together with flight
  log('ON  token=' + token + '  speed=' + FLIGHT_SPEED + '  (Ctrl+F8 to stop)');
}
function disableFlight(reason) {
  if (!active) return;
  popCamera(machine, token, 0, 0);
  restoreCvars();
  disableStream();
  controller = NULL; active = false; token = 0;
  log('OFF (' + reason + ')');
}

// apply queued streaming changes on the engine's own tick (safe thread/timing)
Interceptor.attach(base.add(RVA.mainThreadTick), {
  onEnter: function () {
    if (!applyPending) return;
    applyPending = false;
    try { farRadiusApply(); } catch (e) { log('apply error ' + e); }
  }
});
// the engine resets the override; re-assert it a few times a second while on
setInterval(function () { if (streamOn) applyStream(); }, 400);

hook = Interceptor.attach(base.add(RVA.cameraInputTick), {
  onEnter(args) { this.machine = args[1]; },
  onLeave() {
    if (this.machine === undefined || this.machine.isNull()) return;
    machine = this.machine;
    if (stopRequested) { disableFlight('SHUTDOWN'); cleanupComplete = true; stopRequested = false; return; }
    const f8IsDown = down(VK.F8);
    if (f8IsDown && !f8WasDown && down(VK.CONTROL)) {
      if (active) disableFlight('CTRL+F8'); else enableFlight();
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
    const forward = (down(VK.FORWARD) ? 1 : 0) - (down(VK.BACKWARD) ? 1 : 0);
    const strafe = (down(VK.STRAFE_RIGHT) ? 1 : 0) - (down(VK.STRAFE_LEFT) ? 1 : 0);
    const vertical = (down(VK.UP) ? 1 : 0) - (down(VK.DOWN) ? 1 : 0);
    if (forward !== 0) moveForward(controller, forward * dt);
    if (strafe !== 0) moveStrafe(controller, strafe * dt);
    if (vertical !== 0) moveVertical(controller, vertical * dt);
  }
});

log('=== LOTRO FREECAM (lite - camera + light streaming) ===');
log('build ' + build.name + '  (module size 0x' + mod.size.toString(16) + ')');
log('Ctrl+F8 start/stop | mouse look | LShift 4x | LCtrl precise');
log('Move  P fwd | ;/S back | L left | \'/I right | O up | [/G down');
log('Streaming bubble ~' + STREAM_RADIUS + ' landblocks; rpc setRadius(3..' + STREAM_RADIUS_MAX + '). Character never moves.');

rpc.exports = {
  requestRestore: function () { stopRequested = true; cleanupComplete = false; return true; },
  isRestoreComplete: function () { return cleanupComplete && !active; },
  restore: function () {
    if (active) log('WARNING: still flying - call requestRestore() and wait for isRestoreComplete().');
    try { if (hook !== null) hook.detach(); } catch (_) {}
    hook = null;
    restoreCvars();
    disableStream();
    log('restore complete (active=' + active + ')');
    return !active;
  },
  setRadius: function (r) {
    r = Math.max(3, Math.min(STREAM_RADIUS_MAX, r | 0));
    STREAM_RADIUS = r;
    if (streamOn) applyStream();
    log('radius=' + STREAM_RADIUS + ' blocks (~' + (STREAM_RADIUS * 160) + 'u)');
    return STREAM_RADIUS;
  },
  status: function () {
    let far = -1, rad = -1;
    if (resolveSmartBox()) {
      try { far = streamObject.isNull() ? -1 : streamObject.add(0x38).readU32(); rad = smartBox.add(0x244).readU32(); } catch (_) {}
    }
    return {
      build: build.name, active: active, streamOn: streamOn,
      radius: STREAM_RADIUS, liveOverrideRadius: rad, liveStreamFar: far, speed: FLIGHT_SPEED
    };
  }
};
