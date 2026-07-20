# Installs the two things LOTRO Freecam needs that don't ship with Windows: Python 3.8+
# and Frida (specifically the frida-tools package, which provides the `frida` CLI used
# to attach the .js scripts to the game). Everything else in the toolkit is the plain
# .js files plus this installer - nothing else touches your system.
#
# Deliberately admin-free: everything here installs *for the current user only* (Python
# under %LocalAppData%\Programs\Python, pip packages under %APPDATA%\Python), so this
# never needs a UAC prompt and never touches Program Files or a machine-wide registry
# hive. That's a real trade-off, not just a convenience: if more than one Windows account
# on the same PC plays LOTRO, each account needs to run this once. Frida still needs an
# elevated PowerShell to *attach* to the game later - see "Start LOTRO Freecam.bat" and
# the README - but that's a separate requirement from installing it.
#
# Safe to run more than once: every step checks the current state first and skips
# anything already satisfied, so re-running it after a partial failure just picks up
# where it left off.
#
# Python is installed two ways, in this order:
#   1. winget - the package manager Microsoft ships with Windows 10 1809+ / Windows 11.
#      It fetches Python from the same publisher-signed installer python.org publishes,
#      and winget itself verifies the download before running it. This is the preferred
#      path because it needs no hardcoded version number or hash on our side. Installed
#      with `--scope user` so it never needs elevation.
#   2. A direct download from python.org, for the machines that don't have winget yet.
#      That download is checked against a SHA-256 computed from the exact file this
#      script was written against before it is ever executed - if python.org served
#      something else, this script refuses to run it rather than silently continuing.
#      Run with `InstallAllUsers=0`, the per-user install mode, so it doesn't need
#      elevation either.
#
# Targets Python 3.14 (the current stable release, not just "whatever was newest" -
# checked directly against PyPI's JSON API that `frida`'s Windows wheels are built
# with the stable ABI (`cp37-abi3`), which is forward-compatible with 3.14 and every
# future 3.x, so there's no compatibility risk in tracking the latest release here).

$ErrorActionPreference = 'Stop'

# Bumped every time this script changes - printed in the banner below so that when
# something goes wrong, the pasted output makes it obvious whether the reporter is
# actually running the latest fix or a stale copy of the script.
$InstallerVersion = '1.8'

function Write-Step  ($msg) { Write-Host "`n==> $msg" -ForegroundColor Cyan }
function Write-Ok    ($msg) { Write-Host "    $msg" -ForegroundColor Green }
function Write-Note  ($msg) { Write-Host "    $msg" -ForegroundColor Yellow }

# ---- Helpers ------------------------------------------------------------
function Get-CommandPath ($name, [switch]$ExcludeWindowsAppsStub) {
    # -ExcludeWindowsAppsStub exists only for the "python"/"python3" lookup: even after
    # prepending a real Python install directory to PATH mid-session (see
    # Add-ToUserPath), a bare `Get-Command python` was confirmed (via live testing) to
    # still resolve to %LocalAppData%\Microsoft\WindowsApps\python.exe - the fake "App
    # Execution Alias" stub Windows ships by default that just nags to install Python
    # from the Store and never runs real code. PowerShell's command resolution doesn't
    # reliably re-order/re-resolve after $env:Path changes within the same session, so
    # for Python specifically this explicitly enumerates every match (-All) and skips
    # anything under WindowsApps rather than trusting whichever comes first.
    #
    # NOT applied by default/to other commands: winget.exe is *legitimately* only
    # reachable via that same WindowsApps folder (it's how Windows exposes MSIX-packaged
    # apps like the App Installer) - blanket-filtering WindowsApps broke winget detection
    # entirely the first time this was tried, so the exclusion has to be opt-in per call.
    $cmds = Get-Command $name -All -ErrorAction SilentlyContinue
    if ($ExcludeWindowsAppsStub) {
        $cmds = $cmds | Where-Object { $_.Source -and ($_.Source -notmatch '\\WindowsApps\\') }
    }
    if ($cmds) { return $cmds[0].Source }
    return $null
}

function Update-SessionPath {
    # The Python and pip installers write PATH to the registry (machine and/or user
    # hive). This process only read PATH once at startup, so pull both back in for
    # the rest of the script - otherwise "python" and "frida" stay unrecognised in
    # this same window even though the install actually succeeded.
    $machine = [Environment]::GetEnvironmentVariable('Path', 'Machine')
    $user    = [Environment]::GetEnvironmentVariable('Path', 'User')
    $env:Path = @($machine, $user) -join ';'
}

function Get-PythonUserScriptsPath {
    # Where `pip install --user` puts CLI shims like frida.exe, e.g.
    # %APPDATA%\Python\Python310\Scripts. Not necessarily on PATH by default.
    #
    # Deliberately asks Python's own sysconfig for this instead of hand-building it
    # from `-m site --user-base` + "\Scripts": on Windows the real path has a
    # version-specific folder in between (--user-base is %APPDATA%\Python, but the
    # actual Scripts dir is %APPDATA%\Python\Python310\Scripts) - sysconfig's
    # 'nt_user' scheme is the exact same one pip itself uses to decide where to put
    # these, so this can't drift out of sync with whatever pip actually did.
    $path = & (Get-CommandPath 'python' -ExcludeWindowsAppsStub) -c "import sysconfig; print(sysconfig.get_path('scripts', 'nt_user'))" 2>$null
    if (-not $path) { return $null }
    return $path.Trim()
}

function Add-ToUserPath ($dir) {
    if (-not $dir -or -not (Test-Path $dir)) { return }
    # Prepended, not appended: Windows puts %LocalAppData%\Microsoft\WindowsApps in
    # every user's PATH by default, which contains fake "python.exe"/"python3.exe"
    # stubs (App Execution Aliases) that just nag to install Python from the Store
    # instead of running anything - confirmed these shadow a real, working python.exe
    # that only got added at the *end* of PATH. Putting our directory first guarantees
    # it wins over that (or anything else already on PATH) regardless of ordering.
    $userPath = [Environment]::GetEnvironmentVariable('Path', 'User')
    $parts = @()
    if ($userPath) { $parts = $userPath -split ';' | Where-Object { $_ } }
    if ($parts -notcontains $dir) {
        $newUserPath = if ($userPath) { "$dir;$userPath" } else { $dir }
        # User-scope only - never touches the machine PATH, so this stays admin-free.
        [Environment]::SetEnvironmentVariable('Path', $newUserPath, 'User')
    }
    if (($env:Path -split ';') -notcontains $dir) {
        $env:Path = "$dir;$env:Path"
    }
}

function Find-PythonUserInstallDir {
    # Self-heal fallback for when Python got installed but didn't end up on PATH -
    # winget's own Python manifest doesn't reliably enable "add to PATH" even with
    # --scope user. Rather than trust the installer did it, find the real install
    # directory ourselves.
    #
    # Primary lookup: the registry registration every python.org installer creates
    # (PEP 514 - HKCU/HKLM Software\Python\PythonCore\<ver>\InstallPath), the same
    # mechanism the official `py.exe` launcher itself relies on to find interpreters.
    # This is far more reliable than guessing a folder-naming convention: the actual
    # per-user install directory name has been observed to NOT always be the
    # expected %LocalAppData%\Programs\Python\Python3xx (e.g. varies by installer
    # version/source), but the registry entry always points at wherever it really is.
    foreach ($root in @('HKCU:\Software\Python\PythonCore', 'HKLM:\Software\Python\PythonCore')) {
        if (-not (Test-Path $root)) { continue }
        # Wrapped in @(...): if there's exactly one registry result, PowerShell would
        # otherwise unwrap the pipeline to a bare string rather than a 1-item array -
        # and `foreach` over a bare string iterates it *character by character*
        # (strings are enumerable), silently never matching anything below. @()
        # forces array context regardless of how many results come back.
        $dirs = @(Get-ChildItem -Path $root -ErrorAction SilentlyContinue |
            Sort-Object { [version]($_.PSChildName -replace '[^0-9.]', '') } -Descending |
            ForEach-Object {
                $installPathKey = Join-Path $_.PSPath 'InstallPath'
                if (Test-Path $installPathKey) {
                    (Get-Item -LiteralPath $installPathKey -ErrorAction SilentlyContinue).GetValue('')
                }
            })
        foreach ($dir in $dirs) {
            if ($dir -and (Test-Path (Join-Path $dir 'python.exe'))) { return $dir.TrimEnd('\') }
        }
    }

    # Fallback: recursively scan %LocalAppData%\Programs for any python.exe, in case
    # the registry registration is somehow missing (or under a folder name/layout that
    # doesn't match what we'd expect - already burned twice guessing folder-naming
    # conventions, so this deliberately doesn't filter by a specific expected name).
    $root = Join-Path $env:LocalAppData 'Programs'
    if (-not (Test-Path $root)) { return $null }
    $found = Get-ChildItem -Path $root -Filter 'python.exe' -Recurse -Depth 4 -ErrorAction SilentlyContinue |
        Sort-Object LastWriteTime -Descending |
        Select-Object -First 1
    if ($found) { return $found.DirectoryName }
    return $null
}

function Get-PythonSearchDiagnostics {
    # Real forensic data for the error message below, instead of more blind guessing:
    # what the registry actually says, and where python.exe actually is (if anywhere),
    # across both the per-user and per-machine locations.
    $lines = @()
    foreach ($root in @('HKCU:\Software\Python\PythonCore', 'HKLM:\Software\Python\PythonCore')) {
        if (-not (Test-Path $root)) { $lines += "  $root : (not present)"; continue }
        $subkeys = Get-ChildItem -Path $root -ErrorAction SilentlyContinue
        if (-not $subkeys) { $lines += "  $root : (present, no versions registered)"; continue }
        foreach ($k in $subkeys) {
            $installPathKey = Join-Path $k.PSPath 'InstallPath'
            $val = if (Test-Path $installPathKey) {
                (Get-Item -LiteralPath $installPathKey -ErrorAction SilentlyContinue).GetValue('')
            } else { '(no InstallPath key)' }
            $lines += "  $root\$($k.PSChildName) -> $val"
        }
    }
    $searchRoots = @((Join-Path $env:LocalAppData 'Programs'), $env:ProgramFiles, ${env:ProgramFiles(x86)}) |
        Where-Object { $_ -and (Test-Path $_) }
    foreach ($sr in $searchRoots) {
        $hits = Get-ChildItem -Path $sr -Filter 'python.exe' -Recurse -Depth 4 -ErrorAction SilentlyContinue
        if ($hits) {
            foreach ($h in $hits) { $lines += "  found: $($h.FullName)" }
        } else {
            $lines += "  $sr : no python.exe found"
        }
    }
    return ($lines -join "`n")
}

function Test-PythonOk {
    $exe = Get-CommandPath 'python' -ExcludeWindowsAppsStub
    if (-not $exe) { return $false }
    try {
        $verOut = & $exe -c "import sys; print('%d.%d' % sys.version_info[:2])" 2>$null
        if (-not $verOut) { return $false }
        $parts = $verOut.Trim().Split('.')
        $major = [int]$parts[0]
        $minor = [int]$parts[1]
        return ($major -gt 3) -or ($major -eq 3 -and $minor -ge 8)
    } catch {
        return $false
    }
}

function Test-FridaOk {
    # Just resolving a `frida` command name on PATH isn't enough: pip's Windows entry-point
    # scripts (frida.exe, etc.) are tiny launcher stubs with the *absolute path* of the
    # interpreter they were installed against baked in at install time. If that Python is
    # later uninstalled/replaced (e.g. this script starts targeting a newer version, or the
    # user reinstalled Python some other way), the old shim is still a real file that
    # Get-Command happily finds - it just fails the instant it's run, with "Fatal error in
    # launcher: Unable to create process ... The system cannot find the file specified."
    # Actually invoking --version is the only way to tell a live install from that kind of
    # stale leftover.
    $exe = Get-CommandPath 'frida'
    if (-not $exe) { return $false }
    try {
        & $exe --version *> $null
        return ($LASTEXITCODE -eq 0)
    } catch {
        return $false
    }
}

# Wrapped in try/catch/finally so the window always pauses for a keypress at the end,
# showing either the success message or the actual error - instead of a throw partway
# through closing the window immediately (which is what a double-clicked .bat does the
# instant the underlying powershell.exe process exits with an unhandled exception).
$exitCode = 0
try {
    Write-Host "  LOTRO Freecam - dependency installer (v$InstallerVersion)"
    Write-Host "  --------------------------------------------------------------"

    # ---- 1. Python ------------------------------------------------------------
    Write-Step "Checking for Python 3.8+..."

    if (Test-PythonOk) {
        Write-Ok "Already installed: $(& (Get-CommandPath 'python' -ExcludeWindowsAppsStub) --version 2>&1)"
    } else {
        $installedViaWinget = $false
        $winget = Get-CommandPath 'winget'

        if ($winget) {
            Write-Step "Installing Python via winget (Python.Python.3.14, current user only)..."
            # --scope user keeps this admin-free: it installs under %LocalAppData%\Programs\Python
            # instead of Program Files, so winget never needs to write to a machine-wide location.
            & winget install --id Python.Python.3.14 -e --source winget --scope user `
                --accept-package-agreements --accept-source-agreements --silent
            if ($LASTEXITCODE -eq 0) {
                $installedViaWinget = $true
            } else {
                Write-Note "winget exited with code $LASTEXITCODE - falling back to the direct python.org installer."
            }
        } else {
            Write-Note "winget isn't available on this system (needs Windows 10 1809+ with the"
            Write-Note "'App Installer' package). Falling back to the direct python.org installer."
        }

        if (-not $installedViaWinget) {
            # Pinned to the current latest stable release (checked against
            # https://www.python.org/downloads/windows/ when this script was written).
            # If a newer 3.x has shipped since, that's fine to use too - just update the
            # version AND the hash below together, from a freshly downloaded copy of that
            # installer (never trust a hash copy-pasted from a web page; compute it yourself
            # with `Get-FileHash` right after downloading, the same way this one was captured).
            $pyVersion = '3.14.6'
            $pyUrl     = "https://www.python.org/ftp/python/$pyVersion/python-$pyVersion-amd64.exe"
            $pySha256  = '14B3E9A710A3FCF0BD9B55AB6B60412BD91227563F813FC49040CABC0209E0BD'
            $pyDest    = Join-Path $env:TEMP "python-$pyVersion-amd64.exe"

            Write-Step "Downloading Python $pyVersion from python.org..."
            [Net.ServicePointManager]::SecurityProtocol = [Net.SecurityProtocolType]::Tls12
            Invoke-WebRequest -Uri $pyUrl -OutFile $pyDest -UseBasicParsing

            Write-Step "Verifying the download against the known hash..."
            $actualHash = (Get-FileHash -Path $pyDest -Algorithm SHA256).Hash
            if ($actualHash -ne $pySha256) {
                Remove-Item $pyDest -ErrorAction SilentlyContinue
                throw ("Downloaded installer does not match the expected SHA-256.`n" +
                       "  expected: $pySha256`n" +
                       "  actual:   $actualHash`n" +
                       "Refusing to run it. This means either python.org served something " +
                       "other than the pinned release, or the download was corrupted/tampered " +
                       "with in transit - re-run this script, and if it happens again, install " +
                       "Python manually from https://www.python.org/downloads/windows/ instead.")
            }
            Write-Ok "Hash verified: $actualHash"

            Write-Step "Running the Python installer silently (this can take a minute)..."
            # InstallAllUsers=0 is the per-user mode: it installs under the current user's
            # AppData instead of Program Files, so it never needs (or asks for) elevation.
            $installArgs = @('/quiet', 'InstallAllUsers=0', 'PrependPath=1', 'Include_launcher=0', 'Include_test=0')
            $proc = Start-Process -FilePath $pyDest -ArgumentList $installArgs -Wait -PassThru
            if ($proc.ExitCode -ne 0) {
                Remove-Item $pyDest -ErrorAction SilentlyContinue
                throw "The Python installer exited with code $($proc.ExitCode)."
            }

            Update-SessionPath
            if (-not (Test-PythonOk) -and -not (Find-PythonUserInstallDir)) {
                # The installer can report success ($proc.ExitCode -eq 0) yet leave Python
                # missing on disk: Windows Installer remembers this exact version as already
                # installed (e.g. from an earlier run whose files were later deleted by hand
                # instead of through a proper uninstall), so a plain re-run treats there being
                # "nothing to do" as success without writing any files or PATH entries. An
                # explicit /uninstall first clears that stale record, so the follow-up
                # install actually does the work instead of silently no-op'ing.
                Write-Note "Installer reported success but Python isn't actually present - retrying via uninstall + reinstall (stale install record)."
                Start-Process -FilePath $pyDest -ArgumentList @('/uninstall', '/quiet') -Wait -PassThru | Out-Null
                $proc = Start-Process -FilePath $pyDest -ArgumentList $installArgs -Wait -PassThru
                if ($proc.ExitCode -ne 0) {
                    Remove-Item $pyDest -ErrorAction SilentlyContinue
                    throw "The Python installer exited with code $($proc.ExitCode) on the uninstall+reinstall retry."
                }
            }
            Remove-Item $pyDest -ErrorAction SilentlyContinue
        }

        Update-SessionPath
        if (-not (Test-PythonOk)) {
            # Don't give up yet - the installer may have succeeded without actually
            # adding itself to PATH (see Find-PythonUserInstallDir). Look for it
            # directly and self-heal PATH ourselves before treating this as fatal.
            $pyDir = Find-PythonUserInstallDir
            Write-Note "PATH self-heal: located install dir: $(if ($pyDir) { $pyDir } else { '(none found)' })"
            if ($pyDir) {
                Add-ToUserPath $pyDir
                Add-ToUserPath (Join-Path $pyDir 'Scripts')
                Update-SessionPath
                Write-Note "PATH self-heal: python.exe now resolves to: $(if (Get-CommandPath 'python' -ExcludeWindowsAppsStub) { Get-CommandPath 'python' -ExcludeWindowsAppsStub } else { '(still not found)' })"
            }
        }
        if (-not (Test-PythonOk)) {
            $diag = Get-PythonSearchDiagnostics
            throw ("Python was installed but couldn't be found on this machine afterwards, in the " +
                   "registry or on disk. Diagnostic info (please include this if reporting the issue):`n" +
                   "$diag")
        }
        Write-Ok "Installed: $(& (Get-CommandPath 'python' -ExcludeWindowsAppsStub) --version 2>&1)"
    }

    # ---- 2. pip -----------------------------------------------------------------
    Write-Step "Making sure pip is up to date..."
    # --user: some machines already have a *pre-existing* Python install (e.g. one set
    # up system-wide by another account/installer, under a path like C:\Python310 that
    # a standard user can't write to) whose own site-packages a standard user can't
    # modify at all - `pip install --upgrade pip` without --user fails there with
    # "Access is denied" / WinError 5, even though this script never asked for
    # elevation. --user sidesteps that unconditionally by installing into the current
    # user's own site-packages instead, which always takes precedence when present.
    # (Any "Ignoring invalid distribution" warnings here are pre-existing corruption
    # in that Python install's site-packages, unrelated to this script - harmless.)
    & (Get-CommandPath 'python' -ExcludeWindowsAppsStub) -m pip install --upgrade pip --user --quiet
    if ($LASTEXITCODE -ne 0) {
        throw "Failed to upgrade pip (exit code $LASTEXITCODE) - see the output above for details."
    }
    Write-Ok "pip is current."

    # ---- 3. Frida (frida-tools) --------------------------------------------------
    Write-Step "Checking for Frida..."
    Update-SessionPath

    if (Test-FridaOk) {
        Write-Ok "Already installed: $(& (Get-CommandPath 'frida') --version 2>&1)"
    } else {
        if (Get-CommandPath 'frida') {
            Write-Note ("Found a 'frida' command on PATH, but it doesn't run - it's a leftover " +
                "shim from a Python install that's since been removed or replaced (its baked-in " +
                "interpreter path no longer exists). Reinstalling for the current Python.")
        }
        Write-Step "Installing frida-tools via pip (this pulls in Frida itself too)..."
        # --user for the same reason as the pip upgrade above - required, not optional,
        # whenever the underlying Python install isn't user-writable.
        #
        # --force-reinstall is also required, not just belt-and-braces: if a previous
        # run got partway through installing frida-tools into the (unwritable) global
        # site-packages before failing, pip sees enough metadata there to consider the
        # requirement "already satisfied" and skips doing any work at all - including
        # creating the `frida.exe` entry-point script, which is the whole point of this
        # command. --force-reinstall makes pip actually (re)do the install into --user
        # this time. This stays fast on repeat runs since pip's wheel cache already has
        # everything downloaded ("Using cached ..." instead of hitting the network).
        & (Get-CommandPath 'python' -ExcludeWindowsAppsStub) -m pip install --user --force-reinstall frida-tools
        if ($LASTEXITCODE -ne 0) {
            throw "Failed to install frida-tools via pip (exit code $LASTEXITCODE) - see the output above for details."
        }

        # --user puts the `frida` CLI shim under the per-user Scripts folder, which
        # isn't necessarily on PATH yet - add it now (for this window) and persist it
        # to the user's PATH (so "Start LOTRO Freecam.bat" finds it in new windows too).
        Add-ToUserPath (Get-PythonUserScriptsPath)
        Update-SessionPath
        if (-not (Test-FridaOk)) {
            throw ("frida-tools installed but the 'frida' command isn't working in this " +
                   "window - it may be shadowed on PATH by a stale shim from another Python " +
                   "install. Close this window, open a new one, and run 'frida --version' " +
                   "to confirm it worked (if that still fails, check `where frida` for a " +
                   "leftover entry ahead of the current Python's Scripts folder on PATH).")
        }
        Write-Ok "Installed: $(& (Get-CommandPath 'frida') --version 2>&1)"
    }

    Write-Host ""
    Write-Host "  All set. Double-click 'Start LOTRO Freecam.bat' to attach to the game." -ForegroundColor Green
} catch {
    $exitCode = 1
    Write-Host ""
    Write-Host "  Something went wrong:" -ForegroundColor Red
    Write-Host "  $($_.Exception.Message)" -ForegroundColor Red
} finally {
    Write-Host ""
    Read-Host "Press Enter to close"
}

exit $exitCode
