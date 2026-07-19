// LOTRO Freecam (cinematic) - a free-flying camera plus extended render distance.
//
// This is the full build. It drives the client's own FlightCameraController rather than
// simulating a camera, and then extends the landscape, grass, texture and streaming
// layers so distance still holds up once the camera leaves the player - which is where
// the engine's normal culling becomes obvious. It also draws an on-screen overlay
// showing which of those features are currently on.
//
// If you only want the camera and no render changes at all, use lotro_freecam_minimal.js
// instead. The camera behaviour is identical between the two; everything else here is
// the difference.
//
// The avatar never moves and nothing is sent to the server. Every change is made to
// process memory, captured before it is modified, and reverted on detach.
//
// Target build: 4808.0070.7360.4034 (lotroclient64.exe, module size 0x22b4000). Every
// address below is an RVA into that exact binary - see the size guard further down,
// which refuses to run rather than write to the wrong offsets.
'use strict';

const MODULE_NAME = 'lotroclient64.exe';
const EXPECTED_SIZE = 0x22b4000;
const POSITION_UPDATE_FUNCTION_RVA = 0x54dfa0;
const WORLD_CELL_PRIMARY_RVA = 0x566f10;
const WORLD_CELL_SECONDARY_RVA = 0x5670c0;
const WORLD_CELL_ENTER_RVA = 0x567300;
const FRILL_CENTER_UPDATE_RVA = 0x956470;
const FRILL_LOADER_UPDATE_RVA = 0x954310;
const FRILL_SECTOR_REFRESH_RVA = 0x9556a0;
const TERRAIN_TILE_REQUEST_RVA = 0x4ffcf0;
const RESOURCE_UNWRAP_RVA = 0x34b460;
const RESOURCE_KEY_TO_ID_RVA = 0x441100;
const RESOURCE_HANDLE_INIT_RVA = 0x5e7f50;
const POSITION_TO_RESOURCE_KEY_RVA = 0x89fe80;
const SERVICE_LOCATOR_GET_RVA = 0x1155fe0;
const SERVICE_LOCATOR_FIND_RVA = 0x1155f50;
const LAND_PROVIDER_SERVICE_IID_RVA = 0x155cfd0;
const LAND_PROVIDER_IID_RVA = 0x155cfc0;
const PROVIDER_REQUEST_RVA = 0x506a40;
const PROVIDER_COMPLETION_RVA = 0x4fe890;
const REQUEST_DESCRIPTOR_INIT_RVA = 0x58e010;
const REQUEST_DESCRIPTOR_DESTROY_RVA = 0x58e6b0;
const REQUEST_STAMP_THUNK_RVA = 0x749200;
const LAND_RESOURCE_BUILD_RVA = 0x995720;
const LAND_RESIDENCY_UPDATE_RVA = 0x995950;
const LAND_RESIDENCY_LIMIT_PATCH_RVA = 0x995a16;
const PLAYER_POSITION_COPY_RVA = 0x1a0c1f0;
const SMARTBOX_GLOBAL_RVA = 0x1e492c0;
const MAIN_THREAD_TICK_RVA = 0x971df0;
const SMARTBOX_LAND_UPDATE_RVA = 0x96da90;
const CACHED_LAND_ORIGIN_RVA = 0x1a0c780;
const FAR_RADIUS_APPLY_RVA = 0x96cc80;
const CONSOLE_STRING_CONSTRUCT_RVA = 0x3051a0;
const CONSOLE_DISPATCH_RVA = 0x3fcb60;
const GRAPHICS_RESOURCE_PURGE_BUDGET_RVA = 0x862910;
const ASYNC_CACHE_CONFIG_RESOLVE_RVA = 0x5e86f0;
const ASYNC_CACHE_REGISTRY_RVA = 0x19f5478;
const ASYNC_CACHE_VTABLE_RVA = 0x14de980;
const OBJECT_DISTANCE_FUNCTION_RVA = 0x8f7ab0;
const STATIC_PVS_FLAG_RVA = 0x1a0ac51;
const ALLOW_LODS_FLAG_RVA = 0x1a0ac52;
const MATERIAL_DETAIL_RVA = 0x1a08ffc;
const MODEL_DETAIL_RVA = 0x1a09000;
const OBJECT_DRAW_DISTANCE_RVA = 0x1a0900c;
const LANDSCAPE_DRAW_DISTANCE_RVA = 0x1a09010;
const DISTANT_IMPOSTERS_RVA = 0x1a09014;
const FRILL_DISTANCE_QUALITY_RVA = 0x1a09018;
const FRILL_DENSITY_RVA = 0x1a0901c;
const FRILL_TERRAIN_COLOR_RVA = 0x1a09020;
const LANDSCAPE_STATIC_OBJECT_SHADOWS_RVA = 0x1a09024;
const LANDSCAPE_LIGHTING_QUALITY_RVA = 0x1a09028;
const FAR_LANDSCAPE_NORMAL_MAPS_RVA = 0x1a0902c;
const FRILL_ENGINE_GLOBAL_RVA = 0x1e46470;
const FRILL_TIME_BUDGET_MULTIPLIER_RVA = 0x156c404;
const TEXTURE_FILTERING_RVA = 0x1a08fe4;
const ANISOTROPIC_QUALITY_RVA = 0x1a08fe8;
const TEXTURE_DETAIL_RVA = 0x1a08ff8;
const GRAPHICS_MEMORY_USAGE_RVA = 0x1a09094;
const TEXTURE_FILTER_DIRTY_RVA = 0x1e41164;
const MIP_BIAS_FUNCTION_RVA = 0x860ff0;
const NEAR_FAR_SEAM_BLEND_RVA = 0x1a09075;
const CAMERA_INPUT_TICK_RVA = 0x973b00;
const PUSH_CAMERA_RVA = 0x9732f0;
const POP_CAMERA_RVA = 0x97c190;
const MAKE_FPS_SLOW_RVA = 0x97ab70;
const FLIGHT_MOVE_FORWARD_RVA = 0x97b1f0;
const FLIGHT_MOVE_STRAFE_RVA = 0x97b370;
const FLIGHT_MOVE_VERTICAL_RVA = 0x97b4f0;
const FLIGHT_VTABLE_RVA = 0x1568d40;
const FLIGHT_USE_PHYSICS_RVA = 0x1a0c7ea;
const FLIGHT_MOVE_SPEED_RVA = 0x1a0c89c;

// Landscape topology uses 16 sectors per land block. The distant landscape and
// grass/frill systems have independent useful limits, so keep their radii separate.
// Three landscape bands: full-detail to 224 sectors (14 blocks), native medium
// to 384 sectors (24 blocks), then the engine's lowest distant representation.
// Grass and provider residency keep their own transient streaming ring.
//
// Practical ceiling: streamObject+0x38 stops producing visible terrain past roughly
// 16-20 landblocks. Raising it to 768 (48 blocks) changes nothing on screen and only
// causes streaming thrash, because the engine draws full-detail terrain within its own
// resident-landblock budget (Box+0xf0). The 8/7 keys still move this, but do not expect
// a visible gain beyond that range.
let FAR_RADIUS = 384;
const NEAR_RADIUS_CAP = 384;
const MEDIUM_LAND_BAND_SECTORS = 160;
// Default full-quality land radius. Key 8/7 changes this independently from
// grass and provider coverage; FAR_RADIUS follows with a medium-quality band.
let NEAR_RADIUS = 224;
const FAR_RADIUS_STEP = 32;   // 2 blocks per key press
const FAR_RADIUS_MAX = 768;
const OBJECT_DISTANCE_MULTIPLIER = 5.0;
// Master switch for the entire grass subsystem: residency anchors, the provider grid
// and the frill boost. With it off the script is camera plus terrain only, which is the
// quickest way to tell whether a ground or framerate problem comes from grass.
//
// Grass renders on its own system, independent of the terrain mesh. Since that mesh is
// capped near 16 blocks, dense far grass is what fills the medium/imposter zone beyond
// it. Radius is driven live by setrange() and setgrassrange(): 16 sectors per landblock,
// feeding both the grass draw radius (frillEngine+0x64) and the provider grid.
const GRASS_MACHINERY = true;
// Keep SmartBox world loading centered on the virtual camera target. The target
// preserves the player's original region id, so native FlightCamera movement cannot
// trigger world/region transitions while crossing cinematic map boundaries.
let CAMERA_CENTERED_STREAMING = true;      // feature 'camerastream'
// Grass draw distance in sectors, 16 per landblock. Grass renders on its own system and
// carries a scene far better than distant terrain does, so this ships deliberately long.
// It is also the most expensive setting in the script: the provider grid below has to
// cover the same ground, and that grid is (2R+1)^2 landblocks - 33x33 = 1089 at R16.
// setgrassrange(3-24) moves it live; 24 is the ceiling but rarely finishes streaming.
let FRILL_DISTANCE_SECTORS = 256;   // 16 blocks
const FRILL_DENSITY_MAX = 1.0;
const FRILL_EXTRA_PRECACHE_LEVELS = 0;
const FRILL_DEPTH_FADE_SECTORS = 8.0;
let FRILL_FULL_DENSITY_SECTORS = FRILL_DISTANCE_SECTORS;
// 0 = full density all the way out, 1 = thin the grass with distance. Thinning is
// cheaper and still reads as grass at range; feature 'grassfalloff' (Ctrl+G) flips it.
let FRILL_REDUCTION_ENABLED = 0;
// Native value 0.0005 gives the frill state machine 8 ms at a 16 ms frame.
// R12 can still create a loader burst on the main thread. A 2 ms slice
// preserves the final distance/density while spreading new grass over frames.
let FRILL_BUDGET_MS_AT_60FPS = 2.0;
const TEXTURE_FILTERING_MAX = 4;
const ANISOTROPIC_QUALITY_MAX = 16;
const TEXTURE_DETAIL_MAX = 4;
const GRAPHICS_MEMORY_USAGE_MAX = 2.0;
// Negative mip bias sharpens ground textures. This is a separate problem from the flat
// "painted" far terrain, which is a material-selection issue handled by the far-normal-map
// path (key N), not by mip bias.
const TEXTURE_MIP_BIAS = -2.5;
const HOTKEY_COOLDOWN_MS = 750;
let RESIDENCY_GROUP_RADIUS = 6;   // source groups covering a 16-block bubble.
const RESIDENCY_MAX_ANCHORS = 9;
const RESIDENCY_REQUEST_INTERVAL_MS = 150;
const RESIDENCY_REQUESTS_PER_PASS = 1;
let MAX_RETAINED_LAND_SOURCES = 97;
// Distance-based eviction, and the single most important framerate control.
//
// Every maintenance pass releases any retained grass source whose landblock sits farther
// than this many blocks from the camera, giving a bubble that moves with you and drops
// what falls behind. Without it grass accumulates behind a moving camera and the
// framerate collapses. Smaller is faster, larger holds more grass. Keys 5 and 4 tune it.
let GRASS_EVICT_RADIUS = 19;   // 16 visible blocks + one 3-block source-group margin.
const CACHE_FEATURE_ENABLED = false;   // Streaming only: no photo cache, native cache or purge path.
// Walks the DX11 resource table to total up video memory. Useful when investigating,
// but it is a scan on the render tick - off unless asked for. Feature 'vram'.
let VRAM_TELEMETRY_ENABLED = false;
let renderCacheEnabled = false;
const PHOTO_CACHE_MAX_SOURCES = 512;
const PHOTO_CACHE_MAX_SURFACES = 4096;
const MIB = 1024 * 1024;
const NATIVE_CACHE_RAM_TARGET_MIB = 7424;
const CACHE_TRIM_CHUNK_BYTES = 32 * 1024 * 1024;
const CACHE_TRIM_MAX_PASSES = 4;
let graphicsPurgePending = false;
let graphicsPurgeCount = 0;
let graphicsPurgeReason = 'none';
let graphicsPurgePass = 0;
let graphicsPurgePasses = 0;
let graphicsPurgeFullReset = false;
let grassEvictions = 0;
// The camera starts off deliberately: attaching should change nothing about how the
// game plays until you ask for it. Press F8 in game, or call flight(true).
const AUTO_ENABLE_FREECAM = false;
const LAND_RESOURCE_KEY_VTABLE_RVA = 0x14d8560;
let DIRECT_SOURCE_INTERVAL_MS = 70;    // Streaming cadence: fill quickly, then go idle.
let DIRECT_SOURCE_PER_PASS = 8;
let PROVIDER_SURFACE_RADIUS_BLOCKS = 16;   // must match the grass draw radius above
let PROVIDER_REQUEST_INTERVAL_MS = 70;
const PROVIDER_PENDING_TIMEOUT_MS = 5000;

// --- Streaming behaviour while the camera is moving --------------------------
// Two mechanisms keep the far-grass grid filling in flight rather than only once the
// camera has stopped.
//
// LOOKAHEAD pushes the preload centre ahead of the camera along its motion vector, so
// land sources begin loading before you arrive instead of after. Without it the async
// source loader can never catch up with a moving camera.
//
// PARTIAL_GATE fills the grid per block as each block's own source group becomes held,
// several per pass. The alternative is an all-or-nothing gate that waits for all nine
// centre anchors before requesting any surface at all, which in flight means the grid
// only ever fills at a standstill.
//
// All of these are tunable at runtime through rpc.exports:
//   setpartial(bool)           fill per block instead of all-or-nothing
//   setlookahead(sec, blocks)  how far ahead to preload
//   setrange(blocks)           overall distance; watch for eviction thrash when large
//   setload(6,120,3,100)       request budgets and intervals - lower is gentler
let LOOKAHEAD_ENABLED = true;     // Bounded pre-load ahead
let LOOKAHEAD_SECONDS = 2.0;
let MAX_LOOKAHEAD_BLOCKS = 8;
let PROVIDER_BUDGET_PER_PASS = 16;
let PARTIAL_GATE = true;          // Fill as soon as each source group becomes available
let STRICT_BLOCK_GATE = false;    // Off: hard per-block skipping leaves outer rings patchy.
const NATIVE_RENDER_PROXY_ENABLED = false;
// Keep the avatar/network state native. Only notify the three proven static-world
// land-cell listeners when the flight camera crosses into a different block.
let CAMERA_WORLD_CELL_STREAMING = true;    // feature 'worldcell'
const DEEP_DIAGNOSTIC_HOOKS = false;
// Keep the distance-LOD chain alive so distant tree imposters can promote to a
// medium 3D model when resident, or remain as 2D fallback when the model is not loaded.
// F9 still provides the old all-LOD0 mode as a diagnostic toggle.
let HYBRID_DISTANT_TREE_LODS = false;      // feature 'treelod'
const AUTO_ENABLE_LOD0 = false;
// Extending the object multiplier beyond Ultra moves the 3D/2D transition past
// mesh residency. The engine then drops the 2D fallback before a 3D object is
// available, which leaves unvisited distant land visibly bare.
const AUTO_ENABLE_OBJECT_BOOST = false;
let ALWAYS_FULL_RENDER = true;   // feature 'fullrender': stream even when not flying
let verboseDiagnostics = false;
const BOOST_REASSERT_INTERVAL_MS = 1000;
const PRELOAD_DISPATCH_INTERVAL_MS = 50;

const BLOCK_SIZE = 160.0;
const MATCH_TOLERANCE = 3.0;
const RENDER_POSITION_COPIES = [0x98, 0xd0];
const OBJECT_STREAM_PRELOAD_MARGIN = 48.0;
const OBJECT_STREAM_RELEASE_MARGIN = 72.0;
const OBJECT_STREAM_MIN_PRELOAD_SPEED = 1.0;
const OBJECT_STREAM_DISPATCH_COOLDOWN_MS = 250;
const NATIVE_FLIGHT_SPEED = 5.0;
const MAX_FLIGHT_DT = 0.05;

const VK_SHIFT = 0xa0;
const VK_CONTROL = 0xa2;
const VK_F5 = 0x74;
const VK_F4 = 0x73;
const VK_F6 = 0x75;
const VK_F7 = 0x76;
const VK_F8 = 0x77;
const VK_F9 = 0x78;
const VK_F10 = 0x79;
const VK_F11 = 0x7a;
const VK_F12 = 0x7b;
const VK_N = 0x4e;   // far normal maps: detailed relief vs flat painted terrain
const VK_7 = 0x37;   // FAR_RADIUS down
const VK_8 = 0x38;   // FAR_RADIUS up (push render distance)
const VK_4 = 0x34;   // GRASS_EVICT_RADIUS down (tighter grass bubble, better FPS)
const VK_5 = 0x35;   // GRASS_EVICT_RADIUS up (wider grass bubble)
const VK_6 = 0x36;   // toggle object/tree 3D-distance boost (off if ghost trees appear)
const VK_K = 0x4b;   // reserved; photo/native cache feature is compiled out
const VK_P = 0x50;
const VK_SEMICOLON = 0xba;
const VK_APOSTROPHE = 0xde;
const VK_L = 0x4c;
const VK_O = 0x4f;
const VK_LEFT_BRACKET = 0xdb;
const VK_G = 0x47;    // thin grass with distance
const VK_F1 = 0x70;   // object / decoration draw distance
const VK_F3 = 0x72;   // oyun ici HUD ac/kapa
const VK_F2 = 0x71;   // HUD: compact / full view

const mod = Process.getModuleByName(MODULE_NAME);
if (mod.size !== EXPECTED_SIZE) {
  throw new Error(
    'Unsupported LOTRO build: 0x' + mod.size.toString(16) +
    ', expected 0x' + EXPECTED_SIZE.toString(16)
  );
}

const base = mod.base;
const positionUpdateFunction = base.add(POSITION_UPDATE_FUNCTION_RVA);
const frillCenterUpdate = base.add(FRILL_CENTER_UPDATE_RVA);
const frillLoaderUpdate = base.add(FRILL_LOADER_UPDATE_RVA);
const frillSectorRefresh = base.add(FRILL_SECTOR_REFRESH_RVA);
const terrainTileRequest = base.add(TERRAIN_TILE_REQUEST_RVA);
const resourceUnwrap = base.add(RESOURCE_UNWRAP_RVA);
const resourceKeyToId = new NativeFunction(
  base.add(RESOURCE_KEY_TO_ID_RVA),
  'uint8',
  ['int32', 'pointer', 'pointer']
);
const resourceHandleInit = new NativeFunction(
  base.add(RESOURCE_HANDLE_INIT_RVA),
  'pointer',
  ['pointer', 'int32', 'int32']
);
const positionToResourceKey = new NativeFunction(
  base.add(POSITION_TO_RESOURCE_KEY_RVA),
  'uint8',
  ['pointer', 'pointer', 'pointer', 'pointer']
);
const resourceUnwrapCall = new NativeFunction(
  resourceUnwrap,
  'pointer',
  ['pointer']
);
const serviceLocatorGet = new NativeFunction(
  base.add(SERVICE_LOCATOR_GET_RVA),
  'pointer',
  []
);
const serviceLocatorFind = new NativeFunction(
  base.add(SERVICE_LOCATOR_FIND_RVA),
  'pointer',
  ['pointer', 'pointer', 'pointer', 'pointer']
);
const providerSurfaceRequest = new NativeFunction(
  base.add(PROVIDER_REQUEST_RVA),
  'int32',
  ['pointer', 'pointer', 'pointer', 'pointer']
);
const requestDescriptorInit = new NativeFunction(
  base.add(REQUEST_DESCRIPTOR_INIT_RVA),
  'pointer',
  ['pointer', 'pointer']
);
const requestDescriptorDestroy = new NativeFunction(
  base.add(REQUEST_DESCRIPTOR_DESTROY_RVA),
  'void',
  ['pointer']
);
const requestStamp = new NativeFunction(
  base.add(REQUEST_STAMP_THUNK_RVA),
  'uint32',
  []
);
const landResourceBuild = base.add(LAND_RESOURCE_BUILD_RVA);
const landResidencyLimitPatch = base.add(LAND_RESIDENCY_LIMIT_PATCH_RVA);
const playerPositionCopy = base.add(PLAYER_POSITION_COPY_RVA);
const smartBoxGlobal = base.add(SMARTBOX_GLOBAL_RVA);
const mainThreadTick = base.add(MAIN_THREAD_TICK_RVA);
const smartBoxLandUpdate = base.add(SMARTBOX_LAND_UPDATE_RVA);
const cachedLandOrigin = base.add(CACHED_LAND_ORIGIN_RVA);
const farRadiusApply = new NativeFunction(base.add(FAR_RADIUS_APPLY_RVA), 'void', []);
const consoleStringConstruct = new NativeFunction(
  base.add(CONSOLE_STRING_CONSTRUCT_RVA),
  'pointer',
  ['pointer', 'pointer']
);
const consoleDispatch = new NativeFunction(
  base.add(CONSOLE_DISPATCH_RVA),
  'void',
  ['pointer']
);
const graphicsResourcePurgeBudget = new NativeFunction(
  base.add(GRAPHICS_RESOURCE_PURGE_BUDGET_RVA),
  'bool',
  ['uint64']
);
const landResidencyUpdate = new NativeFunction(
  base.add(LAND_RESIDENCY_UPDATE_RVA),
  'void',
  ['pointer', 'pointer']
);
const objectDistanceFunction = base.add(OBJECT_DISTANCE_FUNCTION_RVA);
const staticPvsFlag = base.add(STATIC_PVS_FLAG_RVA);
const allowLodsFlag = base.add(ALLOW_LODS_FLAG_RVA);
const distantImposters = base.add(DISTANT_IMPOSTERS_RVA);
const frillDistanceQuality = base.add(FRILL_DISTANCE_QUALITY_RVA);
const frillDensity = base.add(FRILL_DENSITY_RVA);
const frillEngineGlobal = base.add(FRILL_ENGINE_GLOBAL_RVA);
const frillTimeBudgetMultiplier = base.add(FRILL_TIME_BUDGET_MULTIPLIER_RVA);
const textureFiltering = base.add(TEXTURE_FILTERING_RVA);
const anisotropicQuality = base.add(ANISOTROPIC_QUALITY_RVA);
const textureDetail = base.add(TEXTURE_DETAIL_RVA);
const graphicsMemoryUsage = base.add(GRAPHICS_MEMORY_USAGE_RVA);
const textureFilterDirty = base.add(TEXTURE_FILTER_DIRTY_RVA);
const mipBiasFunction = base.add(MIP_BIAS_FUNCTION_RVA);
const flightVtable = base.add(FLIGHT_VTABLE_RVA);
const flightUsePhysics = base.add(FLIGHT_USE_PHYSICS_RVA);
const flightMoveSpeed = base.add(FLIGHT_MOVE_SPEED_RVA);
const originalFlightUsePhysics = flightUsePhysics.readU8();
const originalFlightMoveSpeed = flightMoveSpeed.readFloat();
const originalFrillTimeBudgetMultiplier = frillTimeBudgetMultiplier.readFloat();

// ============ VRAM TELEMETRY (read-only; corpus + disasm verified) ============
// The legacy D3D9 backend reports memory through a 32-bit UINT; the active DX11
// backend lives in D3D11GraphicsCore.dll and owns physical residency. Do not write
// a fake value into the inactive D3D9 device. Graphics.MemoryUsage=2.0 is the real
// common engine maximum. The 7.25 GiB photo budget below is native asset RAM; DX11
// may still evict and re-upload remote copies. Telemetry never auto-purges.
const RENDER_DEVICE_PTR_RVA = 0x1e46ce0;
const RENDER_DEVICE_TOTAL_VRAM_OFF = 0x2208;
const VRAM_MB_SCALE_RVA = 0x15509e8;
const GFX_RESOURCE_LIST_RVA = 0x1e41430;
const GFX_RESOURCE_COUNT_RVA = 0x1e4143c;
const VRAM_RES_REMOTE_STATE_OFF = 0x08;
const VRAM_RES_REMOTE_BYTES_OFF = 0x20;
const VRAM_RES_SYSTEM_BYTES_OFF = 0x24;
const VRAM_SCAN_CAP = 262144;
const VRAM_SCAN_CHUNK = 2048;
const VRAM_TELEMETRY_INTERVAL_MS = 10000;
const VRAM_SAFE_REMOTE_CEILING_MB = 8192;
let vramMbScale = 0;
try { vramMbScale = base.add(VRAM_MB_SCALE_RVA).readFloat(); } catch (_) {}
if (!(vramMbScale > 0) || !isFinite(vramMbScale)) vramMbScale = 1 / MIB;
let vramPeakBytes = 0;
let vramTelemetryPending = false;
let vramScanState = null;
let lastVram = {
  totalMB: -1,
  usedMB: -1,
  usedBytes: 0,
  remoteMB: -1,
  remoteBytes: 0,
  systemMB: -1,
  systemBytes: 0,
  peakMB: 0,
  count: -1,
  scanned: 0,
  truncated: false,
  budgetMB: VRAM_SAFE_REMOTE_CEILING_MB,
  at: 0
};

function newVramSample() {
  const out = {
    totalMB: -1,
    usedMB: -1,
    usedBytes: 0,
    remoteMB: -1,
    remoteBytes: 0,
    systemMB: -1,
    systemBytes: 0,
    peakMB: 0,
    count: -1,
    scanned: 0,
    truncated: false,
    budgetMB: VRAM_SAFE_REMOTE_CEILING_MB,
    at: Date.now()
  };
  return out;
}

function finishVramTelemetrySample(state) {
  const out = state.out;
  out.remoteBytes = state.remoteBytes;
  out.remoteMB = state.remoteBytes * vramMbScale;
  out.usedBytes = state.remoteBytes;
  out.usedMB = out.remoteMB;
  out.systemBytes = state.systemBytes;
  out.systemMB = state.systemBytes * vramMbScale;
  out.scanned = state.scanned;
  if (state.remoteBytes > vramPeakBytes) vramPeakBytes = state.remoteBytes;
  out.peakMB = vramPeakBytes * vramMbScale;
  lastVram = out;
  vramScanState = null;
  vramTelemetryPending = false;
  if (state.reason) {
    console.log('[VRAM SAMPLE] ' + state.reason + ' remote=' +
      (out.remoteMB >= 0 ? out.remoteMB.toFixed(0) : '?') + 'MB system=' +
      (out.systemMB >= 0 ? out.systemMB.toFixed(0) : '?') + 'MB peak=' +
      out.peakMB.toFixed(0) + 'MB resources=' + out.scanned + '/' + out.count + '.');
  }
}

function scanVramTelemetryChunk() {
  const state = vramScanState;
  if (state === null) return;
  try {
    const currentArray = base.add(GFX_RESOURCE_LIST_RVA).readPointer();
    if (!currentArray.equals(state.array)) {
      if (state.restarts >= 2) throw new Error('resource table kept moving during sample');
      let currentCount = base.add(GFX_RESOURCE_COUNT_RVA).readS32();
      if (currentArray.isNull() || currentCount <= 0) throw new Error('resource table unavailable');
      state.restarts++;
      state.array = currentArray;
      state.out.count = currentCount;
      if (currentCount > VRAM_SCAN_CAP) {
        currentCount = VRAM_SCAN_CAP;
        state.out.truncated = true;
      }
      state.count = currentCount;
      state.index = 0;
      state.remoteBytes = 0;
      state.systemBytes = 0;
      state.scanned = 0;
      onMainThread(scanVramTelemetryChunk);
      return;
    }
    const end = Math.min(state.count, state.index + VRAM_SCAN_CHUNK);
    for (; state.index < end; state.index++) {
      try {
        const res = state.array.add(state.index * Process.pointerSize).readPointer();
        if (res.isNull()) continue;
        if (res.add(VRAM_RES_REMOTE_STATE_OFF).readU8() === 0) {
          state.remoteBytes += res.add(VRAM_RES_REMOTE_BYTES_OFF).readU32();
        }
        state.systemBytes += res.add(VRAM_RES_SYSTEM_BYTES_OFF).readU32();
        state.scanned++;
      } catch (_) {}
    }
    if (state.index < state.count) {
      onMainThread(scanVramTelemetryChunk);
    } else {
      finishVramTelemetrySample(state);
    }
  } catch (error) {
    console.log('[VRAM SAMPLE ABORT] ' + error + ' (next sample in ' +
      (VRAM_TELEMETRY_INTERVAL_MS / 1000) + 's)');
    lastVram.at = Date.now();
    vramScanState = null;
    vramTelemetryPending = false;
  }
}

function beginVramTelemetrySample(reason) {
  const out = newVramSample();
  try {
    const dev = base.add(RENDER_DEVICE_PTR_RVA).readPointer();
    if (!dev.isNull()) {
      const rawTotal = dev.add(RENDER_DEVICE_TOTAL_VRAM_OFF).readU64().toNumber();
      const mb = rawTotal * vramMbScale;
      if (mb >= 16 && mb <= 4095) out.totalMB = mb;
    }
  } catch (_) {}
  try {
    const arr = base.add(GFX_RESOURCE_LIST_RVA).readPointer();
    let count = base.add(GFX_RESOURCE_COUNT_RVA).readS32();
    out.count = count;
    if (arr.isNull() || count <= 0) throw new Error('resource table unavailable');
    if (count > VRAM_SCAN_CAP) {
      count = VRAM_SCAN_CAP;
      out.truncated = true;
    }
    vramScanState = {
      out: out,
      reason: reason,
      array: arr,
      count: count,
      index: 0,
      remoteBytes: 0,
      systemBytes: 0,
      scanned: 0,
      restarts: 0
    };
    scanVramTelemetryChunk();
  } catch (error) {
    console.log('[VRAM SAMPLE ERROR] ' + error);
    vramScanState = null;
    vramTelemetryPending = false;
  }
}

function queueVramTelemetry(reason) {
  if (!VRAM_TELEMETRY_ENABLED) return false;
  if (vramTelemetryPending) return false;
  vramTelemetryPending = true;
  onMainThread(function () { beginVramTelemetrySample(reason); });
  return true;
}

const objectDistancePatch = [
  0xb8, 0x00, 0x00, 0xa0, 0x40,
  0x66, 0x0f, 0x6e, 0xc8,
  0xf3, 0x0f, 0x59, 0xc1,
  0xc3
];

const user32 = Process.getModuleByName('user32.dll');
const getAsyncKeyState = new NativeFunction(
  user32.getExportByName('GetAsyncKeyState'),
  'int16',
  ['int32']
);
const getForegroundWindow = new NativeFunction(
  user32.getExportByName('GetForegroundWindow'),
  'pointer',
  []
);
const getWindowThreadProcessId = new NativeFunction(
  user32.getExportByName('GetWindowThreadProcessId'),
  'uint32',
  ['pointer', 'pointer']
);
const foregroundProcessId = Memory.alloc(4);
let foregroundCheckAt = 0;
let lotroHasForeground = false;
let lotroWindow = NULL;   // HUD, oyun penceresinin istemci alanini takip eder

// ---- HUD state is declared EARLY --------------------------------------------
// The T_MAIN_TICK hook can fire from the game thread while this file is still
// being evaluated. hudTick() checks hudBootstrapped first; it stays false until
// the HUD block below finishes, which avoids a temporal-dead-zone error.
let hudBootstrapped = false;
let hudEnabled = true;
let hudCompact = false;
let hudWindow = NULL;
let hudDc = NULL;
let hudBackBitmap = NULL;
let hudOldBitmap = NULL;
let hudFont = NULL;
let hudOldFont = NULL;
let hudPanelBrush = NULL;
let hudBorderBrush = NULL;
let hudMoveBrush = NULL;
let hudClassRegistered = false;
let hudSurfaceWidth = 0;
let hudSurfaceHeight = 0;
let hudCharWidth = 7;
let hudLastDrawAt = 0;
let hudLastError = 'none';
let hudErrorCount = 0;
let hudFrames = 0;
let hudAlpha = 205;
let hudOffsetX = 16;
let hudOffsetY = 48;
let hudGrabbable = false;
let hudUnfocusedSince = 0;
// Cached visibility and geometry so ShowWindow/SetWindowPos are only called on a real
// change instead of every frame.
let hudVisible = false;
let hudLastX = -100000;
let hudLastY = -100000;
let hudLastW = 0;
let hudLastH = 0;
let hudDragging = false;
let hudDragGrabX = 0;
let hudDragGrabY = 0;
const pushCamera = new NativeFunction(
  base.add(PUSH_CAMERA_RVA),
  'uint',
  ['pointer', 'uint', 'uint', 'float', 'float']
);
const popCamera = new NativeFunction(
  base.add(POP_CAMERA_RVA),
  'uint',
  ['pointer', 'uint', 'uint', 'uint']
);
const makeFpsSlow = new NativeFunction(base.add(MAKE_FPS_SLOW_RVA), 'uint', []);
const flightMoveForward = new NativeFunction(
  base.add(FLIGHT_MOVE_FORWARD_RVA),
  'void',
  ['pointer', 'float']
);
const flightMoveStrafe = new NativeFunction(
  base.add(FLIGHT_MOVE_STRAFE_RVA),
  'void',
  ['pointer', 'float']
);
const flightMoveVertical = new NativeFunction(
  base.add(FLIGHT_MOVE_VERTICAL_RVA),
  'void',
  ['pointer', 'float']
);
const worldCellPrimary = new NativeFunction(
  base.add(WORLD_CELL_PRIMARY_RVA),
  'void',
  ['pointer', 'pointer', 'pointer']
);
const worldCellSecondary = new NativeFunction(
  base.add(WORLD_CELL_SECONDARY_RVA),
  'void',
  ['pointer', 'pointer', 'pointer']
);
const worldCellEnter = new NativeFunction(
  base.add(WORLD_CELL_ENTER_RVA),
  'void',
  ['pointer', 'pointer', 'pointer']
);

let active = false;
let flightMachine = NULL;
let flightController = NULL;
let flightPositionPointer = NULL;
let flightToken = 0;
let flightF8WasDown = false;
let flightLastTickAt = 0;
let flightLastPosition = null;
let flightMoveCount = 0;
let flightCvarsModified = false;
let flightStopRequested = false;
let flightCleanupComplete = false;
let restoreRequested = false;
let restoreInProgress = false;
let restoreComplete = false;
let nativeAutoEnablePending = AUTO_ENABLE_FREECAM;
let cameraInputHook = null;
let renderProxyObject = null;
let renderProxyCandidate = null;
let renderProxyLockPending = false;
let renderProxyUpdateCount = 0;
let renderProxyWriteCount = 0;
let worldCellProxyBroadcaster = NULL;
let worldCellProxyEntity = NULL;
let worldCellPrimaryListener = NULL;
let worldCellSecondaryListener = NULL;
let worldCellEnterListener = NULL;
let worldCellProxyLastCell = null;
let worldCellProxyDisplaced = false;
let worldCellProxyLastDispatchAt = 0;
let worldCellProxyPrefetch = null;
let worldCellProxyDispatches = 0;
let worldCellProxyErrors = 0;
let worldCellProxyScans = 0;
let worldCellProxyDispatching = false;
const worldCellProxyScratchByThread = new Map();

function cinematicStreamingEnabled() {
  return (ALWAYS_FULL_RENDER || active) &&
    !restoreRequested && !restoreInProgress && !restoreComplete;
}

let smartBox = null;
const smartBoxBaselines = new Map();
let originalLoadWorldForPlayer = null;
let streamObject = null;
let originalStreamSettings = null;
let cameraCenteredStreamingApplied = false;
let originalObjectCode = null;
let originalStaticPvs = staticPvsFlag.readU8();
let originalAllowLods = allowLodsFlag.readU8();
let originalDistantImposters = distantImposters.readU8();
let originalFrillDistanceQuality = frillDistanceQuality.readU32();
let originalFrillDensity = frillDensity.readFloat();
let originalTextureFiltering = textureFiltering.readU32();
let originalAnisotropicQuality = anisotropicQuality.readU32();
let originalTextureDetail = textureDetail.readU32();
let originalGraphicsMemoryUsage = graphicsMemoryUsage.readFloat();
let renderBoostEnabled = false;
let lodBoostEnabled = false;
let frillBoostEnabled = false;
let textureBoostEnabled = false;
let impostersEnabled = originalDistantImposters !== 0;
let radiusApplyPending = false;
let radiusApplyCount = 0;
let landOriginForceEnabled = false;
let landOriginBaseline = null;
let landOriginUpdateCount = 0;
let landOriginWriteCount = 0;
let frillEngine = null;
let originalFrillEngineSettings = null;
let frillCenterUpdateCount = 0;
let lastFrillInput = null;
let maxFrillLoadRing = 0;
let terrainTileRequestCalls = 0;
let terrainTileRequestFailures = 0;
let frillSectorRefreshCalls = 0;
let frillSectorRefreshFailures = 0;
let loaderState4Transitions = 0;
let loaderState4TileFailures = 0;
let loaderState4RefreshFailures = 0;
let loaderState4AsyncMissing = 0;
let loaderState4LandMissing = 0;
let landResourceBuildCalls = 0;
let landResourceBuildSuccesses = 0;
let landResourceResolveCalls = 0;
let landResourceResolveNonNull = 0;
const landResourceSourcePointers = new Set();
const landResourceBuildContexts = new Map();
const retainedLandSources = new Map();
let landSourceHoldErrors = 0;
let lastLandSourceHoldLogAt = 0;
let directSourceKeyCalls = 0;
let directSourceLookups = 0;
let directSourceNonNull = 0;
let directSourceAdoptions = 0;
let directSourceErrors = 0;
let directSourceCursor = 0;
let directSourceInProgress = false;
let lastDirectSourceAt = 0;
let sourceAnchorCacheKey = '';
let sourceAnchorCache = [];
let landscapeProvider = null;
let landscapeProviderLookup = null;
let landscapeProviderResolveAttempted = false;
let landscapeProviderResolveErrors = 0;
let providerSurfaceCursor = 0;
let providerSurfaceLookupCalls = 0;
let providerSurfaceLookupNonNull = 0;
let providerSurfaceRequestCalls = 0;
let providerSurfaceRequestSuccesses = 0;
let providerSurfaceRequestErrors = 0;
let providerSurfaceCompletionCalls = 0;
let providerSurfaceCompletionErrors = 0;
let providerSurfaceLastCompletedKey = 'none';
let providerSurfaceLastKey = 'none';
let providerSurfaceLastStatus = -1;
let providerSurfaceLastOut = NULL;
let providerSurfaceInProgress = false;
let lastProviderSurfaceRequestAt = 0;
let providerCenterStateValid = false;
let targetPreloadBuilds = 0;
const providerSurfacePending = new Map();
const providerSurfaceCompleted = new Set();
let providerBlockCacheKey = '';
let providerBlockCache = [];
let providerBlockCacheKeys = new Set();
const providerBlockRemaining = new Set();
// Current camera velocity in world units per second, and the lookahead derived from it.
const motion = { vx: 0, vy: 0 };
const lastLookahead = { x: 0, y: 0 };
let lastProviderLogAt = 0;
let lastPreloadDispatchAt = 0;
let lastMaintenanceCenterKey = '';
let lastSourceMaintenanceAt = 0;
let residencyGridEnabled = false;
let originalResidencyLimitCode = null;
let residencyGridCalls = 0;
let residencyGridErrors = 0;
let lastResidencyRequestAt = 0;
const residencyProbeState = Memory.alloc(0x38);
const directSourceState = Memory.alloc(0x38);
const directSourceKey = Memory.alloc(0x18);
const directSourceGroupX = Memory.alloc(1);
const directSourceGroupY = Memory.alloc(1);
const directSourceId = Memory.alloc(4);
const directSourceHandle = Memory.alloc(8);
const providerSurfaceKey = Memory.alloc(0x18);
const providerReadinessKey = Memory.alloc(0x18);
const providerRequestDescriptor = Memory.alloc(0x80);
const providerRequestOutput = Memory.alloc(Process.pointerSize);
const providerCenterState = Memory.alloc(0x18);
const cameraTargetPreloadState = Memory.alloc(0x38);
const emptyProviderRequestDescriptor = new Array(0x80).fill(0);
const emptyDirectSourceKey = new Array(0x18).fill(0);

const hotkeys = {};
let lastBoostReassertAt = 0;

Interceptor.attach(mipBiasFunction, {
  onEnter: function (args) {
    this.output = args[1];
  },
  onLeave: function () {
    // Deliberately not gated on the TextureFiltering global. The engine rewrites that
    // value transiently while rebuilding samplers, so testing it here loses the race:
    // any terrain sampler that happened to rebuild inside that window never receives
    // the bias, which shows up as patchy ground. Write it unconditionally instead.
    if (!textureBoostEnabled) return;
    try {
      if (!this.output.isNull()) this.output.writeFloat(TEXTURE_MIP_BIAS);
    } catch (_) {}
  }
});

// ============================================================
// Terrain material quality and object/decoration draw distance.
// ============================================================
const T_SET_BYTE = 0x3ff6b0, T_SET_INT = 0x3ff430, T_MAIN_TICK = 0x971df0;
const T_D_MD = 0x14d7b08, T_D_MODEL = 0x14d7b10, T_D_OBJECT_DISTANCE = 0x14d7b28;
const T_D_LANDSCAPE_DISTANCE = 0x14d7b30, T_D_FRILL_COLOR = 0x14d7b50;
const T_D_STATIC_SHADOWS = 0x14d7b58, T_D_LQ = 0x14d7b60, T_D_FNM = 0x14d7b68;
const T_D_SEAM = 0x14d7c20;
const OBJ_MULT_RVA = 0x1a0ad2c, OBJ_WRITER_A = 0x93ca26, OBJ_WRITER_B = 0x93ce3d;
const originalMaterialDetail = base.add(MATERIAL_DETAIL_RVA).readU32();
const originalModelDetail = base.add(MODEL_DETAIL_RVA).readU32();
const originalObjectDrawDistance = base.add(OBJECT_DRAW_DISTANCE_RVA).readU32();
const originalLandscapeDrawDistance = base.add(LANDSCAPE_DRAW_DISTANCE_RVA).readU32();
const originalFrillTerrainColor = base.add(FRILL_TERRAIN_COLOR_RVA).readU8();
const originalLandscapeStaticObjectShadows = base.add(LANDSCAPE_STATIC_OBJECT_SHADOWS_RVA).readU32();
const originalTerrainLightingQuality = base.add(LANDSCAPE_LIGHTING_QUALITY_RVA).readU32();
const originalTerrainFarNormalMaps = base.add(FAR_LANDSCAPE_NORMAL_MAPS_RVA).readU8();
const originalNearFarSeamBlend = base.add(NEAR_FAR_SEAM_BLEND_RVA).readU8();
const originalObjectDrawMultiplier = base.add(OBJ_MULT_RVA).readFloat();
const restoreObjectDrawMultiplier = Number.isFinite(originalObjectDrawMultiplier) &&
  originalObjectDrawMultiplier > 0 && originalObjectDrawMultiplier <= 100.0
  ? originalObjectDrawMultiplier
  : 20.0;
let OBJECT_GAIN = 4.0;                 // Diagnostic only: native Ultra is 20.0 on this build.
const TERRAIN_REFRESH_MS = 6000;       // debounce for auto terrain rebuild
const NOP8 = [0x90, 0x90, 0x90, 0x90, 0x90, 0x90, 0x90, 0x90];

const tSetB = new NativeFunction(base.add(T_SET_BYTE), 'uint8', ['pointer', 'uint8']);
const tSetI = new NativeFunction(base.add(T_SET_INT), 'uint8', ['pointer', 'int']);

// Real AsyncCache limits. The old *.MaxCount/*.MaxMemory globals were eviction
// statistics, not settings. FUN_1403454d0 copies config+0x40 into each live cache,
// so K must update both the config node and the already-created object.
const asyncCacheConfigResolve = new NativeFunction(
  base.add(ASYNC_CACHE_CONFIG_RESOLVE_RVA),
  'pointer',
  ['uint32']
);
const NATIVE_LAND_CACHES = [
  { name: 'LandblockData', typeId: 0x11, targetCount: 8192, targetMemoryMiB: 1536 },
  { name: 'LandblockBlockmap', typeId: 0x2f, targetCount: 8192, targetMemoryMiB: 512 },
  { name: 'LandblockInfo', typeId: 0x2e, targetCount: 8192, targetMemoryMiB: 1536 },
  { name: 'KynmapLandblock', typeId: 0x64, targetCount: 8192, targetMemoryMiB: 512 },
  { name: 'EntityGroup', typeId: 0x1a, targetCount: 16384, targetMemoryMiB: 1792 },
  { name: 'LandblockProperties', typeId: 0x29, targetCount: 8192, targetMemoryMiB: 1536 }
];
let nativeLandCacheCaptured = false;
let nativeLandCacheEnabled = false;
let nativeLandCacheApplyPending = false;
let nativeLandCacheCaptureErrors = 0;
let nativeLandCacheApplyErrors = 0;
let nativeLandCacheApplyCount = 0;
NATIVE_LAND_CACHES.forEach(function (entry) {
  entry.original = null;
  entry.boosted = null;
  entry.current = null;
});

// cvar setters + terrain rebuild must run on the main render thread.
const mainQueue = [];
function onMainThread(fn) { mainQueue.push(fn); }
Interceptor.attach(base.add(T_MAIN_TICK), { onEnter: function () {
  if (restoreComplete) return;
  if (restoreRequested && !restoreInProgress) {
    restoreRequested = false;
    restore();
    return;
  }
  if (!landscapeProviderResolveAttempted) resolveLandscapeProviderOnMainThread();
  if (radiusApplyPending) {
    radiusApplyPending = false;
    try {
      farRadiusApply();
      radiusApplyCount++;
      console.log('[RADIUS APPLY] count=' + radiusApplyCount);
    } catch (error) {
      console.log('[RADIUS APPLY ERROR] ' + error);
    }
  }
  if (mainQueue.length) {
    const jobs = mainQueue.splice(0, mainQueue.length);
    for (let i = 0; i < jobs.length; i++) {
      try { jobs[i](); } catch (e) { console.log('[T-MAIN ERR] ' + e); }
    }
  }
  // Overlay window: creation, message pump and drawing must share one thread.
  hudTick();
}});

function dispatchEngineCommand(command) {
  const handle = Memory.alloc(Process.pointerSize);
  const commandString = Memory.allocUtf8String(command);
  consoleStringConstruct(handle, commandString);
  consoleDispatch(handle);
}

// Apply every landscape, model and material quality selector at its registered maximum.
let terrainMaxApplied = false;
let startupFullQualityVerified = false;
function setTerrainMax() {
  tSetI(base.add(T_D_MD), 1);
  tSetI(base.add(T_D_LANDSCAPE_DISTANCE), 4);
  tSetB(base.add(T_D_FRILL_COLOR), 1);
  tSetI(base.add(T_D_STATIC_SHADOWS), 3);
  tSetI(base.add(T_D_LQ), 2);
  tSetB(base.add(T_D_FNM), 1);
  tSetB(base.add(T_D_SEAM), 1);
  // Near/far seam blending softens the transition line between the detailed ring and the
  // distant representation. It does not remove the resolution step, it hides the seam.
  base.add(NEAR_FAR_SEAM_BLEND_RVA).writeU8(1);
  base.add(LANDSCAPE_DRAW_DISTANCE_RVA).writeU32(4);
  terrainMaxApplied = true;
  console.log('[QUALITY MAX] Terrain Material=1 Land=4 StaticShadows=3 Lighting=2 FNM=1 Seam=1 FrillColor=1' +
    ' | object/model LOD remains native=' + originalObjectDrawDistance + '/' + originalModelDetail + '.');
}

// Puts every terrain selector back to whatever the client itself had. The engine only
// consults these when a cell is built, so a change here shows up as cells rebuild rather
// than instantly.
function disableTerrainMax() {
  if (!terrainMaxApplied) return;
  tSetI(base.add(T_D_MD), originalMaterialDetail);
  tSetI(base.add(T_D_LANDSCAPE_DISTANCE), originalLandscapeDrawDistance);
  tSetB(base.add(T_D_FRILL_COLOR), originalFrillTerrainColor);
  tSetI(base.add(T_D_STATIC_SHADOWS), originalLandscapeStaticObjectShadows);
  tSetI(base.add(T_D_LQ), originalTerrainLightingQuality);
  tSetB(base.add(T_D_FNM), originalTerrainFarNormalMaps);
  tSetB(base.add(T_D_SEAM), originalNearFarSeamBlend);
  fnmLiveState = originalTerrainFarNormalMaps;
  terrainMaxApplied = false;
  startupFullQualityVerified = false;
  console.log('[TERRAIN QUALITY] OFF - the client\'s own terrain settings restored.');
}

function verifyStartupFullQuality() {
  const engine = resolveFrillEngine();
  const values = {
    material: base.add(MATERIAL_DETAIL_RVA).readU32(),
    model: base.add(MODEL_DETAIL_RVA).readU32(),
    object: base.add(OBJECT_DRAW_DISTANCE_RVA).readU32(),
    land: base.add(LANDSCAPE_DRAW_DISTANCE_RVA).readU32(),
    staticShadows: base.add(LANDSCAPE_STATIC_OBJECT_SHADOWS_RVA).readU32(),
    lighting: base.add(LANDSCAPE_LIGHTING_QUALITY_RVA).readU32(),
    farNormalMaps: base.add(FAR_LANDSCAPE_NORMAL_MAPS_RVA).readU8(),
    seam: base.add(NEAR_FAR_SEAM_BLEND_RVA).readU8(),
    frillColor: base.add(FRILL_TERRAIN_COLOR_RVA).readU8(),
    frillQuality: frillDistanceQuality.readU32(),
    lods: allowLodsFlag.readU8(),
    objectMultiplier: base.add(OBJ_MULT_RVA).readFloat(),
    distantImposters: distantImposters.readU8(),
    filtering: textureFiltering.readU32(),
    texture: textureDetail.readU32(),
    aniso: anisotropicQuality.readU32(),
    memory: graphicsMemoryUsage.readFloat(),
    grassDistance: engine === null ? -1 : engine.add(0x64).readU32(),
    grassDensity: engine === null ? -1 : engine.add(0x60).readFloat(),
    grassReduction: engine === null ? -1 : engine.add(0xe8).readU8()
  };
  const expectedAllowLods = AUTO_ENABLE_LOD0 ? 0 : originalAllowLods;
  const verified = values.material === 1 &&
    values.model === originalModelDetail && values.object === originalObjectDrawDistance &&
    values.land === 4 && values.staticShadows === 3 && values.lighting === 2 &&
    values.farNormalMaps === 1 && values.seam === 1 && values.frillColor === 1 &&
    values.frillQuality === 5 && values.lods === expectedAllowLods &&
    values.distantImposters === originalDistantImposters &&
    values.filtering === TEXTURE_FILTERING_MAX && values.texture === TEXTURE_DETAIL_MAX &&
    values.aniso === ANISOTROPIC_QUALITY_MAX && values.memory === GRAPHICS_MEMORY_USAGE_MAX &&
    values.grassDistance === FRILL_DISTANCE_SECTORS &&
    Math.abs(values.grassDensity - FRILL_DENSITY_MAX) < 0.001 && values.grassReduction === 0 &&
    !renderCacheEnabled;
  startupFullQualityVerified = verified;
  console.log('[STARTUP TERRAIN+NATIVE-OBJECT ' + (verified ? 'VERIFIED' : 'WARN') + '] ' +
    'material/model/object/land=' + values.material + '/' + values.model + '/' + values.object + '/' + values.land +
    ' shadows/light/FNM/seam=' + values.staticShadows + '/' + values.lighting + '/' +
      values.farNormalMaps + '/' + values.seam +
    ' texture/aniso/mem=' + values.texture + '/' + values.aniso + '/' + values.memory.toFixed(1) +
    ' filter=' + values.filtering + ' objMult=' + values.objectMultiplier.toFixed(2) +
    ' grass=' + values.grassDistance + '/' + values.grassDensity.toFixed(2) +
      '/reduction' + values.grassReduction +
    ' ring=' + FAR_RADIUS + '/' + NEAR_RADIUS + ' cache=' + (renderCacheEnabled ? 'ON' : 'OFF'));
  return verified;
}
let terrainRefreshCount = 0;
function terrainRefresh() {  // main thread: toggle FarNormalMaps to rebuild terrain material on all cells
  tSetB(base.add(T_D_FNM), 0); tSetB(base.add(T_D_FNM), 1);
  terrainRefreshCount++;
}

// Far normal maps are what separate detailed relief from flat "painted" terrain. With
// them off, distant cells stay on the base material (+0x90) instead of the normal-map
// material (+0x98). Key N toggles it live so the difference is directly visible.
let fnmLiveState = 1;
function toggleFarNormalMaps() {   // main thread
  fnmLiveState = fnmLiveState ? 0 : 1;
  tSetB(base.add(T_D_FNM), fnmLiveState);
  console.log('[N/FNM] FarNormalMaps -> ' + fnmLiveState +
    (fnmLiveState ? ' (relief / detailed)' : ' (flat / painted)'));
}
let terrainAutoRefresh = false, lastTerrainRefreshAt = 0, lastCompletedSize = 0;
// Off by default. Toggling far normal maps 0->1 in flight rebuilds the terrain material,
// and if the device gate is not satisfied at that instant the far terrain sticks on the
// flat no-normal-map variant - the exact problem the rebuild was meant to fix. Setting
// the value once at startup and leaving it alone is the reliable behaviour.

// --- object / ground-decoration draw distance (lever 0x1a0ad2c, NOP its 2 per-frame writers) ---
let objectBoostEnabled = false, originalObjectMult = 0, origObjWA = null, origObjWB = null;
function boostedObjectMult() { return (originalObjectMult > 0 ? originalObjectMult : 1.0) * OBJECT_GAIN; }
function enableObjectBoost() {
  if (objectBoostEnabled) return;
  try {
    origObjWA = base.add(OBJ_WRITER_A).readByteArray(8);
    origObjWB = base.add(OBJ_WRITER_B).readByteArray(8);
    const liveObjectMult = base.add(OBJ_MULT_RVA).readFloat();
    originalObjectMult = Number.isFinite(liveObjectMult) && liveObjectMult > 0 && liveObjectMult <= 100.0
      ? liveObjectMult
      : restoreObjectDrawMultiplier;
    Memory.protect(base.add(OBJ_WRITER_A), 8, 'rwx'); base.add(OBJ_WRITER_A).writeByteArray(NOP8);
    Memory.protect(base.add(OBJ_WRITER_B), 8, 'rwx'); base.add(OBJ_WRITER_B).writeByteArray(NOP8);
    base.add(OBJ_MULT_RVA).writeFloat(boostedObjectMult());
    objectBoostEnabled = true;
    console.log('[OBJECT ON DIAGNOSTIC] decoration draw-mult ' + originalObjectMult.toFixed(2) + ' -> ' + boostedObjectMult().toFixed(2) + ' (x' + OBJECT_GAIN + '); distant 2D fallback may disappear before 3D mesh residency');
  } catch (e) { console.log('[OBJECT ERR] ' + e); }
}
function disableObjectBoost() {
  if (!objectBoostEnabled) return;
  try {
    if (origObjWA) base.add(OBJ_WRITER_A).writeByteArray(origObjWA);
    if (origObjWB) base.add(OBJ_WRITER_B).writeByteArray(origObjWB);
    base.add(OBJ_MULT_RVA).writeFloat(originalObjectMult);
  } catch (e) {}
  objectBoostEnabled = false;
  console.log('[OBJECT OFF] decoration draw-distance restored.');
}
function reassertObjectMult() { if (objectBoostEnabled) { try { base.add(OBJ_MULT_RVA).writeFloat(boostedObjectMult()); } catch (e) {} } }

// auto terrain-refresh: when new grass blocks stream in (flying to new terrain),
// re-materialize the far terrain so it keeps the high-detail material (debounced).
setInterval(function () {
  reassertObjectMult();
  if (!terrainAutoRefresh || !terrainMaxApplied) return;
  const now = Date.now();
  if (now - lastTerrainRefreshAt < TERRAIN_REFRESH_MS) return;
  if (providerSurfaceCompleted.size !== lastCompletedSize) {
    lastCompletedSize = providerSurfaceCompleted.size;
    lastTerrainRefreshAt = now;
    onMainThread(terrainRefresh);
  }
}, 1500);

// A surface leaves the provider's active table when the loader hands it to the
// global resource manager. Track that handoff so completed blocks are not
// mistaken for missing blocks and requested again every five seconds.
Interceptor.attach(base.add(PROVIDER_COMPLETION_RVA), {
  onEnter: function (args) {
    if (!cinematicStreamingEnabled()) return;
    providerSurfaceCompletionCalls++;
    try {
      const surfaceReference = args[1];
      if (!looksLikePointer(surfaceReference)) return;
      const surface = surfaceReference.readPointer();
      if (!looksLikePointer(surface)) return;
      const blockX = surface.add(0x4c).readU8();
      const blockY = surface.add(0x4d).readU8();
      const blockKey = blockX + ',' + blockY;
      providerSurfaceLastCompletedKey = blockKey;
      providerSurfaceCompleted.add(blockKey);
      providerSurfacePending.delete(blockKey);
      providerBlockRemaining.delete(blockKey);
      if (providerSurfaceCompletionCalls === 1 ||
          providerSurfaceCompletionCalls % 100 === 0) {
        console.log('[PROVIDER COMPLETE] key=' + blockKey +
          ' total=' + providerSurfaceCompletionCalls +
          ' unique=' + providerSurfaceCompleted.size);
      }
    } catch (_) {
      providerSurfaceCompletionErrors++;
    }
  }
});

const target = {
  x: 0,
  y: 0,
  z: 0,
  blockX: 0,
  blockY: 0,
  region: 0,
  valid: false
};

function readLandPosition(address, hasVtable) {
  const fields = hasVtable ? address.add(8) : address;
  const coordinates = hasVtable ? address.add(0x18) : address.add(0x10);
  try {
    return {
      valid: fields.readU32(),
      blockX: fields.add(4).readU8(),
      blockY: fields.add(5).readU8(),
      region: fields.add(6).readU16(),
      x: coordinates.readFloat(),
      y: coordinates.add(4).readFloat(),
      z: coordinates.add(8).readFloat()
    };
  } catch (_) {
    return null;
  }
}

function writeCachedLandPosition(position) {
  cachedLandOrigin.add(4).writeU8(position.blockX);
  cachedLandOrigin.add(5).writeU8(position.blockY);
  cachedLandOrigin.add(6).writeU16(position.region);
  cachedLandOrigin.add(0x10).writeFloat(position.x);
  cachedLandOrigin.add(0x14).writeFloat(position.y);
  cachedLandOrigin.add(0x18).writeFloat(position.z);
}

function formatLandPosition(position) {
  if (position === null) return 'none';
  return position.blockX + ',' + position.blockY +
    '/' + position.x.toFixed(1) + ',' + position.y.toFixed(1) + ',' + position.z.toFixed(1);
}

function enableLandOriginForce() {
  if (landOriginForceEnabled) return;
  landOriginBaseline = readLandPosition(cachedLandOrigin, false);
  landOriginForceEnabled = true;
  console.log('[LAND ORIGIN FORCE] ON - cached SmartBox landscape origin follows freecam.');
}

function disableLandOriginForce() {
  if (!landOriginForceEnabled) return;
  landOriginForceEnabled = false;
  if (landOriginBaseline !== null) writeCachedLandPosition(landOriginBaseline);
  console.log('[LAND ORIGIN FORCE] OFF - cached landscape origin baseline restored.');
  landOriginBaseline = null;
}

function isLotroForeground() {
  const now = Date.now();
  if (now - foregroundCheckAt < 50) return lotroHasForeground;
  foregroundCheckAt = now;
  try {
    const window = getForegroundWindow();
    if (window.isNull()) {
      lotroHasForeground = false;
      return false;
    }
    foregroundProcessId.writeU32(0);
    getWindowThreadProcessId(window, foregroundProcessId);
    lotroHasForeground = foregroundProcessId.readU32() === Process.id;
    // The game window the HUD aligns to: the foreground window owned by us.
    // The HUD itself is WS_EX_NOACTIVATE so it can never be picked up here.
    if (lotroHasForeground && !window.equals(hudWindow)) lotroWindow = window;
  } catch (_) {
    lotroHasForeground = false;
  }
  return lotroHasForeground;
}

function keyDown(key) {
  if (!isLotroForeground()) return false;
  return (getAsyncKeyState(key) & 0x8000) !== 0;
}

// Every toggle requires a modifier key to be held at the moment the key goes down. LOTRO
// binds the bare number and function keys to quickslots and panels, so an unmodified
// hotkey would fire an ability at the same time as changing a render setting. Freecam
// movement is exempt - it is only live while the camera is flying, and it needs Ctrl free
// for the precision modifier.
//
// The modifier is a parameter (not hardcoded to VK_CONTROL) so each feature's hotkey can
// be rebound to a different modifier later without touching this function - e.g. moving a
// toggle off Ctrl to free that combo up, or giving a specific feature its own modifier,
// without forcing every hotkey in the file to share one fixed key.
function dualKeyPressed(modifier, key, name) {
  // keyPressed() runs first and unconditionally so its edge state stays accurate even
  // when the key is pressed without the modifier.
  const pressed = keyPressed(key, name);
  return pressed && keyDown(modifier);
}

function keyPressed(key, name) {
  const now = Date.now();
  const down = keyDown(key);
  const state = hotkeys[name] || { down: false, changedAt: 0 };
  const pressed = down && !state.down && now - state.changedAt >= HOTKEY_COOLDOWN_MS;
  state.down = down;
  if (pressed) state.changedAt = now;
  hotkeys[name] = state;
  return pressed;
}

function readFloat(address) {
  try { return address.readFloat(); } catch (_) { return NaN; }
}

function writeU8IfChanged(address, value) {
  if (address.readU8() !== value) address.writeU8(value);
}

function writeU32IfChanged(address, value) {
  if (address.readU32() !== value) address.writeU32(value);
}

function writeFloatIfChanged(address, value) {
  if (address.readFloat() !== value) address.writeFloat(value);
}

function patchReadonlyFloatIfChanged(address, value) {
  const current = address.readFloat();
  if (Math.abs(current - value) < 0.00000001) return;
  Memory.patchCode(address, 4, function (writable) {
    writable.writeFloat(value);
  });
}

function looksLikePointer(value) {
  try {
    return !value.isNull() &&
      value.compare(ptr('0x10000')) > 0 &&
      value.compare(ptr('0x7fffffffffff')) < 0;
  } catch (_) {
    return false;
  }
}

function findNativeAsyncCache(typeId) {
  const registry = base.add(ASYNC_CACHE_REGISTRY_RVA);
  const buckets = registry.add(0x10).readPointer();
  const bucketCount = registry.add(0x20).readU32();
  const nodeCount = registry.add(0x24).readU32();
  if (!looksLikePointer(buckets) || bucketCount === 0 || bucketCount > 0x100000) {
    throw new Error('async registry unavailable');
  }

  let node = buckets.add((typeId % bucketCount) * Process.pointerSize).readPointer();
  const hopLimit = Math.min(Math.max(nodeCount + 1, 16), 4096);
  for (let hop = 0; hop < hopLimit && looksLikePointer(node); hop++) {
    if (node.readU32() === typeId) {
      const cache = node.add(0x10).readPointer();
      if (!looksLikePointer(cache)) throw new Error('type 0x' + typeId.toString(16) + ': null cache');
      const vtable = cache.readPointer();
      if (!vtable.equals(base.add(ASYNC_CACHE_VTABLE_RVA))) {
        throw new Error('type 0x' + typeId.toString(16) + ': vtable=' + vtable);
      }
      return cache;
    }
    node = node.add(0x08).readPointer();
  }
  throw new Error('type 0x' + typeId.toString(16) + ': live cache not found');
}

function readNativeAsyncCacheState(entry) {
  const config = asyncCacheConfigResolve(entry.typeId);
  if (!looksLikePointer(config)) throw new Error(entry.name + ': config unavailable');
  const cache = findNativeAsyncCache(entry.typeId);
  return {
    config: config,
    cache: cache,
    configCount: config.add(0x48).readU32(),
    configMemoryBytes: config.add(0x4c).readU32(),
    objectCount: cache.add(0x40).readU32(),
    objectMemoryBytes: cache.add(0x44).readU32()
  };
}

function cacheLimitValues(state) {
  return {
    configCount: state.configCount,
    configMemoryBytes: state.configMemoryBytes,
    objectCount: state.objectCount,
    objectMemoryBytes: state.objectMemoryBytes
  };
}

function nativeLandCacheSummary(field) {
  return NATIVE_LAND_CACHES.map(function (entry) {
    const value = entry[field];
    if (value === null) return entry.name + '=?';
    return entry.name + '=' + value.objectCount + '/' +
      (value.objectMemoryBytes / MIB).toFixed(0) + 'MiB';
  }).join(' ');
}

function nativeLandCacheStatus(entry, field) {
  const value = entry[field];
  return {
    name: entry.name,
    typeId: entry.typeId,
    count: value === null ? null : value.objectCount,
    memoryBytes: value === null ? null : value.objectMemoryBytes,
    memoryMiB: value === null ? null : value.objectMemoryBytes / MIB,
    configCount: value === null ? null : value.configCount,
    configMemoryBytes: value === null ? null : value.configMemoryBytes,
    targetCount: entry.targetCount,
    targetMemoryMiB: entry.targetMemoryMiB
  };
}

function captureNativeLandCacheSettings() {
  if (!CACHE_FEATURE_ENABLED) return false;
  let captured = 0;
  NATIVE_LAND_CACHES.forEach(function (entry) {
    if (entry.original !== null) {
      captured++;
      return;
    }
    try {
      const state = readNativeAsyncCacheState(entry);
      entry.original = cacheLimitValues(state);
      entry.current = cacheLimitValues(state);
      const targetBytes = entry.targetMemoryMiB * MIB;
      entry.boosted = {
        configCount: Math.max(entry.original.configCount, entry.targetCount),
        configMemoryBytes: Math.max(entry.original.configMemoryBytes, targetBytes),
        objectCount: Math.max(entry.original.objectCount, entry.targetCount),
        objectMemoryBytes: Math.max(entry.original.objectMemoryBytes, targetBytes)
      };
      captured++;
    } catch (error) {
      nativeLandCacheCaptureErrors++;
      console.log('[NATIVE CACHE CAPTURE ERROR] ' + entry.name + ': ' + error);
    }
  });
  nativeLandCacheCaptured = captured === NATIVE_LAND_CACHES.length;
  console.log('[NATIVE CACHE BASELINE] captured=' + captured + '/' +
    NATIVE_LAND_CACHES.length + ' ' + nativeLandCacheSummary('original'));
  return nativeLandCacheCaptured;
}

function writeNativeAsyncCacheState(state, desired) {
  state.config.add(0x48).writeU32(desired.configCount);
  state.config.add(0x4c).writeU32(desired.configMemoryBytes);
  state.cache.add(0x40).writeU32(desired.objectCount);
  state.cache.add(0x44).writeU32(desired.objectMemoryBytes);
}

function cacheLimitsEqual(actual, expected) {
  return actual.configCount === expected.configCount &&
    actual.configMemoryBytes === expected.configMemoryBytes &&
    actual.objectCount === expected.objectCount &&
    actual.objectMemoryBytes === expected.objectMemoryBytes;
}

function applyNativeLandCacheSettings(enabled) {
  if (!CACHE_FEATURE_ENABLED) {
    nativeLandCacheApplyPending = false;
    nativeLandCacheEnabled = false;
    return false;
  }
  nativeLandCacheApplyPending = false;
  if (!nativeLandCacheCaptured) captureNativeLandCacheSettings();

  let changed = 0;
  let verified = 0;
  NATIVE_LAND_CACHES.forEach(function (entry) {
    if (entry.original === null) return;
    const desired = enabled ? entry.boosted : entry.original;
    try {
      const before = readNativeAsyncCacheState(entry);
      if (!cacheLimitsEqual(before, desired)) {
        writeNativeAsyncCacheState(before, desired);
        changed++;
      }
      const after = readNativeAsyncCacheState(entry);
      entry.current = cacheLimitValues(after);
      if (!cacheLimitsEqual(after, desired)) throw new Error(entry.name + ': post-write verify failed');
      verified++;
    } catch (error) {
      nativeLandCacheApplyErrors++;
      console.log('[NATIVE CACHE APPLY ERROR] ' + entry.name + ': ' + error);
    }
  });

  nativeLandCacheEnabled = enabled && verified === NATIVE_LAND_CACHES.length;
  nativeLandCacheApplyCount++;
  console.log('[NATIVE CACHE ' + (enabled ? 'ON' : 'OFF') + '] changed=' + changed +
    ' verified=' + verified + '/' + NATIVE_LAND_CACHES.length +
    ' target=' + NATIVE_CACHE_RAM_TARGET_MIB + 'MiB applyCount=' + nativeLandCacheApplyCount +
    ' ' + nativeLandCacheSummary('current'));
  return verified === NATIVE_LAND_CACHES.length;
}

function queueNativeLandCacheSettings(enabled) {
  if (!CACHE_FEATURE_ENABLED) return false;
  nativeLandCacheApplyPending = true;
  onMainThread(function () { applyNativeLandCacheSettings(enabled); });
  return true;
}

function restoreNativeLandCacheSettingsImmediate() {
  if (!CACHE_FEATURE_ENABLED) return;
  let restored = 0;
  NATIVE_LAND_CACHES.forEach(function (entry) {
    if (entry.original === null) return;
    try {
      const state = readNativeAsyncCacheState(entry);
      if (!cacheLimitsEqual(state, entry.original)) writeNativeAsyncCacheState(state, entry.original);
      entry.current = cacheLimitValues(readNativeAsyncCacheState(entry));
      restored++;
    } catch (error) {
      nativeLandCacheApplyErrors++;
      console.log('[NATIVE CACHE RESTORE ERROR] ' + entry.name + ': ' + error);
    }
  });
  nativeLandCacheEnabled = false;
  nativeLandCacheApplyPending = false;
  console.log('[NATIVE CACHE RESTORE] config+live values restored=' + restored + '/' +
    NATIVE_LAND_CACHES.length + '.');
}

function primeRenderTargetFromPlayer() {
  const box = resolveSmartBox();
  if (box === null) return false;
  const position = readLandPosition(box.add(0x80), true);
  if (position === null || ![position.x, position.y, position.z].every(Number.isFinite)) {
    return false;
  }
  target.x = position.x;
  target.y = position.y;
  target.z = position.z;
  target.blockX = position.blockX;
  target.blockY = position.blockY;
  target.region = position.region;
  target.valid = true;
  console.log('[FLIGHT ANCHOR] region=' + target.region +
    ' block=' + target.blockX + ',' + target.blockY +
    ' local=' + target.x.toFixed(2) + ',' + target.y.toFixed(2) + ',' + target.z.toFixed(2));
  return true;
}

function normalizeRenderTarget() {
  while (target.x >= BLOCK_SIZE) {
    target.x -= BLOCK_SIZE;
    target.blockX = (target.blockX + 1) & 0xff;
  }
  while (target.x < 0) {
    target.x += BLOCK_SIZE;
    target.blockX = (target.blockX - 1) & 0xff;
  }
  while (target.y >= BLOCK_SIZE) {
    target.y -= BLOCK_SIZE;
    target.blockY = (target.blockY + 1) & 0xff;
  }
  while (target.y < 0) {
    target.y += BLOCK_SIZE;
    target.blockY = (target.blockY - 1) & 0xff;
  }
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
    const controller = state.add(0x70).readPointer();
    if (controller.isNull() || !controller.readPointer().equals(flightVtable)) return NULL;
    return controller;
  } catch (_) {
    return NULL;
  }
}

function resolveFlightPositionPointer(controller) {
  try {
    const cameraInterface = controller.add(0x18);
    const vtable = cameraInterface.readPointer();
    const getterAddress = vtable.add(0x50).readPointer();
    if (!looksLikePointer(getterAddress)) return NULL;
    const getter = new NativeFunction(getterAddress, 'pointer', ['pointer']);
    const position = getter(cameraInterface);
    return looksLikePointer(position) ? position : NULL;
  } catch (_) {
    return NULL;
  }
}

function readFlightPosition() {
  if (flightPositionPointer.isNull()) return null;
  try {
    const position = {
      x: flightPositionPointer.readFloat(),
      y: flightPositionPointer.add(4).readFloat(),
      z: flightPositionPointer.add(8).readFloat()
    };
    return [position.x, position.y, position.z].every(Number.isFinite) ? position : null;
  } catch (_) {
    return null;
  }
}

function restoreFlightCvars() {
  if (!flightCvarsModified) return;
  flightUsePhysics.writeU8(originalFlightUsePhysics);
  flightMoveSpeed.writeFloat(originalFlightMoveSpeed);
  flightCvarsModified = false;
}

function enableNativeFlight() {
  if (active || !looksLikePointer(flightMachine)) return;
  try {
    primeRenderTargetFromPlayer();
    makeFpsSlow();
    flightUsePhysics.writeU8(0);
    flightMoveSpeed.writeFloat(NATIVE_FLIGHT_SPEED);
    flightCvarsModified = true;
    flightToken = pushCamera(flightMachine, 4, 0, 0.2, 0.2);
    flightController = resolveFlightController(flightMachine);
    flightPositionPointer = flightController.isNull()
      ? NULL
      : resolveFlightPositionPointer(flightController);
    flightLastPosition = readFlightPosition();
    active = true;
    armWorldCellProxyBaseline();
    renderProxyObject = NATIVE_RENDER_PROXY_ENABLED && looksLikePointer(renderProxyCandidate)
      ? renderProxyCandidate
      : null;
    renderProxyLockPending = NATIVE_RENDER_PROXY_ENABLED && renderProxyObject === null;
    if (renderProxyObject !== null) {
      console.log('[RENDER PROXY] PRELOCK object=' + renderProxyObject);
    }
    flightLastTickAt = Date.now();
    motion.vx = 0;
    motion.vy = 0;
    enableLandOriginForce();
    setCameraCenteredStreaming(true);
    console.log('[FLIGHT] ON token=' + flightToken +
      ' speed=' + NATIVE_FLIGHT_SPEED +
      ' controller=' + flightController +
      ' position=' + flightPositionPointer);
  } catch (error) {
    restoreFlightCvars();
    disableLandOriginForce();
    setCameraCenteredStreaming(false);
    flightToken = 0;
    flightController = NULL;
    flightPositionPointer = NULL;
    flightLastPosition = null;
    renderProxyObject = null;
    renderProxyLockPending = false;
    active = false;
    console.log('[FLIGHT ERROR] enable: ' + error);
  }
}

function disableNativeFlight(reason) {
  if (!active) {
    restoreFlightCvars();
    flightCleanupComplete = true;
    return;
  }
  try {
    if (looksLikePointer(flightMachine) && flightToken !== 0) {
      popCamera(flightMachine, flightToken, 0, 0);
    }
  } catch (error) {
    console.log('[FLIGHT ERROR] pop: ' + error);
  }
  restoreFlightCvars();
  active = false;
  restoreWorldCellProxyFromPlayer(reason);
  renderProxyObject = null;
  renderProxyLockPending = false;
  flightToken = 0;
  flightController = NULL;
  flightPositionPointer = NULL;
  flightLastPosition = null;
  motion.vx = 0;
  motion.vy = 0;
  disableLandOriginForce();
  setCameraCenteredStreaming(false);
  flightCleanupComplete = true;
  console.log('[FLIGHT] ' + reason + ' OFF');
}

function syncRenderTargetToFlight(before, after, dt) {
  if (!target.valid || before === null || after === null || dt <= 0) return;
  const dx = after.x - before.x;
  const dy = after.y - before.y;
  const dz = after.z - before.z;
  if (![dx, dy, dz].every(Number.isFinite)) return;
  const previousBlockX = target.blockX;
  const previousBlockY = target.blockY;
  target.x += dx;
  target.y += dy;
  target.z += dz;
  normalizeRenderTarget();
  if (target.blockX !== previousBlockX || target.blockY !== previousBlockY) {
    // FAR/NEAR radii are global and survive block changes. Re-running the native
    // apply routine here rebuilds the whole landscape ring and causes a visible
    // freeze/pop at every boundary; the moving provider/anchor bubble is sufficient.
    providerSurfaceCursor = 0;
    directSourceCursor = 0;
  }
  motion.vx = dx / dt;
  motion.vy = dy / dt;
  updateCameraWorldCellStreaming(motion.vx, motion.vy);
  if (dx !== 0 || dy !== 0 || dz !== 0) flightMoveCount++;
}

function landSourceKey(keyPointer, source) {
  try {
    if (looksLikePointer(keyPointer)) {
      return keyPointer.add(0x08).readU32() + ':' +
        keyPointer.add(0x0c).readU8() + ':' +
        keyPointer.add(0x0d).readU8() + ':' +
        keyPointer.add(0x0e).readU16() + ':' +
        keyPointer.add(0x10).readU16();
    }
  } catch (_) {}
  return 'ptr:' + source;
}

function callObjectMethod(object, vtableOffset) {
  if (!looksLikePointer(object)) throw new Error('invalid object pointer ' + object);
  const vtable = object.readPointer();
  if (!looksLikePointer(vtable) || Process.findModuleByAddress(vtable) === null) {
    throw new Error('invalid object vtable ' + vtable);
  }
  const method = vtable.add(vtableOffset).readPointer();
  if (!looksLikePointer(method) || Process.findModuleByAddress(method) === null) {
    throw new Error('invalid object method ' + method);
  }
  const invoke = new NativeFunction(method, 'void', ['pointer']);
  invoke(object);
}

function resolveLandscapeProviderOnMainThread() {
  if (!GRASS_MACHINERY) return;   // grass off: never resolve the provider, every pass is a no-op
  if (landscapeProvider !== null || landscapeProviderResolveAttempted) return;
  landscapeProviderResolveAttempted = true;

  const status1 = Memory.alloc(0x10);
  const status2 = Memory.alloc(0x10);
  const outService = Memory.alloc(Process.pointerSize);
  const outProvider = Memory.alloc(Process.pointerSize);
  status1.writeByteArray(new Array(0x10).fill(0));
  status2.writeByteArray(new Array(0x10).fill(0));
  outService.writePointer(NULL);
  outProvider.writePointer(NULL);

  let service = NULL;
  try {
    const locator = serviceLocatorGet();
    serviceLocatorFind(
      locator,
      status1,
      base.add(LAND_PROVIDER_SERVICE_IID_RVA),
      outService
    );
    service = outService.readPointer();
    if (!looksLikePointer(service)) throw new Error('land provider service not found');

    const queryAddress = service.readPointer().add(0x18).readPointer();
    const query = new NativeFunction(
      queryAddress,
      'pointer',
      ['pointer', 'pointer', 'pointer', 'pointer']
    );
    query(service, status2, base.add(LAND_PROVIDER_IID_RVA), outProvider);

    const provider = outProvider.readPointer();
    if (!looksLikePointer(provider)) throw new Error('land provider interface not found');
    const lookupAddress = provider.readPointer().add(0x98).readPointer();
    if (!looksLikePointer(lookupAddress)) throw new Error('land provider lookup not found');

    landscapeProvider = ptr(provider.toString());
    landscapeProviderLookup = new NativeFunction(
      lookupAddress,
      'pointer',
      ['pointer', 'pointer']
    );
    console.log('[PROVIDER ON] provider=' + landscapeProvider +
      ' lookup=' + lookupAddress +
      ' radius=' + PROVIDER_SURFACE_RADIUS_BLOCKS +
      ' blocks grid=' + (PROVIDER_SURFACE_RADIUS_BLOCKS * 2 + 1) + 'x' +
        (PROVIDER_SURFACE_RADIUS_BLOCKS * 2 + 1));
  } catch (error) {
    landscapeProviderResolveErrors++;
    console.log('[PROVIDER RESOLVE ERROR] ' + error);
  } finally {
    if (looksLikePointer(service)) {
      try { callObjectMethod(service, 0x28); } catch (_) {}
    }
  }
}

function releaseLandscapeProvider() {
  landscapeProviderLookup = null;
  if (landscapeProvider === null) return;
  try {
    callObjectMethod(landscapeProvider, 0x28);
    console.log('[PROVIDER OFF] Interface reference released.');
  } catch (error) {
    console.log('[PROVIDER RELEASE ERROR] ' + error);
  }
  landscapeProvider = null;
}

function desiredProviderSurfaceBlocks(positionState) {
  const centerX = positionState.add(0x0c).readU8();
  const centerY = positionState.add(0x0d).readU8();
  const cacheKey = centerX + ':' + centerY + ':' + PROVIDER_SURFACE_RADIUS_BLOCKS;
  if (cacheKey === providerBlockCacheKey) return providerBlockCache;

  const blocks = [];
  const seen = new Set();

  for (let y = -PROVIDER_SURFACE_RADIUS_BLOCKS; y <= PROVIDER_SURFACE_RADIUS_BLOCKS; y++) {
    for (let x = -PROVIDER_SURFACE_RADIUS_BLOCKS; x <= PROVIDER_SURFACE_RADIUS_BLOCKS; x++) {
      const blockX = Math.max(0, Math.min(255, centerX + x));
      const blockY = Math.max(0, Math.min(255, centerY + y));
      const key = blockX + ':' + blockY;
      if (seen.has(key)) continue;
      seen.add(key);
      blocks.push({ blockX: blockX, blockY: blockY, dx: x, dy: y });
    }
  }

  blocks.sort(function (a, b) {
    const ringA = Math.max(Math.abs(a.dx), Math.abs(a.dy));
    const ringB = Math.max(Math.abs(b.dx), Math.abs(b.dy));
    if (ringA !== ringB) return ringA - ringB;
    return (Math.abs(a.dx) + Math.abs(a.dy)) - (Math.abs(b.dx) + Math.abs(b.dy));
  });
  providerBlockCacheKey = cacheKey;
  providerBlockCache = blocks;
  providerBlockCacheKeys = new Set();
  providerBlockRemaining.clear();
  blocks.forEach(function (block) {
    const key = block.blockX + ',' + block.blockY;
    providerBlockCacheKeys.add(key);
    if (!providerSurfaceCompleted.has(key) && !providerSurfacePending.has(key)) {
      providerBlockRemaining.add(key);
    }
  });
  providerSurfaceCursor = 0;
  return providerBlockCache;
}

function invalidateProviderBlockCache() {
  providerBlockCacheKey = '';
  providerBlockCache = [];
  providerBlockCacheKeys = new Set();
  providerBlockRemaining.clear();
  providerSurfaceCursor = 0;
}

function invalidateSourceAnchorCache() {
  sourceAnchorCacheKey = '';
  sourceAnchorCache = [];
}

function writeProviderSurfaceKey(output, positionState, block) {
  Memory.copy(output, positionState, 0x18);
  output.writePointer(base.add(LAND_RESOURCE_KEY_VTABLE_RVA));
  output.add(0x08).writeU32(1);
  output.add(0x0c).writeU8(block.blockX);
  output.add(0x0d).writeU8(block.blockY);
}

function lookupProviderSurface(keyPointer, countLookup) {
  if (landscapeProvider === null || landscapeProviderLookup === null) return NULL;
  if (countLookup) providerSurfaceLookupCalls++;
  const surface = landscapeProviderLookup(landscapeProvider, keyPointer);
  if (countLookup && looksLikePointer(surface)) providerSurfaceLookupNonNull++;
  return surface;
}

// Is a provider block's underlying land-source group currently held? Groups are the
// 3x3-block anchors retained by desiredResidencyAnchors and preloadCameraSourceDirect.
function sourceGroupHeldFor(block, region, heldGroups) {
  const groupBaseX = Math.max(0, Math.min(84, Math.floor(block.blockX / 3))) * 3;
  const groupBaseY = Math.max(0, Math.min(84, Math.floor(block.blockY / 3))) * 3;
  return heldGroups.has(groupBaseX + ':' + groupBaseY + ':' + region);
}

// Issue one provider surface request for a block. Returns why it stopped so the
// budget loop can decide whether the slot was actually spent.
function issueProviderSurfaceRequest(positionState, block, blockKey, now) {
  writeProviderSurfaceKey(providerSurfaceKey, positionState, block);

  let surface = NULL;
  try {
    surface = lookupProviderSurface(providerSurfaceKey, true);
  } catch (error) {
    providerSurfaceRequestErrors++;
    console.log('[PROVIDER LOOKUP ERROR] ' + error);
    return 'error';
  }
  if (looksLikePointer(surface)) {
    providerSurfacePending.delete(blockKey);
    providerSurfaceCompleted.add(blockKey);
    providerBlockRemaining.delete(blockKey);
    return 'present';
  }
  const pendingAt = providerSurfacePending.get(blockKey);
  if (pendingAt !== undefined && now - pendingAt < PROVIDER_PENDING_TIMEOUT_MS) {
    providerBlockRemaining.delete(blockKey);
    return 'pending';
  }

  providerSurfaceLastKey = blockKey;
  providerSurfaceRequestCalls++;
  let descriptorInitialized = false;
  let requestAccepted = false;
  try {
    providerRequestDescriptor.writeByteArray(emptyProviderRequestDescriptor);
    providerRequestOutput.writePointer(NULL);
    requestDescriptorInit(providerRequestDescriptor, providerSurfaceKey);
    descriptorInitialized = true;
    providerRequestDescriptor.add(0x18).writeU32(1);
    providerRequestDescriptor.add(0x50).writeU32(requestStamp());

    providerSurfaceLastStatus = providerSurfaceRequest(
      landscapeProvider,
      providerSurfaceKey,
      providerRequestDescriptor,
      providerRequestOutput
    );
    providerSurfaceLastOut = providerRequestOutput.readPointer();
    if (providerSurfaceLastStatus === 0 && looksLikePointer(providerSurfaceLastOut)) {
      providerSurfaceRequestSuccesses++;
      providerSurfacePending.set(blockKey, now);
      providerBlockRemaining.delete(blockKey);
      requestAccepted = true;
    } else {
      providerSurfaceRequestErrors++;
    }
  } catch (error) {
    providerSurfaceRequestErrors++;
    console.log('[PROVIDER REQUEST ERROR] key=' + blockKey + ' ' + error);
  } finally {
    if (descriptorInitialized) {
      try { requestDescriptorDestroy(providerRequestDescriptor); } catch (_) {}
    }
  }
  return requestAccepted ? 'requested' : 'failed';
}

function preloadCameraProviderSurface(positionState) {
  if (!cinematicStreamingEnabled() || providerSurfaceInProgress || !looksLikePointer(positionState)) return;
  if (landscapeProvider === null || landscapeProviderLookup === null) return;

  const now = Date.now();
  if (now - lastProviderSurfaceRequestAt < PROVIDER_REQUEST_INTERVAL_MS) return;
  lastProviderSurfaceRequestAt = now;

  Memory.copy(providerCenterState, positionState, 0x18);
  providerCenterStateValid = true;

  providerSurfacePending.forEach(function (pendingAt, key) {
    if (now - pendingAt > PROVIDER_PENDING_TIMEOUT_MS * 4) {
      providerSurfacePending.delete(key);
      if (providerBlockCacheKeys.has(key) && !providerSurfaceCompleted.has(key)) {
        providerBlockRemaining.add(key);
      }
    }
  });

  const blocks = desiredProviderSurfaceBlocks(positionState);
  if (blocks.length === 0 || providerBlockRemaining.size === 0) return;

  const heldGroups = retainedSourceAnchorKeys();
  if (PARTIAL_GATE) {
    // As long as ANY source group is held we fill the blocks it covers; the
    // rest fill as their groups arrive. This is what lets the grid stream in
    // during flight instead of only after the camera has stopped.
    if (heldGroups.size === 0) return;
  } else {
    // All-or-nothing gate: wait for every centre anchor before requesting anything.
    const allReady = desiredResidencyAnchors(positionState).every(function (anchor) {
      return heldGroups.has(anchor.blockX + ':' + anchor.blockY + ':' + anchor.region);
    });
    if (!allReady) return;
    const readiness = retainedLandSourceReadiness();
    if (readiness.payloadD8 < retainedLandSources.size) return;
  }

  const region = positionState.add(0x0e).readU16();
  let budget = PARTIAL_GATE ? Math.max(1, PROVIDER_BUDGET_PER_PASS) : 1;
  let issued = 0;

  providerSurfaceInProgress = true;
  try {
    for (let offset = 0; offset < blocks.length && budget > 0; offset++) {
      const index = (providerSurfaceCursor + offset) % blocks.length;
      const block = blocks[index];
      const blockKey = block.blockX + ',' + block.blockY;
      if (!providerBlockRemaining.has(blockKey)) continue;
      // Optional hard per-block source gate, off by default: skipping blocks whose
      // group is not held leaves the outer rings patchy. Requesting every block and
      // letting the engine backfill produces a more even grid.
      if (STRICT_BLOCK_GATE && !sourceGroupHeldFor(block, region, heldGroups)) continue;

      const result = issueProviderSurfaceRequest(positionState, block, blockKey, now);
      if (result === 'error') break;
      if (result === 'requested' || result === 'failed' ||
          result === 'present' || result === 'pending') {
        providerSurfaceCursor = (index + 1) % blocks.length;
        if (result === 'requested') issued++;
        budget--;
      }
    }
  } finally {
    providerSurfaceInProgress = false;
  }

  if (issued > 0 && now - lastProviderLogAt > 1000) {
    lastProviderLogAt = now;
    console.log('[PROVIDER PASS] issued=' + issued +
      ' success=' + providerSurfaceRequestSuccesses + '/' + providerSurfaceRequestCalls +
      ' held=' + heldGroups.size +
      ' la=' + lastLookahead.x + ',' + lastLookahead.y +
      ' budget=' + PROVIDER_BUDGET_PER_PASS +
      ' last=' + providerSurfaceLastKey + '/' + providerSurfaceLastStatus);
  }
}

function providerGridReadiness() {
  const result = { total: 0, surfaces: 0, payloads: 0, completed: 0, errors: 0 };
  if (!providerCenterStateValid || landscapeProvider === null || landscapeProviderLookup === null) {
    return result;
  }

  try {
    const blocks = desiredProviderSurfaceBlocks(providerCenterState);
    result.total = blocks.length;
    blocks.forEach(function (block) {
      try {
        if (providerSurfaceCompleted.has(block.blockX + ',' + block.blockY)) {
          result.completed++;
        }
        writeProviderSurfaceKey(providerReadinessKey, providerCenterState, block);
        const surface = lookupProviderSurface(providerReadinessKey, false);
        if (!looksLikePointer(surface)) return;
        result.surfaces++;
        if (looksLikePointer(surface.add(0xd8).readPointer())) result.payloads++;
      } catch (_) {
        result.errors++;
      }
    });
  } catch (_) {
    result.errors++;
  }
  return result;
}

function providerInternalTableStatus() {
  const result = { buckets: 0, nodes: 0, errors: 0 };
  if (landscapeProvider === null) return result;
  try {
    result.buckets = landscapeProvider.add(0x28).readU32();
    result.nodes = landscapeProvider.add(0x2c).readU32();
  } catch (_) {
    result.errors++;
  }
  return result;
}

function releaseRetainedLandSource(key) {
  const source = retainedLandSources.get(key);
  if (source === undefined) return;
  retainedLandSources.delete(key);
  try {
    callObjectMethod(source, 0x28);
  } catch (error) {
    landSourceHoldErrors++;
    console.log('[LAND SOURCE RELEASE ERROR] ' + error);
  }
}

// Where the grass bubble is centred: the flight camera when it is up, otherwise the
// avatar's landblock.
function currentGrassCenter() {
  if (active && target.valid) {
    return { x: target.blockX, y: target.blockY, region: target.region };
  }
  try {
    const box = resolveSmartBox();
    if (box === null) return null;
    const lp = readLandPosition(box.add(0x80), true);
    if (lp === null) return null;
    return { x: lp.blockX, y: lp.blockY, region: lp.region };
  } catch (_) {
    return null;
  }
}

// Called when the retained set is over its cap. Drops the source FARTHEST from the
// camera rather than the oldest one.
//
// Oldest-first is distance-blind: it will happily throw away grass standing right next
// to you because it happened to load first, while keeping a block you left behind ten
// landblocks ago. Once the set sits at its cap - which it does most of the time - that
// is the eviction path doing the work, so it decides what the grass actually looks like.
function releaseFarthestRetainedSource() {
  const center = currentGrassCenter();
  const oldest = retainedLandSources.keys().next().value;
  if (center === null) { releaseRetainedLandSource(oldest); return; }
  let worstKey = null;
  let worstDistance = -1;
  retainedLandSources.forEach(function (_source, key) {
    const parts = key.split(':');
    if (parts.length < 4) { worstKey = key; worstDistance = Infinity; return; }
    const bx = parseInt(parts[1], 10);
    const by = parseInt(parts[2], 10);
    const rg = parseInt(parts[3], 10);
    if (!Number.isFinite(bx) || !Number.isFinite(by)) { worstKey = key; worstDistance = Infinity; return; }
    // Anything from another region is dead weight here - evict it first.
    const distance = rg !== center.region
      ? Infinity
      : Math.max(Math.abs(bx - center.x), Math.abs(by - center.y));
    if (distance > worstDistance) { worstDistance = distance; worstKey = key; }
  });
  releaseRetainedLandSource(worstKey === null ? oldest : worstKey);
}

function retainLandSource(source, keyPointer) {
  // A resource build can finish after restore has started. Do not acquire a new
  // reference after the shutdown pass has released the retained-source map.
  if (!cinematicStreamingEnabled()) return;
  const stableSource = source.add(0);
  const key = landSourceKey(keyPointer, stableSource);
  if (retainedLandSources.has(key)) return;
  try {
    callObjectMethod(stableSource, 0x20);
    retainedLandSources.set(key, stableSource);
    const now = Date.now();
    if (now - lastLandSourceHoldLogAt >= 1000) {
      lastLandSourceHoldLogAt = now;
      console.log('[LAND SOURCE HOLD] held=' + retainedLandSources.size +
        ' newest=' + key + ' source=' + stableSource);
    }
    while (retainedLandSources.size > MAX_RETAINED_LAND_SOURCES) {
      const before = retainedLandSources.size;
      releaseFarthestRetainedSource();
      grassEvictions++;
      if (retainedLandSources.size >= before) break;   // never spin if a release fails
    }
  } catch (error) {
    landSourceHoldErrors++;
    console.log('[LAND SOURCE HOLD ERROR] ' + error);
  }
}

function releaseAllRetainedLandSources() {
  const keys = Array.from(retainedLandSources.keys());
  keys.forEach(releaseRetainedLandSource);
  console.log('[LAND SOURCE HOLD OFF] Released ' + keys.length + ' retained sources.');
}

// Distance-based eviction: drop any retained grass source whose landblock is farther than
// GRASS_EVICT_RADIUS from the current camera block (Chebyshev). Keeps grass a moving bubble
// around the character so it never accumulates behind and tanks FPS. Key format from
// landSourceKey(): landcell:blockX:blockY:region:subcell.
function evictFarLandSources(centerX, centerY, centerRegion) {
  if (renderCacheEnabled) {
    // Photo-cache mode is a trail, not a larger moving bubble. Old grass/source
    // groups survive distance changes until the explicit FIFO memory cap is hit.
    while (retainedLandSources.size > PHOTO_CACHE_MAX_SOURCES) {
      releaseRetainedLandSource(retainedLandSources.keys().next().value);
      grassEvictions++;
    }
    return;
  }

  const toRelease = [];
  retainedLandSources.forEach(function (_source, key) {
    const parts = key.split(':');
    if (parts.length < 4 || parts[0] === 'ptr') { toRelease.push(key); return; }
    const bx = parseInt(parts[1], 10);
    const by = parseInt(parts[2], 10);
    const rg = parseInt(parts[3], 10);
    if (!Number.isFinite(bx) || !Number.isFinite(by)) { toRelease.push(key); return; }
    if (rg !== centerRegion) { toRelease.push(key); return; }   // different world -> drop
    if (Math.max(Math.abs(bx - centerX), Math.abs(by - centerY)) > GRASS_EVICT_RADIUS) {
      toRelease.push(key);
    }
  });
  for (let i = 0; i < toRelease.length; i++) {
    releaseRetainedLandSource(toRelease[i]);
    grassEvictions++;
  }
}

function providerBlockFromKey(key) {
  const parts = key.split(',');
  if (parts.length !== 2) return null;
  const blockX = parseInt(parts[0], 10);
  const blockY = parseInt(parts[1], 10);
  if (!Number.isFinite(blockX) || !Number.isFinite(blockY)) return null;
  return { blockX: blockX, blockY: blockY };
}

function pruneProviderTracking(centerX, centerY) {
  if (renderCacheEnabled) {
    while (providerSurfaceCompleted.size > PHOTO_CACHE_MAX_SURFACES) {
      providerSurfaceCompleted.delete(providerSurfaceCompleted.values().next().value);
    }
    return;
  }

  const keepRadius = PROVIDER_SURFACE_RADIUS_BLOCKS + 2;
  providerSurfaceCompleted.forEach(function (key) {
    const block = providerBlockFromKey(key);
    if (block === null ||
        Math.max(Math.abs(block.blockX - centerX), Math.abs(block.blockY - centerY)) > keepRadius) {
      providerSurfaceCompleted.delete(key);
    }
  });
  providerSurfacePending.forEach(function (_pendingAt, key) {
    const block = providerBlockFromKey(key);
    if (block === null ||
        Math.max(Math.abs(block.blockX - centerX), Math.abs(block.blockY - centerY)) > keepRadius) {
      providerSurfacePending.delete(key);
    }
  });
}

function normalSourceLimit() {
  const groups = 2 * RESIDENCY_GROUP_RADIUS + 1;
  return Math.max(64, groups * groups + 16); // working set plus a small in-flight margin.
}

function finishRenderCachePurge(reason, succeeded, rebuildCurrentBubble) {
  if (succeeded) {
    graphicsPurgeCount++;
    console.log('[VRAM PURGE] DONE count=' + graphicsPurgeCount + ' reason=' + reason + '.');
  }
  graphicsPurgePending = false;
  graphicsPurgeFullReset = false;
  if (!rebuildCurrentBubble) return;

  radiusApplyPending = true;
  enforceRenderBoost();
  enforceFrillBoost();
  enforceTextureBoost();
  setTimeout(function () {
    providerSurfacePending.clear();
    providerSurfaceCompleted.clear();
    invalidateProviderBlockCache();
    invalidateSourceAnchorCache();
    radiusApplyPending = true;
    autoFixMaterialize('(after VRAM purge)');
  }, 500);
}

function runBoundedCacheTrim(reason) {
  onMainThread(function () {
    if (!graphicsPurgePending || graphicsPurgeReason !== reason) return;
    const startedAt = Date.now();
    let enoughReleased = false;
    try {
      enoughReleased = graphicsResourcePurgeBudget(CACHE_TRIM_CHUNK_BYTES);
      graphicsPurgePass++;
      console.log('[CACHE TRIM] pass=' + graphicsPurgePass + '/' + graphicsPurgePasses +
        ' request=' + (CACHE_TRIM_CHUNK_BYTES / (1024 * 1024)) + 'MiB' +
        ' enough=' + enoughReleased + ' time=' + (Date.now() - startedAt) + 'ms');
    } catch (error) {
      console.log('[CACHE TRIM ERROR] ' + error);
      finishRenderCachePurge(reason, false, false);
      return;
    }

    // A false result means fewer old/thrashable resources remained than this chunk.
    if (!enoughReleased || graphicsPurgePass >= graphicsPurgePasses) {
      finishRenderCachePurge(reason, true, false);
      return;
    }
    setTimeout(function () { runBoundedCacheTrim(reason); }, 100);
  });
}

function purgeRenderCaches(reason, fullReset) {
  if (!CACHE_FEATURE_ENABLED) {
    console.log('[CACHE DISABLED] purge ignored; this build has no cache or purge path.');
    return false;
  }
  if (graphicsPurgePending) {
    console.log('[VRAM PURGE] already pending (' + graphicsPurgeReason + ').');
    return false;
  }

  graphicsPurgePending = true;
  graphicsPurgeReason = reason;
  graphicsPurgePass = 0;
  graphicsPurgeFullReset = !!fullReset;

  if (!fullReset) {
    const cachedSourceCount = retainedLandSources.size;
    const cachedSurfaceCount = providerSurfaceCompleted.size;
    const normalSources = normalSourceLimit();
    const center = target.valid ? target : readLandPosition(cachedLandOrigin, false);
    let cachedTrailSurfaceCount = cachedSurfaceCount;
    if (center !== null) {
      cachedTrailSurfaceCount = 0;
      providerSurfaceCompleted.forEach(function (key) {
        const block = providerBlockFromKey(key);
        if (block === null ||
            Math.max(Math.abs(block.blockX - center.blockX),
              Math.abs(block.blockY - center.blockY)) > PROVIDER_SURFACE_RADIUS_BLOCKS + 2) {
          cachedTrailSurfaceCount++;
        }
      });
    }

    if (center !== null) {
      evictFarLandSources(center.blockX, center.blockY, center.region);
      pruneProviderTracking(center.blockX, center.blockY);
    }
    while (retainedLandSources.size > normalSources) {
      releaseRetainedLandSource(retainedLandSources.keys().next().value);
    }

    const excessSources = Math.max(0, cachedSourceCount - retainedLandSources.size);
    const excessSurfaces = cachedTrailSurfaceCount;
    const estimatedOldMiB = excessSources + (excessSurfaces * 0.05);
    graphicsPurgePasses = Math.min(
      CACHE_TRIM_MAX_PASSES,
      Math.max(0, Math.ceil(estimatedOldMiB / 32))
    );

    if (graphicsPurgePasses === 0) {
      graphicsPurgePending = false;
      graphicsPurgeFullReset = false;
      console.log('[CACHE TRIM] SKIPPED - no trail outside the current ' +
        PROVIDER_SURFACE_RADIUS_BLOCKS + '-block bubble; nothing will be rebuilt.');
      return true;
    }

    console.log('[CACHE TRIM] QUEUED reason=' + reason + ' passes=' + graphicsPurgePasses +
      'x' + (CACHE_TRIM_CHUNK_BYTES / (1024 * 1024)) +
      'MiB excessSources=' + excessSources + ' excessSurfaces=' + excessSurfaces +
      ' - current R' + PROVIDER_SURFACE_RADIUS_BLOCKS + ' bubble stays intact.');
    runBoundedCacheTrim(reason);
    return true;
  }

  releaseAllRetainedLandSources();
  providerSurfacePending.clear();
  providerSurfaceCompleted.clear();
  invalidateProviderBlockCache();
  invalidateSourceAnchorCache();
  providerCenterStateValid = false;
  landResourceSourcePointers.clear();
  providerSurfaceCursor = 0;
  directSourceCursor = 0;
  lastProviderSurfaceRequestAt = 0;
  lastDirectSourceAt = 0;
  lastResidencyRequestAt = 0;
  lastCompletedSize = 0;
  graphicsPurgePasses = 1;

  console.log('[VRAM PURGE] FULL RESET START reason=' + reason +
    ' - the game may pause for 20-30 seconds while all graphics resources are discarded.');
  onMainThread(function () {
    try {
      dispatchEngineCommand('PurgeGraphicsResources');
      dispatchEngineCommand('GraphicsResourceManager.FreeSystemMemory');
      finishRenderCachePurge(reason, true, true);
    } catch (error) {
      console.log('[VRAM PURGE ERROR] ' + error);
      finishRenderCachePurge(reason, false, true);
    }
  });
  return true;
}

function setRenderCacheEnabled(enabled) {
  if (!CACHE_FEATURE_ENABLED) {
    renderCacheEnabled = false;
    nativeLandCacheEnabled = false;
    nativeLandCacheApplyPending = false;
    console.log('[CACHE DISABLED] photo/native cache is compiled out; streaming remains transient.');
    return false;
  }
  const nextEnabled = !!enabled;
  if (renderCacheEnabled === nextEnabled) {
    console.log('[PHOTO CACHE] already ' + (nextEnabled ? 'ON' : 'OFF') + '.');
    return false;
  }
  renderCacheEnabled = nextEnabled;
  if (renderCacheEnabled) {
    if (graphicsPurgePending && !graphicsPurgeFullReset) {
      graphicsPurgePending = false;
      graphicsPurgePasses = graphicsPurgePass;
      graphicsPurgeReason = 'cancelled: PHOTO CACHE ON';
      console.log('[CACHE TRIM] cancelled because PHOTO CACHE was enabled again.');
    }
    MAX_RETAINED_LAND_SOURCES = PHOTO_CACHE_MAX_SOURCES;
    queueNativeLandCacheSettings(true);
    // Re-scan the current grass ring so surfaces loaded before the cache was enabled
    // also pick up an explicit reference. Later completions are retained by the
    // provider completion hook as the camera moves.
    providerSurfaceCompleted.clear();
    invalidateProviderBlockCache();
    console.log('[PHOTO CACHE] ON - engine-native landblock/entity-group budgets queued;' +
      ' distance eviction disabled, tracking caps=' + PHOTO_CACHE_MAX_SURFACES +
      ' land keys + ' + PHOTO_CACHE_MAX_SOURCES +
      ' grass sources. Seeding current R' + PROVIDER_SURFACE_RADIUS_BLOCKS + ' ring now.');
    return true;
  }

  GRASS_EVICT_RADIUS = PROVIDER_SURFACE_RADIUS_BLOCKS + 3;
  MAX_RETAINED_LAND_SOURCES = normalSourceLimit();
  console.log('[PHOTO CACHE] OFF - releasing trail references without an automatic GPU purge; current ' +
    PROVIDER_SURFACE_RADIUS_BLOCKS + '-block bubble stays intact. Ctrl+F4 remains the explicit hard reset.');
  nativeLandCacheApplyPending = true;
  onMainThread(function () {
    applyNativeLandCacheSettings(false);
    const beforeSources = retainedLandSources.size;
    const beforeSurfaces = providerSurfaceCompleted.size;
    const center = target.valid ? target : readLandPosition(cachedLandOrigin, false);
    if (center !== null) {
      evictFarLandSources(center.blockX, center.blockY, center.region);
      pruneProviderTracking(center.blockX, center.blockY);
    }
    while (retainedLandSources.size > MAX_RETAINED_LAND_SOURCES) {
      releaseRetainedLandSource(retainedLandSources.keys().next().value);
    }
    console.log('[PHOTO CACHE RELEASE] sources=' + beforeSources + '->' + retainedLandSources.size +
      ' surfaceKeys=' + beforeSurfaces + '->' + providerSurfaceCompleted.size +
      ' GPU purge=skipped (hitch-free DX11 eviction).');
  });
  return true;
}

function retainedLandSourceReadiness() {
  const readiness = {
    readable: 0,
    flag40: 0,
    flag41: 0,
    payloadD8: 0,
    errors: 0
  };

  retainedLandSources.forEach(function (source) {
    try {
      if (!looksLikePointer(source)) throw new Error('invalid retained source');
      readiness.readable++;
      if (source.add(0x40).readU8() !== 0) readiness.flag40++;
      if (source.add(0x41).readU8() !== 0) readiness.flag41++;
      if (looksLikePointer(source.add(0xd8).readPointer())) readiness.payloadD8++;
    } catch (_) {
      readiness.errors++;
    }
  });

  return readiness;
}

function retainedSourceAnchorKeys() {
  const keys = new Set();
  retainedLandSources.forEach(function (_, key) {
    const parts = key.split(':');
    if (parts.length >= 4 && parts[0] !== 'ptr') {
      keys.add(parts[1] + ':' + parts[2] + ':' + parts[3]);
    }
  });
  return keys;
}

// Acquire and retain ONE land-source group anchor. Returns on any step failure
// (so the per-pass loop can move to the next anchor instead of aborting).
function acquireOneLandSource(positionState, anchor) {
  directSourceKeyCalls++;
  try {
    Memory.copy(directSourceState, positionState, 0x38);
    directSourceState.add(0x0c).writeU8(anchor.blockX + 1);
    directSourceState.add(0x0d).writeU8(anchor.blockY + 1);
    directSourceState.add(0x0e).writeU16(anchor.region);

    directSourceKey.writeByteArray(emptyDirectSourceKey);
    directSourceKey.writePointer(base.add(LAND_RESOURCE_KEY_VTABLE_RVA));
    directSourceGroupX.writeU8(0);
    directSourceGroupY.writeU8(0);
    if ((positionToResourceKey(
      directSourceState,
      directSourceGroupX,
      directSourceGroupY,
      directSourceKey
    ) & 0xff) === 0) return;

    directSourceId.writeU32(0);
    if ((resourceKeyToId(0x41, directSourceKey, directSourceId) & 0xff) === 0) return;

    directSourceHandle.writeU64(0);
    const handle = resourceHandleInit(
      directSourceHandle,
      directSourceId.readS32(),
      0x41
    );
    directSourceLookups++;
    const source = resourceUnwrapCall(handle);
    if (!looksLikePointer(source)) return;

    directSourceNonNull++;
    const stableSource = source.add(0);
    const before = retainedLandSources.size;
    retainLandSource(stableSource, directSourceKey);
    callObjectMethod(stableSource, 0x28);
    if (retainedLandSources.size > before) directSourceAdoptions++;
  } catch (error) {
    directSourceErrors++;
    console.log('[DIRECT SOURCE ERROR] ' + error);
  }
}

function preloadCameraSourceDirect(positionState) {
  if (!GRASS_MACHINERY) return;   // LEAK FIX: this pinned up to 96 land sources even with grass "off"
  if (!cinematicStreamingEnabled() || directSourceInProgress || !looksLikePointer(positionState)) return;
  const now = Date.now();
  if (now - lastDirectSourceAt < DIRECT_SOURCE_INTERVAL_MS) return;
  lastDirectSourceAt = now;

  const held = retainedSourceAnchorKeys();
  const desired = desiredSourceAnchors(positionState);

  directSourceInProgress = true;
  try {
    // Acquire several missing source groups per pass. One per interval is far too slow
    // for a moving camera: 25 groups at one per 150 ms would take nearly four seconds.
    const budget = Math.max(1, DIRECT_SOURCE_PER_PASS);
    let attempted = 0;
    for (let i = 0; i < desired.length && attempted < budget; i++) {
      const anchor = desired[i];
      if (held.has(anchor.blockX + ':' + anchor.blockY + ':' + anchor.region)) continue;
      acquireOneLandSource(positionState, anchor);
      attempted++;
    }
    directSourceCursor = 0;
  } finally {
    directSourceInProgress = false;
  }
}

function residencyAnchors() {
  if (!looksLikePointer(streamObject)) return [];
  try {
    const count = streamObject.add(0xe4).readU32();
    const entries = streamObject.add(0xd8).readPointer();
    if (!looksLikePointer(entries)) return [];

    const anchors = [];
    for (let index = 0; index < Math.min(count, 32); index++) {
      const entry = entries.add(index * 0x18);
      anchors.push({
        blockX: entry.add(0x0c).readU8(),
        blockY: entry.add(0x0d).readU8(),
        region: entry.add(0x0e).readU16()
      });
    }
    return anchors;
  } catch (_) {
    return [];
  }
}

function desiredSourceAnchors(positionState) {
  const blockX = positionState.add(0x0c).readU8();
  const blockY = positionState.add(0x0d).readU8();
  const region = positionState.add(0x0e).readU16();
  const groupX = Math.floor(blockX / 3);
  const groupY = Math.floor(blockY / 3);
  const cacheKey = groupX + ':' + groupY + ':' + region + ':' + RESIDENCY_GROUP_RADIUS;
  if (cacheKey === sourceAnchorCacheKey) return sourceAnchorCache;

  const desired = [];
  const seen = new Set();

  for (let y = -RESIDENCY_GROUP_RADIUS; y <= RESIDENCY_GROUP_RADIUS; y++) {
    for (let x = -RESIDENCY_GROUP_RADIUS; x <= RESIDENCY_GROUP_RADIUS; x++) {
      const targetGroupX = Math.max(0, Math.min(84, groupX + x));
      const targetGroupY = Math.max(0, Math.min(84, groupY + y));
      const key = targetGroupX + ':' + targetGroupY;
      if (seen.has(key)) continue;
      seen.add(key);
      desired.push({
        blockX: targetGroupX * 3,
        blockY: targetGroupY * 3,
        region: region,
        dx: x,
        dy: y
      });
    }
  }
  desired.sort(function (a, b) {
    const ringA = Math.max(Math.abs(a.dx), Math.abs(a.dy));
    const ringB = Math.max(Math.abs(b.dx), Math.abs(b.dy));
    if (ringA !== ringB) return ringA - ringB;
    return (Math.abs(a.dx) + Math.abs(a.dy)) - (Math.abs(b.dx) + Math.abs(b.dy));
  });
  sourceAnchorCacheKey = cacheKey;
  sourceAnchorCache = desired;
  return sourceAnchorCache;
}

// The native stream object has nine residency slots. Feeding it every source
// group made those slots rotate forever from the far corner of the grid. Keep
// them stable at the camera center plus the eight edges; direct source loading
// above still fills every 3x3 group inside the 12-block bubble.
function desiredResidencyAnchors(positionState) {
  const blockX = positionState.add(0x0c).readU8();
  const blockY = positionState.add(0x0d).readU8();
  const region = positionState.add(0x0e).readU16();
  const groupX = Math.floor(blockX / 3);
  const groupY = Math.floor(blockY / 3);
  const radius = RESIDENCY_GROUP_RADIUS;
  const offsets = [
    [0, 0],
    [-radius, 0], [radius, 0], [0, -radius], [0, radius],
    [-radius, -radius], [radius, -radius], [-radius, radius], [radius, radius]
  ];
  const desired = [];
  const seen = new Set();
  offsets.forEach(function (offset) {
    const targetGroupX = Math.max(0, Math.min(84, groupX + offset[0]));
    const targetGroupY = Math.max(0, Math.min(84, groupY + offset[1]));
    const key = targetGroupX + ':' + targetGroupY;
    if (seen.has(key)) return;
    seen.add(key);
    desired.push({
      blockX: targetGroupX * 3,
      blockY: targetGroupY * 3,
      region: region
    });
  });
  return desired.slice(0, RESIDENCY_MAX_ANCHORS);
}

function residencyKey(anchor) {
  return anchor.region + ':' + anchor.blockX + ':' + anchor.blockY;
}

function preloadCameraResidency(positionState) {
  if (!residencyGridEnabled || !looksLikePointer(positionState)) return;
  if (resolveSmartBox() === null || !looksLikePointer(streamObject)) return;

  const now = Date.now();
  if (now - lastResidencyRequestAt < RESIDENCY_REQUEST_INTERVAL_MS) return;
  lastResidencyRequestAt = now;

  const existing = new Set(residencyAnchors().map(residencyKey));
  const missing = desiredResidencyAnchors(positionState)
    .filter(function (anchor) { return !existing.has(residencyKey(anchor)); });
  if (missing.length === 0) return;

  for (let index = 0; index < Math.min(missing.length, RESIDENCY_REQUESTS_PER_PASS); index++) {
    const anchor = missing[index];
    try {
      Memory.copy(residencyProbeState, positionState, 0x38);
      residencyProbeState.add(0x0c).writeU8(anchor.blockX + 1);
      residencyProbeState.add(0x0d).writeU8(anchor.blockY + 1);
      residencyProbeState.add(0x0e).writeU16(anchor.region);
      residencyProbeState.add(0x18).writeFloat(80.0);
      residencyProbeState.add(0x1c).writeFloat(80.0);
      landResidencyUpdate(streamObject, residencyProbeState);
      residencyGridCalls++;
    } catch (error) {
      residencyGridErrors++;
      console.log('[RESIDENCY GRID ERROR] ' + error);
      break;
    }
  }
}

function enableResidencyGrid() {
  if (residencyGridEnabled) return;
  const expected = [0x41, 0x83, 0xfa, 0x04];
  const patched = [0x41, 0x83, 0xfa, RESIDENCY_MAX_ANCHORS - 1];
  let originalMatches = true;
  let patchedMatches = true;
  for (let index = 0; index < expected.length; index++) {
    const current = landResidencyLimitPatch.add(index).readU8();
    if (current !== expected[index]) originalMatches = false;
    if (current !== patched[index]) patchedMatches = false;
  }
  if (!originalMatches && !patchedMatches) {
    console.log('[RESIDENCY GRID] Disabled: cache-limit instruction bytes do not match.');
    return;
  }
  if (patchedMatches) {
    // A previous session may have detached while the expanded instruction was
    // still active. Reconstruct the known original bytes so this session can
    // restore them after releasing its anchors.
    originalResidencyLimitCode = expected.slice();
    residencyGridEnabled = true;
    console.log('[RESIDENCY GRID ON] Existing nine-anchor process patch detected.');
    return;
  }

  originalResidencyLimitCode = landResidencyLimitPatch.readByteArray(expected.length);
  Memory.patchCode(landResidencyLimitPatch, 16, function (code) {
    code.writeByteArray(patched);
  });
  residencyGridEnabled = true;

  console.log(
    '[RESIDENCY GRID ON] anchors=' + RESIDENCY_MAX_ANCHORS +
    ' coverage=9x9 landblocks | manager 0x995950'
  );
}

function disableResidencyGrid() {
  if (!residencyGridEnabled) return;
  residencyGridEnabled = false;
  const anchorCount = residencyAnchors().length;
  if (originalResidencyLimitCode !== null && anchorCount <= 5) {
    const saved = originalResidencyLimitCode;
    Memory.patchCode(landResidencyLimitPatch, 16, function (code) {
      code.writeByteArray(saved);
    });
    originalResidencyLimitCode = null;
    console.log('[RESIDENCY GRID OFF] Original five-anchor cache limit restored.');
  } else {
    console.log(
      '[RESIDENCY GRID OFF] Limit patch retained because ' + anchorCount +
      ' anchors are still resident; game restart restores original code.'
    );
  }
}

function resolveFrillEngine() {
  try {
    const candidate = frillEngineGlobal.readPointer();
    if (!looksLikePointer(candidate)) return null;
    if (frillEngine === null || !candidate.equals(frillEngine)) {
      frillEngine = candidate;
      originalFrillEngineSettings = {
        runtimeDensity: frillEngine.add(0x60).readFloat(),
        runtimeDistance: frillEngine.add(0x64).readU32(),
        useDepthTransitions: frillEngine.add(0x9c).readU8(),
        extraPreCache: frillEngine.add(0xa0).readU32(),
        depthFade: frillEngine.add(0xe0).readFloat(),
        reductionDistance: frillEngine.add(0xe4).readFloat(),
        enableReduction: frillEngine.add(0xe8).readU8(),
        playerPositionBlend: frillEngine.add(0xec).readFloat()
      };
      console.log(
        '[FRILL ENGINE] ' + frillEngine +
        ' runtime=' + originalFrillEngineSettings.runtimeDistance +
        '/' + originalFrillEngineSettings.runtimeDensity.toFixed(2) +
        ' precache=' + originalFrillEngineSettings.extraPreCache +
        ' reduction=' + originalFrillEngineSettings.enableReduction +
        ' playerBlend=' + originalFrillEngineSettings.playerPositionBlend.toFixed(2)
      );
    }
    return frillEngine;
  } catch (_) {
    frillEngine = null;
    originalFrillEngineSettings = null;
    return null;
  }
}

function boostedFrillDensity() {
  return FRILL_DENSITY_MAX;
}

function markTextureFilteringDirty() {
  textureFilterDirty.writeU8(1);
}

function enforceTextureBoost() {
  if (!textureBoostEnabled) return;
  writeU32IfChanged(textureFiltering, TEXTURE_FILTERING_MAX);
  writeU32IfChanged(anisotropicQuality, ANISOTROPIC_QUALITY_MAX);
  writeU32IfChanged(textureDetail, TEXTURE_DETAIL_MAX);
  writeFloatIfChanged(graphicsMemoryUsage, GRAPHICS_MEMORY_USAGE_MAX);
}

function enableTextureBoost() {
  if (textureBoostEnabled) return;
  textureBoostEnabled = true;
  enforceTextureBoost();
  markTextureFilteringDirty();
  console.log(
    '[TEXTURE ON] detail=' + TEXTURE_DETAIL_MAX +
    ' filtering=' + TEXTURE_FILTERING_MAX +
    ' aniso=' + ANISOTROPIC_QUALITY_MAX +
    ' memory=' + GRAPHICS_MEMORY_USAGE_MAX.toFixed(1) +
    ' mipBias=' + TEXTURE_MIP_BIAS.toFixed(1)
  );
}

function disableTextureBoost() {
  if (!textureBoostEnabled) return;
  textureBoostEnabled = false;
  textureFiltering.writeU32(originalTextureFiltering);
  anisotropicQuality.writeU32(originalAnisotropicQuality);
  textureDetail.writeU32(originalTextureDetail);
  graphicsMemoryUsage.writeFloat(originalGraphicsMemoryUsage);
  markTextureFilteringDirty();
  console.log('[TEXTURE OFF] Texture detail, filtering, memory scale and mip bias restored.');
}

function enableHybridLodMode() {
  lodBoostEnabled = false;
  writeU8IfChanged(allowLodsFlag, 1);
  writeU8IfChanged(distantImposters, 1);
  impostersEnabled = true;
  console.log('[TREE LOD HYBRID] AllowLODs=1 + ModelDetail=Ultra + ObjectDistance=Ultra; distant trees use medium 3D when resident, otherwise keep 2D fallback.');
}

// Undo the hybrid tree mode by putting both values back where the client had them.
function disableHybridLodMode() {
  writeU8IfChanged(allowLodsFlag, originalAllowLods);
  writeU8IfChanged(distantImposters, originalDistantImposters);
  impostersEnabled = originalDistantImposters !== 0;
  console.log('[TREE LOD HYBRID] OFF - AllowLODs and imposters back to the client values.');
}

function enforceLodBoost() {
  if (lodBoostEnabled) {
    writeU8IfChanged(allowLodsFlag, 0);
  }
}

function enableLodBoost() {
  if (lodBoostEnabled) return;
  lodBoostEnabled = true;
  enforceLodBoost();
  console.log('[3D LOD0 DIAGNOSTIC] AllowLODs=0; full model where loaded, 2D/medium fallback may disappear.');
}

function disableLodBoost() {
  if (!lodBoostEnabled) return;
  lodBoostEnabled = false;
  if (HYBRID_DISTANT_TREE_LODS) {
    enableHybridLodMode();
  } else {
    allowLodsFlag.writeU8(originalAllowLods);
    console.log('[3D LOD OFF] SceneRender.AllowLODs restored to ' + originalAllowLods + '.');
  }
}

function cinematicFrillBudgetMultiplier() {
  return FRILL_BUDGET_MS_AT_60FPS / 16000.0;
}

function enforceFrillBoost() {
  if (!frillBoostEnabled) return;
  writeU32IfChanged(frillDistanceQuality, 5);
  writeFloatIfChanged(frillDensity, boostedFrillDensity());
  patchReadonlyFloatIfChanged(frillTimeBudgetMultiplier, cinematicFrillBudgetMultiplier());

  const engine = resolveFrillEngine();
  if (engine === null) return;
  writeFloatIfChanged(engine.add(0x60), boostedFrillDensity());
  writeU32IfChanged(engine.add(0x64), FRILL_DISTANCE_SECTORS);
  writeU32IfChanged(engine.add(0xa0), FRILL_EXTRA_PRECACHE_LEVELS);
  writeFloatIfChanged(engine.add(0xe0), FRILL_DEPTH_FADE_SECTORS);
  writeFloatIfChanged(engine.add(0xe4), FRILL_FULL_DENSITY_SECTORS);
  writeU8IfChanged(engine.add(0xe8), FRILL_REDUCTION_ENABLED);
  writeFloatIfChanged(engine.add(0xec), 0.0);
}

function enableFrillBoost() {
  if (frillBoostEnabled) return;
  resolveFrillEngine();
  frillBoostEnabled = true;
  enforceFrillBoost();
  console.log(
    '[FRILL ON] distance=' + FRILL_DISTANCE_SECTORS +
    ' density=' + FRILL_DENSITY_MAX.toFixed(1) +
    ' precache=' + FRILL_EXTRA_PRECACHE_LEVELS +
    ' fullDensityUntil=' + FRILL_FULL_DENSITY_SECTORS.toFixed(1) +
    ' reduction=' + FRILL_REDUCTION_ENABLED + ' playerBlend=0.0' +
    ' mainThreadBudget=' + FRILL_BUDGET_MS_AT_60FPS.toFixed(1) + 'ms@60fps'
  );
}

function disableFrillBoost() {
  if (!frillBoostEnabled) return;
  frillBoostEnabled = false;
  frillDistanceQuality.writeU32(originalFrillDistanceQuality);
  frillDensity.writeFloat(originalFrillDensity);
  patchReadonlyFloatIfChanged(frillTimeBudgetMultiplier, originalFrillTimeBudgetMultiplier);

  const engine = resolveFrillEngine();
  if (engine !== null && originalFrillEngineSettings !== null) {
    engine.add(0x60).writeFloat(originalFrillEngineSettings.runtimeDensity);
    engine.add(0x64).writeU32(originalFrillEngineSettings.runtimeDistance);
    engine.add(0x9c).writeU8(originalFrillEngineSettings.useDepthTransitions);
    engine.add(0xa0).writeU32(originalFrillEngineSettings.extraPreCache);
    engine.add(0xe0).writeFloat(originalFrillEngineSettings.depthFade);
    engine.add(0xe4).writeFloat(originalFrillEngineSettings.reductionDistance);
    engine.add(0xe8).writeU8(originalFrillEngineSettings.enableReduction);
    engine.add(0xec).writeFloat(originalFrillEngineSettings.playerPositionBlend);
  }
  console.log('[FRILL OFF] Grass/frill settings restored.');
}

function toggleDistantImposters() {
  impostersEnabled = !impostersEnabled;
  distantImposters.writeU8(impostersEnabled ? 1 : 0);
  console.log('[IMPOSTERS] ' + (impostersEnabled ? 'ON (2D distant sprites)' : 'OFF (3D-only diagnostic)'));
}

function resolveSmartBox() {
  try {
    const candidate = smartBoxGlobal.readPointer();
    if (!looksLikePointer(candidate)) return null;
    if (smartBox === null || !candidate.equals(smartBox)) {
      smartBox = candidate;
      const root = smartBox.readPointer();
      streamObject = looksLikePointer(root) ? root.add(0x20).readPointer() : null;
      if (!looksLikePointer(streamObject)) streamObject = null;
      const baselineKey = smartBox.toString();
      let baseline = smartBoxBaselines.get(baselineKey);
      if (baseline === undefined) {
        baseline = {
          loadWorldForPlayer: smartBox.add(0x250).readU8(),
          streamSettings: {
            overrideEnabled: smartBox.add(0x243).readU8(),
            overrideRadius: smartBox.add(0x244).readU32(),
            far: streamObject === null ? -1 : streamObject.add(0x38).readU32(),
            near: streamObject === null ? -1 : streamObject.add(0x3c).readU32()
          }
        };
        smartBoxBaselines.set(baselineKey, baseline);
      }
      originalLoadWorldForPlayer = baseline.loadWorldForPlayer;
      originalStreamSettings = baseline.streamSettings;
      console.log(
        '[SMARTBOX] ' + smartBox +
        ' original LoadWorldForPlayerPosition=' + originalLoadWorldForPlayer +
        ' stream=' + originalStreamSettings.far + '/' + originalStreamSettings.near
      );
    }
    return smartBox;
  } catch (_) {
    smartBox = null;
    streamObject = null;
    originalLoadWorldForPlayer = null;
    originalStreamSettings = null;
    return null;
  }
}

function patchObjectDistance() {
  if (originalObjectCode !== null) return;
  originalObjectCode = objectDistanceFunction.readByteArray(objectDistancePatch.length);
  Memory.patchCode(objectDistanceFunction, 32, function (code) {
    code.writeByteArray(objectDistancePatch);
  });
}

function restoreObjectDistance() {
  if (originalObjectCode === null) return;
  const saved = originalObjectCode;
  Memory.patchCode(objectDistanceFunction, 32, function (code) {
    code.writeByteArray(saved);
  });
  originalObjectCode = null;
}

function enforceRenderBoost() {
  if (!renderBoostEnabled) return;
  const box = resolveSmartBox();
  if (box !== null) {
    writeU8IfChanged(box.add(0x243), 1);
    writeU32IfChanged(box.add(0x244), FAR_RADIUS);
    if (streamObject !== null) {
      writeU32IfChanged(streamObject.add(0x38), FAR_RADIUS);
      writeU32IfChanged(streamObject.add(0x3c), NEAR_RADIUS);
    }
  }
}

function enableRenderBoost() {
  if (renderBoostEnabled) return;
  resolveSmartBox();
  renderBoostEnabled = true;
  enforceRenderBoost();
  radiusApplyPending = true;
  console.log(
    '[TOPOLOGY ON] far/near=' + FAR_RADIUS + '/' + NEAR_RADIUS +
    ' sectors (' + (FAR_RADIUS / 16).toFixed(1) + ' land blocks)' +
    ' | object distance and StaticPVS unchanged'
  );
}

// Live push of the high-detail landscape radius. The medium band remains 160
// sectors outside it. Grass/provider coverage is intentionally independent.
function bumpFarRadius(delta) {
  const nextNear = Math.max(16, Math.min(NEAR_RADIUS_CAP, NEAR_RADIUS + delta));
  if (nextNear === NEAR_RADIUS) {
    console.log('[LAND RADIUS] high-detail limit (' + NEAR_RADIUS + ')');
    return;
  }
  NEAR_RADIUS = nextNear;
  FAR_RADIUS = Math.min(FAR_RADIUS_MAX, NEAR_RADIUS + MEDIUM_LAND_BAND_SECTORS);
  if (!renderBoostEnabled) { enableRenderBoost(); }
  else { enforceRenderBoost(); radiusApplyPending = true; }
  console.log('[LAND RADIUS] high=' + NEAR_RADIUS + ' (' + (NEAR_RADIUS / 16).toFixed(1) +
    ' blocks) medium=' + FAR_RADIUS + ' (' + (FAR_RADIUS / 16).toFixed(1) +
    ' blocks); grass/provider stay=' + PROVIDER_SURFACE_RADIUS_BLOCKS + ' blocks');
}

function disableRenderBoost() {
  if (!renderBoostEnabled && originalObjectCode === null) return;
  renderBoostEnabled = false;
  restoreObjectDistance();
  staticPvsFlag.writeU8(originalStaticPvs);

  const box = resolveSmartBox();
  if (box !== null && originalStreamSettings !== null) {
    box.add(0x243).writeU8(originalStreamSettings.overrideEnabled);
    box.add(0x244).writeU32(originalStreamSettings.overrideRadius);
    if (streamObject !== null && originalStreamSettings.far >= 0) {
      streamObject.add(0x38).writeU32(originalStreamSettings.far);
      streamObject.add(0x3c).writeU32(originalStreamSettings.near);
    }
  }
  radiusApplyPending = true;
  console.log('[TOPOLOGY OFF] Original landscape radii restored.');
}

function setCameraCenteredStreaming(enabled) {
  // Pins SmartBox+0x250 (LoadWorldForPlayerPosition) so world loading follows the
  // camera instead of the avatar. Without it the camera can fly well past the region
  // the engine is still streaming for the player.
  if (!CAMERA_CENTERED_STREAMING) return;
  const box = resolveSmartBox();
  if (box === null) return;
  try {
    if (enabled) {
      if (!cameraCenteredStreamingApplied || box.add(0x250).readU8() !== 0) {
        box.add(0x250).writeU8(0);
      }
      if (!cameraCenteredStreamingApplied) {
        console.log('[WORLD LOCK] ON - streaming follows cinematic target; region remains ' +
          (target.valid ? target.region : 'unknown') + '.');
      }
      cameraCenteredStreamingApplied = true;
    } else if (originalLoadWorldForPlayer !== null) {
      box.add(0x250).writeU8(originalLoadWorldForPlayer);
      if (cameraCenteredStreamingApplied) {
        console.log('[WORLD LOCK] OFF - LoadWorldForPlayerPosition restored to ' +
          box.add(0x250).readU8() + '.');
      }
      cameraCenteredStreamingApplied = false;
    }
  } catch (error) {
    console.log('[SMARTBOX ERROR] ' + error);
  }
}

function packedCellIdFor(blockX, blockY) {
  return (
    ((target.region & 0xffff) << 16) |
    ((blockY & 0xff) << 8) |
    (blockX & 0xff)
  ) >>> 0;
}

function clampBlock(value) {
  return Math.max(0, Math.min(255, value));
}

function worldCellProxyScratch() {
  const threadId = Process.getCurrentThreadId();
  let scratch = worldCellProxyScratchByThread.get(threadId);
  if (scratch === undefined) {
    scratch = Memory.alloc(0x38);
    worldCellProxyScratchByThread.set(threadId, scratch);
  }
  return scratch;
}

function worldCellProxyListenersReady() {
  return looksLikePointer(worldCellPrimaryListener) &&
    looksLikePointer(worldCellSecondaryListener) &&
    looksLikePointer(worldCellEnterListener);
}

function scanWorldCellProxyListeners(broadcaster) {
  if (!looksLikePointer(broadcaster)) return false;
  worldCellProxyScans++;
  try {
    const buckets = broadcaster.add(0x10).readPointer();
    const bucketCount = broadcaster.add(0x20).readU32();
    if (!looksLikePointer(buckets) || bucketCount === 0 || bucketCount > 0x10000) {
      return false;
    }
    const seenNodes = new Set();
    for (let i = 0; i < bucketCount; i++) {
      let node = buckets.add(i * Process.pointerSize).readPointer();
      let depth = 0;
      while (looksLikePointer(node) && depth < 4096) {
        const key = node.toString();
        if (seenNodes.has(key)) break;
        seenNodes.add(key);
        const listener = node.add(0x18).readPointer();
        if (looksLikePointer(listener)) {
          const vtable = listener.readPointer();
          if (looksLikePointer(vtable)) {
            const move = vtable.add(0x30).readPointer();
            const leave = vtable.add(0x38).readPointer();
            const enter = vtable.add(0x40).readPointer();
            if (leave.equals(base.add(WORLD_CELL_PRIMARY_RVA))) {
              worldCellPrimaryListener = listener;
            }
            if (leave.equals(base.add(WORLD_CELL_SECONDARY_RVA))) {
              worldCellSecondaryListener = listener;
            }
            if (enter.equals(base.add(WORLD_CELL_ENTER_RVA))) {
              worldCellEnterListener = listener;
            }
            // Reading all three slots also validates the vtable before retaining
            // a borrowed listener pointer; no engine reference count is changed.
            void move;
          }
        }
        node = node.add(0x10).readPointer();
        depth++;
      }
    }
  } catch (_) {
    worldCellProxyErrors++;
    return false;
  }
  if (worldCellProxyListenersReady()) {
    console.log('[OBJECT STREAM] listeners locked primary=' + worldCellPrimaryListener +
      ' secondary=' + worldCellSecondaryListener + ' enter=' + worldCellEnterListener + '.');
    return true;
  }
  return false;
}

function captureWorldCellProxy(object) {
  if (!CAMERA_WORLD_CELL_STREAMING || !looksLikePointer(object)) return false;
  try {
    const broadcaster = object.add(0x1f0).readPointer();
    const entity = object.add(0x18).readPointer();
    if (!looksLikePointer(broadcaster) || !looksLikePointer(entity)) return false;
    worldCellProxyBroadcaster = broadcaster;
    worldCellProxyEntity = entity;
    if (!worldCellProxyListenersReady()) scanWorldCellProxyListeners(broadcaster);
    return true;
  } catch (_) {
    worldCellProxyErrors++;
    return false;
  }
}

function armWorldCellProxyBaseline() {
  if (!CAMERA_WORLD_CELL_STREAMING || !looksLikePointer(renderProxyCandidate)) return;
  try {
    captureWorldCellProxy(renderProxyCandidate);
    worldCellProxyLastCell = renderProxyCandidate.add(0x98).add(0x0c).readU32();
    worldCellProxyDisplaced = false;
    worldCellProxyLastDispatchAt = 0;
    worldCellProxyPrefetch = null;
    console.log('[OBJECT STREAM] ARMED at player cell=0x' +
      worldCellProxyLastCell.toString(16) + '; dispatch only on camera block changes.');
  } catch (_) {
    worldCellProxyErrors++;
  }
}

function buildWorldCellProxyState(templateState, streamTarget) {
  if (!looksLikePointer(templateState) || streamTarget === null || streamTarget === undefined) {
    return null;
  }
  const scratch = worldCellProxyScratch();
  Memory.copy(scratch, templateState, 0x38);
  scratch.add(0x0c).writeU32(packedCellIdFor(streamTarget.blockX, streamTarget.blockY));
  scratch.add(0x18).writeFloat(streamTarget.x);
  scratch.add(0x1c).writeFloat(streamTarget.y);
  scratch.add(0x20).writeFloat(streamTarget.z);
  return scratch;
}

function dispatchWorldCellProxy(entity, state, reason) {
  if (worldCellProxyDispatching || !looksLikePointer(state)) return false;
  if (!worldCellProxyListenersReady() &&
      !scanWorldCellProxyListeners(worldCellProxyBroadcaster)) return false;
  const dispatchEntity = looksLikePointer(entity) ? entity : worldCellProxyEntity;
  if (!looksLikePointer(dispatchEntity)) return false;
  worldCellProxyDispatching = true;
  try {
    // Match FUN_1405cffb0's native order: all +0x38 cell-change listeners,
    // followed by the +0x40 cell-entry listener. Their +0x30 movement slots are no-ops.
    worldCellPrimary(worldCellPrimaryListener, dispatchEntity, state);
    worldCellSecondary(worldCellSecondaryListener, dispatchEntity, state);
    worldCellEnter(worldCellEnterListener, dispatchEntity, state);
    worldCellProxyDispatches++;
    const cell = state.add(0x0c).readU32();
    console.log('[OBJECT STREAM] ' + reason + ' cell=0x' + cell.toString(16) +
      ' dispatch=' + worldCellProxyDispatches + '.');
    return true;
  } catch (error) {
    worldCellProxyErrors++;
    console.log('[OBJECT STREAM ERROR] ' + error);
    return false;
  } finally {
    worldCellProxyDispatching = false;
  }
}

function restoreWorldCellProxyFromPlayer(reason) {
  if (!worldCellProxyDisplaced || !looksLikePointer(renderProxyCandidate)) return;
  try {
    const playerState = renderProxyCandidate.add(0x98);
    if (dispatchWorldCellProxy(worldCellProxyEntity, playerState, reason + ' RECENTER')) {
      worldCellProxyLastCell = playerState.add(0x0c).readU32();
      worldCellProxyDisplaced = false;
      worldCellProxyPrefetch = null;
    }
  } catch (_) {
    worldCellProxyErrors++;
  }
}

function cameraWorldStreamTarget(vx, vy) {
  const streamTarget = {
    blockX: target.blockX,
    blockY: target.blockY,
    x: target.x,
    y: target.y,
    z: target.z,
    prefetched: false,
    prefetchMeta: null
  };
  const actualCell = packedCellIdFor(target.blockX, target.blockY);

  if (worldCellProxyPrefetch !== null) {
    if (actualCell === worldCellProxyPrefetch.targetCell) {
      // The camera entered the cell that was prepared in advance. Keep the loaded
      // cell and end the prediction without another callback.
      worldCellProxyPrefetch = null;
      return streamTarget;
    }
    if (actualCell === worldCellProxyPrefetch.sourceCell) {
      const prefetch = worldCellProxyPrefetch;
      let keep = false;
      if (prefetch.axis === 'x') {
        keep = prefetch.direction > 0
          ? target.x >= BLOCK_SIZE - OBJECT_STREAM_RELEASE_MARGIN
          : target.x <= OBJECT_STREAM_RELEASE_MARGIN;
      } else {
        keep = prefetch.direction > 0
          ? target.y >= BLOCK_SIZE - OBJECT_STREAM_RELEASE_MARGIN
          : target.y <= OBJECT_STREAM_RELEASE_MARGIN;
      }
      if (keep) {
        const held = Object.assign({}, prefetch.streamTarget);
        held.z = target.z;
        return held;
      }
    }
    // The camera retreated well inside the source cell or crossed a different
    // boundary. Re-center once; the release margin prevents edge ping-pong.
    worldCellProxyPrefetch = null;
  }

  const candidates = [];
  if (vx >= OBJECT_STREAM_MIN_PRELOAD_SPEED &&
      target.x >= BLOCK_SIZE - OBJECT_STREAM_PRELOAD_MARGIN) {
    candidates.push({ axis: 'x', direction: 1, eta: (BLOCK_SIZE - target.x) / vx });
  } else if (vx <= -OBJECT_STREAM_MIN_PRELOAD_SPEED &&
             target.x <= OBJECT_STREAM_PRELOAD_MARGIN) {
    candidates.push({ axis: 'x', direction: -1, eta: target.x / -vx });
  }
  if (vy >= OBJECT_STREAM_MIN_PRELOAD_SPEED &&
      target.y >= BLOCK_SIZE - OBJECT_STREAM_PRELOAD_MARGIN) {
    candidates.push({ axis: 'y', direction: 1, eta: (BLOCK_SIZE - target.y) / vy });
  } else if (vy <= -OBJECT_STREAM_MIN_PRELOAD_SPEED &&
             target.y <= OBJECT_STREAM_PRELOAD_MARGIN) {
    candidates.push({ axis: 'y', direction: -1, eta: target.y / -vy });
  }
  if (candidates.length === 0) return streamTarget;

  candidates.sort(function (left, right) { return left.eta - right.eta; });
  const selected = candidates[0];
  if (selected.axis === 'x') {
    streamTarget.blockX = (target.blockX + selected.direction) & 0xff;
    streamTarget.x = selected.direction > 0 ? 1.0 : BLOCK_SIZE - 1.0;
  } else {
    streamTarget.blockY = (target.blockY + selected.direction) & 0xff;
    streamTarget.y = selected.direction > 0 ? 1.0 : BLOCK_SIZE - 1.0;
  }
  streamTarget.prefetched = true;
  streamTarget.prefetchMeta = {
    sourceCell: actualCell,
    targetCell: packedCellIdFor(streamTarget.blockX, streamTarget.blockY),
    axis: selected.axis,
    direction: selected.direction,
    streamTarget: Object.assign({}, streamTarget, { prefetchMeta: null })
  };
  return streamTarget;
}

function updateCameraWorldCellStreaming(vx, vy) {
  if (!CAMERA_WORLD_CELL_STREAMING || !active || !target.valid ||
      !looksLikePointer(renderProxyCandidate)) return false;
  const streamTarget = cameraWorldStreamTarget(vx, vy);
  const streamCell = packedCellIdFor(streamTarget.blockX, streamTarget.blockY);
  if (streamCell === worldCellProxyLastCell) return true;
  const now = Date.now();
  if (now - worldCellProxyLastDispatchAt < OBJECT_STREAM_DISPATCH_COOLDOWN_MS) return false;
  try {
    captureWorldCellProxy(renderProxyCandidate);
    const playerState = renderProxyCandidate.add(0x98);
    const proxyState = buildWorldCellProxyState(playerState, streamTarget);
    if (proxyState === null ||
        !dispatchWorldCellProxy(
          worldCellProxyEntity,
          proxyState,
          streamTarget.prefetched ? 'CAMERA PRELOAD' : 'CAMERA CENTER'
        )) {
      return false;
    }
    worldCellProxyLastCell = streamCell;
    worldCellProxyDisplaced = true;
    worldCellProxyLastDispatchAt = now;
    worldCellProxyPrefetch = streamTarget.prefetched ? streamTarget.prefetchMeta : null;
    return true;
  } catch (_) {
    worldCellProxyErrors++;
    return false;
  }
}

// Blocks to shift the preload center ahead, given a per-axis velocity (u/s).
function lookaheadBlocks(velocity) {
  if (!LOOKAHEAD_ENABLED) return 0;
  const blocks = Math.round((velocity * LOOKAHEAD_SECONDS) / BLOCK_SIZE);
  return Math.max(-MAX_LOOKAHEAD_BLOCKS, Math.min(MAX_LOOKAHEAD_BLOCKS, blocks));
}

function buildCameraTargetPreloadState(templateState) {
  if (!looksLikePointer(templateState)) return null;
  Memory.copy(cameraTargetPreloadState, templateState, 0x38);

  if (!active || !target.valid) {
    lastLookahead.x = 0;
    lastLookahead.y = 0;
    targetPreloadBuilds++;
    return cameraTargetPreloadState;
  }

  // Shift the preload centre ahead along the motion vector so land sources
  // and provider surfaces load before the camera arrives. Only the block id is
  // shifted; the local x/y/z stay the real target so the resource key resolves
  // to a valid position inside the lookahead block. The rendered camera is NOT
  // affected; target follows the native flight camera's real position delta.
  lastLookahead.x = lookaheadBlocks(motion.vx);
  lastLookahead.y = lookaheadBlocks(motion.vy);
  const centerX = clampBlock(target.blockX + lastLookahead.x);
  const centerY = clampBlock(target.blockY + lastLookahead.y);

  cameraTargetPreloadState.add(0x0c).writeU32(packedCellIdFor(centerX, centerY));
  cameraTargetPreloadState.add(0x18).writeFloat(target.x);
  cameraTargetPreloadState.add(0x1c).writeFloat(target.y);
  cameraTargetPreloadState.add(0x20).writeFloat(target.z);
  targetPreloadBuilds++;
  return cameraTargetPreloadState;
}

function writeRenderProxyPosition(object) {
  const cellId = packedCellIdFor(target.blockX, target.blockY);
  for (const copyOffset of RENDER_POSITION_COPIES) {
    const state = object.add(copyOffset);
    state.add(0x0c).writeU32(cellId);
    state.add(0x18).writeFloat(target.x);
    state.add(0x1c).writeFloat(target.y);
    state.add(0x20).writeFloat(target.z);
  }
  renderProxyWriteCount++;
}

// Called from the position-update hook before the player object has been identified,
// so it runs for every positioned object in the scene until it matches. Compares the
// values directly instead of collecting them into an array first: an array literal plus
// a closure call per invocation is real allocation pressure on a path this hot.
function matchesPlayerRenderState(positionState) {
  const staticX = readFloat(playerPositionCopy);
  const staticY = readFloat(playerPositionCopy.add(4));
  const staticZ = readFloat(playerPositionCopy.add(8));
  const x = readFloat(positionState.add(0x18));
  const y = readFloat(positionState.add(0x1c));
  const z = readFloat(positionState.add(0x20));
  if (!Number.isFinite(staticX) || !Number.isFinite(staticY) || !Number.isFinite(staticZ) ||
      !Number.isFinite(x) || !Number.isFinite(y) || !Number.isFinite(z)) return false;
  if (Math.abs(x - staticX) >= MATCH_TOLERANCE ||
      Math.abs(y - staticY) >= MATCH_TOLERANCE ||
      Math.abs(z - staticZ) >= MATCH_TOLERANCE) return false;

  return true;
}

function tryLockRenderProxy(object, positionState) {
  if (!matchesPlayerRenderState(positionState)) return false;

  renderProxyCandidate = object;
  captureWorldCellProxy(object);
  if (!active || !target.valid || !NATIVE_RENDER_PROXY_ENABLED) return true;
  renderProxyObject = object;
  renderProxyLockPending = false;
  console.log('[RENDER PROXY] LOCK object=' + object +
    ' block=' + positionState.add(0x0c).readU8() + ',' + positionState.add(0x0d).readU8() +
    ' target=' + target.blockX + ',' + target.blockY);
  return true;
}

// This runs for every positioned object in the scene, so it is the hottest callback in
// the script and everything in it is on the frame budget. Its only job in the default
// build is to identify the player's render object once, so it bails on the cheapest
// possible check as soon as that is done. The onLeave half is only installed when the
// render proxy is actually compiled in - an unused onLeave still costs a trampoline on
// every single call, which in a crowded area is thousands of calls a frame.
const positionUpdateCallbacks = {
  onEnter: function (args) {
    renderProxyUpdateCount++;
    this.applyRenderProxy = false;
    if (restoreRequested || restoreInProgress || restoreComplete) return;
    if (!NATIVE_RENDER_PROXY_ENABLED && renderProxyCandidate !== null) return;
    const object = args[0];
    const positionState = args[1];
    if (!looksLikePointer(object) || !looksLikePointer(positionState)) return;
    if (renderProxyCandidate === null) tryLockRenderProxy(object, positionState);
    if (!NATIVE_RENDER_PROXY_ENABLED || !active || !target.valid) return;
    if (renderProxyLockPending) tryLockRenderProxy(object, positionState);
    if (renderProxyObject === null || !object.equals(renderProxyObject)) return;
    this.applyRenderProxy = true;
    this.renderProxyObject = object;
  }
};
if (NATIVE_RENDER_PROXY_ENABLED) {
  positionUpdateCallbacks.onLeave = function () {
    if (!this.applyRenderProxy || !active || !target.valid) return;
    try {
      writeRenderProxyPosition(this.renderProxyObject);
    } catch (error) {
      console.log('[RENDER PROXY ERROR] ' + error);
    }
  };
}
Interceptor.attach(positionUpdateFunction, positionUpdateCallbacks);

cameraInputHook = Interceptor.attach(base.add(CAMERA_INPUT_TICK_RVA), {
  onEnter: function (args) {
    this.machine = args[1];
  },
  onLeave: function () {
    if (this.machine === undefined || this.machine.isNull()) return;
    flightMachine = this.machine;

    if (flightStopRequested) {
      disableNativeFlight('SHUTDOWN');
      flightCleanupComplete = true;
      flightStopRequested = false;
      return;
    }

    // Ctrl must be held at the instant F8 goes down, matching dualKeyPressed() elsewhere.
    // Testing it on the edge rather than every frame means holding F8 and then tapping
    // Ctrl does not toggle the camera.
    const f8Down = keyDown(VK_F8);
    if (f8Down && !flightF8WasDown && keyDown(VK_CONTROL)) {
      if (active) disableNativeFlight('CTRL+F8');
      else enableNativeFlight();
    }
    flightF8WasDown = f8Down;

    if (nativeAutoEnablePending && !active) {
      nativeAutoEnablePending = false;
      enableNativeFlight();
    }
    if (!active) return;

    if (flightController.isNull()) {
      flightController = resolveFlightController(flightMachine);
      if (!flightController.isNull()) {
        flightPositionPointer = resolveFlightPositionPointer(flightController);
      }
    }
    if (flightController.isNull() || flightPositionPointer.isNull()) return;
    if (!target.valid) primeRenderTargetFromPlayer();

    const now = Date.now();
    let dt = (now - flightLastTickAt) / 1000.0;
    flightLastTickAt = now;
    if (dt <= 0) return;
    if (dt > MAX_FLIGHT_DT) dt = MAX_FLIGHT_DT;

    let multiplier = 1.0;
    if (keyDown(VK_SHIFT)) multiplier = 4.0;
    else if (keyDown(VK_CONTROL)) multiplier = 0.25;
    const movementDt = dt * multiplier;

    const forward = (keyDown(VK_P) ? 1 : 0) - (keyDown(VK_SEMICOLON) ? 1 : 0);
    const strafe = (keyDown(VK_APOSTROPHE) ? 1 : 0) - (keyDown(VK_L) ? 1 : 0);
    const vertical = (keyDown(VK_O) ? 1 : 0) - (keyDown(VK_LEFT_BRACKET) ? 1 : 0);
    if (forward === 0 && strafe === 0 && vertical === 0) {
      motion.vx = 0;
      motion.vy = 0;
      updateCameraWorldCellStreaming(0, 0);
      return;
    }

    const before = flightLastPosition === null ? readFlightPosition() : flightLastPosition;
    if (forward !== 0) flightMoveForward(flightController, forward * movementDt);
    if (strafe !== 0) flightMoveStrafe(flightController, strafe * movementDt);
    if (vertical !== 0) flightMoveVertical(flightController, vertical * movementDt);
    const after = readFlightPosition();
    syncRenderTargetToFlight(before, after, dt);
    if (after !== null) flightLastPosition = after;
  }
});

Interceptor.attach(frillCenterUpdate, {
  onEnter: function (args) {
    this.positionState = null;
    if (!GRASS_MACHINERY || !cinematicStreamingEnabled()) return;
    const now = Date.now();
    if (now - lastPreloadDispatchAt < PRELOAD_DISPATCH_INTERVAL_MS) return;
    lastPreloadDispatchAt = now;
    if (verboseDiagnostics) frillCenterUpdateCount++;
    this.positionState = looksLikePointer(args[2]) ? args[2] : null;
    if (this.positionState === null) return;
    if (verboseDiagnostics) lastFrillInput = readLandPosition(args[2], true);
  },
  onLeave: function () {
    if (this.positionState === null) return;
    const preloadState = buildCameraTargetPreloadState(this.positionState);
    if (preloadState === null) return;
    preloadCameraResidency(preloadState);
    preloadCameraSourceDirect(preloadState);
    preloadCameraProviderSurface(preloadState);
  }
});

// Both land-source hooks sit on shared engine functions that are called constantly, so
// they are only installed when the grass subsystem they feed is actually compiled in.
// Everything inside them was already gated on GRASS_MACHINERY; attaching unconditionally
// just meant paying a JS transition per call for a callback that did nothing.
if (GRASS_MACHINERY) {
Interceptor.attach(landResourceBuild, {
  onEnter: function (args) {
    this.trackLandSource = cinematicStreamingEnabled();
    if (!this.trackLandSource) return;
    landResourceBuildCalls++;
    this.output = args[3];
    this.buildThreadId = Process.getCurrentThreadId();
    // add(0) clones the pointer; ptr(x.toString()) would round-trip through a hex string
    // and allocate on every call.
    landResourceBuildContexts.set(this.buildThreadId, { keyPointer: args[2].add(0) });
  },
  onLeave: function (retval) {
    if (!this.trackLandSource) return;
    try {
      if ((retval.toUInt32() & 0xff) !== 0 &&
          looksLikePointer(this.output) && looksLikePointer(this.output.readPointer())) {
        landResourceBuildSuccesses++;
      }
    } catch (_) {
    } finally {
      landResourceBuildContexts.delete(this.buildThreadId);
    }
  }
});

Interceptor.attach(resourceUnwrap, {
  onEnter: function () {
    // resourceUnwrap is a generic engine helper, so this filters by return address to
    // catch only the calls coming from landResourceBuild. Reading returnAddress is not
    // free, hence the cheap cinematicStreamingEnabled() test first to short-circuit it.
    this.fromLandResourceBuild = cinematicStreamingEnabled() &&
      this.returnAddress.compare(landResourceBuild) >= 0 &&
      this.returnAddress.compare(base.add(LAND_RESIDENCY_UPDATE_RVA)) < 0;
  },
  onLeave: function (retval) {
    if (!this.fromLandResourceBuild) return;
    landResourceResolveCalls++;
    if (!looksLikePointer(retval)) return;
    landResourceResolveNonNull++;
    if (verboseDiagnostics) landResourceSourcePointers.add(retval.toString());
    const context = landResourceBuildContexts.get(Process.getCurrentThreadId());
    retainLandSource(retval, context === undefined ? null : context.keyPointer);
  }
});
}

if (DEEP_DIAGNOSTIC_HOOKS) {
  Interceptor.attach(terrainTileRequest, {
    onEnter: function () {
      terrainTileRequestCalls++;
    },
    onLeave: function (retval) {
      if ((retval.toUInt32() & 0xff) === 0) terrainTileRequestFailures++;
    }
  });

  Interceptor.attach(frillSectorRefresh, {
    onEnter: function () {
      frillSectorRefreshCalls++;
    },
    onLeave: function (retval) {
      if ((retval.toUInt32() & 0xff) === 0) frillSectorRefreshFailures++;
    }
  });

  Interceptor.attach(frillLoaderUpdate, {
    onEnter: function (args) {
      this.engine = looksLikePointer(args[0]) ? args[0] : null;
      this.beforeState = this.engine === null ? -1 : this.engine.readS32();
      this.tileFailures = terrainTileRequestFailures;
      this.refreshFailures = frillSectorRefreshFailures;
    },
    onLeave: function () {
      if (this.engine === null) return;
      let afterState = -1;
      try { afterState = this.engine.readS32(); } catch (_) { return; }
      if (afterState !== 4 || this.beforeState === 4) return;

      loaderState4Transitions++;
      if (terrainTileRequestFailures > this.tileFailures) {
        loaderState4TileFailures++;
      } else if (frillSectorRefreshFailures > this.refreshFailures) {
        loaderState4RefreshFailures++;
      } else if (this.beforeState === 3) {
        loaderState4AsyncMissing++;
      } else {
        loaderState4LandMissing++;
      }
    }
  });
}

Interceptor.attach(smartBoxLandUpdate, {
  onEnter: function (args) {
    landOriginUpdateCount++;
    if (!landOriginForceEnabled || !active || !target.valid || !args[1].isNull()) return;
    try {
      writeCachedLandPosition(target);
      landOriginWriteCount++;
    } catch (error) {
      console.log('[LAND ORIGIN ERROR] ' + error);
      disableLandOriginForce();
    }
  }
});

setInterval(function () {
  try {
    // Ctrl+F3 shows/hides the overlay and Ctrl+F2 switches compact/full. Moving it
    // needs no hotkey: hold Ctrl and drag the panel. These only flip a flag; the window
    // work itself happens on the main tick.
    if (dualKeyPressed(VK_CONTROL, VK_F3, 'hud')) {
      hudEnabled = !hudEnabled;
      console.log('[HUD] overlay=' + (hudEnabled ? 'ON' : 'OFF'));
    }
    // Ctrl+F1 = object / decoration draw distance. The last visual toggle that had no
    // key. Off by default because pushing decoration distance out can make distant trees
    // disappear: the 3D draw distance outruns the mesh residency behind it.
    if (dualKeyPressed(VK_CONTROL, VK_F1, 'objectBoost')) {
      onMainThread(objectBoostEnabled ? disableObjectBoost : enableObjectBoost);
    }

    if (dualKeyPressed(VK_CONTROL, VK_F2, 'hudCompact')) {
      hudCompact = !hudCompact;
      hudLastDrawAt = 0;
      console.log('[HUD] view=' + (hudCompact ? 'compact' : 'full'));
    }

    if (dualKeyPressed(VK_CONTROL, VK_F6, 'landOrigin')) {
      setFeature('landorigin', !landOriginForceEnabled);
    }

    if (dualKeyPressed(VK_CONTROL, VK_F7, 'texture')) {
      if (textureBoostEnabled) disableTextureBoost();
      else enableTextureBoost();
    }

    if (dualKeyPressed(VK_CONTROL, VK_F5, 'world')) {
      if (renderBoostEnabled) disableRenderBoost();
      else enableRenderBoost();
    }

    if (dualKeyPressed(VK_CONTROL, VK_F9, 'lod')) {
      if (lodBoostEnabled) disableLodBoost();
      else enableLodBoost();
    }

    if (dualKeyPressed(VK_CONTROL, VK_F10, 'frill')) {
      if (frillBoostEnabled) disableFrillBoost();
      else enableFrillBoost();
    }

    if (dualKeyPressed(VK_CONTROL, VK_F11, 'imposters')) toggleDistantImposters();

    if (CACHE_FEATURE_ENABLED && dualKeyPressed(VK_CONTROL, VK_K, 'photoCache')) {
      setRenderCacheEnabled(!renderCacheEnabled);
    }

    // Ctrl+F4 = maximum terrain material quality. Off by default: it rebuilds terrain
    // materials, which is one of the settings that makes the client pause while the
    // engine works through it.
    if (dualKeyPressed(VK_CONTROL, VK_F4, 'terrainQuality')) {
      onMainThread(function () {
        if (terrainMaxApplied) disableTerrainMax();
        else { setTerrainMax(); verifyStartupFullQuality(); }
      });
    }

    // Ctrl+G = thin the grass with distance. The cheapest single thing you can do to
    // the grass without shortening it, so it earns the one remaining sensible key.
    if (dualKeyPressed(VK_CONTROL, VK_G, 'grassFalloff')) {
      setFeature('grassfalloff', !(FRILL_REDUCTION_ENABLED !== 0));
    }

    // Ctrl+N = far normal maps: detailed relief versus flat "painted" terrain.
    if (dualKeyPressed(VK_CONTROL, VK_N, 'fnm')) onMainThread(toggleFarNormalMaps);

    // Ctrl+8 / Ctrl+7 push and pull the high-detail landscape radius, then re-materialize.
    if (dualKeyPressed(VK_CONTROL, VK_8, 'radiusUp')) {
      bumpFarRadius(FAR_RADIUS_STEP);
      setTimeout(function () { autoFixMaterialize('(after radius up)'); }, 600);
      setTimeout(function () { autoFixMaterialize('(after radius up)'); }, 2000);
    }
    if (dualKeyPressed(VK_CONTROL, VK_7, 'radiusDown')) bumpFarRadius(-FAR_RADIUS_STEP);

    // 5 / 4 = grass bubble radius (eviction). Smaller = fewer sources behind = better FPS.
    if (dualKeyPressed(VK_CONTROL, VK_5, 'grassEvictUp')) {
      GRASS_EVICT_RADIUS = Math.min(48, GRASS_EVICT_RADIUS + 2);
      console.log('[GRASS BUBBLE] evict radius=' + GRASS_EVICT_RADIUS + ' blocks (wider = more grass, lower FPS)');
    }
    if (dualKeyPressed(VK_CONTROL, VK_4, 'grassEvictDown')) {
      GRASS_EVICT_RADIUS = Math.max(4, GRASS_EVICT_RADIUS - 2);
      console.log('[GRASS BUBBLE] evict radius=' + GRASS_EVICT_RADIUS + ' blocks (tighter = better FPS)');
    }

    // Object/tree boost REMOVED from the hotkey: on extended rings it vanishes trees (3D-draw distance
    // outruns object-mesh residency, an unsolved engine limit). Trees stay at their safe
    // vanilla behaviour (3D near, 2D imposters far) - no vanishing.
    // (disableObjectBoost still runs on shutdown to un-NOP writers if a prior run enabled it.)

    // F12 = heavy landscape re-stream. Poisons the TextureDetail shadow copy so the
    // engine rebuilds every landscape cell with fresh materials at the current position.
    // Expect a visible hitch: this is a full rebuild, not an incremental update.
    if (dualKeyPressed(VK_CONTROL, VK_F12, 'restream')) {
      try {
        base.add(0x1e4150c).writeU8(textureDetail.readU32() ^ 0xff);
        console.log('[F12] heavy landscape re-stream (every cell is rebuilt)');
      } catch (e) { console.log('[F12 ERR] ' + e); }
    }

    const now = Date.now();
    if (now - lastBoostReassertAt >= BOOST_REASSERT_INTERVAL_MS) {
      lastBoostReassertAt = now;
      if (active && CAMERA_CENTERED_STREAMING) {
        if (!landOriginForceEnabled) enableLandOriginForce();
        setCameraCenteredStreaming(true);
      }
      enforceRenderBoost();
      enforceLodBoost();
      enforceFrillBoost();
      enforceTextureBoost();
    }
  } catch (error) {
    console.log('[TIMER ERROR] ' + error);
  }
}, 50);

// Source eviction is cheap while stationary and provider pruning is only needed when the
// center block changes. Avoid reparsing hundreds of tracked keys every 150 ms.
setInterval(function () {
  if (!GRASS_MACHINERY || retainedLandSources.size === 0) return;
  try {
    let cx, cy, cr;
    if (active && target.valid) {
      cx = target.blockX; cy = target.blockY; cr = target.region;
    } else {
      const box = resolveSmartBox();
      if (box === null) return;
      const lp = readLandPosition(box.add(0x80), true);
      if (lp === null) return;
      cx = lp.blockX; cy = lp.blockY; cr = lp.region;
    }
    const now = Date.now();
    const centerKey = cx + ':' + cy + ':' + cr;
    const centerChanged = centerKey !== lastMaintenanceCenterKey;
    if (!centerChanged && now - lastSourceMaintenanceAt < 1000) return;
    lastSourceMaintenanceAt = now;
    evictFarLandSources(cx, cy, cr);
    if (centerChanged) {
      lastMaintenanceCenterKey = centerKey;
      pruneProviderTracking(cx, cy);
    }
  } catch (_) {}
}, 250);

function vramLine(v) {
  const u = v.remoteMB >= 0 ? v.remoteMB.toFixed(0) : '?';
  const pct = v.remoteMB >= 0
    ? ' (' + (100 * v.remoteMB / VRAM_SAFE_REMOTE_CEILING_MB).toFixed(0) + '% of safe-monitor)'
    : '';
  const peak = v.peakMB > 0 ? ' peak=' + v.peakMB.toFixed(0) : '';
  const system = v.systemMB >= 0 ? ' sys=' + v.systemMB.toFixed(0) + 'MB' : '';
  return 'remote=' + u + 'MB' + system + peak + pct +
    ' res=' + v.scanned + (v.truncated ? '+TRUNC' : '');
}

setInterval(function () {
  if (VRAM_TELEMETRY_ENABLED &&
      (!lastVram.at || Date.now() - lastVram.at >= VRAM_TELEMETRY_INTERVAL_MS)) {
    queueVramTelemetry(null);
  }
  const vram = lastVram;
  if (!verboseDiagnostics) {
    console.log(
      '[STATUS-LITE] active=' + active +
      ' moves=' + flightMoveCount +
      ' topology=' + (FAR_RADIUS / 16).toFixed(1) + 'blocks' +
      ' near=' + (NEAR_RADIUS / 16).toFixed(1) + 'blocks' +
      ' grass=' + (FRILL_DISTANCE_SECTORS / 16).toFixed(1) + 'blocks' +
      ' held=' + retainedLandSources.size +
      ' provider=' + providerSurfaceCompleted.size + '/' +
        providerSurfacePending.size + '/' + providerBlockRemaining.size +
      ' cache=DISABLED' +
        '/surfaceKeys' + providerSurfaceCompleted.size +
      ' | VRAM-scan=OFF'
    );
    return;
  }

  let loadForPlayer = -1;
  let far = -1;
  let near = -1;
  let landPosition = null;
  const box = resolveSmartBox();
  if (box !== null) {
    try { loadForPlayer = box.add(0x250).readU8(); } catch (_) {}
    landPosition = readLandPosition(box.add(0x80), true);
    try {
      if (streamObject !== null) {
        far = streamObject.add(0x38).readU32();
        near = streamObject.add(0x3c).readU32();
      }
    } catch (_) {}
  }
  const cachedPosition = readLandPosition(cachedLandOrigin, false);
  const currentResidencyAnchors = residencyAnchors();
  const residencyAnchorText = currentResidencyAnchors
    .map(function (anchor) { return anchor.blockX + ',' + anchor.blockY; })
    .join('|');

  let frillRuntimeDistance = -1;
  let frillRuntimeDensity = -1;
  let frillPlayerBlend = -1;
  let frillDepthFade = -1;
  let frillReductionDistance = -1;
  let frillReductionEnabled = -1;
  let frillCenterX = -1;
  let frillCenterY = -1;
  let frillLoadState = -1;
  let frillLoadRing = -1;
  let frillLoadIndex = -1;
  let frillHashLoaded = -1;
  let frillActiveDraw = -1;
  const engine = resolveFrillEngine();
  if (engine !== null) {
    try { frillRuntimeDistance = engine.add(0x64).readU32(); } catch (_) {}
    try { frillRuntimeDensity = engine.add(0x60).readFloat(); } catch (_) {}
    try { frillPlayerBlend = engine.add(0xec).readFloat(); } catch (_) {}
    try { frillDepthFade = engine.add(0xe0).readFloat(); } catch (_) {}
    try { frillReductionDistance = engine.add(0xe4).readFloat(); } catch (_) {}
    try { frillReductionEnabled = engine.add(0xe8).readU8(); } catch (_) {}
    try { frillCenterX = engine.add(0x28).readS32(); } catch (_) {}
    try { frillCenterY = engine.add(0x2c).readS32(); } catch (_) {}
    try { frillLoadState = engine.readS32(); } catch (_) {}
    try { frillLoadRing = engine.add(0x68).readS32(); } catch (_) {}
    try { frillLoadIndex = engine.add(0x6c).readS32(); } catch (_) {}
    try { frillHashLoaded = engine.add(0x5c).readS32(); } catch (_) {}
    try { frillActiveDraw = engine.add(0xbc).readS32(); } catch (_) {}
    if (frillLoadRing > maxFrillLoadRing) maxFrillLoadRing = frillLoadRing;
  }

  const sourceReadiness = retainedLandSourceReadiness();
  const providerReadiness = providerGridReadiness();
  const providerTable = providerInternalTableStatus();

  console.log(
    '[STATUS] active=' + active +
    ' flightToken=' + flightToken +
    ' flightMoves=' + flightMoveCount +
    ' flightController=' + flightController +
    ' renderProxy=' + (renderProxyObject !== null) +
      '/' + renderProxyWriteCount + '/' + renderProxyUpdateCount +
    ' objectStream=' + CAMERA_WORLD_CELL_STREAMING +
      '/listeners' + worldCellProxyListenersReady() +
      '/dispatch' + worldCellProxyDispatches +
      '/errors' + worldCellProxyErrors +
    ' loadForPlayer=' + loadForPlayer +
    ' landForce=' + landOriginForceEnabled + '/' + landOriginWriteCount + '/' + landOriginUpdateCount +
    ' land=' + formatLandPosition(landPosition) +
    ' cached=' + formatLandPosition(cachedPosition) +
    ' photoCache=' + renderCacheEnabled +
    ' purge=' + graphicsPurgePending + '/' + graphicsPurgeCount +
      '/pass' + graphicsPurgePass + ':' + graphicsPurgePasses + '/' + graphicsPurgeReason +
    ' residency=' + residencyGridEnabled +
      '/' + currentResidencyAnchors.length +
      '/calls' + residencyGridCalls +
      '/errors' + residencyGridErrors +
      '/anchors[' + residencyAnchorText + ']' +
    ' topology=' + renderBoostEnabled + '/' + (FAR_RADIUS / 16).toFixed(1) + 'blocks' +
    ' stream=' + far + '/' + near +
    ' pvs=' + staticPvsFlag.readU8() +
    ' objectPatch=' + (originalObjectCode !== null) +
    ' lod3D=' + lodBoostEnabled + '/' + allowLodsFlag.readU8() +
    ' frill=' + frillBoostEnabled + '/' + frillRuntimeDistance +
      '/' + frillRuntimeDensity.toFixed(2) +
      '/fade' + frillDepthFade.toFixed(1) +
      '/reduce' + frillReductionDistance.toFixed(1) + '/' + frillReductionEnabled +
      '/blend' + frillPlayerBlend.toFixed(2) +
      '/center' + frillCenterX + ',' + frillCenterY +
      '/loader' + frillLoadState + ':' + frillLoadRing + ':' + frillLoadIndex +
      '/maxRing' + maxFrillLoadRing +
      '/state4_' + loaderState4Transitions +
        '(tile' + loaderState4TileFailures +
        ',refresh' + loaderState4RefreshFailures +
        ',async' + loaderState4AsyncMissing +
        ',land' + loaderState4LandMissing + ')' +
      '/source' + landResourceBuildCalls + ':' + landResourceBuildSuccesses +
        ':' + landResourceResolveCalls + ':' + landResourceResolveNonNull +
        ':unique' + landResourceSourcePointers.size +
        ':held' + retainedLandSources.size + '/evictR' + GRASS_EVICT_RADIUS + '/evicted' + grassEvictions + ':holdErr' + landSourceHoldErrors +
        ':ready' + sourceReadiness.readable +
        ':f40_' + sourceReadiness.flag40 +
        ':f41_' + sourceReadiness.flag41 +
        ':d8_' + sourceReadiness.payloadD8 +
        ':readErr' + sourceReadiness.errors +
        '/direct' + directSourceKeyCalls + ':' + directSourceLookups +
        ':nonnull' + directSourceNonNull + ':adopted' + directSourceAdoptions +
        ':errors' + directSourceErrors +
      '/provider' + (landscapeProvider !== null) +
        ':targetBuilds' + targetPreloadBuilds +
        ':range' + PROVIDER_SURFACE_RADIUS_BLOCKS + '(' + ((2 * PROVIDER_SURFACE_RADIUS_BLOCKS + 1) * (2 * PROVIDER_SURFACE_RADIUS_BLOCKS + 1)) + 'blk)' +
        ':la' + lastLookahead.x + ',' + lastLookahead.y +
        ':budget' + PROVIDER_BUDGET_PER_PASS + '/src' + DIRECT_SOURCE_PER_PASS + ':partial' + PARTIAL_GATE +
        ':grid' + providerReadiness.surfaces +
        ':payload' + providerReadiness.payloads +
        ':complete' + providerReadiness.completed +
        ':total' + providerReadiness.total +
        ':scanErr' + providerReadiness.errors +
        ':table' + providerTable.nodes + '/' + providerTable.buckets +
        ':tableErr' + providerTable.errors +
        ':pending' + providerSurfacePending.size +
        ':lookup' + providerSurfaceLookupCalls + ':' + providerSurfaceLookupNonNull +
        ':request' + providerSurfaceRequestCalls + ':' + providerSurfaceRequestSuccesses +
        ':handoff' + providerSurfaceCompletionCalls +
          ':unique' + providerSurfaceCompleted.size +
          ':errors' + providerSurfaceCompletionErrors +
          ':last[' + providerSurfaceLastCompletedKey + ']' +
        ':errors' + providerSurfaceRequestErrors +
        ':resolveErr' + landscapeProviderResolveErrors +
        ':last[' + providerSurfaceLastKey + '/' + providerSurfaceLastStatus +
          '/' + providerSurfaceLastOut + ']' +
      '/tileReq' + terrainTileRequestCalls + '/' + terrainTileRequestFailures +
      '/refresh' + frillSectorRefreshCalls + '/' + frillSectorRefreshFailures +
      '/hashLoaded' + frillHashLoaded +
      '/activeDraw' + frillActiveDraw +
      '/updates' + frillCenterUpdateCount +
      '/input' + formatLandPosition(lastFrillInput) +
    ' tex=' + textureBoostEnabled +
      '/' + textureFiltering.readU32() +
      '/' + anisotropicQuality.readU32() +
      '/' + textureDetail.readU32() +
      '/mem' + graphicsMemoryUsage.readFloat().toFixed(2) +
      '/bias' + (textureBoostEnabled ? TEXTURE_MIP_BIAS.toFixed(1) : 'orig') +
    ' VRAM=' + vramLine(vram) + '(' + (vram.usedBytes / (1024 * 1024)).toFixed(1) + 'MB res/' + vram.count + 'total)' +
    ' imposters=' + distantImposters.readU8() +
    (target.valid
      ? ' block=' + target.blockX + ',' + target.blockY +
        ' local=' + target.x.toFixed(1) + ',' + target.y.toFixed(1) + ',' + target.z.toFixed(1)
      : '')
  );
}, 2000);

function restore() {
  if (restoreComplete || restoreInProgress) return true;
  restoreInProgress = true;
  let restoreOk = true;
  try {
  if (graphicsPurgePending) {
    console.log('[VRAM PURGE] pending work cancelled by restore.');
  }
  graphicsPurgePending = false;
  graphicsPurgeFullReset = false;
  vramScanState = null;
  vramTelemetryPending = false;
  restoreNativeLandCacheSettingsImmediate();
  mainQueue.splice(0, mainQueue.length);
  nativeAutoEnablePending = false;
  if (active) disableNativeFlight('RESTORE-FALLBACK');
  else {
    restoreFlightCvars();
    restoreWorldCellProxyFromPlayer('RESTORE-FALLBACK');
  }
  try { if (cameraInputHook !== null) cameraInputHook.detach(); } catch (_) {}
  cameraInputHook = null;
  motion.vx = 0;
  motion.vy = 0;
  renderProxyObject = null;
  renderProxyCandidate = null;
  renderProxyLockPending = false;
  worldCellProxyBroadcaster = NULL;
  worldCellProxyEntity = NULL;
  worldCellPrimaryListener = NULL;
  worldCellSecondaryListener = NULL;
  worldCellEnterListener = NULL;
  worldCellProxyLastCell = null;
  worldCellProxyDisplaced = false;
  worldCellProxyLastDispatchAt = 0;
  worldCellProxyPrefetch = null;
  target.valid = false;
  disableLandOriginForce();
  setCameraCenteredStreaming(false);
  disableTextureBoost();
  disableFrillBoost();
  disableLodBoost();
  disableRenderBoost();
  disableObjectBoost();
  releaseAllRetainedLandSources();
  disableResidencyGrid();
  providerSurfacePending.clear();
  providerSurfaceCompleted.clear();
  invalidateProviderBlockCache();
  invalidateSourceAnchorCache();
  releaseLandscapeProvider();
  allowLodsFlag.writeU8(originalAllowLods);
  // Registered setters can synchronously rebuild the complete landscape and
  // block the main tick for several seconds during detach. Restore the captured
  // globals directly; the engine's normal settings pass owns later rebuilds.
  base.add(MATERIAL_DETAIL_RVA).writeU32(originalMaterialDetail);
  base.add(MODEL_DETAIL_RVA).writeU32(originalModelDetail);
  base.add(OBJECT_DRAW_DISTANCE_RVA).writeU32(originalObjectDrawDistance);
  base.add(LANDSCAPE_DRAW_DISTANCE_RVA).writeU32(originalLandscapeDrawDistance);
  base.add(FRILL_TERRAIN_COLOR_RVA).writeU8(originalFrillTerrainColor);
  base.add(LANDSCAPE_STATIC_OBJECT_SHADOWS_RVA).writeU32(originalLandscapeStaticObjectShadows);
  base.add(FAR_LANDSCAPE_NORMAL_MAPS_RVA).writeU8(originalTerrainFarNormalMaps);
  base.add(NEAR_FAR_SEAM_BLEND_RVA).writeU8(originalNearFarSeamBlend);
  base.add(LANDSCAPE_LIGHTING_QUALITY_RVA).writeU32(originalTerrainLightingQuality);
  base.add(LANDSCAPE_DRAW_DISTANCE_RVA).writeU32(originalLandscapeDrawDistance);
  base.add(NEAR_FAR_SEAM_BLEND_RVA).writeU8(originalNearFarSeamBlend);
  distantImposters.writeU8(originalDistantImposters);
  impostersEnabled = originalDistantImposters !== 0;
  terrainMaxApplied = false;
  startupFullQualityVerified = false;
  hudEnabled = false;
  hudDestroy();
  console.log('[RESTORE] Native flight camera and render settings restored; cleanupComplete=' +
    flightCleanupComplete + '.');
  } catch (error) {
    restoreOk = false;
    console.log('[RESTORE ERROR] ' + (error.stack || error));
  }
  restoreInProgress = false;
  restoreComplete = true;
  return restoreOk;
}

function applyGrassRangeBlocks(blocks) {
  const R = Math.max(3, Math.min(24, blocks | 0));
  PROVIDER_SURFACE_RADIUS_BLOCKS = R;
  FRILL_DISTANCE_SECTORS = R * 16;
  FRILL_FULL_DENSITY_SECTORS = FRILL_DISTANCE_SECTORS;
  RESIDENCY_GROUP_RADIUS = Math.max(1, Math.min(8, Math.ceil(R / 3)));
  if (!renderCacheEnabled) GRASS_EVICT_RADIUS = R + 3;
  MAX_RETAINED_LAND_SOURCES = renderCacheEnabled ? PHOTO_CACHE_MAX_SOURCES : normalSourceLimit();
  MAX_LOOKAHEAD_BLOCKS = Math.min(MAX_LOOKAHEAD_BLOCKS, R);
  invalidateProviderBlockCache();
  invalidateSourceAnchorCache();
  directSourceCursor = 0;
  if (target.valid) pruneProviderTracking(target.blockX, target.blockY);
  enforceFrillBoost();
  return {
    blocks: R,
    gridBlocks: (2 * R + 1) * (2 * R + 1),
    drawSectors: FRILL_DISTANCE_SECTORS,
    groupRadius: RESIDENCY_GROUP_RADIUS,
    evictRadius: GRASS_EVICT_RADIUS,
    maxRetain: MAX_RETAINED_LAND_SOURCES
  };
}

// =============================================================================
// IN-GAME HUD - shows every feature's ON/OFF state on screen
// -----------------------------------------------------------------------------
// This does NOT touch the game's render pipeline. It creates a separate Win32
// window: layered (WS_EX_LAYERED = translucent), click-through (WS_EX_TRANSPARENT),
// always-on-top (WS_EX_TOPMOST) and focus-stealing-free (WS_EX_NOACTIVATE).
// Window creation, the message pump and drawing all run on the GAME'S MAIN TICK,
// so the thread that owns the window is the thread that pumps it (a Win32 rule).
// Drawing is double-buffered (memory DC -> BitBlt), so it does not flicker.
//
// NOTE: no overlay window can be drawn over an EXCLUSIVE FULLSCREEN game.
// Use windowed or borderless fullscreen.
// =============================================================================
const HUD_REFRESH_MS = 250;
// How long the game may sit in the background before the overlay window is torn down.
// Long enough that flicking to another window and back does not churn it, far shorter
// than the ~5s Windows waits before deciding a thread is unresponsive.
const HUD_BACKGROUND_DESTROY_MS = 1500;
const HUD_PAD = 12;
const HUD_LINE_H = 16;
const HUD_TITLE_H = 26;
const HUD_FOOTER_H = 20;
const HUD_COL_W = 362;
const HUD_STATE_X = 210;   // state column, offset from the label (px)
const HUD_EXTRA_X = 272;   // value column, offset from the label (px)

// COLORREF = 0x00BBGGRR (GDI stores the bytes in reverse order)
const HUD_C_ON     = 0x50e678;   // green
const HUD_C_OFF    = 0x6e6e6e;   // grey
const HUD_C_FORCED = 0xe0c060;   // cyan: compile-time constant, no hotkey changes it
const HUD_C_VALUE  = 0xdcdcdc;   // off-white value
const HUD_C_HEADER = 0x3caaff;   // orange heading
const HUD_C_KEY    = 0x5adcff;   // yellow hotkey
const HUD_C_RPC    = 0xc8aa8c;   // console-only toggle marker
const HUD_C_WARN   = 0x5a5aff;   // red warning
const HUD_C_DIM    = 0x8a7a6a;
const HUD_C_PANEL  = 0x0e0a06;
const HUD_C_BORDER = 0x503828;

const gdi32 = Process.getModuleByName('gdi32.dll');
function u32fn(mod, name, ret, args) {
  return new NativeFunction(mod.getExportByName(name), ret, args);
}
const registerClassExW = u32fn(user32, 'RegisterClassExW', 'uint16', ['pointer']);
const createWindowExW = u32fn(user32, 'CreateWindowExW', 'pointer',
  ['uint32', 'pointer', 'pointer', 'uint32', 'int', 'int', 'int', 'int',
   'pointer', 'pointer', 'pointer', 'pointer']);
const destroyWindow = u32fn(user32, 'DestroyWindow', 'int', ['pointer']);
const showWindow = u32fn(user32, 'ShowWindow', 'int', ['pointer', 'int']);
const setLayeredWindowAttributes = u32fn(user32, 'SetLayeredWindowAttributes', 'int',
  ['pointer', 'uint32', 'uint8', 'uint32']);
const setWindowPos = u32fn(user32, 'SetWindowPos', 'int',
  ['pointer', 'pointer', 'int', 'int', 'int', 'int', 'uint32']);
const getDC = u32fn(user32, 'GetDC', 'pointer', ['pointer']);
const releaseDC = u32fn(user32, 'ReleaseDC', 'int', ['pointer', 'pointer']);
const peekMessageW = u32fn(user32, 'PeekMessageW', 'int',
  ['pointer', 'pointer', 'uint32', 'uint32', 'uint32']);
const translateMessage = u32fn(user32, 'TranslateMessage', 'int', ['pointer']);
const dispatchMessageW = u32fn(user32, 'DispatchMessageW', 'pointer', ['pointer']);
const getClientRect = u32fn(user32, 'GetClientRect', 'int', ['pointer', 'pointer']);
const clientToScreen = u32fn(user32, 'ClientToScreen', 'int', ['pointer', 'pointer']);
const fillRect = u32fn(user32, 'FillRect', 'int', ['pointer', 'pointer', 'pointer']);
const frameRect = u32fn(user32, 'FrameRect', 'int', ['pointer', 'pointer', 'pointer']);
const isWindowFn = u32fn(user32, 'IsWindow', 'int', ['pointer']);
const findWindowW = u32fn(user32, 'FindWindowW', 'pointer', ['pointer', 'pointer']);
const getWindowRect = u32fn(user32, 'GetWindowRect', 'int', ['pointer', 'pointer']);
const getCursorPos = u32fn(user32, 'GetCursorPos', 'int', ['pointer']);
const setWindowLongPtrW = u32fn(user32, 'SetWindowLongPtrW', 'pointer',
  ['pointer', 'int', 'pointer']);
const getWindowLongPtrW = u32fn(user32, 'GetWindowLongPtrW', 'pointer', ['pointer', 'int']);
const defWindowProcW = user32.getExportByName('DefWindowProcW');
const getModuleHandleW = u32fn(Process.getModuleByName('kernel32.dll'),
  'GetModuleHandleW', 'pointer', ['pointer']);
const createCompatibleDC = u32fn(gdi32, 'CreateCompatibleDC', 'pointer', ['pointer']);
const createCompatibleBitmap = u32fn(gdi32, 'CreateCompatibleBitmap', 'pointer',
  ['pointer', 'int', 'int']);
const selectObject = u32fn(gdi32, 'SelectObject', 'pointer', ['pointer', 'pointer']);
const deleteObject = u32fn(gdi32, 'DeleteObject', 'int', ['pointer']);
const deleteDC = u32fn(gdi32, 'DeleteDC', 'int', ['pointer']);
const bitBlt = u32fn(gdi32, 'BitBlt', 'int',
  ['pointer', 'int', 'int', 'int', 'int', 'pointer', 'int', 'int', 'uint32']);
const setBkMode = u32fn(gdi32, 'SetBkMode', 'int', ['pointer', 'int']);
const setTextColor = u32fn(gdi32, 'SetTextColor', 'uint32', ['pointer', 'uint32']);
const textOutW = u32fn(gdi32, 'TextOutW', 'int', ['pointer', 'int', 'int', 'pointer', 'int']);
const createSolidBrush = u32fn(gdi32, 'CreateSolidBrush', 'pointer', ['uint32']);
const createFontW = u32fn(gdi32, 'CreateFontW', 'pointer',
  ['int', 'int', 'int', 'int', 'int', 'uint32', 'uint32', 'uint32',
   'uint32', 'uint32', 'uint32', 'uint32', 'uint32', 'pointer']);
const getTextExtentPoint32W = u32fn(gdi32, 'GetTextExtentPoint32W', 'int',
  ['pointer', 'pointer', 'int', 'pointer']);

// Frida bu tamponlari cop toplayabilir; modul seviyesinde referans tutuyoruz.
const hudClassName = Memory.allocUtf16String('LotroCinematicFreecamHud');
const hudTitleText = Memory.allocUtf16String('LOTRO Freecam HUD');
const hudFontName = Memory.allocUtf16String('Consolas');
const hudMeasureText = Memory.allocUtf16String('M');
const hudWndClass = Memory.alloc(80);
const hudMsg = Memory.alloc(64);
const hudRect = Memory.alloc(16);
const hudPoint = Memory.alloc(8);
const hudDragRect = Memory.alloc(16);    // separate scratch for dragging so it cannot clobber the draw buffer
// Own buffer: the foreground check runs on the hotkey timer thread and must not
// race with the stale-window sweep running on the main tick.
const hudOwnerPid = Memory.alloc(4);
const hudCursor = Memory.alloc(8);
const hudSize = Memory.alloc(8);
const hudTextBuffer = Memory.alloc(2 * 260);   // tek satirlik UTF-16 cizim tamponu

function hudFail(where, error) {
  hudErrorCount++;
  hudLastError = where + ': ' + error;
  if (hudErrorCount <= 5 || hudErrorCount % 200 === 0) {
    console.log('[HUD ERROR] ' + hudLastError + ' (total=' + hudErrorCount + ')');
  }
}

function hudSafe(fn, fallback) {
  try {
    const value = fn();
    return (value === undefined || value === null) ? fallback : value;
  } catch (_) {
    return fallback;
  }
}

// Kisa UTF-16 yazim: sabit tamponu kullanir, her satirda yeni tahsis yapmaz.
function hudText(dc, x, y, text, color) {
  let s = String(text);
  if (s.length > 255) s = s.slice(0, 255);
  for (let i = 0; i < s.length; i++) hudTextBuffer.add(i * 2).writeU16(s.charCodeAt(i));
  hudTextBuffer.add(s.length * 2).writeU16(0);
  setTextColor(dc, color);
  textOutW(dc, x, y, hudTextBuffer, s.length);
}

// ---- Feature registry --------------------------------------------------------
// on: true/false -> ON/OFF. kind:
//   'key'    = can be toggled live with a hotkey
//   'const'  = compile-time constant (needs a file edit + reattach)
//   'value'  = a value only, not an on/off toggle
//   'engine' = live value read straight out of the engine
function hudRow(label, on, extra, kind) {
  return { label: label, on: on, extra: extra === undefined ? '' : String(extra),
           kind: kind || 'key' };
}
function hudVal(label, extra) {
  return { label: label, on: null, extra: String(extra), kind: 'value' };
}

function hudSections() {
  const rd = hudSafe;
  const engine = rd(function () { return resolveFrillEngine(); }, null);
  const grassDist = engine === null ? -1 : rd(function () { return engine.add(0x64).readU32(); }, -1);
  const grassDens = engine === null ? -1 : rd(function () { return engine.add(0x60).readFloat(); }, -1);
  const fnm = rd(function () { return base.add(FAR_LANDSCAPE_NORMAL_MAPS_RVA).readU8(); }, -1);
  const seam = rd(function () { return base.add(NEAR_FAR_SEAM_BLEND_RVA).readU8(); }, -1);
  const landQ = rd(function () { return base.add(LANDSCAPE_DRAW_DISTANCE_RVA).readU32(); }, -1);
  const matQ = rd(function () { return base.add(MATERIAL_DETAIL_RVA).readU32(); }, -1);
  const shadows = rd(function () { return base.add(LANDSCAPE_STATIC_OBJECT_SHADOWS_RVA).readU32(); }, -1);
  const lightQ = rd(function () { return base.add(LANDSCAPE_LIGHTING_QUALITY_RVA).readU32(); }, -1);
  const lods = rd(function () { return allowLodsFlag.readU8(); }, -1);
  const imp = rd(function () { return distantImposters.readU8(); }, -1);
  const pvs = rd(function () { return staticPvsFlag.readU8(); }, -1);
  const filt = rd(function () { return textureFiltering.readU32(); }, -1);
  const aniso = rd(function () { return anisotropicQuality.readU32(); }, -1);
  const texd = rd(function () { return textureDetail.readU32(); }, -1);
  const gmem = rd(function () { return graphicsMemoryUsage.readFloat(); }, -1);
  const modelD = rd(function () { return base.add(MODEL_DETAIL_RVA).readU32(); }, -1);
  const objD = rd(function () { return base.add(OBJECT_DRAW_DISTANCE_RVA).readU32(); }, -1);
  const objMult = rd(function () { return base.add(OBJ_MULT_RVA).readFloat(); }, -1);
  const anchors = rd(function () { return residencyAnchors().length; }, 0);

  return [
    { title: 'CAMERA / FLIGHT', rows: [
      hudRow('^F8  Freecam', active, active ? 'tok' + flightToken + ' mv' + flightMoveCount : ''),
      hudRow('     Flight controller', !flightController.isNull(),
        flightController.isNull() ? 'none' : 'bound', 'engine'),
      hudRow('^F6  Land-origin force', landOriginForceEnabled, 'w' + landOriginWriteCount),
      hudRow('rpc  Camera-centred stream', CAMERA_CENTERED_STREAMING,
        cameraCenteredStreamingApplied ? 'applied' : 'idle', 'key'),
      hudRow('rpc  World-cell stream', CAMERA_WORLD_CELL_STREAMING,
        'lsn' + rd(function () { return worldCellProxyListenersReady(); }, 0) +
        ' snd' + worldCellProxyDispatches, 'key'),
      hudRow('     Native render proxy', NATIVE_RENDER_PROXY_ENABLED, '', 'const'),
      hudRow('rpc  Always full render', ALWAYS_FULL_RENDER, '', 'key')
    ]},
    { title: 'TERRAIN / LAND', rows: [
      hudRow('^F5  Topology boost', renderBoostEnabled,
        'R' + (NEAR_RADIUS / 16).toFixed(0) + '/' + (FAR_RADIUS / 16).toFixed(0) + ' blk'),
      hudRow('^N   Far normal maps', fnm === 1, fnm === 1 ? 'relief' : 'FLAT/paint', 'engine'),
      hudRow('     Near/far seam blend', seam === 1, '', 'engine'),
      hudVal ('     Landscape quality', landQ + '/4'),
      hudVal ('     Material detail', matQ),
      hudVal ('     Static shadows', shadows + '/3'),
      hudVal ('     Lighting quality', lightQ + '/2'),
      hudRow('^F4  Terrain max quality', terrainMaxApplied, 'rebuild' + terrainRefreshCount),
      hudRow('rpc  Terrain auto-refresh', terrainAutoRefresh, '', 'key'),
      hudRow('     Quality verified', startupFullQualityVerified, '', 'engine'),
      hudRow('     Static PVS', pvs !== 0, String(pvs), 'engine'),
      hudRow('^7/8 Ring (smaller/bigger)', renderBoostEnabled,
        FAR_RADIUS + '/' + NEAR_RADIUS + ' sec')
    ]},
    { title: 'GRASS / FRILL', rows: [
      hudRow('     Grass machinery (master)', GRASS_MACHINERY, '', 'const'),
      hudRow('^F10 Frill boost', frillBoostEnabled,
        (grassDist < 0 ? '?' : (grassDist / 16).toFixed(0) + 'blk') +
        ' d' + (grassDens < 0 ? '?' : grassDens.toFixed(2))),
      hudRow('     Residency grid', residencyGridEnabled, anchors + ' anchors'),
      hudVal ('^4/5 Grass bubble (evict)', GRASS_EVICT_RADIUS + ' blk'),
      hudVal ('     Retained sources', retainedLandSources.size + '/' + MAX_RETAINED_LAND_SOURCES),
      hudVal ('     Frill budget', FRILL_BUDGET_MS_AT_60FPS.toFixed(1) + 'ms@60'),
      hudRow('^G   Grass falloff (cheaper)', FRILL_REDUCTION_ENABLED !== 0, '', 'key')
    ]},
    { title: 'TEXTURES', rows: [
      hudRow('^F7  Texture boost', textureBoostEnabled,
        textureBoostEnabled ? 'mip' + TEXTURE_MIP_BIAS.toFixed(1) : 'original'),
      hudVal ('     Filter/Aniso/Detail', filt + '/' + aniso + '/' + texd),
      hudVal ('     Graphics memory', gmem < 0 ? '?' : gmem.toFixed(2))
    ]},
    { title: 'OBJECTS / LOD', rows: [
      hudRow('^F9  LOD0 boost', lodBoostEnabled, 'AllowLODs=' + lods),
      hudRow('^F11 Distant imposters', imp !== 0, String(imp), 'engine'),
      hudRow('^F1  Object boost', objectBoostEnabled,
        objectBoostEnabled ? 'x' + OBJECT_GAIN : 'native'),
      hudRow('     Object-distance patch', originalObjectCode !== null, '', 'engine'),
      hudRow('rpc  Hybrid tree LOD', HYBRID_DISTANT_TREE_LODS, '', 'key'),
      hudVal ('     Model/Object detail', modelD + '/' + objD),
      hudVal ('     Object multiplier', objMult < 0 ? '?' : objMult.toFixed(2))
    ]},
    { title: 'STREAMING / PROVIDER', rows: [
      hudRow('     Provider resolved', landscapeProvider !== null,
        'err' + landscapeProviderResolveErrors, 'engine'),
      hudRow('rpc  Partial gate', PARTIAL_GATE, '', 'key'),
      hudRow('rpc  Strict block gate', STRICT_BLOCK_GATE, '', 'key'),
      hudRow('rpc  Lookahead', LOOKAHEAD_ENABLED,
        LOOKAHEAD_SECONDS.toFixed(1) + 's/' + MAX_LOOKAHEAD_BLOCKS + 'blk'),
      hudVal ('     Budget surf/source', PROVIDER_BUDGET_PER_PASS + '/' + DIRECT_SOURCE_PER_PASS),
      hudVal ('     Interval surf/source', PROVIDER_REQUEST_INTERVAL_MS + '/' +
        DIRECT_SOURCE_INTERVAL_MS + 'ms'),
      hudVal ('     Blocks done/pend/left', providerSurfaceCompleted.size + '/' +
        providerSurfacePending.size + '/' + providerBlockRemaining.size),
      hudVal ('     Grid radius', PROVIDER_SURFACE_RADIUS_BLOCKS + ' blk')
    ]},
    { title: 'CACHE / VRAM / DIAG', rows: [
      // No key marker: the cache feature is compiled out, so Ctrl+K does nothing.
      hudRow('     Photo cache', CACHE_FEATURE_ENABLED && renderCacheEnabled,
        CACHE_FEATURE_ENABLED ? '' : 'NOT BUILT', CACHE_FEATURE_ENABLED ? 'key' : 'const'),
      hudRow('rpc  Native land cache', nativeLandCacheEnabled,
        nativeLandCacheCaptured ? 'captured' : 'not captured'),
      hudRow('rpc  VRAM telemetry', VRAM_TELEMETRY_ENABLED,
        VRAM_TELEMETRY_ENABLED ? (lastVram.remoteMB >= 0 ?
          lastVram.remoteMB.toFixed(0) + 'MB' : '?') : '', 'const'),
      hudRow('     Purge pending', graphicsPurgePending, 'n' + graphicsPurgeCount, 'engine'),
      hudRow('rpc  Verbose diagnostics', verboseDiagnostics, '', 'key'),
      hudRow('     Deep diagnostic hooks', DEEP_DIAGNOSTIC_HOOKS, '', 'const'),
      hudRow('     Restore requested', restoreRequested || restoreComplete,
        restoreComplete ? 'DONE' : '', 'engine')
    ]}
  ];
}

function hudBuildLines() {
  const sections = hudSections();
  const lines = [];
  for (let s = 0; s < sections.length; s++) {
    const section = sections[s];
    if (lines.length) lines.push({ type: 'gap' });
    lines.push({ type: 'header', label: section.title });
    for (let i = 0; i < section.rows.length; i++) {
      const row = section.rows[i];
      // Compact view: show only real on/off toggles, drop the value-only rows.
      if (hudCompact && row.on === null) continue;
      lines.push({ type: 'row', row: row });
    }
  }
  return lines;
}

function hudStateText(row) {
  if (row.on === null) return { text: row.extra, color: HUD_C_VALUE, extra: '' };
  const color = row.on
    ? (row.kind === 'const' ? HUD_C_FORCED : HUD_C_ON)
    : (row.kind === 'const' ? HUD_C_DIM : HUD_C_OFF);
  return { text: row.on ? 'ON' : 'OFF', color: color, extra: row.extra };
}

// When the script is reloaded (frida -l ... again) the previous instance's overlay
// window is left orphaned in the process. Its owning thread is still the game's main
// thread, so it can be destroyed from here. Otherwise a frozen ghost panel stays on
// screen with the new one drawn on top of it.
function hudSweepStaleWindows() {
  try {
    for (let i = 0; i < 8; i++) {
      const stale = findWindowW(hudClassName, NULL);
      if (stale.isNull()) break;
      if (!hudWindow.isNull() && stale.equals(hudWindow)) break;
      // DestroyWindow only works from the thread that OWNS the window. A window left
      // by a previous load of this script inside THIS process is owned by the game's
      // main thread, which is exactly where this runs, so it can be destroyed. A
      // window belonging to another process (a second client, say) cannot be, and
      // FindWindowW would keep handing back the same handle forever - so stop rather
      // than spin, and do not claim to have closed something we did not.
      hudOwnerPid.writeU32(0);
      getWindowThreadProcessId(stale, hudOwnerPid);
      const owner = hudOwnerPid.readU32();
      if (owner !== Process.id) {
        console.log('[HUD] leftover overlay window ' + stale + ' belongs to another ' +
          'process (pid ' + owner + '); leaving it alone.');
        break;
      }
      if (destroyWindow(stale) === 0) {
        console.log('[HUD] could not close leftover overlay window ' + stale +
          ' (not owned by this thread); continuing without it.');
        break;
      }
      console.log('[HUD] closed a leftover overlay window from a previous load.');
    }
  } catch (error) {
    hudFail('hudSweepStaleWindows', error);
  }
}

function hudEnsureClass() {
  if (hudClassRegistered) return true;
  hudSweepStaleWindows();
  hudWndClass.writeU32(80);                                  // cbSize
  hudWndClass.add(4).writeU32(0x0020);                       // style = CS_OWNDC
  hudWndClass.add(8).writePointer(defWindowProcW);           // lpfnWndProc
  hudWndClass.add(16).writeU32(0);                           // cbClsExtra
  hudWndClass.add(20).writeU32(0);                           // cbWndExtra
  hudWndClass.add(24).writePointer(getModuleHandleW(NULL));  // hInstance
  hudWndClass.add(32).writePointer(NULL);                    // hIcon
  hudWndClass.add(40).writePointer(NULL);                    // hCursor
  hudWndClass.add(48).writePointer(NULL);                    // hbrBackground
  hudWndClass.add(56).writePointer(NULL);                    // lpszMenuName
  hudWndClass.add(64).writePointer(hudClassName);            // lpszClassName
  hudWndClass.add(72).writePointer(NULL);                    // hIconSm
  const atom = registerClassExW(hudWndClass);
  // A zero atom can simply mean the class is already registered
  // (ERROR_CLASS_ALREADY_EXISTS); a real failure is caught at CreateWindowExW.
  hudClassRegistered = true;
  if (atom === 0) console.log('[HUD] window class already registered, continuing.');
  return true;
}

function hudEnsureWindow(width, height) {
  if (!hudWindow.isNull() && isWindowFn(hudWindow) !== 0) {
    if (width !== hudSurfaceWidth || height !== hudSurfaceHeight) hudResizeSurface(width, height);
    return true;
  }
  hudEnsureClass();
  const exStyle = 0x00080000 | 0x00000020 | 0x00000008 | 0x00000080 | 0x08000000;
  //             LAYERED    | TRANSPARENT | TOPMOST    | TOOLWINDOW | NOACTIVATE
  // No WS_VISIBLE: let the window be positioned and drawn first, then hudTick shows
  // it. Otherwise an empty panel flashes in the top-left corner on the first frame.
  const style = 0x80000000;   // WS_POPUP
  hudWindow = createWindowExW(exStyle, hudClassName, hudTitleText, style,
    0, 0, width, height, NULL, NULL, getModuleHandleW(NULL), NULL);
  if (hudWindow.isNull()) {
    hudFail('CreateWindowExW', 'pencere olusturulamadi');
    return false;
  }
  setLayeredWindowAttributes(hudWindow, 0, hudAlpha, 0x2);   // LWA_ALPHA
  hudResizeSurface(width, height);
  // A rebuilt window starts click-through; hudUpdateDrag re-evaluates it next frame.
  hudGrabbable = false;
  console.log('[HUD] overlay window created (' + width + 'x' + height +
    '). F3 = show/hide, F2 = compact/full, Ctrl+F3 = move.');
  return true;
}

function hudReleaseSurface() {
  try {
    if (!hudDc.isNull()) {
      if (!hudOldFont.isNull()) selectObject(hudDc, hudOldFont);
      if (!hudOldBitmap.isNull()) selectObject(hudDc, hudOldBitmap);
      deleteDC(hudDc);
    }
    if (!hudBackBitmap.isNull()) deleteObject(hudBackBitmap);
    if (!hudFont.isNull()) deleteObject(hudFont);
  } catch (_) {}
  hudDc = NULL;
  hudBackBitmap = NULL;
  hudOldBitmap = NULL;
  hudOldFont = NULL;
  hudFont = NULL;
  hudSurfaceWidth = 0;
  hudSurfaceHeight = 0;
}

function hudResizeSurface(width, height) {
  hudReleaseSurface();
  const windowDc = getDC(hudWindow);
  if (windowDc.isNull()) { hudFail('GetDC', 'pencere DC alinamadi'); return false; }
  try {
    hudDc = createCompatibleDC(windowDc);
    hudBackBitmap = createCompatibleBitmap(windowDc, width, height);
    if (hudDc.isNull() || hudBackBitmap.isNull()) {
      hudFail('CreateCompatibleDC/Bitmap', 'arka tampon olusturulamadi');
      return false;
    }
    hudOldBitmap = selectObject(hudDc, hudBackBitmap);
    // -13 = piksel yuksekligi (negatif = karakter yuksekligi), FW_NORMAL=400,
    // DEFAULT_CHARSET=1, OUT_TT_PRECIS=4, CLEARTYPE_QUALITY=5, FIXED_PITCH|FF_MODERN=49
    hudFont = createFontW(-13, 0, 0, 0, 400, 0, 0, 0, 1, 4, 0, 5, 49, hudFontName);
    if (!hudFont.isNull()) hudOldFont = selectObject(hudDc, hudFont);
    setBkMode(hudDc, 1);   // TRANSPARENT
    if (getTextExtentPoint32W(hudDc, hudMeasureText, 1, hudSize) !== 0) {
      const measured = hudSize.readS32();
      if (measured > 0 && measured < 40) hudCharWidth = measured;
    }
    if (hudPanelBrush.isNull()) hudPanelBrush = createSolidBrush(HUD_C_PANEL);
    if (hudBorderBrush.isNull()) hudBorderBrush = createSolidBrush(HUD_C_BORDER);
    if (hudMoveBrush.isNull()) hudMoveBrush = createSolidBrush(HUD_C_KEY);
    hudSurfaceWidth = width;
    hudSurfaceHeight = height;
    setWindowPos(hudWindow, NULL, 0, 0, width, height, 0x0010 | 0x0004 | 0x0002);
    // SWP_NOACTIVATE | SWP_NOZORDER | SWP_NOMOVE
    return true;
  } catch (error) {
    hudFail('hudResizeSurface', error);
    return false;
  } finally {
    releaseDC(hudWindow, windowDc);
  }
}

function hudPumpMessages() {
  if (hudWindow.isNull()) return;
  // PM_REMOVE = 1. Overlay girdi almaz; bu pompa yalnizca pencerenin
  // "yanit vermiyor" durumuna dusmesini engeller.
  let guard = 0;
  while (guard++ < 32 && peekMessageW(hudMsg, hudWindow, 0, 0, 1) !== 0) {
    translateMessage(hudMsg);
    dispatchMessageW(hudMsg);
  }
}

// The panel is click-through, so it normally cannot receive the mouse at all. To let it
// be dragged, WS_EX_TRANSPARENT is cleared for exactly as long as it is grabbable -
// while Ctrl is held with the cursor over the panel, or while a drag is in progress.
// Any other time it goes straight back to click-through, so clicks reach the game.
//
// Doing it this way avoids a separate "move mode" to remember: hold Ctrl, grab, drag.
const GWL_EXSTYLE = -20;
const WS_EX_TRANSPARENT = 0x00000020;

function hudSetGrabbable(grabbable) {
  if (hudGrabbable === grabbable) return;
  hudGrabbable = grabbable;
  hudLastDrawAt = 0;   // redraw so the border highlight follows immediately
  if (hudWindow.isNull()) return;
  try {
    const current = getWindowLongPtrW(hudWindow, GWL_EXSTYLE).toUInt32();
    const updated = grabbable
      ? (current & ~WS_EX_TRANSPARENT)
      : (current | WS_EX_TRANSPARENT);
    setWindowLongPtrW(hudWindow, GWL_EXSTYLE, ptr(updated));
  } catch (error) {
    hudFail('hudSetGrabbable', error);
  }
}

// Runs every frame rather than at the draw rate, otherwise dragging feels laggy.
function hudUpdateDrag() {
  if (hudWindow.isNull()) return;
  try {
    if (getCursorPos(hudCursor) === 0) return;
    const cursorX = hudCursor.readS32();
    const cursorY = hudCursor.add(4).readS32();
    if (getWindowRect(hudWindow, hudDragRect) === 0) return;
    const left = hudDragRect.readS32();
    const top = hudDragRect.add(4).readS32();
    const right = hudDragRect.add(8).readS32();
    const bottom = hudDragRect.add(12).readS32();
    const overPanel = cursorX >= left && cursorX < right &&
                      cursorY >= top && cursorY < bottom;
    const ctrlDown = (getAsyncKeyState(VK_CONTROL) & 0x8000) !== 0;
    const buttonDown = (getAsyncKeyState(0x01) & 0x8000) !== 0;   // VK_LBUTTON

    // Stay grabbable for the whole drag even if the cursor outruns the panel.
    hudSetGrabbable(hudDragging || (ctrlDown && overPanel));
    if (!hudGrabbable) { hudDragging = false; return; }
    if (!buttonDown) { hudDragging = false; return; }

    if (!hudDragging) {
      if (!overPanel) return;
      hudDragging = true;
      hudDragGrabX = cursorX - left;
      hudDragGrabY = cursorY - top;
      return;
    }

    const newLeft = cursorX - hudDragGrabX;
    const newTop = cursorY - hudDragGrabY;
    // Store the position RELATIVE to the game client area, or the HUD drifts when the game window moves.
    if (!lotroWindow.isNull() && isWindowFn(lotroWindow) !== 0) {
      hudPoint.writeS32(0);
      hudPoint.add(4).writeS32(0);
      if (clientToScreen(lotroWindow, hudPoint) !== 0) {
        hudOffsetX = newLeft - hudPoint.readS32();
        hudOffsetY = newTop - hudPoint.add(4).readS32();
      }
    }
    setWindowPos(hudWindow, ptr('0xffffffffffffffff'), newLeft, newTop, 0, 0,
      0x0010 | 0x0001);   // SWP_NOACTIVATE | SWP_NOSIZE
  } catch (error) {
    hudFail('hudUpdateDrag', error);
    hudDragging = false;
    hudSetGrabbable(false);
  }
}

function hudFollowGameWindow(width, height) {
  // While dragging we drive the position ourselves; the follow code must not fight it.
  if (hudDragging) return;
  if (lotroWindow.isNull() || isWindowFn(lotroWindow) === 0) return;
  if (getClientRect(lotroWindow, hudRect) === 0) return;
  hudPoint.writeS32(0);
  hudPoint.add(4).writeS32(0);
  if (clientToScreen(lotroWindow, hudPoint) === 0) return;
  const x = hudPoint.readS32() + hudOffsetX;
  const y = hudPoint.add(4).readS32() + hudOffsetY;
  // Only touch the window manager when the geometry actually changed. Re-asserting
  // position and Z-order four times a second forever is a system-wide z-order
  // recalculation each time, for no benefit while the game window is not moving.
  if (x === hudLastX && y === hudLastY &&
      width === hudLastW && height === hudLastH) return;
  hudLastX = x;
  hudLastY = y;
  hudLastW = width;
  hudLastH = height;
  const topmost = ptr('0xffffffffffffffff');   // HWND_TOPMOST
  setWindowPos(hudWindow, topmost, x, y, width, height, 0x0010);   // SWP_NOACTIVATE
}

function hudDraw() {
  const lines = hudBuildLines();
  const columns = 2;
  const perColumn = Math.ceil(lines.length / columns);
  const width = HUD_PAD * 2 + HUD_COL_W * columns;
  const height = HUD_TITLE_H + perColumn * HUD_LINE_H + HUD_FOOTER_H + HUD_PAD * 2;

  if (!hudEnsureWindow(width, height)) return;
  if (hudDc.isNull()) return;
  hudFollowGameWindow(width, height);

  // panel + border
  hudRect.writeS32(0);
  hudRect.add(4).writeS32(0);
  hudRect.add(8).writeS32(width);
  hudRect.add(12).writeS32(height);
  fillRect(hudDc, hudRect, hudPanelBrush);
  // Highlight the border while the panel can be grabbed.
  frameRect(hudDc, hudRect, hudGrabbable ? hudMoveBrush : hudBorderBrush);

  if (hudGrabbable) {
    hudText(hudDc, HUD_PAD, 6,
      'HOLD CTRL AND DRAG to move this panel',
      HUD_C_KEY);
  } else {
    hudText(hudDc, HUD_PAD, 6,
      'LOTRO CINEMATIC FREECAM - FEATURE STATUS   (^ = Ctrl)' +
      (hudCompact ? '  [compact]' : '') +
      '   ^F3 hide | ^F2 view | hold Ctrl + drag to move',
      HUD_C_HEADER);
  }

  for (let i = 0; i < lines.length; i++) {
    const column = Math.floor(i / perColumn);
    const rowIndex = i - column * perColumn;
    const x = HUD_PAD + column * HUD_COL_W;
    const y = HUD_TITLE_H + rowIndex * HUD_LINE_H;
    const line = lines[i];
    if (line.type === 'gap') continue;
    if (line.type === 'header') {
      hudText(hudDc, x, y, '-- ' + line.label, HUD_C_HEADER);
      continue;
    }
    const row = line.row;
    const state = hudStateText(row);
    // The first 4 characters of the label are the control marker: '^Fx' for a Ctrl
    // hotkey, 'rpc' for something only the console can change, blank for a row that is
    // a reading rather than a switch.
    const prefix = row.label.slice(0, 4);
    const rest = row.label.slice(4);
    if (prefix.trim().length) {
      hudText(hudDc, x, y, prefix, prefix.charAt(0) === '^' ? HUD_C_KEY : HUD_C_RPC);
    }
    hudText(hudDc, x + 4 * hudCharWidth, y, rest, HUD_C_VALUE);
    hudText(hudDc, x + HUD_STATE_X, y, state.text, state.color);
    if (state.extra) hudText(hudDc, x + HUD_EXTRA_X, y, state.extra, HUD_C_DIM);
  }

  // Legend: without it the panel looks like a wall of switches, when in fact only the
  // rows with a marker can be changed at all.
  const footerY = height - HUD_PAD - 12;
  if (hudErrorCount > 0) {
    hudText(hudDc, HUD_PAD, footerY, 'HUD error: ' + hudLastError.slice(0, 90), HUD_C_WARN);
  } else {
    hudText(hudDc, HUD_PAD, footerY, '^Fx', HUD_C_KEY);
    hudText(hudDc, HUD_PAD + 4 * hudCharWidth, footerY,
      '= Ctrl hotkey    ', HUD_C_DIM);
    hudText(hudDc, HUD_PAD + 21 * hudCharWidth, footerY, 'rpc', HUD_C_RPC);
    hudText(hudDc, HUD_PAD + 25 * hudCharWidth, footerY,
      '= console only    ', HUD_C_DIM);
    hudText(hudDc, HUD_PAD + 43 * hudCharWidth, footerY, 'cyan', HUD_C_FORCED);
    hudText(hudDc, HUD_PAD + 48 * hudCharWidth, footerY,
      '= fixed at compile time    no marker = a reading, not a switch', HUD_C_DIM);
  }

  const windowDc = getDC(hudWindow);
  if (windowDc.isNull()) return;
  try {
    bitBlt(windowDc, 0, 0, width, height, hudDc, 0, 0, 0x00CC0020);   // SRCCOPY
  } finally {
    releaseDC(hudWindow, windowDc);
  }
  hudFrames++;
}

// ShowWindow is a window-manager call, so calling it every frame while alt-tabbed meant
// 60+ pointless calls a second. Track the state and only act on an actual change.
function hudSetVisible(visible) {
  if (hudWindow.isNull() || hudVisible === visible) return;
  try {
    showWindow(hudWindow, visible ? 4 : 0);   // SW_SHOWNOACTIVATE : SW_HIDE
    hudVisible = visible;
  } catch (_) {}
}

function hudDestroy() {
  hudReleaseSurface();
  try {
    if (!hudPanelBrush.isNull()) deleteObject(hudPanelBrush);
    if (!hudBorderBrush.isNull()) deleteObject(hudBorderBrush);
    if (!hudMoveBrush.isNull()) deleteObject(hudMoveBrush);
  } catch (_) {}
  hudPanelBrush = NULL;
  hudBorderBrush = NULL;
  hudMoveBrush = NULL;
  try { if (!hudWindow.isNull()) destroyWindow(hudWindow); } catch (_) {}
  hudWindow = NULL;
  // Reset cached window state, otherwise a rebuilt window inherits the old geometry
  // and hudFollowGameWindow decides nothing changed and never positions it.
  hudVisible = false;
  hudLastX = -100000;
  hudLastY = -100000;
  hudLastW = 0;
  hudLastH = 0;
  hudDragging = false;
  hudGrabbable = false;
  hudUnfocusedSince = 0;
}

// Called from the game's main tick. The thread that creates the window must also
// pump its messages, which makes this the only correct place for it.
function hudTick() {
  if (!hudBootstrapped) return;
  try {
    // Pump FIRST, unconditionally, before any early return below can skip it.
    //
    // This is not optional bookkeeping. Windows decides a thread is unresponsive if it
    // goes ~5 seconds without processing messages, and then ghosts every top-level
    // window that thread owns. Our overlay is owned by the game's main thread, so an
    // existing-but-unpumped overlay makes the GAME show up as "not responding" while it
    // is actually running perfectly. Any path that leaves the window alive must keep
    // pumping it.
    hudPumpMessages();

    if (restoreComplete) { hudDestroy(); return; }
    if (!hudEnabled) {
      // Tear the window down rather than leaving a hidden one alive: a window that does
      // not exist cannot be counted against the thread, which removes the whole failure
      // mode above. Re-enabling rebuilds it lazily on the next tick.
      if (!hudWindow.isNull()) hudDestroy();
      return;
    }
    if (!isLotroForeground()) {
      // Hide immediately so the panel never floats over the desktop, then destroy it.
      //
      // Destroying matters: the pump above only runs as often as the game's main tick,
      // and the client throttles that tick hard while it is in the background. A window
      // that exists but has stopped being pumped is exactly what makes Windows flag the
      // owning thread - and therefore the game itself - as "not responding". While we
      // are in the background the window simply does not exist, so there is nothing to
      // flag. It is rebuilt on the next tick after focus returns.
      hudSetVisible(false);
      if (!hudWindow.isNull()) {
        if (hudUnfocusedSince === 0) hudUnfocusedSince = Date.now();
        else if (Date.now() - hudUnfocusedSince >= HUD_BACKGROUND_DESTROY_MS) hudDestroy();
      }
      return;
    }
    hudUnfocusedSince = 0;
    hudUpdateDrag();   // independent of the draw rate so dragging stays smooth
    const now = Date.now();
    if (now - hudLastDrawAt < HUD_REFRESH_MS) return;
    hudLastDrawAt = now;
    hudDraw();
    hudSetVisible(true);
  } catch (error) {
    hudFail('hudTick', error);
  }
}

hudBootstrapped = true;

// =============================================================================
// FEATURE REGISTRY
// -----------------------------------------------------------------------------
// One place that knows every switchable feature, what it currently is, and how to
// change it. The hotkeys, the overlay and the console commands all read from this, so
// they cannot drift apart from each other.
//
// Only land and grass start enabled. Everything else is opt-in, because the rest either
// costs framerate, changes how the game looks in ways not everyone wants, or pauses the
// client while the engine rebuilds. Nothing here is on unless you asked for it.
// =============================================================================
const FEATURES = {
  land: {
    label: 'Terrain draw distance', key: 'Ctrl+F5', def: true,
    note: 'Extends the high-detail terrain ring past the engine default.',
    get: function () { return renderBoostEnabled; },
    set: function (on) { if (on) enableRenderBoost(); else disableRenderBoost(); }
  },
  grass: {
    label: 'Grass distance + density', key: 'Ctrl+F10', def: true,
    note: 'The long-range grass. Also the biggest single framerate cost.',
    get: function () { return frillBoostEnabled; },
    set: function (on) {
      if (!GRASS_MACHINERY) {
        console.log('[FEATURE] grass is compiled out (GRASS_MACHINERY=false).');
        return;
      }
      if (on) { enableResidencyGrid(); enableFrillBoost(); }
      else { disableFrillBoost(); disableResidencyGrid(); }
    }
  },
  texture: {
    label: 'Sharp textures / mip bias', key: 'Ctrl+F7', def: false,
    note: 'Max texture detail and 16x aniso, with a negative mip bias.',
    get: function () { return textureBoostEnabled; },
    set: function (on) { if (on) enableTextureBoost(); else disableTextureBoost(); }
  },
  terrain: {
    label: 'Max terrain material quality', key: 'Ctrl+F4', def: false,
    note: 'Material, shadows, lighting, far normal maps and seam blending at maximum. ' +
          'Rebuilds terrain materials, so expect a pause when toggled.',
    get: function () { return terrainMaxApplied; },
    set: function (on) {
      onMainThread(function () {
        if (on) { setTerrainMax(); verifyStartupFullQuality(); }
        else disableTerrainMax();
      });
    }
  },
  lod0: {
    label: 'Force LOD0 on everything', key: 'Ctrl+F9', def: false,
    note: 'Every object at full detail at any distance. Very expensive - stills only.',
    get: function () { return lodBoostEnabled; },
    // Mutually exclusive with treelod: one writes AllowLODs=0, the other writes 1, so
    // leaving both on meant whichever ran last silently won and the loser still reported
    // itself as enabled.
    set: function (on) {
      if (on && HYBRID_DISTANT_TREE_LODS) {
        HYBRID_DISTANT_TREE_LODS = false;
        console.log('[FEATURE] treelod turned off: it and lod0 control the same flag.');
      }
      if (on) enableLodBoost(); else disableLodBoost();
    }
  },
  objects: {
    label: 'Object draw distance boost', key: 'Ctrl+F1', def: false,
    note: 'Pushes decoration draw distance out. Can make distant trees disappear ' +
          'because the 3D draw distance outruns mesh residency.',
    get: function () { return objectBoostEnabled; },
    set: function (on) { onMainThread(on ? enableObjectBoost : disableObjectBoost); }
  },
  imposters: {
    label: 'Distant 2D imposters', key: 'Ctrl+F11', def: null,
    note: 'The far horizon ground. Turning this OFF deletes the horizon - keep it on.',
    get: function () { return distantImposters.readU8() !== 0; },
    set: function (on) {
      writeU8IfChanged(distantImposters, on ? 1 : 0);
      impostersEnabled = !!on;
      console.log('[IMPOSTERS] ' + (on ? 'ON' : 'OFF - the far ground is gone'));
    }
  },
  landorigin: {
    label: 'Streaming origin follows camera', key: 'Ctrl+F6', def: false,
    note: 'Moves the landscape streaming origin to the camera. Locked during flight, ' +
          'where the camera-centred path already handles it.',
    get: function () { return landOriginForceEnabled; },
    // The same guard the hotkey uses. It lived only in the key handler before, so the
    // console could force it on mid-flight where the camera-centred path already owns
    // the origin, and the two would fight.
    set: function (on) {
      if (on && active && CAMERA_CENTERED_STREAMING) {
        console.log('[LAND ORIGIN FORCE] Locked during flight; the camera-centred path ' +
          'already moves the origin.');
        return;
      }
      if (on) enableLandOriginForce(); else disableLandOriginForce();
    }
  },
  grassfalloff: {
    label: 'Thin grass with distance', key: 'Ctrl+G', def: false,
    note: 'Off means full density all the way out, which is what makes the far grass ' +
          'look solid. On thins it with distance: cheaper, still reads as grass.',
    // Reads the engine field rather than the script variable. enforceFrillBoost() bails
    // out when the grass boost is off, so going through it meant the flag could say ON
    // while the engine had never been told - the feature would report a state it had not
    // actually applied. Write and read the real field instead.
    get: function () {
      const engine = resolveFrillEngine();
      if (engine === null) return FRILL_REDUCTION_ENABLED !== 0;
      try { return engine.add(0xe8).readU8() !== 0; }
      catch (_) { return FRILL_REDUCTION_ENABLED !== 0; }
    },
    set: function (on) {
      FRILL_REDUCTION_ENABLED = on ? 1 : 0;
      const engine = resolveFrillEngine();
      if (engine !== null) {
        try { writeU8IfChanged(engine.add(0xe8), FRILL_REDUCTION_ENABLED); } catch (_) {}
      }
    }
  },
  treelod: {
    label: 'Hybrid distant tree LOD', key: '-', def: false,
    note: 'Lets distant trees promote to a medium 3D model when one is resident and ' +
          'keep the 2D imposter when it is not.',
    get: function () { return HYBRID_DISTANT_TREE_LODS; },
    // See lod0 above - these two write opposite values to AllowLODs, so turning one on
    // turns the other off rather than letting them overwrite each other silently.
    set: function (on) {
      if (on && lodBoostEnabled) {
        disableLodBoost();
        console.log('[FEATURE] lod0 turned off: it and treelod control the same flag.');
      }
      HYBRID_DISTANT_TREE_LODS = !!on;
      onMainThread(on ? enableHybridLodMode : disableHybridLodMode);
    }
  },
  camerastream: {
    label: 'World loads around the camera', key: '-', def: true,
    note: 'Keeps world streaming centred on the camera instead of the avatar. Without ' +
          'it the camera can outrun the region the engine is streaming for you.',
    get: function () { return CAMERA_CENTERED_STREAMING; },
    set: function (on) {
      if (!on) setCameraCenteredStreaming(false);
      CAMERA_CENTERED_STREAMING = !!on;
      if (on && active) setCameraCenteredStreaming(true);
    }
  },
  worldcell: {
    label: 'Object streaming follows camera', key: '-', def: true,
    note: 'Notifies the static-world cell listeners when the camera crosses a block, ' +
          'so buildings and props load ahead of it.',
    get: function () { return CAMERA_WORLD_CELL_STREAMING; },
    set: function (on) {
      if (!on) restoreWorldCellProxyFromPlayer('FEATURE OFF');
      CAMERA_WORLD_CELL_STREAMING = !!on;
    }
  },
  fullrender: {
    label: 'Stream even when not flying', key: '-', def: true,
    note: 'Off restricts the extended streaming to while the camera is actually ' +
          'flying, which gives the game back its normal behaviour when parked.',
    get: function () { return ALWAYS_FULL_RENDER; },
    set: function (on) { ALWAYS_FULL_RENDER = !!on; }
  },
  vram: {
    label: 'VRAM telemetry scan', key: '-', def: false,
    note: 'Totals video memory by walking the DX11 resource table. A scan on the ' +
          'render tick - for investigating, not for leaving on.',
    get: function () { return VRAM_TELEMETRY_ENABLED; },
    set: function (on) { VRAM_TELEMETRY_ENABLED = !!on; if (on) queueVramTelemetry('feature'); }
  },
  hud: {
    label: 'On-screen overlay', key: 'Ctrl+F3', def: true,
    note: 'The feature-status panel. Hold Ctrl and drag it to move it.',
    get: function () { return hudEnabled; },
    set: function (on) { hudEnabled = !!on; hudLastDrawAt = 0; }
  }
};

function featureStates() {
  const out = {};
  Object.keys(FEATURES).forEach(function (name) {
    try { out[name] = !!FEATURES[name].get(); } catch (_) { out[name] = null; }
  });
  return out;
}

function setFeature(name, on) {
  const feature = FEATURES[name];
  if (feature === undefined) {
    console.log('[FEATURE] unknown: ' + name + '. Known: ' + Object.keys(FEATURES).join(', '));
    return false;
  }
  const want = !!on;
  let current = false;
  try { current = !!feature.get(); } catch (_) {}
  if (current === want) return true;
  try {
    feature.set(want);
    console.log('[FEATURE] ' + name + ' -> ' + (want ? 'ON' : 'OFF') + '  (' + feature.label + ')');
    return true;
  } catch (error) {
    console.log('[FEATURE ERROR] ' + name + ': ' + error);
    return false;
  }
}

// 'all' turns everything on, 'none' strips back to the camera alone, 'default' is what
// you get on attach - land and grass, nothing else.
//
// One thing is deliberately excluded and it is logged rather than hidden: 'none' does
// not switch the distant imposters off. Off is not a cheaper state for them, it deletes
// the far ground and leaves skybox behind, so it belongs to nobody's idea of "turn the
// extras off".
function applyFeaturePreset(preset) {
  const skipped = [];
  Object.keys(FEATURES).forEach(function (name) {
    const feature = FEATURES[name];
    if (preset === 'all') {
      setFeature(name, true);
    } else if (preset === 'none') {
      if (name === 'imposters') { skipped.push(name); return; }
      setFeature(name, false);
    } else {
      if (feature.def === null) { skipped.push(name); return; }
      setFeature(name, feature.def);
    }
  });
  if (skipped.length) {
    console.log('[FEATURES] left untouched by "' + preset + '": ' + skipped.join(', ') +
      ' (turning imposters off deletes the horizon; use feature(\'imposters\', false) ' +
      'if you really want that).');
  }
  if (preset === 'all') {
    // Not literally everything: lod0 and treelod write opposite values to the same flag,
    // so the later one wins and says so. The state printed below is the truth.
    console.log('[FEATURES] everything that can be on at once is on. That is the ' +
      'heaviest possible configuration - expect a large framerate drop and a pause ' +
      'while terrain rebuilds. alloff() or defaults() puts it back.');
  }
  // terrain and objects are applied on the game's main tick, so they can still read
  // as their old value here and settle a frame later. features() is the accurate view.
  console.log('[FEATURES] "' + preset + '" -> ' + JSON.stringify(featureStates()) +
    '  (terrain/objects settle on the next frame)');
  return featureStates();
}

rpc.exports = {
  requestRestore: function () {
    nativeAutoEnablePending = false;
    restoreRequested = true;
    flightCleanupComplete = !active;
    return true;
  },
  isRestoreComplete: function () {
    return restoreComplete;
  },
  // Never execute engine cleanup from Frida's RPC worker. Queue it for the
  // game's main tick and let the runner wait for isRestoreComplete().
  restore: function () {
    if (!restoreComplete) {
      restoreRequested = true;
      return false;
    }
    return true;
  },
  flight: function (on) {
    if (on) {
      flightStopRequested = false;
      nativeAutoEnablePending = true;
      console.log('[RPC FLIGHT] ON queued for camera tick.');
    } else {
      nativeAutoEnablePending = false;
      flightStopRequested = true;
      console.log('[RPC FLIGHT] OFF queued for camera tick.');
    }
    return { requested: !!on, active: active, token: flightToken };
  },
  setlookahead: function (seconds, maxBlocks) {
    if (typeof seconds === 'number' && isFinite(seconds)) LOOKAHEAD_SECONDS = Math.max(0, seconds);
    if (typeof maxBlocks === 'number' && isFinite(maxBlocks)) {
      MAX_LOOKAHEAD_BLOCKS = Math.max(0, Math.min(8, maxBlocks | 0));
    }
    LOOKAHEAD_ENABLED = LOOKAHEAD_SECONDS > 0 && MAX_LOOKAHEAD_BLOCKS > 0;
    console.log('[TUNE] lookahead=' + LOOKAHEAD_SECONDS + 's max=' + MAX_LOOKAHEAD_BLOCKS +
      ' enabled=' + LOOKAHEAD_ENABLED);
    return { LOOKAHEAD_SECONDS: LOOKAHEAD_SECONDS, MAX_LOOKAHEAD_BLOCKS: MAX_LOOKAHEAD_BLOCKS };
  },
  setbudget: function (n) {
    if (typeof n === 'number' && isFinite(n)) PROVIDER_BUDGET_PER_PASS = Math.max(1, Math.min(16, n | 0));
    console.log('[TUNE] provider budget/pass=' + PROVIDER_BUDGET_PER_PASS);
    return { PROVIDER_BUDGET_PER_PASS: PROVIDER_BUDGET_PER_PASS };
  },
  setfrillbudget: function (millisecondsAt60Fps) {
    if (typeof millisecondsAt60Fps === 'number' && isFinite(millisecondsAt60Fps)) {
      FRILL_BUDGET_MS_AT_60FPS = Math.max(0.5, Math.min(8.0, millisecondsAt60Fps));
    }
    if (frillBoostEnabled) {
      patchReadonlyFloatIfChanged(frillTimeBudgetMultiplier, cinematicFrillBudgetMultiplier());
    }
    console.log('[TUNE] frill main-thread budget=' +
      FRILL_BUDGET_MS_AT_60FPS.toFixed(2) + 'ms@60fps multiplier=' +
      cinematicFrillBudgetMultiplier().toFixed(7));
    return {
      millisecondsAt60Fps: FRILL_BUDGET_MS_AT_60FPS,
      multiplier: cinematicFrillBudgetMultiplier(),
      originalMultiplier: originalFrillTimeBudgetMultiplier
    };
  },
  setpartial: function (on) {
    PARTIAL_GATE = !!on;
    console.log('[TUNE] partial gate=' + PARTIAL_GATE + (PARTIAL_GATE ? '' : ' (all-nine-anchor gate)'));
    return { PARTIAL_GATE: PARTIAL_GATE };
  },
  // Increase/decrease render distance live. blocks = grid radius in landblocks.
  // Scales grass draw radius, provider grid, source coverage and retention together.
  setrange: function (blocks) {
    const R = Math.max(3, Math.min(24, blocks | 0));
    const grass = applyGrassRangeBlocks(R);
    NEAR_RADIUS = Math.min(R * 16, NEAR_RADIUS_CAP);
    FAR_RADIUS = Math.min(FAR_RADIUS_MAX, NEAR_RADIUS + MEDIUM_LAND_BAND_SECTORS);
    radiusApplyPending = true;
    enforceRenderBoost();
    console.log('[TUNE] range=' + R + ' blocks | grid=' + grass.gridBlocks +
      ' | land high/medium=' + NEAR_RADIUS + '/' + FAR_RADIUS +
      ' | grass=' + FRILL_DISTANCE_SECTORS + ' sectors | groupR=' + RESIDENCY_GROUP_RADIUS +
      ' retain=' + MAX_RETAINED_LAND_SOURCES +
      (grass.gridBlocks > 150
        ? ' | WARN: >150 blocks may hit the native resident budget (Box+0xf0) = eviction thrash; watch grid/complete for oscillation'
        : ''));
    return { blocks: R, gridBlocks: grass.gridBlocks, drawSectors: FRILL_DISTANCE_SECTORS,
      landHighSectors: NEAR_RADIUS, landMediumSectors: FAR_RADIUS,
      groupRadius: RESIDENCY_GROUP_RADIUS, maxRetain: MAX_RETAINED_LAND_SOURCES };
  },
  setgrassrange: function (blocks) {
    const grass = applyGrassRangeBlocks(blocks);
    console.log('[TUNE] grass-only R' + grass.blocks + ' | distance=' + grass.drawSectors +
      ' sectors | grid=' + grass.gridBlocks + ' | groupR=' + grass.groupRadius +
      ' | evictR=' + grass.evictRadius + ' | retain=' + grass.maxRetain +
      ' | land unchanged high/medium=' + NEAR_RADIUS + '/' + FAR_RADIUS);
    return grass;
  },
  cache: function (on) {
    setRenderCacheEnabled(!!on);
    return {
      featureEnabled: CACHE_FEATURE_ENABLED,
      enabled: renderCacheEnabled,
      evictRadius: GRASS_EVICT_RADIUS,
      maxSources: MAX_RETAINED_LAND_SOURCES,
      retainedSurfaceKeys: providerSurfaceCompleted.size,
      retainedSources: retainedLandSources.size,
      nativeCacheCaptured: nativeLandCacheCaptured,
      nativeCacheEnabled: nativeLandCacheEnabled,
      nativeCachePending: nativeLandCacheApplyPending,
      nativeCacheApplyCount: nativeLandCacheApplyCount,
      nativeCacheCaptureErrors: nativeLandCacheCaptureErrors,
      nativeCacheApplyErrors: nativeLandCacheApplyErrors,
      purgePending: graphicsPurgePending
    };
  },
  purge: function (freeSystemMemory) {
    const fullReset = freeSystemMemory !== false;
    const queued = purgeRenderCaches('RPC MANUAL RESET', fullReset);
    return {
      featureEnabled: CACHE_FEATURE_ENABLED,
      queued: queued,
      pending: graphicsPurgePending,
      count: graphicsPurgeCount,
      fullReset: fullReset
    };
  },
  // Tune load SPEED. All args optional (pass null to keep). Lower intervals / higher
  // per-pass = faster fill but more FPS load.
  setload: function (surfaceBudget, surfaceIntervalMs, sourceBudget, sourceIntervalMs) {
    if (typeof surfaceBudget === 'number' && isFinite(surfaceBudget)) PROVIDER_BUDGET_PER_PASS = Math.max(1, Math.min(32, surfaceBudget | 0));
    if (typeof surfaceIntervalMs === 'number' && isFinite(surfaceIntervalMs)) PROVIDER_REQUEST_INTERVAL_MS = Math.max(40, Math.min(500, surfaceIntervalMs | 0));
    if (typeof sourceBudget === 'number' && isFinite(sourceBudget)) DIRECT_SOURCE_PER_PASS = Math.max(1, Math.min(16, sourceBudget | 0));
    if (typeof sourceIntervalMs === 'number' && isFinite(sourceIntervalMs)) DIRECT_SOURCE_INTERVAL_MS = Math.max(40, Math.min(500, sourceIntervalMs | 0));
    console.log('[TUNE] load: surface=' + PROVIDER_BUDGET_PER_PASS + '/' + PROVIDER_REQUEST_INTERVAL_MS + 'ms' +
      ' source=' + DIRECT_SOURCE_PER_PASS + '/' + DIRECT_SOURCE_INTERVAL_MS + 'ms');
    return { PROVIDER_BUDGET_PER_PASS: PROVIDER_BUDGET_PER_PASS, PROVIDER_REQUEST_INTERVAL_MS: PROVIDER_REQUEST_INTERVAL_MS,
      DIRECT_SOURCE_PER_PASS: DIRECT_SOURCE_PER_PASS, DIRECT_SOURCE_INTERVAL_MS: DIRECT_SOURCE_INTERVAL_MS };
  },
  setobjectgain: function (x) {
    if (typeof x === 'number' && isFinite(x) && x > 0) { OBJECT_GAIN = Math.min(20, x); reassertObjectMult(); }
    console.log('[TUNE] objectGain=' + OBJECT_GAIN + ' -> mult=' + boostedObjectMult().toFixed(2));
    return { OBJECT_GAIN: OBJECT_GAIN, mult: boostedObjectMult() };
  },
  refreshterrain: function () { onMainThread(terrainRefresh); return true; },
  terrainauto: function (on) { terrainAutoRefresh = !!on; console.log('[TUNE] terrainAutoRefresh=' + terrainAutoRefresh); return { terrainAutoRefresh: terrainAutoRefresh }; },
  objectboost: function (on) { if (on) onMainThread(enableObjectBoost); else onMainThread(disableObjectBoost); return { on: !!on }; },
  lod: function (on) {
    if (on) enableLodBoost();
    else disableLodBoost();
    return { enabled: lodBoostEnabled, allowLods: allowLodsFlag.readU8() };
  },
  diagnostics: function (on) {
    verboseDiagnostics = !!on;
    console.log('[DIAGNOSTICS] verbose status=' + verboseDiagnostics +
      ' deepHooks=' + DEEP_DIAGNOSTIC_HOOKS + '.');
    return { verbose: verboseDiagnostics, deepHooks: DEEP_DIAGNOSTIC_HOOKS };
  },
  vram: function () {
    queueVramTelemetry('rpc');
    const v = lastVram;
    console.log('[VRAM] resource scan=' + (VRAM_TELEMETRY_ENABLED ? 'ON' : 'DISABLED') +
      ' cached remote=' + (v.remoteMB >= 0 ? v.remoteMB.toFixed(0) : '?') + 'MB' +
      ' system=' + (v.systemMB >= 0 ? v.systemMB.toFixed(0) : '?') + 'MB' +
      ' peak=' + v.peakMB.toFixed(0) + 'MB' +
      ' safeMonitor=' + VRAM_SAFE_REMOTE_CEILING_MB + 'MB' +
      ' resources=' + v.scanned + '/' + v.count +
      (v.truncated ? ' TRUNCATED' : '') + ' (fresh sample queued)');
    return Object.assign({ enabled: VRAM_TELEMETRY_ENABLED, pending: vramTelemetryPending }, v);
  },
  vrambudget: function (mb) {
    console.log('[VRAM] ' + mb + 'MB request is monitor-only: DX11 owns physical residency. ' +
      'Graphics.MemoryUsage=' + GRAPHICS_MEMORY_USAGE_MAX.toFixed(1) + ' is already max; ' +
      'photo asset RAM target=' + NATIVE_CACHE_RAM_TARGET_MIB + 'MiB.');
    return {
      requestedMB: mb,
      writable: false,
      graphicsMemoryUsage: GRAPHICS_MEMORY_USAGE_MAX,
      safeRemoteMonitorMB: VRAM_SAFE_REMOTE_CEILING_MB,
      nativeAssetCacheMiB: NATIVE_CACHE_RAM_TARGET_MIB
    };
  },
  vrampeakreset: function () { vramPeakBytes = 0; console.log('[VRAM] peak high-water reset.'); return true; },
  // An omitted argument arrives as null through the RPC bridge, not undefined. Getting
  // this wrong meant that merely reading the state - rpc.exports.hud() - switched the
  // overlay off, because !!null is false.
  hud: function (on) {
    hudEnabled = (on === undefined || on === null) ? !hudEnabled : !!on;
    hudLastDrawAt = 0;
    console.log('[HUD] overlay=' + (hudEnabled ? 'ON' : 'OFF') +
      ' errors=' + hudErrorCount + ' last=' + hudLastError);
    return { enabled: hudEnabled, compact: hudCompact, grabbable: hudGrabbable,
      frames: hudFrames, errors: hudErrorCount, lastError: hudLastError,
      window: hudWindow.toString(), gameWindow: lotroWindow.toString() };
  },
  hudcompact: function (on) {
    hudCompact = (on === undefined || on === null) ? !hudCompact : !!on;
    hudLastDrawAt = 0;
    return { compact: hudCompact };
  },
  // Move mode: the panel stops being click-through so you can drag it with the
  // left mouse button. Lock it again when you are done, or the game will not
  // receive clicks that land on the panel.
  // Turn any single feature on or off by name. Omit `on` to toggle.
  feature: function (name, on) {
    // An omitted argument arrives as null through the RPC bridge, not undefined.
    if (name === undefined || name === null) return featureStates();
    const entry = FEATURES[name];
    if (entry === undefined) {
      setFeature(name, false);   // logs the unknown name and the valid ones
      return featureStates();
    }
    setFeature(name, (on === undefined || on === null) ? !entry.get() : on);
    return featureStates();
  },
  // Current state of everything, plus what each one is and which key toggles it.
  features: function () {
    const state = featureStates();
    const out = {};
    Object.keys(FEATURES).forEach(function (name) {
      out[name] = {
        on: state[name],
        label: FEATURES[name].label,
        key: FEATURES[name].key,
        defaultOn: FEATURES[name].def,
        note: FEATURES[name].note
      };
    });
    return out;
  },
  // Raw engine values behind the features, read straight out of memory rather than from
  // script state. If a feature's reported state and the value here ever disagree, the
  // feature is lying and this is how you catch it.
  raw: function () {
    const engine = resolveFrillEngine();
    function rd(fn, fallback) { try { const v = fn(); return v === undefined ? fallback : v; } catch (_) { return fallback; } }
    return {
      allowLods: rd(function () { return allowLodsFlag.readU8(); }, -1),
      distantImposters: rd(function () { return distantImposters.readU8(); }, -1),
      materialDetail: rd(function () { return base.add(MATERIAL_DETAIL_RVA).readU32(); }, -1),
      farNormalMaps: rd(function () { return base.add(FAR_LANDSCAPE_NORMAL_MAPS_RVA).readU8(); }, -1),
      seamBlend: rd(function () { return base.add(NEAR_FAR_SEAM_BLEND_RVA).readU8(); }, -1),
      staticShadows: rd(function () { return base.add(LANDSCAPE_STATIC_OBJECT_SHADOWS_RVA).readU32(); }, -1),
      textureDetail: rd(function () { return textureDetail.readU32(); }, -1),
      aniso: rd(function () { return anisotropicQuality.readU32(); }, -1),
      objectMult: rd(function () { return base.add(OBJ_MULT_RVA).readFloat(); }, -1),
      grassDrawSectors: engine === null ? -1 : rd(function () { return engine.add(0x64).readU32(); }, -1),
      grassDensity: engine === null ? -1 : rd(function () { return engine.add(0x60).readFloat(); }, -1),
      grassReduction: engine === null ? -1 : rd(function () { return engine.add(0xe8).readU8(); }, -1),
      streamFar: streamObject === null ? -1 : rd(function () { return streamObject.add(0x38).readU32(); }, -1),
      streamNear: streamObject === null ? -1 : rd(function () { return streamObject.add(0x3c).readU32(); }, -1),
      smartBoxLoadForPlayer: rd(function () { const b = resolveSmartBox(); return b === null ? -1 : b.add(0x250).readU8(); }, -1)
    };
  },
  allon: function () { return applyFeaturePreset('all'); },
  alloff: function () { return applyFeaturePreset('none'); },
  defaults: function () { return applyFeaturePreset('default'); },
  // alpha 0-255 (dusuk = daha saydam), x/y = oyun istemci alanina gore offset
  hudstyle: function (alpha, x, y) {
    if (typeof alpha === 'number' && isFinite(alpha)) {
      hudAlpha = Math.max(40, Math.min(255, alpha | 0));
      if (!hudWindow.isNull()) {
        try { setLayeredWindowAttributes(hudWindow, 0, hudAlpha, 0x2); } catch (_) {}
      }
    }
    if (typeof x === 'number' && isFinite(x)) hudOffsetX = x | 0;
    if (typeof y === 'number' && isFinite(y)) hudOffsetY = y | 0;
    hudLastDrawAt = 0;
    console.log('[HUD] alpha=' + hudAlpha + ' offset=' + hudOffsetX + ',' + hudOffsetY);
    return { alpha: hudAlpha, offsetX: hudOffsetX, offsetY: hudOffsetY };
  },
  status: function () {
    return {
      active: active,
      flightToken: flightToken,
      flightController: flightController.toString(),
      flightPosition: flightPositionPointer.toString(),
      flightMoves: flightMoveCount,
      renderProxyLocked: renderProxyObject !== null,
      renderProxyWrites: renderProxyWriteCount,
      renderProxyUpdates: renderProxyUpdateCount,
      renderProxyEnabled: NATIVE_RENDER_PROXY_ENABLED,
      worldCellStreamingEnabled: CAMERA_WORLD_CELL_STREAMING,
      worldCellListenersReady: worldCellProxyListenersReady(),
      worldCellDispatches: worldCellProxyDispatches,
      worldCellErrors: worldCellProxyErrors,
      worldCellScans: worldCellProxyScans,
      worldCellDisplaced: worldCellProxyDisplaced,
      alwaysFullRender: ALWAYS_FULL_RENDER,
      renderCacheEnabled: renderCacheEnabled,
      nativeLandCacheCaptured: nativeLandCacheCaptured,
      nativeLandCacheEnabled: nativeLandCacheEnabled,
      nativeLandCachePending: nativeLandCacheApplyPending,
      nativeLandCacheApplyCount: nativeLandCacheApplyCount,
      nativeLandCacheCaptureErrors: nativeLandCacheCaptureErrors,
      nativeLandCacheApplyErrors: nativeLandCacheApplyErrors,
      nativeLandCacheRamTargetMiB: NATIVE_CACHE_RAM_TARGET_MIB,
      nativeLandCacheOriginals: NATIVE_LAND_CACHES.map(function (entry) {
        return nativeLandCacheStatus(entry, 'original');
      }),
      nativeLandCacheCurrent: NATIVE_LAND_CACHES.map(function (entry) {
        return nativeLandCacheStatus(entry, 'current');
      }),
      vramTotalMB: lastVram.totalMB,
      vramUsedMB: lastVram.usedMB,
      vramUsedBytes: lastVram.usedBytes,
      vramRemoteMB: lastVram.remoteMB,
      vramRemoteBytes: lastVram.remoteBytes,
      vramSystemMB: lastVram.systemMB,
      vramSystemBytes: lastVram.systemBytes,
      vramPeakMB: lastVram.peakMB,
      vramBudgetMB: VRAM_SAFE_REMOTE_CEILING_MB,
      vramTelemetryPending: vramTelemetryPending,
      vramResourceCount: lastVram.count,
      vramScanned: lastVram.scanned,
      vramTruncated: lastVram.truncated,
      vramAgeMs: lastVram.at ? (Date.now() - lastVram.at) : -1,
      graphicsPurgePending: graphicsPurgePending,
      graphicsPurgeCount: graphicsPurgeCount,
      graphicsPurgeReason: graphicsPurgeReason,
      graphicsPurgePass: graphicsPurgePass,
      graphicsPurgePasses: graphicsPurgePasses,
      graphicsPurgeFullReset: graphicsPurgeFullReset,
      objectGain: OBJECT_GAIN,
      objectMult: objectBoostEnabled ? boostedObjectMult() : originalObjectMult,
      terrainRefreshCount: terrainRefreshCount,
      startupFullQualityVerified: startupFullQualityVerified,
      materialDetail: base.add(MATERIAL_DETAIL_RVA).readU32(),
      modelDetail: base.add(MODEL_DETAIL_RVA).readU32(),
      objectDrawDistance: base.add(OBJECT_DRAW_DISTANCE_RVA).readU32(),
      landscapeDrawDistance: base.add(LANDSCAPE_DRAW_DISTANCE_RVA).readU32(),
      landscapeStaticObjectShadows: base.add(LANDSCAPE_STATIC_OBJECT_SHADOWS_RVA).readU32(),
      landscapeLightingQuality: base.add(LANDSCAPE_LIGHTING_QUALITY_RVA).readU32(),
      farLandscapeNormalMaps: base.add(FAR_LANDSCAPE_NORMAL_MAPS_RVA).readU8(),
      nearFarSeamBlend: base.add(NEAR_FAR_SEAM_BLEND_RVA).readU8(),
      worldBoost: renderBoostEnabled,
      lodBoost: lodBoostEnabled,
      farRadius: FAR_RADIUS,
      nearRadius: NEAR_RADIUS,
      frillBoost: frillBoostEnabled,
      frillDistance: FRILL_DISTANCE_SECTORS,
      frillFullDensity: FRILL_FULL_DENSITY_SECTORS,
      frillDensity: boostedFrillDensity(),
      frillReduction: FRILL_REDUCTION_ENABLED,
      textureBoost: textureBoostEnabled,
      lookaheadSeconds: LOOKAHEAD_SECONDS,
      maxLookaheadBlocks: MAX_LOOKAHEAD_BLOCKS,
      providerBudgetPerPass: PROVIDER_BUDGET_PER_PASS,
      providerCompleted: providerSurfaceCompleted.size,
      providerPending: providerSurfacePending.size,
      providerRemaining: providerBlockRemaining.size,
      retainedSources: retainedLandSources.size,
      verboseDiagnostics: verboseDiagnostics,
      hudEnabled: hudEnabled,
      hudFrames: hudFrames,
      hudErrors: hudErrorCount,
      hudLastError: hudLastError,
      partialGate: PARTIAL_GATE,
      lastLookahead: lastLookahead,
      target: target
    };
  }
};

console.log('============================================================');
console.log(' LOTRO CINEMATIC FREECAM');
console.log(' Built-in FlightCameraController + extended landscape/grass streaming,');
console.log(' max terrain material quality and sharp ground textures.');
console.log('');
console.log(' EVERY TOGGLE NEEDS CTRL so it cannot collide with your own game bindings.');
console.log(' The freecam movement keys below are the exception - no Ctrl needed there.');
console.log('');
console.log(' CAMERA');
console.log('   Ctrl+F8         start / stop the freecam');
console.log('   Mouse           look        LShift  4x faster        LCtrl  precise');
console.log('   Move (US)       P forward | ; back | L left | \' right | O up | [ down');
console.log('   Move (TR-Q)     P forward | S back | L left | I right | O up | G down');
console.log('');
console.log(' HUD');
console.log('   Ctrl+F3         show / hide the feature-status overlay');
console.log('   Ctrl+F2         compact (toggles only) / full (toggles + values)');
console.log('   Hold Ctrl + drag  move the panel anywhere');
console.log('   The HUD is a separate layered Win32 window. It cannot be drawn in');
console.log('   EXCLUSIVE FULLSCREEN - use windowed or borderless.');
console.log('');
console.log(' VISUAL TOGGLES (all need Ctrl)');
console.log('   Ctrl+F5  terrain draw distance   ON    Ctrl+F10 grass distance         ON');
console.log('   Ctrl+F7  sharp textures          off   Ctrl+F4  max terrain quality   off');
console.log('   Ctrl+F9  force LOD0 (very heavy) off   Ctrl+F6  origin follows camera off');
console.log('   Ctrl+F1  object draw distance   off   Ctrl+F11 distant imposters      ON');
console.log('            (leave imposters ON - turning them off deletes the horizon)');
console.log('   Ctrl+F12 full landscape re-stream     Ctrl+N   far normal maps (relief vs flat)');
console.log('   Ctrl+8/7 terrain ring bigger/smaller  Ctrl+5/4 grass bubble <- main FPS dial');
console.log('   Ctrl+G   thin grass with distance (cheaper than shortening it)');
console.log('');
console.log(' ONLY TERRAIN DISTANCE AND GRASS START ENABLED. Everything else is opt-in,');
console.log(' by hotkey or with feature(name, true). See features() for the full list.');
console.log('');
console.log(' CONSOLE');
console.log('   setrange(3-24)  setgrassrange(3-24)  setload(6,120,3,100)  setfrillbudget(0.5-8)');
console.log('   features()          list every feature, its state and its key');
console.log('   feature(name, bool) turn one on/off      allon() / alloff() / defaults()');
console.log('   hud(bool)  hudcompact(bool)  hudstyle(alpha,x,y)  status()  requestRestore()');
console.log('');
console.log(' DEFAULTS: terrain high R14 / medium R24, grass full-density R16 (33x33 blocks).');
console.log(' Tuned for looks, not framerate. Shrink grass first (Ctrl+4 or setgrassrange).');
console.log(' Cache, native asset cache and VRAM resource scanning are compiled out.');
console.log(' Do not run another Frida script against the client at the same time.');
console.log('============================================================');
resolveSmartBox();
resolveFrillEngine();
console.log(
  '[ORIGINAL] AllowLODs=' + originalAllowLods +
  ' DistantImposters=' + originalDistantImposters +
  ' FrillQuality=' + originalFrillDistanceQuality +
  ' FrillDensity=' + originalFrillDensity.toFixed(2) +
  ' Texture=' + originalTextureFiltering +
    '/' + originalAnisotropicQuality +
    '/' + originalTextureDetail +
    '/mem' + originalGraphicsMemoryUsage.toFixed(2)
);
if (GRASS_MACHINERY) {
  enableResidencyGrid();
  enableFrillBoost();
} else {
  console.log('[GRASS OFF] grass machinery fully disabled: no anchors, no provider, stock frill.');
}
// Object and model selection is left to the player's own graphics settings. Billboard
// promotion, model detail, draw distance and the per-frame object multiplier are not
// forced - the script keeps whatever the client already had.
try { allowLodsFlag.writeU8(originalAllowLods); } catch (_) {}
try { distantImposters.writeU8(originalDistantImposters); } catch (_) {}
impostersEnabled = originalDistantImposters !== 0;
console.log('[OBJECT NATIVE] AllowLODs=' + originalAllowLods +
  ' imposters=' + originalDistantImposters +
  ' model/object=' + originalModelDetail + '/' + originalObjectDrawDistance +
  ' multiplierSample=' + originalObjectDrawMultiplier.toFixed(2) +
  ' (engine-owned; script does not write it).');
// Extend the landscape topology and streaming radius so real high-detail landblocks
// build far out, pushing the pre-baked imposter boundary away from the camera. F5
// toggles it live, setrange() moves it in steps.
enableRenderBoost();
// Land-origin force stays off here; Ctrl+F6 toggles it so the origin follows the camera.
console.log('[DISTANCE] TOPOLOGY ON (F5 disables) -> high=' +
  (NEAR_RADIUS / 16).toFixed(1) + ' blocks, medium=' +
  (FAR_RADIUS / 16).toFixed(1) + ' blocks, then lowest distant LOD.');
// Everything past land and grass is opt-in. Sharp textures, maximum terrain materials,
// LOD0 and the object boost all stay off until asked for, either by hotkey or through
// feature()/allon(). Attaching should not silently change how the game looks beyond the
// draw distance you came for.
if (AUTO_ENABLE_LOD0) enableLodBoost();
if (AUTO_ENABLE_OBJECT_BOOST) onMainThread(enableObjectBoost);
if (HYBRID_DISTANT_TREE_LODS && !AUTO_ENABLE_LOD0) onMainThread(enableHybridLodMode);

// Seam blending and the landscape quality selector belong to the terrain-quality
// feature (Ctrl+F4), which is off by default. DistantImposters is left exactly as the
// client had it: disabling it deletes the far ground and leaves skybox in its place.

// Forces already-built terrain cells to re-select the normal-map material. setTerrainMax
// sets the far-normal-map global to 1, but cells built before that keep their old
// material until something triggers a rebuild, which is what a 0->1 toggle does. Used
// after a radius change brings new cells into view.
function autoFixMaterialize(tag) {
  onMainThread(function () {
    try {
      terrainRefresh();  // FNM 0->1: re-materialize terrain with normal maps (kills "paint")
      console.log('[AUTO-FIX] FNM rebuild (' + terrainRefreshCount + ') ' + tag);
    } catch (e) { console.log('[AUTO-FIX ERR] ' + e); }
  });
}
// Called on demand only, never on a timer. A recurring version rebuilt the whole
// landscape every few seconds, which reads as a constant flicker. New cells brought in
// by a radius change are re-materialized by the 8 key instead, and the mip hook already
// stamps fresh samplers as cells load.
// FNM is already set to 1 by setTerrainMax(). Do not toggle it after attach: even
// a one-time 0->1 toggle rebuilds every loaded material and looks like a world reload.
if (AUTO_ENABLE_FREECAM) {
  console.log('[FLIGHT] AUTO ON pending - waiting for the camera machine.');
}
console.log('[DIAGNOSTIC] 9 source anchors + camera-centered individual provider surfaces + frill enabled.');
queueVramTelemetry('startup');
