# LOTRO Cinematic Freecam

A free-flying camera for LOTRO, plus a lot of extra render distance and terrain
quality. You detach the camera from your character, fly it wherever you want, and take
screenshots or video of Middle-earth from angles the game normally won't give you.

It's a JavaScript file that runs under [Frida](https://frida.re). Nothing gets installed,
no game file is touched. It attaches to the running client, changes some values in memory
while it's attached, and puts them back when you close it.

It's open source, and I'd genuinely rather you read it (or have an AI read it) than take
my word for anything below. There's a whole section on that further down.

> ### ⚠️ Read this first
>
> **This edits the game client's memory, and that is against LOTRO's Terms of Service.**
> The terms prohibit third-party software that interacts with the client, and there is no
> exception for "but it's only cosmetic." Memory injection is also exactly the kind of
> thing client integrity checks are built to notice — assume it is visible if anyone
> looks. I have not put anything in here to hide it, and I'm not going to.
>
> Nothing in this touches the server, your character, combat, loot or the network. It is a
> camera and a renderer, and you can verify that yourself — the whole thing is readable.
> That does not change the paragraph above.
>
> Use it parked in the open world for screenshots rather than in a group, instance, raid
> or PvMP, and think about which account you run it on. **The risk is yours.** If that
> isn't a trade you want to make, close this page — no hard feelings, it's a reasonable
> call.
>
> The longer version is in [One thing to know first](#one-thing-to-know-first).

virustotal:

https://www.virustotal.com/gui/file/5c42c7d1a1e663a0c1395ae3b1dff3002ad6c6a6197505a1ee8f95d02b224fa0?nocache=1 5c42c7d1a1e663a0c1395ae3b1dff3002ad6c6a6197505a1ee8f95d02b224fa0 lotro_freecam_minimal.js

https://www.virustotal.com/gui/file/b95e27d78dc30042b02206cea569778cba5c66661bd4d63a4e90bd116d91bb86?nocache=1 b95e27d78dc30042b02206cea569778cba5c66661bd4d63a4e90bd116d91bb86 lotro_freecam_cinematic.js

lotro_freecam_minimal.js

SHA-256 5c42c7d1a1e663a0c1395ae3b1dff3002ad6c6a6197505a1ee8f95d02b224fa0

SHA-1 67d6e4aebb8cccaf07a74cc766bf26777d148451

MD5 afc50d49ba9adeede1c9cf6b931cfe43

Size 11.223 bayt

lotro_freecam_cinematic.js

SHA-256 b95e27d78dc30042b02206cea569778cba5c66661bd4d63a4e90bd116d91bb86

SHA-1 bef8aa154b6a7e9340608271636c2aafd4d29de0

MD5 03d1101088c38fc17cba5caaf314c82f

## Which file do you want?

There are two, and they are separate — you run one or the other, never both.

| | **`lotro_freecam_minimal.js`** | **`lotro_freecam_cinematic.js`** |
|---|---|---|
| Free-flying camera | yes | yes |
| Changes how the game looks | **no** | yes |
| Render distance / grass / terrain | untouched | extended |
| On-screen overlay | none | yes |
| Framerate cost | essentially none | significant, see below |
| Size | ~300 lines | ~5,000 lines |

**Start with `lotro_freecam_minimal.js`.** It gives you the camera and changes nothing
else — the game renders exactly as it normally does, so there's no framerate cost, no
freezing when you toggle things, and nothing to tune. For most screenshots that's all you
actually need.

Move to `lotro_freecam_cinematic.js` when the thing you want to photograph is far away
and you can see the engine culling it. That build extends the terrain ring, grass and
texture detail well past their normal limits, which looks considerably better at distance
and costs real framerate. Everything specific to it — the toggles, the overlay, the
performance advice — is marked as such below.

The camera itself is identical in both. Same keys, same behaviour, same code path.

## Read this before you turn things on

*All of this is about `lotro_freecam_cinematic.js`. The minimal build doesn't change
rendering at all, so none of it applies — that's the whole reason it exists.*

### On an older or lower-spec PC, leave most of it off

The cinematic build asks the engine to draw a lot more world than it was budgeted for.
On current hardware that's a framerate cost you choose to pay. On an older machine, or
anything with a weaker GPU, limited VRAM or a mechanical hard drive, some of it is simply
not worth turning on.

Specifically, on a modest machine:

- **Don't use LOD0 (Ctrl+F9).** This is the single most expensive thing here. It forces
  every visible object to full detail at any distance and can take a decent PC into single
  digits. If you want it for one still shot, stop moving first, take the shot, turn it off.
- **Keep the grass small.** The default is 16 landblocks at full density, which is 1,089
  landblocks of grass streaming. Run `rpc.exports.setgrassrange(5)` or tap **Ctrl+4** a
  few times right after attaching.
- **Leave the opt-in extras off.** Sharp textures, max terrain quality, LOD0 and the
  object boost all start off. On a modest machine, leave them there — `rpc.exports.defaults()`
  puts you back if you've been experimenting.
- **Keep the terrain ring modest.** `rpc.exports.setrange(6)` instead of the default 14.
- **Slow the loader down** if you get stutter while flying rather than while parked:
  `rpc.exports.setload(4,200,2,200)`.
- **Avoid Ctrl+F12** and large jumps in render distance. Both rebuild the world, and on a
  slow disk that rebuild is where the long freezes come from.
- **Turn the overlay off** with Ctrl+F3 once you've set things up. It's a small cost, but
  it isn't nothing.

A reasonable low-spec starting point, pasted into the Frida window right after attaching:

```js
rpc.exports.setgrassrange(5)
rpc.exports.setrange(6)
rpc.exports.setload(4,200,2,200)
```

If that still struggles, use `lotro_freecam_minimal.js` instead. You keep the camera —
which is the actual point — and give up only the extra draw distance.

### The game freezing for 5-10 seconds is not a crash

Toggling LOD0 (Ctrl+F9), doing a landscape re-stream (Ctrl+F12), or making a big jump in
render distance (`setrange`, or holding Ctrl+8) makes the engine rebuild the world. That
rebuild is synchronous, so the client stops responding while it happens and Windows may
grey the window out and call it "not responding."

It is not crashing and it has not hung. The engine is just working through a lot at once.
Give it up to about ten seconds and it comes back on its own. Don't kill the client, and
don't spam the key while you wait, because each press queues another rebuild. On a slower
disk or in a dense area it's at the longer end of that range.

### Turn things down in cities

Bree, Minas Tirith, the Twenty-first Hall and anywhere else with a lot of players and
objects will hurt, because you're stacking extended draw distance on top of a scene that's
already heavy. Before you fly somewhere busy, shrink the grass bubble with **Ctrl+4**,
pull the terrain ring in with **Ctrl+7**, and leave Ctrl+F9 alone. Save the big settings
for landscapes, which is what they're for. The whole point of the overlay is that you can
see what's still on.

## License

Do what you want with it. Credit is appreciated but not required, and there is no
warranty of any kind. Provided as-is for personal use.

I am not responsible for account actions, client crashes, lost time, or anything else
that happens as a result of running it. Read the [terms of service](#one-thing-to-know-first)
section below so you know what you're getting into before you do.

Not affiliated with or endorsed by Standing Stone Games or Daybreak Game Company. The
Lord of the Rings Online is their trademark.

---

## Installation

### Step 0: check that it can run at all

The addresses in this script are compiled for **one exact client build**. If yours
doesn't match, nothing below will help you and the script will refuse to start. Check
[Will it even run for you?](#will-it-even-run-for-you) first — it takes ten seconds and
saves you installing Python for nothing.

### Step 1: Python (or skip to the automated installer)

There are two ways to get Python and Frida onto the machine: by hand (this step and the
next), or in one go with **`Install LOTRO Freecam Dependencies.bat`**, covered right
after Step 2. If you'd rather not run PowerShell scripts, do it by hand below — both end
up in the same place.

Install **Python 3.8 or newer** from [python.org](https://www.python.org/downloads/).

On the first installer screen, tick **"Add python.exe to PATH"** before clicking
Install. If you skip that, the `pip` command in the next step won't be found.

Verify it in a new PowerShell window:

```powershell
python --version
```

### Step 2: Frida

```powershell
pip install frida-tools
```

This pulls in Frida itself and the `frida` command-line tool. It takes a minute or two.
Verify:

```powershell
frida --version
```

If `pip` isn't recognised, Python isn't on your PATH — reinstall it with the checkbox
above ticked, or use `py -m pip install frida-tools` instead.

Your antivirus may object to Frida. That isn't specific to this project: Frida is a
general-purpose instrumentation toolkit, and process injection is exactly what it does
for a living, so some scanners flag the category. It's a well-known open-source tool
used widely in security research and app development. Decide for yourself whether you
want it on your machine.

### Steps 1 & 2, automated

**`Install-Dependencies.ps1`** (launched by double-clicking
**`Install LOTRO Freecam Dependencies.bat`**) does the same two steps above for you:

- No admin rights needed. Everything installs for your Windows user only (Python under
  `%LocalAppData%\Programs\Python`, `pip` packages under `%APPDATA%\Python`), so there's
  no UAC prompt — the trade-off is that if more than one Windows account on the PC plays
  LOTRO, each account runs this once. (Frida still needs an elevated PowerShell to
  *attach* to the game afterwards — see [Step 5](#step-5-attach) — that's a separate
  requirement from installing it.)
- Checks whether Python 3.8+ is already installed and on PATH; if it is, this step is
  skipped entirely.
- If not, installs it using [winget](https://learn.microsoft.com/windows/package-manager/winget/),
  the package manager Microsoft ships with Windows 10 1809+ and Windows 11 — with
  `--scope user` so it installs per-user, matching the no-admin design above. winget
  fetches Python from the same publisher-signed installer python.org hosts and checks it
  itself, so nothing about the download needs to be hardcoded in this repo.
- If winget isn't available (older Windows without the "App Installer" package), it falls
  back to downloading a specific, pinned Python installer directly from `python.org` over
  HTTPS and checks its SHA-256 against a hash captured from that exact file before running
  it. If the hash doesn't match, it stops and refuses to run the installer, rather than
  continuing anyway. Run with the per-user install flag, so this doesn't need admin either.
- Installs/upgrades `pip`, then installs `frida-tools`, then verifies `frida --version`
  works.
- Every step is skipped if it's already satisfied, so it's safe to run again if it fails
  partway (network hiccup, etc.) — just double-click it again.

As with everything else in this repo: it's a plain, readable script — open
[Install-Dependencies.ps1](Install-Dependencies.ps1) in a text editor first if you want
to see exactly what it does before running it.

### Step 3: get the script

Download whichever of the two you want (see [Which file do you want?](#which-file-do-you-want)
— if you're unsure, take the minimal one) and put it anywhere you like. Desktop is fine.
Nothing needs to go into the game folder, and nothing gets installed.

There's also **`Start LOTRO Freecam.bat`**, which is optional. It's a launcher that does
Step 5 for you. If you want it, put it in the same folder as the `.js` files — it looks
for them next to itself.

Confirm you have the file I'm describing:

```powershell
Get-FileHash .\lotro_freecam_minimal.js -Algorithm SHA256
```

**`lotro_freecam_minimal.js`** — camera only

```
SHA-256  5c42c7d1a1e663a0c1395ae3b1dff3002ad6c6a6197505a1ee8f95d02b224fa0
SHA-1    67d6e4aebb8cccaf07a74cc766bf26777d148451
MD5      afc50d49ba9adeede1c9cf6b931cfe43
Size     11,223 bytes
```

**`lotro_freecam_cinematic.js`** — camera + extended render distance + overlay

```
SHA-256  b95e27d78dc30042b02206cea569778cba5c66661bd4d63a4e90bd116d91bb86
SHA-1    bef8aa154b6a7e9340608271636c2aafd4d29de0
MD5      03d1101088c38fc17cba5caaf314c82f
Size     228,180 bytes
```

**`Start LOTRO Freecam.bat`** — optional launcher

```
SHA-256  0054c86c1ac4b70550ee0e6926b950eef19f2d370511a5b91a59ed5b8115d5d2
SHA-1    41ff8fc9158edbcd1323682bad14614c8cc6c620
MD5      d04c5d1c78aa26acb9c2fa813745914e
Size     2,958 bytes
```

If it doesn't match, you have a different file and nothing in this README applies to it.
There are VirusTotal scans in the [Is it safe?](#is-it-safe) section.

A word on the `.bat` in particular: a batch file that asks for administrator rights is
exactly the shape a lot of malware takes, and you're right to look at it twice. It's 90
lines of plain text with comments — read it before you run it. If it doesn't say what
I've told you it says, don't run it.

### Step 4: set up the game

Two things before you attach:

- **Windowed or Borderless Fullscreen.** In exclusive fullscreen, Windows won't draw any
  overlay window over the game, so you won't see the HUD. That's an OS limitation, not
  something I can work around. The camera itself works either way.
- **Log all the way in to a character.** Not the launcher, not character select. The
  script resolves engine objects that only exist once the world is loaded, and attaching
  early is the most common reason people find that Ctrl+F8 does nothing.

### Step 5: attach

**The short version:** double-click `Start LOTRO Freecam.bat`. It asks for admin,
finds the game, asks which of the two scripts you want, and attaches. If that works
for you, skip to Step 6.

It's a plain text file — open it in Notepad if you want to see what it runs. All it
does is check Frida is installed, pull the game's process ID out of `tasklist`, and
run the same `frida -p ... -l ...` command you'd type yourself. Everything below is
that command by hand, which is worth knowing anyway since the console it opens is how
you talk to the script.

---

Open PowerShell **as Administrator** — right-click the Start button, "Terminal
(Admin)" or "Windows PowerShell (Admin)". Frida can't attach to the game process
without it.

```powershell
cd C:\path\to\the\folder
frida -p (Get-Process lotroclient64).Id -l lotro_freecam_minimal.js
```

If the path has spaces in it — and it probably does, `Documents` under OneDrive
usually looks something like `...\The Lord of the Rings Online\...` — it needs quotes,
or PowerShell reads it as several separate arguments and the `cd` silently fails:

```powershell
cd "C:\Users\you\OneDrive\Documents\The Lord of the Rings Online\LOTRO Freecam"
```

You can skip the `cd` entirely and hand Frida the full path instead. It doesn't care
what folder you're in:

```powershell
frida -p (Get-Process lotroclient64).Id -l "C:\full\path\to\lotro_freecam_minimal.js"
```

And if you'd rather not type a path at all, this searches your user folder for the
script and passes whatever it finds. Takes a few seconds, but it works no matter where
you saved it:

```powershell
frida -p (Get-Process lotroclient64).Id -l (Get-ChildItem $env:USERPROFILE -Recurse -Filter lotro_freecam_minimal.js -EA 0 | Select -First 1).FullName
```

You should see a banner listing the controls. The cinematic build also prints a
`[STATUS-LITE]` line every couple of seconds; the minimal one stays quiet until you
press something. Either way, that's it working.

**Leave that window open.** It's your connection to the running script — closing it
detaches and restores your settings. It's also a live console you can type commands
into, which is covered further down.

### Step 6: fly

Alt-tab into the game and press **Ctrl+F8**. On the cinematic build, **Ctrl+F3** brings
up the overlay.

Every toggle needs Ctrl held down, so it can never collide with your own keybinds.

### If attaching fails

**"unable to find process with pid ..."** or `Get-Process` errors — the game isn't
running, or it's still at the launcher. The launcher is a different executable.

**"Failed to attach: access denied"** — PowerShell isn't elevated. Close it and reopen
as Administrator.

**"Unsupported LOTRO build: 0x..."** — see Step 0. The script stopped on purpose.

**`frida` is not recognised** — Step 2 didn't complete, or you need a fresh PowerShell
window so it picks up the updated PATH.

**"No such file or directory: '...lotro_freecam_minimal.js'"** — Frida attached fine,
it just can't find the script. Almost always the `cd` didn't take you where you thought
it did. Run `pwd` to see where you actually are, or use the search-for-it command above
and stop worrying about paths.

---

## One thing to know first

This runs through Frida, which attaches to the game client and edits values in its
memory. Worth understanding what that does and doesn't mean before you decide.

What it isn't: this is cosmetic. It touches the camera and the renderer, and that's it.
There's no gameplay advantage in it, nothing that talks to the server, and no combat,
loot, movement or network code anywhere in the file. Your character doesn't even move
while the camera flies, it just stands there. None of that is a claim you have to take
on faith either, there's a section further down on how to check all of it yourself.

That said, LOTRO's terms prohibit third-party software that interacts with the client,
and they don't carve out an exception for "but it's only cosmetic." Injection is also
the sort of thing client integrity checks are built to notice, so assume it's visible if
anyone looks. I haven't put anything in here to hide it and I'm not going to.

Practically, that means use it parked in the open world for screenshots rather than in a
group, instance, raid or PvMP, and use a bit of judgement about which account you run it
on. That's really all there is to it.

## Will it even run for you?

Possibly not, and I'd rather you knew that before installing anything.

The addresses in this script are hardcoded for one exact client build:

```
lotroclient64.exe
build 4808.0070.7360.4034
module size 0x22b4000  (36,258,816 bytes)
```

You can check your own copy in PowerShell:

```powershell
(Get-Item "<path>\lotroclient64.exe").Length          # want 36258816
(Get-Item "<path>\lotroclient64.exe").VersionInfo     # want 4808.0070.7360.4034
```

The script checks the module size on startup and refuses to run if it doesn't match:

```
Error: Unsupported LOTRO build: 0x<size>, expected 0x22b4000
```

That guard is there because running the wrong addresses would write garbage into random
memory and take the client down with it. Worth being precise about what the check
actually buys you though: it's a sanity check, not a cryptographic one. It confirms the
module is the size it should be. It can't prove it's the same binary, so if you've
somehow got a different executable that happens to be the exact same size, the check
won't catch it. In practice, for an unmodified client, it does its job.

The upshot is that **any game patch will break this** until the addresses are found
again. That's not a bug, it's the nature of the thing. And re-finding them isn't a
config edit, it's an afternoon in a disassembler.

## What it actually does

The camera itself isn't simulated. It uses the client's own built-in
`FlightCameraController`, which is already in there for cinematics, and pushes it onto
the camera stack. Your character stays exactly where it was.

**Only two things are on when you attach: terrain draw distance and grass.** Everything
else is opt-in. Attaching shouldn't quietly change how your game looks beyond the extra
distance you came for, and several of the extras cost real framerate or pause the client
while the engine rebuilds — so you turn those on yourself, when you want them.

`rpc.exports.features()` lists everything with its current state, its key and what it
does. `allon()`, `alloff()` and `defaults()` move all of them at once.

On by default:

- **Terrain draw distance** — extends the high-detail ring to about 14 landblocks with a
  medium band out to 24, and keeps world streaming centred on the camera rather than your
  character.
- **Grass** — streams grass out to 16 landblocks at full density, with a moving bubble
  that drops grass behind you as you fly. Grass carries a distant scene better than
  distant terrain does, which is why it ships long. It is also the single biggest
  framerate cost here.
- **The overlay** — shows what's on and what's off. Ctrl+F3.

Off until you ask for it:

- **Sharp textures** (Ctrl+F7) — max texture detail, 16x anisotropic and a negative mip
  bias so ground resolves crisply instead of looking painted.
- **Max terrain material quality** (Ctrl+F4) — material detail, static shadows, lighting
  quality, far normal maps and seam blending at their registered maximums. Toggling this
  rebuilds terrain materials, which is one of the things that pauses the client.
- **Force LOD0** (Ctrl+F9) — every object at full detail at any distance. Extremely
  expensive; it exists for a single still shot.
- **Object draw distance boost** (`feature('objects', true)`) — pushes decoration
  distance out, at the risk of distant trees vanishing.
- **Streaming origin follows camera** (Ctrl+F6).

Things it deliberately doesn't do: it doesn't write your position anywhere, it doesn't
touch the network, and it never writes to disk.

## Controls

**Every toggle needs Ctrl held down.** That's deliberate: LOTRO binds the bare number
keys to your quickslots and the function keys to panels, so an unmodified hotkey would
fire an ability or open a window at the same time as changing a render setting. With
Ctrl in front, nothing here can collide with your own keybinds.

The freecam movement keys are the one exception — they need Ctrl free for the precision
modifier, and they're only meaningful while the camera is already flying.

Hotkeys only fire while LOTRO is the focused window, and there's a 750 ms cooldown so
holding a key doesn't toggle it forty times. Ctrl has to be down at the moment the key
goes down, so tapping Ctrl afterwards won't retro-trigger anything.

**Ctrl+F8** starts and stops the camera. Mouse looks around. Hold **Shift** to move 4x
faster, **Ctrl** to crawl for precise framing.

Movement is read as raw Windows key codes, so the physical key depends on your keyboard
layout:

| | US / QWERTY | Turkish-Q |
|---|---|---|
| Forward | `P` | `P` |
| Back | `;` | `Ş` |
| Left | `L` | `L` |
| Right | `'` | `İ` |
| Up | `O` | `O` |
| Down | `[` | `Ğ` |

It's the `P L O` cluster plus the three keys to the right of them. I picked those so they
don't fight with WASD.

The rest:

The camera keys above work in both builds. Everything in this table belongs to
`lotro_freecam_cinematic.js` — the minimal build has no toggles at all, just the camera.

| Key | |
|---|---|
| **Ctrl+F3** | HUD on/off |
| **Ctrl+F2** | HUD compact / full |
| **Hold Ctrl + drag** | Move the overlay panel — no mode to toggle |
| **Ctrl+F5** | Terrain draw distance *(on by default)* |
| **Ctrl+F6** | Make landscape streaming follow the camera |
| **Ctrl+F4** | Max terrain material quality *(off by default, pauses when toggled)* |
| **Ctrl+F7** | Sharp textures / mip bias *(off by default)* |
| **Ctrl+F1** | Object / decoration draw distance *(off by default)* |
| **Ctrl+F9** | Force LOD0. Very expensive, for stills only |
| **Ctrl+F10** | Grass distance and density *(on by default)* |
| **Ctrl+F11** | Distant imposters. Leave these on, turning them off deletes the far ground |
| **Ctrl+F12** | Full landscape re-stream, causes a hitch |
| **Ctrl+N** | Far normal maps. The difference between detailed terrain and flat "painted" terrain |
| **Ctrl+G** | Thin grass with distance — cheaper than shortening it |
| **Ctrl+8** / **Ctrl+7** | Terrain ring bigger / smaller |
| **Ctrl+5** / **Ctrl+4** | Grass bubble bigger / smaller. Your main FPS dial |

In the HUD these are shown with `^` standing for Ctrl, so `^F10` is Ctrl+F10.

If you've seen `K` or `Ctrl+F4` mentioned somewhere, the caching feature they controlled
is compiled out in this build and they do nothing now.

## The HUD

*`lotro_freecam_cinematic.js` only.*

Press Ctrl+F3 and you get a translucent panel listing every feature and whether it's on,
grouped into camera, terrain, grass, textures, objects, streaming and diagnostics. The
values are read live out of the engine rather than from script variables, so it shows you
what's actually true, not what the script thinks it set.

Green means on, grey means off. Most of the panel is *readings*, not switches, and the
marker in the left column tells you which is which — there's a legend along the bottom of
the panel saying the same thing:

| Marker | Meaning |
|---|---|
| `^F7` | A Ctrl hotkey. `^` is Ctrl, so this one is Ctrl+F7 |
| `rpc` | Changeable, but only from the console — no key is bound |
| *(blank, cyan text)* | Fixed at compile time. Needs a file edit and a reattach |
| *(blank, white text)* | A value read out of the engine. Not a switch at all |

That distinction is the point of the panel. Thirteen rows have hotkeys, another dozen
are console-only, four are fixed at compile time, and the rest are there so you can see
what the engine actually has — not so you can click them. If you press a key and nothing
happens, the marker tells you why.

**To move it, hold Ctrl and drag it with the left mouse button.** The border turns yellow
while it's grabbable, so you can see it's ready. There's no mode to remember and nothing
to switch back afterwards.

The reason it needs Ctrl at all: the panel is click-through, so your clicks normally pass
straight through it to the game. It stops being click-through for exactly as long as
Ctrl is held with the cursor over it, or while you're mid-drag — any other time your
clicks reach the game as usual. The position is stored relative to the game's client
area, so it stays put if you move or resize the window.

The overlay is a separate layered Win32 window drawn with GDI. It doesn't hook D3D or
inject anything into the game's render pipeline, so it can't corrupt a frame. It's
click-through and never takes focus.

It only exists while the game is the focused window. Alt-tab away and it's torn down
completely, not just hidden; click back and it's rebuilt. That's deliberate rather than
tidiness: the overlay's message pump runs on the game's main tick, the client throttles
that tick hard in the background, and a window that exists but has stopped being pumped
is what makes Windows decide a thread is unresponsive — which shows up as the game
itself greying out with "not responding" while it's actually running perfectly. No
window in the background, nothing to flag.

## Console commands

The Frida window you launched from is a live JavaScript prompt into the running script.
Type any of these straight into it. Every one of them prints what it did and returns the
resulting state.

The minimal build only has `rpc.exports.requestRestore()`, `rpc.exports.isRestoreComplete()`,
`rpc.exports.restore()` and `rpc.exports.status()` — there is nothing else to tune. Every
other command below belongs to `lotro_freecam_cinematic.js`.

### Features

Every switchable feature lives in one registry, so these, the hotkeys and the overlay can
never disagree with each other.

| Command | |
|---|---|
| `rpc.exports.features()` | List every feature: current state, its key, what it does |
| `rpc.exports.feature(name)` | Toggle one. Omit the second argument to flip it |
| `rpc.exports.feature(name, true/false)` | Set one explicitly |
| `rpc.exports.defaults()` | Back to attach state: terrain distance + grass, nothing else |
| `rpc.exports.allon()` | Everything on, LOD0 included. Heaviest possible configuration |
| `rpc.exports.alloff()` | Everything off — camera only |

Names: `land`, `grass`, `grassfalloff`, `texture`, `terrain`, `lod0`, `objects`,
`treelod`, `imposters`, `landorigin`, `camerastream`, `worldcell`, `fullrender`,
`vram`, `hud` — fifteen in total.

Four things genuinely can't be switched at runtime, and the overlay marks them cyan so
you don't go hunting for a way: the photo cache, the deep diagnostic hooks, the native
render proxy, and the grass subsystem as a whole. Those decide whether hooks get
*installed* when the script loads, and you can't install a hook that was never put in.
They're constants at the top of the file — edit and reattach if you need them. (The
`grass` feature still turns grass on and off at runtime; the constant only decides
whether the machinery exists at all.)

Beyond those, a handful of streaming and diagnostic switches are console-only, marked
`rpc` in the overlay. They're deliberately not on keys: they take parameters, or they're
things you set once while tuning rather than A/B while looking at the screen.

| Command | |
|---|---|
| `rpc.exports.setpartial(true/false)` | Fill the grid per block instead of all-or-nothing |
| `rpc.exports.setlookahead(sec, blocks)` | How far ahead of the camera to preload |
| `rpc.exports.terrainauto(true/false)` | Rebuild terrain materials as new blocks stream in |
| `rpc.exports.diagnostics(true/false)` | Verbose status line. Expensive |

`lod0` and `treelod` write opposite values to the same engine flag, so turning one on
turns the other off and logs that it did. `allon()` therefore can't literally enable
everything — the state it prints afterwards is the truth.

`alloff()` deliberately leaves `imposters` alone and says so when it runs. Off isn't a
cheaper state for them — it deletes the far ground and leaves skybox behind. If you
genuinely want that, `feature('imposters', false)` still does it.

### Camera

| Command | |
|---|---|
| `rpc.exports.flight(true/false)` | Start or stop the camera without the hotkey |

### Distance and quality

| Command | Range | |
|---|---|---|
| `rpc.exports.setrange(blocks)` | 3–24 | Overall render distance. Scales grass, provider grid, source coverage and retention together |
| `rpc.exports.setgrassrange(blocks)` | 3–24 | Grass only, leaves the terrain ring alone |
| `rpc.exports.lod(true/false)` | | Force LOD0. Expensive — same as F9 |
| `rpc.exports.objectboost(true/false)` | | Extend object/decoration draw distance. Can make distant trees vanish |
| `rpc.exports.setobjectgain(x)` | ≤20 | Multiplier used by `objectboost` |
| `rpc.exports.refreshterrain()` | | Rebuild terrain materials once |
| `rpc.exports.terrainauto(true/false)` | | Auto-rebuild terrain as new blocks stream in. Off by default |

### Streaming behaviour

| Command | Range | |
|---|---|---|
| `rpc.exports.setload(sBudget, sInterval, srcBudget, srcInterval)` | 1–32, 40–500 ms, 1–16, 40–500 ms | Request budgets and intervals. Lower budget / higher interval = gentler |
| `rpc.exports.setbudget(n)` | 1–16 | Provider surface requests per pass |
| `rpc.exports.setfrillbudget(ms)` | 0.5–8.0 | Main-thread time the grass loader may use per 60 fps frame |
| `rpc.exports.setlookahead(seconds, blocks)` | blocks 0–8 | How far ahead of the camera to preload |
| `rpc.exports.setpartial(true/false)` | | Fill the grid per block instead of all-or-nothing |

### HUD

| Command | |
|---|---|
| `rpc.exports.hud(true/false)` | Show/hide. Omit the argument to toggle |
| `rpc.exports.hudcompact(true/false)` | Compact (toggles only) or full (toggles + values) |
| `rpc.exports.hudmove(true/false)` | Move mode — same as Ctrl+F3 |
| `rpc.exports.hudstyle(alpha, x, y)` | Alpha 40–255, then x/y offset from the game's client area |

### Diagnostics

| Command | |
|---|---|
| `rpc.exports.status()` | Full state dump — the useful thing to paste when reporting a problem |
| `rpc.exports.diagnostics(true/false)` | Verbose status line. Expensive, off by default |
| `rpc.exports.vram()` | VRAM telemetry sample (the resource scan is compiled out in this build) |
| `rpc.exports.vrampeakreset()` | Reset the VRAM high-water mark |
| `rpc.exports.vrambudget(mb)` | Reports why a VRAM budget can't be set — DX11 owns residency |

### Shutdown

| Command | |
|---|---|
| `rpc.exports.requestRestore()` | Undo everything. Queued onto the main tick |
| `rpc.exports.isRestoreComplete()` | Whether that finished |

`cache()` and `purge()` also exist but do nothing — the caching feature is compiled out
here and they say so when called.

## About framerate

*`lotro_freecam_cinematic.js` only. The minimal build doesn't change rendering, so it
costs you nothing measurable — if framerate is your concern, that's the one to use.*

This will cost you FPS. How much is entirely up to how far you push it, and I should say
plainly that the defaults are tuned for how it looks, not for how it runs.

Out of the box you get 14 landblocks of high-detail terrain, a 24-block medium band, and
16 blocks of grass at full density with no falloff. That's a lot — deliberately, because
the defaults are tuned for how it looks. Everything else is off until you turn it on.

In rough order of what's actually eating your frames:

Grass is almost always the answer. The default 16-block radius is **1,089 landblocks** of
grass streaming at full density, and it dwarfs everything else on this list. It ships that
long on purpose — grass is what makes distance look alive — but it is the first thing to
cut. Tap **Ctrl+4** a few times or run `setgrassrange(8)`.

Streaming fill is second, and it's spiky rather than constant. When you first attach, and
every time you fly into terrain that hasn't loaded, the loader bursts and you'll stutter
for a few seconds before it settles. It's much worse while moving fast than while parked,
so if you're framing a shot, stop moving and give it a moment.

The terrain ring costs real frames too, though less than grass. **Ctrl+7** shrinks it.

Then Ctrl+F9. Forcing LOD0 puts every visible object at its highest detail at any distance, and
it can drop a decent machine into single digits somewhere dense. It exists so you can take
one still screenshot. Turn it back off afterwards.

Ctrl+F12 and big radius changes rebuild the world and hitch by design. That's expected — see
[Read this before you turn things on](#read-this-before-you-turn-things-on).

If it's running badly, go in this order:

```js
rpc.exports.setgrassrange(6)      // almost always fixes it
rpc.exports.setrange(8)           // then pull the terrain ring in
rpc.exports.setload(6,120,3,100)  // then slow the loader
```

One expectation to set: this pushes the engine past distances it was budgeted for, and
some of that is a hard limit rather than something I can tune around. Past roughly 16-20
landblocks the terrain ring stops looking better and just thrashes the streamer. The
defaults sit near the useful ceiling on purpose, so if you crank `setrange` to 24
expecting a big view, you'll mostly get stutter.

## How it works, in more detail

Skip this if you just want to fly around. It's here because people asked what it's
actually doing, and because it makes the framerate advice above make sense.

*The camera section below applies to both builds. Everything after it — streaming,
terrain materials, the overlay — is specific to the cinematic build.*

### World geometry

LOTRO's world is a grid of **landblocks**. One landblock is 160 world units across and is
subdivided into **16 sectors**, so every radius in the script is in sectors and divides by
16 to give landblocks. A "radius 16" grass setting is 16 landblocks in every direction,
which is a 33x33 grid, or **1,089 landblocks** being tracked at the shipped default of 16.
That number is why grass is the expensive part: it isn't 16 of anything, it's 1,089.

Terrain is drawn in three bands: a full-detail ring (default 224 sectors, 14 blocks), a
medium band beyond it (384 sectors, 24 blocks), and then the engine's own lowest distant
representation with 2D imposters. The imposters are the far ground you see on the horizon,
which is why turning them off with Ctrl+F11 deletes the horizon rather than improving it.

### The camera

The client already contains a `FlightCameraController` used for cinematics. Ctrl+F8 pushes it
onto the camera stack and gets back a token, then movement is applied by calling the
engine's own three axis functions (forward, strafe, vertical) each frame with a delta
scaled by frame time. Releasing it pops the same token.

This matters for two reasons. It means the camera behaves like the engine's camera because
it *is* the engine's camera, and it means nothing has to fake a position. The avatar is
never touched, no position is written, and nothing goes to the server. The camera is purely
a local viewpoint.

Separately, a virtual streaming target follows the camera and keeps the world loading
around it instead of around your character, since otherwise you'd fly straight out of the
region the engine is streaming for the player. That target deliberately keeps your
character's original region id, so flying across a map boundary can't trigger a region or
world transition.

### The streaming pipeline

Getting terrain and grass to exist far from the player is three stages:

1. **Land sources.** Blocks are grouped into 3x3 **source groups**. The script acquires the
   groups around the camera and holds a reference so the engine doesn't evict them.
2. **Provider surfaces.** For each landblock in the grid, a surface request goes to the
   landscape provider. A completion hook watches for the loader handing a surface to the
   global resource manager, so finished blocks are marked done rather than being
   re-requested every few seconds.
3. **Residency and eviction.** Every pass, any held source farther than the eviction radius
   from the camera is released. That's the moving bubble, and it's what stops grass piling
   up behind you.

Worth knowing how that last step actually behaves, because it isn't what people expect:
eviction is **radial, not per-chunk**. Nothing is dropped because you left a chunk — it's
dropped once it is farther than the eviction radius from wherever the camera is now. That
radius is the grass radius plus three blocks (19 by default), so grass a few blocks behind
you is deliberately kept. Sources are acquired in 3x3 groups, and evicting a group that
still feeds a visible block makes grass pop out at the edge of view, which looks far worse
than holding it a moment longer.

If it feels like grass lingers too long, that margin is the reason, and **Ctrl+4** tightens
it live (each press is two blocks). There's also a hard cap on retained sources — 185 at
the default range — and when the set is at that cap the farthest source is dropped to make
room for a new one.

Two things keep this working while the camera is moving rather than only when parked.
**Lookahead** shifts the preload centre ahead along your motion vector, so blocks start
loading before you arrive instead of after. **Partial gating** fills the grid per block as
each block's own source group becomes available, instead of waiting for all nine centre
anchors before requesting anything at all — that all-or-nothing version only ever filled at
a standstill.

Both are tunable, and the request budgets (`setload`) are the gentle way to reduce
streaming cost without losing distance: fewer requests per pass over a longer interval
means it fills more slowly but stutters less.

### Terrain materials, and the "painted" ground

If far terrain ever looks flat and painted rather than detailed, that's a material
selection problem, not a resolution one. Terrain cells pick between a base material and a
normal-map material. With far normal maps off they stay on the base one and the relief
disappears. **Ctrl+N** toggles it so you can see the difference directly.

The catch is that the setting is only consulted when a cell is *built*. Cells that already
exist keep whatever material they were built with, so changing the global alone does
nothing to what's on screen — something has to trigger a rebuild. That's what Ctrl+F12 does, and
it's also why enabling it costs you the freeze described at the top.

Sharpness is a separate mechanism: a hook on the engine's mip-bias function writes a
negative bias so ground textures resolve crisply. That one is applied unconditionally
rather than being gated on the texture-filtering global, because the engine rewrites that
global while rebuilding samplers and any sampler that rebuilt inside that window would
silently miss the bias, giving patchy ground.

### Threading

Everything that touches the engine runs on the game's main tick. Hotkeys are polled on a
separate timer, but they only set flags — the actual work is queued and executed on the
main thread, because engine setters can rebuild the entire landscape synchronously and
calling them from the wrong thread is how you corrupt state.

The HUD follows the same rule for a different reason: Win32 requires that the thread which
creates a window is the thread that pumps its messages, so the overlay is created, pumped
and drawn on the main tick too. Drawing is double-buffered into a memory DC and blitted
once, so it doesn't flicker, and it redraws at 4 Hz rather than per frame.

### Restore

Every value is captured before it's modified, and `requestRestore()` puts all of them back:
LOD flags, terrain quality, seam blending, object multiplier, texture settings, grass,
topology radius, camera lock, plus releasing every retained land source and un-patching the
two instructions the object-distance feature NOPs.

Restore is queued onto the main tick rather than run from Frida's RPC thread, and the
runner waits for it to report completion, because doing engine cleanup from the wrong
thread during detach is a good way to crash on exit.

If the client crashes before restore runs, nothing is left behind: every change is in
process memory and none of it is written to disk, so restarting the game clears it.

## Reference: what it hooks and what it writes

For anyone auditing it or porting it to a newer build. This describes
`lotro_freecam_cinematic.js`; the minimal build installs exactly one hook (the camera
input tick) and writes exactly two globals (`0x1a0c7ea` collision, `0x1a0c89c` move
speed), both restored on detach.

### Hooks

Nine are installed in normal operation. Three more exist behind `DEEP_DIAGNOSTIC_HOOKS`,
which is off.

| Target | Purpose |
|---|---|
| Main game tick (`0x971df0`) | Runs all queued engine work, the HUD, and restore. The one place engine state is touched |
| Mip bias function (`0x860ff0`) | Writes the sharp-texture bias as samplers are built |
| Provider completion (`0x4fe890`) | Marks a landblock's surface as finished so it isn't re-requested |
| Position update (`0x54dfa0`) | Tracks the streaming target |
| Camera input tick (`0x973b00`) | Applies flight movement; detached when the camera stops |
| Frill centre update (`0x956470`) | Keeps the grass system centred on the camera |
| Land resource build (`0x995720`) | Retains land sources so they aren't evicted |
| Resource unwrap (`0x34b460`) | Resolves land source handles |
| SmartBox land update (`0x96da90`) | Forces the landscape origin when F6 is on |

### Globals it writes

All are restored on detach.

| Address | What |
|---|---|
| `0x1a08fe4` / `0x1a08fe8` / `0x1a08ff8` | Texture filtering, anisotropic quality, texture detail |
| `0x1a08ffc` / `0x1a09000` | Material detail, model detail |
| `0x1a0900c` / `0x1a09010` | Object and landscape draw distance |
| `0x1a09014` | Distant imposters |
| `0x1a09018` / `0x1a0901c` / `0x1a09020` | Frill distance quality, density, terrain colour |
| `0x1a09024` / `0x1a09028` / `0x1a0902c` | Static object shadows, lighting quality, far normal maps |
| `0x1a09075` | Near/far seam blending |
| `0x1a09094` | Graphics memory usage |
| `0x1a0ac51` / `0x1a0ac52` | Static PVS, AllowLODs |
| `0x1a0ad2c` | Object draw multiplier (`objectboost` only) |
| `0x1a0c7ea` / `0x1a0c89c` | Flight camera physics flag and move speed |

### Code and read-only data it patches

This is the part worth reading closely if you're auditing, so here is all of it. Every
site is saved before it is modified. All but one are restored on detach - the exception
is called out below, because "it puts everything back" would not be quite true.

| Address | Size | When | What |
|---|---|---|---|
| `0x995a16` | 16 bytes | **On by default** | Land residency limit. Raises the engine's cap on how many landblocks may stay resident — without it the extended grass grid is evicted as fast as it loads |
| `0x156c404` | 4 bytes | **On by default** | Frill time budget multiplier. A float in read-only data, so it needs a page-protection change rather than a plain write. This is the grass loader's per-frame main-thread budget (`setfrillbudget`) |
| `0x93ca26`, `0x93ce3d` | 8 bytes each | Only with `objectboost` | The two per-frame writers to the object draw multiplier are NOPed so the value stays where it's put |

The first two are active as soon as you attach, because grass is on by default. Turning
`GRASS_MACHINERY` off at the top of the file disables both.

**The one thing that is not always restored:** the residency limit at `0x995a16` is only
put back if five or fewer landblock anchors are still resident when you detach. With the
default settings there are nine, so in practice it usually stays patched until you close
the game, and it says so in the console when you detach:

```
[RESIDENCY GRID OFF] Limit patch retained because 9 anchors are still resident;
                     game restart restores original code.
```

That is deliberate, not an oversight. The patch raises a cache limit from five to nine;
writing the smaller limit back while nine anchors are actually live would leave the
engine with more resident blocks than it now believes it can hold. Leaving the larger
limit in place is the safe direction. It only affects how many landblocks the client is
willing to keep in memory, it is a change to process memory like everything else here,
and restarting the game clears it.

There is also a 32-byte patch for the object-distance function at `0x8f7ab0` present in
the file (`patchObjectDistance`). **It is never called** — it's left over from working out
which lever actually controlled object distance, and the answer turned out to be the
multiplier above instead. You can confirm it's dead by grepping for `patchObjectDistance`:
the only hit is its own definition. The HUD row "Object-distance patch" reports it, and it
will always read OFF.

## Is it safe?

Reasonable question and you shouldn't just believe me. Here's what you need to check it
yourself.

Both are plain-text JavaScript files, about 5,000 lines (the minimal build is about 300), no build step, no dependencies
beyond Frida, nothing minified or obfuscated. Everything they do is in the file you
downloaded.

At the OS level the entire surface is: Frida injects into `lotroclient64.exe`, the script
reads and writes memory in that process and calls a few functions inside the game, and it
creates one overlay window through the normal Windows APIs. The only DLLs it touches are
`user32.dll` (hotkeys and the overlay window), `gdi32.dll` (drawing, nothing else) and
`kernel32.dll` (a single `GetModuleHandleW` call).

Things you can grep for and won't find: any network call at all (`Socket`, `fetch`, `http`,
`WebSocket`, `connect`, `send`), any file access (`writeFile`, `readFile`, `fopen`),
anything that starts a process (`exec`, `spawn`, `CreateProcess`, `ShellExecute`), any
registry access, and anything hidden (`eval`, `atob`, `Function(`, base64 payloads). All of
those come back with zero hits.

**On `GetAsyncKeyState`**, which I'm raising myself because any decent audit will flag it
and I'd rather you hear it here: yes, it's the same API a keylogger uses. Here's how it's
used and how to confirm it. It's called from exactly one function, `keyDown()` — search for
it, it's four lines. Every hotkey goes through that one function and there's no other
keyboard code in the file. It polls specific named key codes, the `VK_*` constants at the
top, so F-keys, N, the number keys and the movement keys. It doesn't enumerate the
keyboard, it doesn't install a hook (grep `SetWindowsHookEx`, it isn't there), and it never
captures a character or a string. The first line of `keyDown()` bails out unless LOTRO is
the foreground window, so it structurally can't see what you type anywhere else. And per
everything above, there's nowhere for a keystroke to go even if it wanted to: no file
access, no network.

**If you can't read code, get an AI to read it for you.** I'd honestly prefer that to you
trusting a stranger on Reddit. Upload the `.js` to ChatGPT or Claude and ask something like:

> Audit this Frida script for anything malicious. Does it make network connections, read or
> write files, spawn processes, access credentials or clipboard, or contain obfuscated or
> encoded payloads? Does anything in it do something other than modify graphics and camera
> settings in the target process? Summarise what it actually does and flag anything that
> doesn't match that description.

Both handle a file this size fine. Someone already did this with ChatGPT before I posted and
it came back clean — no network, no file or registry access, no persistence, no obfuscation,
no keylogging behaviour — while correctly pointing out the genuinely risky parts, which are
that it writes to game memory, hooks game functions, and modifies instructions with a
page-protection change. All true, all intentional, and every such site is listed in the
reference section above, including the two that are active from the moment you attach.

### VirusTotal

Scanned against ~70 antivirus engines:

- `lotro_freecam_minimal.js` -
  https://www.virustotal.com/gui/file/5c42c7d1a1e663a0c1395ae3b1dff3002ad6c6a6197505a1ee8f95d02b224fa0
- `lotro_freecam_cinematic.js` -
  https://www.virustotal.com/gui/file/b95e27d78dc30042b02206cea569778cba5c66661bd4d63a4e90bd116d91bb86
- `Start LOTRO Freecam.bat` -
  https://www.virustotal.com/gui/file/0054c86c1ac4b70550ee0e6926b950eef19f2d370511a5b91a59ed5b8115d5d2

Two honest caveats about what that link is worth.

First, **check that the hash on the VirusTotal page matches the file you downloaded.** A
clean scan of some other file tells you nothing about yours. Any change to the script
produces a completely different hash, so if they don't match, either you have a different
version or someone has modified it.

Second, a clean VirusTotal result is weaker evidence than people assume. This is a
plain-text script, not a compiled binary — there's no packed payload for a scanner to
recognise, and antivirus engines are not really in the business of deciding whether a
readable script does something you'd object to. It's a useful sanity check that nothing
known-malicious is embedded in it. It is not a substitute for reading the file or having
an AI read it, which is why that comes first in this section.

The reverse is also worth saying: if it ever *does* get flagged, that's most likely a
heuristic reacting to the memory-writing and hooking described above, which is exactly
what the script openly does.

### File hashes

`lotro_freecam_minimal.js`

```
SHA-256  5c42c7d1a1e663a0c1395ae3b1dff3002ad6c6a6197505a1ee8f95d02b224fa0
SHA-1    67d6e4aebb8cccaf07a74cc766bf26777d148451
MD5      afc50d49ba9adeede1c9cf6b931cfe43
Size     11,223 bytes
```

`lotro_freecam_cinematic.js`

```
SHA-256  b95e27d78dc30042b02206cea569778cba5c66661bd4d63a4e90bd116d91bb86
SHA-1    bef8aa154b6a7e9340608271636c2aafd4d29de0
MD5      03d1101088c38fc17cba5caaf314c82f
Size     228,180 bytes
```

```powershell
Get-FileHash .\lotro_freecam_minimal.js -Algorithm SHA256
Get-FileHash .\lotro_freecam_cinematic.js -Algorithm SHA256
```

If yours doesn't match, you've got a different file and none of this applies to it.

One distinction worth keeping straight, since people tend to merge them: "there's no malware
in it" and "it can't get your account actioned" are separate questions. This section is about
the first one. The second is the short bit near the top.

## Turning it off

There's nothing to uninstall, and this works the same in both builds. Run:

```js
rpc.exports.requestRestore()
```

and then close the Frida window. It puts back everything it captured at startup: LOD,
terrain quality, seam blending, object multiplier, textures, grass, topology radius, camera
lock, and it releases the land sources it was holding.

One exception, which it reports in the console when it happens: the landblock residency
limit usually stays patched until you restart the game. The reasoning is in
[the reference section](#code-and-read-only-data-it-patches). It is in-memory only and a
restart clears it.

Just closing the window (`Ctrl+D`, or `q` then Enter) also detaches it.

If the client crashes while the script is attached, restore won't get to finish. That's fine
and not something to worry about, because every change is made to process memory and never
to disk, so restarting the game clears all of it.

## When it doesn't work

**"Unsupported LOTRO build"** — your client doesn't match. Covered above, the addresses have
to be found again for your version.

**"Failed to attach" or "unable to find process"** — run PowerShell as Administrator, and
check the game is actually running rather than sitting at the launcher.

**HUD doesn't show up** — you're in exclusive fullscreen, switch to windowed or borderless.
If you're already windowed, check the Frida window for `[HUD ERROR]` lines, and
`rpc.exports.hud()` will report the current state.

**Ctrl+F8 does nothing** — you probably attached before the world finished loading. Also check
LOTRO actually has focus, and look for `[FLIGHT]` lines in the console.

**Terrain looks flat and painted** — press **Ctrl+N**. That's exactly what that toggle is
for. It should be on already, but if some cells were built before the setting applied,
**Ctrl+F12** rebuilds them.

**Constant stutter** — grass. Tap **Ctrl+4** a few times. See the framerate section.

**The far ground vanished into skybox** — you turned off distant imposters with Ctrl+F11.
Press it again.

**The game froze for several seconds** — expected after Ctrl+F9, Ctrl+F12 or a big range
change. See
[Read this before you turn things on](#read-this-before-you-turn-things-on).
