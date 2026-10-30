// LOTRO Freecam (lite) - free-flying camera + LIGHT camera-follow streaming.
//
// This is the minimal camera plus ONE light thing: the engine's land-streaming centre
// follows the CAMERA instead of staying frozen on your character. The streaming bubble
// keeps its NORMAL (native) size and quality - we do NOT widen the draw distance, touch
// grass/frill, or run the cinematic script's heavy provider/residency/cache machinery.
// So the world keeps rendering wherever you fly, at the normal render distance, with no
// FPS drop. Renderer/streaming and camera only: no player position, physics, packet or
// network writes. Your character does not move and nothing is sent to the server.
//
// How it works (same core the cinematic script uses, stripped to the light part):
//   - LoadWorldForPlayer (SmartBox+0x250) is pinned to 0 so the engine stops re-centring
//     the stream on the player each frame.
//   - Each land update we write the CAMERA's world position into the engine's cached
//     land origin, so the native-size streaming ring recentres on the camera.
//   - We NEVER change the far/near radius (streamObject+0x38/+0x3c) or the override
//     radius (SmartBox+0x243/+0x244). Render distance stays exactly native = light.
//
// Addresses are 5000.0071.3771.4007 (module size 0x22d6000), ported & prologue-checked.
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
      // light camera-follow streaming
      smartBoxGlobal: 0x1e6ad10,     // land-stream manager global
      smartBoxLandUpdate: 0x9774d0,  // runs each land update; we redirect its origin here
      cachedLandOrigin: 0x1a2d7a0    // engine's cached landscape origin (we force it to the camera)
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
  smartBoxLandUpdate: '48 8b c4 48 89 58 08 48 89 70 10'
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
const BLOCK_SIZE = 160.0;

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

// ---- light camera-follow streaming over the engine's SmartBox land manager ----
const smartBoxGlobal = base.add(RVA.smartBoxGlobal);
const smartBoxLandUpdate = base.add(RVA.smartBoxLandUpdate);
const cachedLandOrigin = base.add(RVA.cachedLandOrigin);

let smartBox = NULL;
let originalLoadWorldForPlayer = null;   // SmartBox+0x250 baseline
let cameraCenteredApplied = false;
let landOriginForceEnabled = false;
let landOriginBaseline = null;
let landOriginWriteCount = 0;

// the stream centre we steer; seeded from the player, then moved by camera deltas
const target = { x: 0, y: 0, z: 0, blockX: 0, blockY: 0, region: 0, valid: false };

function looksPtr(p) {
  try { return !p.isNull() && p.compare(ptr('0x10000')) > 0 && p.compare(ptr('0x7fffffffffff')) < 0; }
  catch (_) { return false; }
}
function resolveSmartBox() {
  try {
    const sb = smartBoxGlobal.readPointer();
    if (!looksPtr(sb)) { smartBox = NULL; return false; }
    smartBox = sb;
    return true;
  } catch (_) { smartBox = NULL; return false; }
}

// a land-position struct: fields (valid/block/region) then 3 world-coord floats.
// SmartBox+0x80 carries a vtable (hasVtable=true); the cached origin global does not.
function readLandPosition(address, hasVtable) {
  const fields = hasVtable ? address.add(8) : address;
  const coords = hasVtable ? address.add(0x18) : address.add(0x10);
  try {
    return {
      valid: fields.readU32(),
      blockX: fields.add(4).readU8(),
      blockY: fields.add(5).readU8(),
      region: fields.add(6).readU16(),
      x: coords.readFloat(),
      y: coords.add(4).readFloat(),
      z: coords.add(8).readFloat()
    };
  } catch (_) { return null; }
}
function writeCachedLandPosition(position) {
  cachedLandOrigin.add(4).writeU8(position.blockX);
  cachedLandOrigin.add(5).writeU8(position.blockY);
  cachedLandOrigin.add(6).writeU16(position.region);
  cachedLandOrigin.add(0x10).writeFloat(position.x);
  cachedLandOrigin.add(0x14).writeFloat(position.y);
  cachedLandOrigin.add(0x18).writeFloat(position.z);
}

function primeRenderTargetFromPlayer() {
  if (!resolveSmartBox()) return false;
  const position = readLandPosition(smartBox.add(0x80), true);
  if (position === null || ![position.x, position.y, position.z].every(Number.isFinite)) return false;
  target.x = position.x; target.y = position.y; target.z = position.z;
  target.blockX = position.blockX; target.blockY = position.blockY; target.region = position.region;
  target.valid = true;
  log('anchor region=' + target.region + ' block=' + target.blockX + ',' + target.blockY +
    ' local=' + target.x.toFixed(1) + ',' + target.y.toFixed(1) + ',' + target.z.toFixed(1));
  return true;
}
function normalizeRenderTarget() {
  while (target.x >= BLOCK_SIZE) { target.x -= BLOCK_SIZE; target.blockX = (target.blockX + 1) & 0xff; }
  while (target.x < 0)          { target.x += BLOCK_SIZE; target.blockX = (target.blockX - 1) & 0xff; }
  while (target.y >= BLOCK_SIZE) { target.y -= BLOCK_SIZE; target.blockY = (target.blockY + 1) & 0xff; }
  while (target.y < 0)          { target.y += BLOCK_SIZE; target.blockY = (target.blockY - 1) & 0xff; }
}
function syncRenderTargetToFlight(before, after) {
  if (!target.valid || before === null || after === null) return;
  const dx = after.x - before.x, dy = after.y - before.y, dz = after.z - before.z;
  if (![dx, dy, dz].every(Number.isFinite)) return;
  target.x += dx; target.y += dy; target.z += dz;
  normalizeRenderTarget();
}

function resolveFlightController(machine) {
  try {
    let state = machine.add(0x30).readPointer();
    if (state.isNull()) {
      const head = machine.add(0x10).readPointer();
      if (head.isNull()) return NULL;
      state = head.readPointer();
    }
    if (state.isNull()) return NULL;
    const c = state.add(0x70).readPointer();
    if (c.isNull() || !c.readPointer().equals(flightVtable)) return NULL;
    return c;
  } catch (_) { return NULL; }
}
function resolveFlightPositionPointer(c) {
  try {
    const cameraInterface = c.add(0x18);
    const vtable = cameraInterface.readPointer();
    const getterAddress = vtable.add(0x50).readPointer();
    if (!looksPtr(getterAddress)) return NULL;
    const getter = new NativeFunction(getterAddress, 'pointer', ['pointer']);
    const position = getter(cameraInterface);
    return looksPtr(position) ? position : NULL;
  } catch (_) { return NULL; }
}
function readFlightPosition() {
  if (flightPositionPointer.isNull()) return null;
  try {
    const p = { x: flightPositionPointer.readFloat(), y: flightPositionPointer.add(4).readFloat(), z: flightPositionPointer.add(8).readFloat() };
    return [p.x, p.y, p.z].every(Number.isFinite) ? p : null;
  } catch (_) { return null; }
}

// Pin SmartBox+0x250 (LoadWorldForPlayer) to 0 so the engine stops re-centring the
// stream on the player; our land-origin write then centres it on the camera.
function setCameraCentered(on) {
  if (!resolveSmartBox()) return;
  try {
    if (on) {
      if (originalLoadWorldForPlayer === null) originalLoadWorldForPlayer = smartBox.add(0x250).readU8();
      if (!cameraCenteredApplied || smartBox.add(0x250).readU8() !== 0) {
        smartBox.add(0x250).writeU8(0);
        cameraCenteredApplied = true;
      }
    } else if (originalLoadWorldForPlayer !== null) {
      smartBox.add(0x250).writeU8(originalLoadWorldForPlayer);
      cameraCenteredApplied = false;
    }
  } catch (_) {}
}
function enableLandOriginForce() {
  if (landOriginForceEnabled) return;
  landOriginBaseline = readLandPosition(cachedLandOrigin, false);
  landOriginForceEnabled = true;
  log('camera-follow ON - cached land origin follows the freecam (native render distance).');
}
function disableLandOriginForce() {
  if (!landOriginForceEnabled) return;
  landOriginForceEnabled = false;
  if (landOriginBaseline !== null) { try { writeCachedLandPosition(landOriginBaseline); } catch (_) {} }
  landOriginBaseline = null;
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

let machine = NULL, controller = NULL, flightPositionPointer = NULL, flightLastPosition = null;
let token = 0, active = false, f8WasDown = false;
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
  if (!controller.isNull()) flightPositionPointer = resolveFlightPositionPointer(controller);
  flightLastPosition = null;
  active = true;
  lastTickAt = Date.now();
  primeRenderTargetFromPlayer();
  setCameraCentered(true);               // stream centre follows the camera, native radius
  enableLandOriginForce();
  log('ON  token=' + token + '  speed=' + FLIGHT_SPEED + '  (Ctrl+F8 to stop)');
}
function disableFlight(reason) {
  if (!active) return;
  popCamera(machine, token, 0, 0);
  restoreCvars();
  disableLandOriginForce();
  setCameraCentered(false);
  controller = NULL; flightPositionPointer = NULL; flightLastPosition = null;
  target.valid = false; active = false; token = 0;
  log('OFF (' + reason + ')');
}

// the land update runs constantly; when flying, redirect its cached origin to the camera
Interceptor.attach(smartBoxLandUpdate, {
  onEnter: function (args) {
    if (!landOriginForceEnabled || !active || !target.valid || !args[1].isNull()) return;
    try { writeCachedLandPosition(target); landOriginWriteCount++; }
    catch (e) { log('land origin error ' + e); disableLandOriginForce(); }
  }
});
// the engine re-centres LoadWorldForPlayer; re-pin it a few times a second while flying
setInterval(function () { if (active) setCameraCentered(true); }, 400);

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
    if (controller.isNull()) {
      controller = resolveFlightController(machine);
      if (!controller.isNull()) flightPositionPointer = resolveFlightPositionPointer(controller);
    }
    if (controller.isNull() || flightPositionPointer.isNull()) return;
    if (!target.valid) primeRenderTargetFromPlayer();
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
    if (forward === 0 && strafe === 0 && vertical === 0) { return; }
    const before = flightLastPosition === null ? readFlightPosition() : flightLastPosition;
    if (forward !== 0) moveForward(controller, forward * dt);
    if (strafe !== 0) moveStrafe(controller, strafe * dt);
    if (vertical !== 0) moveVertical(controller, vertical * dt);
    const after = readFlightPosition();
    syncRenderTargetToFlight(before, after);
    if (after !== null) flightLastPosition = after;
  }
});

log('=== LOTRO FREECAM (lite - camera + light camera-follow streaming) ===');
log('build ' + build.name + '  (module size 0x' + mod.size.toString(16) + ')');
log('Ctrl+F8 start/stop | mouse look | LShift 4x | LCtrl precise');
log('Move  P fwd | ;/S back | L left | \'/I right | O up | [/G down');
log('Streaming centre follows the camera at NATIVE render distance. Character never moves.');

rpc.exports = {
  requestRestore: function () { stopRequested = true; cleanupComplete = false; return true; },
  isRestoreComplete: function () { return cleanupComplete && !active; },
  restore: function () {
    if (active) log('WARNING: still flying - call requestRestore() and wait for isRestoreComplete().');
    try { if (hook !== null) hook.detach(); } catch (_) {}
    hook = null;
    restoreCvars();
    disableLandOriginForce();
    setCameraCentered(false);
    log('restore complete (active=' + active + ')');
    return !active;
  },
  status: function () {
    let loadForPlayer = -1;
    if (resolveSmartBox()) { try { loadForPlayer = smartBox.add(0x250).readU8(); } catch (_) {} }
    return {
      build: build.name, active: active, cameraFollow: landOriginForceEnabled,
      loadWorldForPlayer: loadForPlayer, originWrites: landOriginWriteCount,
      target: target.valid ? (target.region + ':' + target.blockX + ',' + target.blockY) : 'none',
      speed: FLIGHT_SPEED
    };
  }
};
