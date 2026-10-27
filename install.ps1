# SPDX-License-Identifier: Apache-2.0
#
# Mode_Code installer for Windows. Paste this into PowerShell:
#
#   irm https://raw.githubusercontent.com/OzcanOrhanDemirci/Mode_Code/main/install.ps1 | iex
#
# With options:  & ([scriptblock]::Create((irm <the address above>))) -Yes -Version 1.2.1
#
# What it does, in this order, and nothing else:
#   1. Finds Node.js 22.13 or newer on your PATH. Without one it downloads the official Node.js 24 build
#      from nodejs.org, checks it against nodejs.org's SHA-256 list, and keeps it for Mode_Code alone:
#      no administrator rights, nothing installed system-wide.
#   2. Downloads the Mode_Code package from the newest GitHub release and checks its SHA-256.
#   3. Puts the program in %LOCALAPPDATA%\mode-code and the `mode-code` command in %USERPROFILE%\.local\bin,
#      and adds that folder to your user PATH when it is not there yet.
#   4. Runs `mode-code install`, which shows every change it will make to Claude Code and asks once.
#      Without Claude Code it offers to run Anthropic's official installer first.
#
# Run it again to update. `mode-code uninstall` removes everything it installed.
#
# Options:
#   -Yes            answer yes to every question (for scripts: nothing is asked)
#   -InstallClaude  install Claude Code too when it is missing (Anthropic's installer; -Yes alone does not)
#   -Version <v>    install that version instead of the newest
#   -NoModifyPath   leave your user PATH alone
#   -NoSetup        install the program only; run `mode-code install` yourself later
#   -Help           show this
# Environment:
#   MODE_CODE_INSTALL_DIR   where the program goes (default %LOCALAPPDATA%\mode-code)
#   MODE_CODE_BIN_DIR       where the command goes (default %USERPROFILE%\.local\bin)
#   MODE_CODE_PACKAGE       a package to install instead of a release's: a .tgz file or its address
#   MODE_CODE_RELEASE_URL   where a release's files are, checked against its SHA256SUMS (default: GitHub)
#   MODE_CODE_NODE_MIRROR   where Node.js is downloaded from (default https://nodejs.org/dist)
#   MODE_CODE_LANG          en or tr: the language of these messages (default: your system's)
#
# Pasted with `irm ... | iex`, this runs inside your PowerShell session: everything happens in a script block
# of its own, so no setting, variable or function is left behind, and it never calls `exit`, which would
# close your window. The file is ASCII on purpose: Windows PowerShell 5.1 reads a file without a byte order
# mark in the system's code page, so the Turkish messages are written with \u escapes.

param(
  [switch]$Yes,
  [switch]$InstallClaude,
  [string]$Version = '',
  [switch]$NoModifyPath,
  [switch]$NoSetup,
  [switch]$Help
)

& {
  param($Yes, $InstallClaude, $Version, $NoModifyPath, $NoSetup, $Help)
  # Version 1: an unset variable is an error; a key the table does not hold yet reads as nothing.
  Set-StrictMode -Version 1
  $ErrorActionPreference = 'Stop'
  # The progress bar makes downloads many times slower in Windows PowerShell 5.1.
  $ProgressPreference = 'SilentlyContinue'

  $Repo = 'OzcanOrhanDemirci/Mode_Code'
  $App = 'mode-code'
  $Name = 'Mode_Code'
  $NodeMin = [version]'22.13.0'
  $NodeLine = '24'
  $Mark = 'Written by the Mode_Code installer'

  # Shared state: functions read the variables above, and change these through the table.
  $S = @{ Code = 0; NoColor = [bool]$env:NO_COLOR; Interactive = $false; NewShell = $false; Wanted = '' }

  $lang = $env:MODE_CODE_LANG
  if (-not $lang) { $lang = $env:LC_ALL }
  if (-not $lang) { $lang = $env:LC_MESSAGES }
  if (-not $lang) { $lang = $env:LANG }
  if (-not $lang) { $lang = (Get-Culture).Name }
  $S.Tr = $lang -match '^tr'

  # T <English> <Turkish>: the text in the person's language.
  # Only the Turkish letters' escapes are read: the text may hold a path, and C:\Users is not an escape.
  function T([string]$en, [string]$tr) {
    if (-not $S.Tr) { return $en }
    return [regex]::Replace($tr, '\\u(00e7|00c7|011f|011e|0131|0130|00f6|00d6|015f|015e|00fc|00dc|00e2|00ee)', { param($m) [string][char][Convert]::ToInt32($m.Groups[1].Value, 16) })
  }

  function Out-Line([string]$text, [string]$color) {
    if ($color -and -not $S.NoColor) { Write-Host $text -ForegroundColor $color } else { Write-Host $text }
  }
  function Say([string]$text = '') { Write-Host $text }
  # Busy <text>: what is under way, on a line the next Ok writes over in a terminal; a log gets it as a line.
  function Busy([string]$text) {
    # A log may not take the ellipsis in its code page: three dots there.
    if ([Console]::IsOutputRedirected) { Out-Line "  $([char]0x203A) $text..." 'Cyan'; return }
    $line = "  $([char]0x203A) $text$([char]0x2026)"
    if ($S.NoColor) { Write-Host $line -NoNewline } else { Write-Host $line -ForegroundColor Cyan -NoNewline }
    $S.Busy = $line.Length
  }
  # The line Busy left open: written over by its outcome, or ended when something else comes first.
  function Close-Busy([switch]$Keep) {
    if (-not $S.Busy) { return }
    if ($Keep) { Write-Host '' } else { Write-Host ("`r" + (' ' * $S.Busy) + "`r") -NoNewline }
    $S.Busy = 0
  }
  function Ok([string]$text) { Close-Busy; Out-Line ("  $([char]0x2713) " + $text) 'Green' }
  function Note([string]$text) { Close-Busy -Keep; Out-Line ('  ' + $text) 'DarkGray' }
  function Warn([string]$text) { Close-Busy -Keep; Out-Line ('  ! ' + $text) 'Yellow' }
  # Stops the installation with a message; caught once, at the end.
  function Fail([string]$text) { throw (New-Object System.Exception ("MODECODE:" + $text)) }

  # For a program of another maker: Enter means no, and -Yes does not answer it; only -InstallClaude does.
  # Asked as every question of Mode_Code's is (docs/design.md): the hint says what Enter answers, and another
  # word asks again. Read-Host gets no prompt of its own, which it would end with a colon.
  function AskNo([string]$question) {
    if ($InstallClaude) { return $true }
    if (-not $S.Interactive) { return $false }
    while ($true) {
      Write-Host "$question " -NoNewline
      if ($S.NoColor) { Write-Host (T '[y/n, Enter = no] ' "[e/h, Enter = hay\u0131r] ") -NoNewline }
      else { Write-Host (T '[y/n, Enter = no] ' "[e/h, Enter = hay\u0131r] ") -ForegroundColor DarkGray -NoNewline }
      # Lowered without the culture's rules: in Turkish ones HAYIR would not lower to hayir.
      $answer = ([string](Read-Host)).Trim().ToLowerInvariant()
      if ($answer -cmatch '^(|n|no|h|hayir|hay\u0131r)$') { return $false }
      if ($answer -cmatch '^(y|yes|e|evet)$') { return $true }
    }
  }

  # Downloads an address, or copies a local file (a mirror or a package you named). Three tries.
  function Get-File([string]$from, [string]$to) {
    if ($from -notmatch '^https?://') {
      if (-not (Test-Path -LiteralPath $from -PathType Leaf)) { throw "not found: $from" }
      Copy-Item -LiteralPath $from -Destination $to -Force
      return
    }
    for ($i = 1; ; $i++) {
      try {
        Invoke-WebRequest -Uri $from -OutFile $to -UseBasicParsing
        return
      } catch {
        if ($i -ge 3) { throw }
        Start-Sleep -Seconds (2 * $i)
      }
    }
  }

  function Get-Sha256([string]$file) { return (Get-FileHash -LiteralPath $file -Algorithm SHA256).Hash.ToLowerInvariant() }

  # Runs a program with its error output shown as it is, not turned into PowerShell errors.
  function Invoke-Native([string]$exe, [string[]]$arguments) {
    $eap = $ErrorActionPreference
    $ErrorActionPreference = 'Continue'
    try { & $exe @arguments } finally { $ErrorActionPreference = $eap }
  }

  function Get-NodeVersion([string]$exe) {
    try {
      $v = ([string](Invoke-Native $exe @('-p', 'process.versions.node') 2>$null)).Trim()
      if ($LASTEXITCODE -eq 0 -and $v -match '^\d+\.\d+\.\d+$') { return [version]$v }
    } catch { $null = $_ }
    return $null
  }

  # replace <new> <old>: the new folder takes the old one's place; the old one is removed after.
  function Move-FolderIntoPlace([string]$new, [string]$old) {
    $aside = "$old.old"
    if (Test-Path -LiteralPath $aside) { Remove-Item -LiteralPath $aside -Recurse -Force }
    $hadOld = Test-Path -LiteralPath $old
    if ($hadOld) { Rename-Item -LiteralPath $old -NewName (Split-Path $aside -Leaf) }
    try {
      Move-Item -LiteralPath $new -Destination $old
    } catch {
      # The last good one goes back where it was.
      if ($hadOld) { Rename-Item -LiteralPath $aside -NewName (Split-Path $old -Leaf) -ErrorAction SilentlyContinue }
      throw
    }
    Remove-Item -LiteralPath $aside -Recurse -Force -ErrorAction SilentlyContinue
  }

  function Find-Node {
    $S.Node = $null
    $S.PrivateNode = $false
    $S.OldNode = $null
    $cmd = Get-Command node -CommandType Application -ErrorAction SilentlyContinue | Select-Object -First 1
    if ($cmd) {
      $v = Get-NodeVersion $cmd.Source
      if ($v -and $v -ge $NodeMin) {
        # Version managers hand out links that move; the hooks need the installation itself.
        $real = Invoke-Native $cmd.Source @('-p', "require('fs').realpathSync(process.execPath)")
        $S.Node = ([string]$real).Trim()
        $S.NodeVersion = $v
        return
      }
      if ($v) { $S.OldNode = $v }
    }
    $own = Join-Path $S.Home 'node\node.exe'
    if (Test-Path -LiteralPath $own) {
      $v = Get-NodeVersion $own
      if ($v -and $v -ge $NodeMin) {
        $S.Node = $own
        $S.NodeVersion = $v
        $S.PrivateNode = $true
      }
    }
  }

  # Downloads the newest Node.js $NodeLine build for Windows into the program folder, checked against
  # nodejs.org's SHA-256 list; keeps the one already there when it is the newest.
  function Install-PrivateNode {
    $arch = $env:PROCESSOR_ARCHITEW6432
    if (-not $arch) { $arch = $env:PROCESSOR_ARCHITECTURE }
    switch ($arch) {
      'AMD64' { $arch = 'x64' }
      'ARM64' { $arch = 'arm64' }
      default { Fail (T "nodejs.org has no Node.js $NodeLine build for this processor ($arch). Install Node.js 22.13 or newer yourself, then run this again." "nodejs.org'da bu i\u015flemci ($arch) i\u00e7in Node.js $NodeLine derlemesi yok. Node.js 22.13 ya da sonras\u0131n\u0131 kendin kur, sonra bunu yeniden \u00e7al\u0131\u015ft\u0131r.") }
    }
    $mirror = 'https://nodejs.org/dist'
    if ($env:MODE_CODE_NODE_MIRROR) { $mirror = $env:MODE_CODE_NODE_MIRROR.TrimEnd('/', '\') }
    $base = "$mirror/latest-v$NodeLine.x"
    $sums = Join-Path $S.Stage 'SHASUMS256.txt'
    try { Get-File "$base/SHASUMS256.txt" $sums } catch { Fail (T "Could not reach $mirror to download Node.js." "Node.js'i indirmek i\u00e7in $mirror adresine ula\u015f\u0131lamad\u0131.") }
    $file = $null
    $want = $null
    foreach ($line in Get-Content -LiteralPath $sums) {
      $parts = $line -split '\s+'
      if ($parts.Count -ge 2 -and $parts[1] -match "^node-v\d+\.\d+\.\d+-win-$arch\.zip$") { $want = $parts[0]; $file = $parts[1]; break }
    }
    if (-not $file) { Fail (T "nodejs.org has no Node.js build for win-$arch." "nodejs.org'da win-$arch i\u00e7in Node.js derlemesi yok.") }
    $folder = $file -replace '\.zip$', ''
    $version = [version](($folder -replace '^node-v', '') -replace '-.*$', '')
    if ($S.PrivateNode -and $S.NodeVersion -eq $version) {
      Ok (T "Node.js $version found (used by $Name alone)" "Node.js $version bulundu (yaln\u0131z $Name kullan\u0131r)")
      return
    }
    Busy (T 'Downloading Node.js' 'Node.js indiriliyor')
    $zip = Join-Path $S.Stage $file
    try { Get-File "$base/$file" $zip } catch { Fail (T 'The Node.js download failed.' 'Node.js indirilemedi.') }
    if ((Get-Sha256 $zip) -ne $want) { Fail (T "The Node.js download does not match nodejs.org's checksum; nothing was installed." "\u0130ndirilen Node.js, nodejs.org'un sa\u011flama toplam\u0131yla e\u015fle\u015fmiyor; hi\u00e7bir \u015fey kurulmad\u0131.") }
    $out = Join-Path $S.Stage 'nodex'
    New-Item -ItemType Directory -Path $out | Out-Null
    # Only the program and its license: npm and the headers are not needed to run Mode_Code.
    if ($S.Tar) {
      Invoke-Native $S.Tar @('-xf', $zip, '-C', $out, "$folder/node.exe", "$folder/LICENSE")
      if ($LASTEXITCODE -ne 0) { Fail (T 'Node.js could not be unpacked.' "Node.js a\u00e7\u0131lamad\u0131.") }
    } else {
      Expand-Archive -LiteralPath $zip -DestinationPath $out
    }
    $node = Join-Path $S.Stage 'node'
    New-Item -ItemType Directory -Path $node | Out-Null
    Move-Item -LiteralPath (Join-Path $out "$folder\node.exe") -Destination $node
    Move-Item -LiteralPath (Join-Path $out "$folder\LICENSE") -Destination $node
    $target = Join-Path $S.Home 'node'
    try {
      Move-FolderIntoPlace $node $target
    } catch {
      if ($S.PrivateNode) {
        # A Mode_Code window or hook is running the old one: it stays until the next run.
        Warn (T "Node.js $version could not replace the one in use; close Mode_Code's windows and run this again to update it." "Node.js $version kullan\u0131mdakinin yerine konamad\u0131; g\u00fcncellemek i\u00e7in Mode_Code pencerelerini kapat\u0131p bunu yeniden \u00e7al\u0131\u015ft\u0131r.")
        return
      }
      throw
    }
    $S.Node = Join-Path $target 'node.exe'
    $S.NodeVersion = $version
    $S.PrivateNode = $true
    Ok (T "Node.js downloaded and verified (used by $Name alone)" "Node.js indirildi ve do\u011fruland\u0131 (yaln\u0131z $Name kullan\u0131r)")
  }

  # The package: from the release (checksum verified) or from MODE_CODE_PACKAGE; unpacked into the stage.
  function Get-ModeCodePackage {
    $S.Sha = $null
    $tgz = Join-Path $S.Stage 'package.tgz'
    if ($env:MODE_CODE_PACKAGE) {
      $S.Source = $env:MODE_CODE_PACKAGE
      try { Get-File $S.Source $tgz } catch { Fail (T "Could not get the package $($S.Source)." "$($S.Source) paketi al\u0131namad\u0131.") }
      Warn (T "Installing the package you named ($($S.Source)); it has no checksum to verify." "Belirtti\u011fin paket kuruluyor ($($S.Source)); do\u011frulanacak sa\u011flama toplam\u0131 yok.")
    } else {
      if ($S.Wanted) {
        $base = "https://github.com/$Repo/releases/download/v$($S.Wanted)"
        $asset = "$App-$($S.Wanted).tgz"
      } else {
        $base = "https://github.com/$Repo/releases/latest/download"
        $asset = "$App.tgz"
      }
      # A release's files elsewhere (a mirror, a fork, a rehearsal): checked against its SHA256SUMS the same way.
      if ($env:MODE_CODE_RELEASE_URL) { $base = $env:MODE_CODE_RELEASE_URL.TrimEnd('/', '\') }
      $S.Source = "$base/$asset"
      $label = $Name
      if ($S.Wanted) { $label = "$Name $($S.Wanted)" }
      Busy (T "Downloading $label" "$label indiriliyor")
      $sums = Join-Path $S.Stage 'SHA256SUMS'
      try { Get-File "$base/SHA256SUMS" $sums } catch {
        # A version that does not exist is said so, with where the releases are.
        if ($S.Wanted) { Fail (T "Could not download release v$($S.Wanted): it may not exist, or the network is down. The releases: https://github.com/$Repo/releases" "v$($S.Wanted) s\u00fcr\u00fcm\u00fc indirilemedi: b\u00f6yle bir s\u00fcr\u00fcm olmayabilir ya da a\u011f kapal\u0131 olabilir. S\u00fcr\u00fcmler: https://github.com/$Repo/releases") }
        Fail (T "Could not reach the release at $base." "$base adresindeki s\u00fcr\u00fcme ula\u015f\u0131lamad\u0131.")
      }
      try { Get-File $S.Source $tgz } catch { Fail (T "Could not download $($S.Source)." "$($S.Source) indirilemedi.") }
      $want = $null
      foreach ($line in Get-Content -LiteralPath $sums) {
        $parts = $line -split '\s+'
        if ($parts.Count -ge 2 -and ($parts[1] -eq $asset -or $parts[1] -eq "*$asset")) { $want = $parts[0].ToLowerInvariant(); break }
      }
      if (-not $want) { Fail (T "The release lists no checksum for $asset." "S\u00fcr\u00fcm $asset i\u00e7in sa\u011flama toplam\u0131 vermiyor.") }
      $S.Sha = Get-Sha256 $tgz
      if ($S.Sha -ne $want) { Fail (T 'The download does not match the release checksum; nothing was installed.' "\u0130ndirilen dosya s\u00fcr\u00fcm\u00fcn sa\u011flama toplam\u0131yla e\u015fle\u015fmiyor; hi\u00e7bir \u015fey kurulmad\u0131.") }
    }
    $pkg = Join-Path $S.Stage 'pkg'
    New-Item -ItemType Directory -Path $pkg | Out-Null
    Invoke-Native $S.Tar @('-xzf', $tgz, '-C', $pkg)
    if ($LASTEXITCODE -ne 0) { Fail (T 'The package could not be unpacked.' "Paket a\u00e7\u0131lamad\u0131.") }
    $S.Package = Join-Path $pkg 'package'
    if (-not (Test-Path -LiteralPath (Join-Path $S.Package 'dist\cli.mjs')) -or -not (Test-Path -LiteralPath (Join-Path $S.Package 'dist\hook.mjs'))) {
      Fail (T 'That is not a Mode_Code package.' "Bu bir Mode_Code paketi de\u011fil.")
    }
    $S.Version = (Get-Content -LiteralPath (Join-Path $S.Package 'package.json') -Raw | ConvertFrom-Json).version
    if ($S.Sha) { Ok (T "$Name $($S.Version) downloaded and verified" "$Name $($S.Version) indirildi ve do\u011fruland\u0131") }
  }

  # A path for the command file, with the person's folders written as variables: cmd.exe reads the file in
  # the console's code page, and a user name with letters outside it would not survive otherwise.
  function ConvertTo-CmdPath([string]$path) {
    foreach ($var in 'LOCALAPPDATA', 'APPDATA', 'USERPROFILE', 'ProgramFiles') {
      $value = [Environment]::GetEnvironmentVariable($var)
      if ($value -and $path.StartsWith($value.TrimEnd('\') + '\', [StringComparison]::OrdinalIgnoreCase)) {
        return "%$var%" + $path.Substring($value.TrimEnd('\').Length)
      }
    }
    return $path
  }

  # The `mode-code` command: a small cmd file that runs the program with the Node.js chosen above. Its
  # `(goto)` leaves the batch file before the program starts, so `mode-code uninstall` can delete the file
  # while it runs, Ctrl+C asks no "Terminate batch job" question, and the exit code is the program's.
  function Write-Command {
    New-Item -ItemType Directory -Path $S.BinDir -Force | Out-Null
    $S.Command = Join-Path $S.BinDir "$App.cmd"
    if ((Test-Path -LiteralPath $S.Command) -and -not (Select-String -LiteralPath $S.Command -SimpleMatch $Mark -Quiet)) {
      Fail (T "$($S.Command) exists and was not written by this installer; it was left as it is. Remove it, or set MODE_CODE_BIN_DIR to another folder." "$($S.Command) var ve bu kurulumun yazd\u0131\u011f\u0131 de\u011fil; oldu\u011fu gibi b\u0131rak\u0131ld\u0131. Kald\u0131r ya da MODE_CODE_BIN_DIR ile ba\u015fka bir klas\u00f6r se\u00e7.")
    }
    $text = "@echo off`r`nrem ${Mark}: runs $Name with the Node.js it chose.`r`n" +
      "@(goto) 2>nul & `"$(ConvertTo-CmdPath $S.Node)`" `"$(ConvertTo-CmdPath $S.Cli)`" %*`r`n"
    $cp = [Console]::OutputEncoding.CodePage
    if ($cp -eq 65001) { $encoding = New-Object System.Text.UTF8Encoding $false } else { $encoding = [System.Text.Encoding]::GetEncoding($cp) }
    [System.IO.File]::WriteAllText("$($S.Command).new", $text, $encoding)
    Move-Item -LiteralPath "$($S.Command).new" -Destination $S.Command -Force
    Ok (T "The $App command is added" "$App komutu eklendi")
  }

  function Test-OnPath([string]$list, [string]$dir) {
    foreach ($entry in ($list -split ';')) {
      if ($entry -and [Environment]::ExpandEnvironmentVariables($entry).TrimEnd('\') -ieq $dir.TrimEnd('\')) { return $true }
    }
    return $false
  }

  # Adds the command's folder to the user PATH in the registry, keeping the variables the value holds
  # (%USERPROFILE% stays a variable), then tells running programs the environment changed.
  function Add-ToUserPath {
    $S.PathEntry = $null
    if (-not (Test-OnPath $env:Path $S.BinDir)) { $env:Path = $env:Path.TrimEnd(';') + ';' + $S.BinDir; $S.NewShell = $true }
    $keyName = 'Environment'
    if ($env:MODE_CODE_TEST_ENV_KEY) { $keyName = $env:MODE_CODE_TEST_ENV_KEY }
    $key = [Microsoft.Win32.Registry]::CurrentUser.OpenSubKey($keyName, $true)
    if (-not $key -and -not $NoModifyPath) { $key = [Microsoft.Win32.Registry]::CurrentUser.CreateSubKey($keyName) }
    try {
      $raw = ''
      if ($key) { $raw = [string]$key.GetValue('Path', '', [Microsoft.Win32.RegistryValueOptions]::DoNotExpandEnvironmentNames) }
      if (Test-OnPath $raw $S.BinDir) {
        $S.NewShell = $false
        # Added by an earlier run: it stays the installer's to remove.
        $prev = $S.PreviousPath
        if ($prev -and ($prev.PSObject.Properties.Name -contains 'user') -and ([string]$prev.user).TrimEnd('\') -ieq $S.BinDir) {
          $S.PathEntry = @{ user = $S.BinDir; key = $keyName }
        }
        return
      }
      if ($NoModifyPath) {
        if ($S.NewShell) { Warn (T "$($S.BinDir) is not on your user PATH; add it yourself (-NoModifyPath)." "$($S.BinDir) kullan\u0131c\u0131 PATH'inde de\u011fil; kendin ekle (-NoModifyPath).") }
        return
      }
      $next = $S.BinDir
      if ($raw) { $next = $raw.TrimEnd(';') + ';' + $S.BinDir }
      $key.SetValue('Path', $next, [Microsoft.Win32.RegistryValueKind]::ExpandString)
      $S.PathEntry = @{ user = $S.BinDir; key = $keyName }
    } finally {
      if ($key) { $key.Close() }
    }
    if (-not $env:MODE_CODE_TEST_ENV_KEY) {
      try {
        if (-not ('ModeCodeInstaller.Native' -as [type])) {
          Add-Type -Namespace ModeCodeInstaller -Name Native -MemberDefinition '[DllImport("user32.dll", CharSet = CharSet.Unicode)] public static extern System.IntPtr SendMessageTimeout(System.IntPtr hWnd, uint msg, System.UIntPtr wParam, string lParam, uint flags, uint timeout, out System.UIntPtr result);'
        }
        $result = [UIntPtr]::Zero
        [ModeCodeInstaller.Native]::SendMessageTimeout([IntPtr]0xffff, 0x1A, [UIntPtr]::Zero, 'Environment', 2, 5000, [ref]$result) | Out-Null
      } catch { $null = $_ } # an older Windows without the call: new windows still read the registry
    }
  }

  # The record `mode-code uninstall` reads: what was put where.
  function Write-Receipt {
    $receipt = [ordered]@{
      v = 1; app = $App; version = $S.Version; installedAt = (Get-Date).ToUniversalTime().ToString('o')
      home = $S.Home; program = $S.Cli; node = $S.Node; privateNode = [bool]$S.PrivateNode
      command = $S.Command; path = $S.PathEntry; source = $S.Source; sha256 = $S.Sha
    }
    $file = Join-Path $S.Home 'install.json'
    [System.IO.File]::WriteAllText("$file.new", ($receipt | ConvertTo-Json -Depth 4) + "`n", (New-Object System.Text.UTF8Encoding $false))
    Move-Item -LiteralPath "$file.new" -Destination $file -Force
  }

  function Find-Claude {
    if (Get-Command claude -ErrorAction SilentlyContinue) { return $true }
    # Anthropic's installer puts it here; a window opened before it ran may not have the folder on PATH yet.
    $dir = Join-Path $env:USERPROFILE '.local\bin'
    if (Test-Path -LiteralPath (Join-Path $dir 'claude.exe')) {
      if (-not (Test-OnPath $env:Path $dir)) { $env:Path = $env:Path.TrimEnd(';') + ';' + $dir }
      return $true
    }
    return $false
  }

  # The version Claude Code says it is, "2.1.310 (Claude Code)" read as 2.1.310; nothing when it does not say.
  function Get-ClaudeVersion {
    try {
      $said = [string](Invoke-Native 'claude' @('--version') 2>$null | Select-Object -First 1)
      if ($said -match '^\s*(\d+\.\d+\.\d+)') { return $Matches[1] }
    } catch { $null = $_ }
    return ''
  }

  function Install-Claude {
    Say ''
    Say ('  ' + (T "$Name works inside Claude Code; Claude Code was not found on this computer." "$Name, Claude Code'un i\u00e7inde \u00e7al\u0131\u015f\u0131r; bu bilgisayarda Claude Code bulunamad\u0131."))
    Say ''
    if (-not (AskNo ('  ' + (T "Install Claude Code now with Anthropic's official installer?" "Claude Code, Anthropic'in resm\u00ee kurulumuyla \u015fimdi kurulsun mu?")))) { return $false }
    Say ''
    Busy (T 'Installing Claude Code' 'Claude Code kuruluyor')
    # In a PowerShell of its own, so nothing it does can end this one. What it says is kept and shown only when it
    # fails: its lines are its own, in English, and Windows PowerShell draws its check mark wrong.
    $shell = (Get-Process -Id $PID).Path
    $said = Invoke-Native $shell @('-NoProfile', '-ExecutionPolicy', 'Bypass', '-Command', 'irm https://claude.ai/install.ps1 | iex') 2>&1 | Out-String
    if ($LASTEXITCODE -ne 0) {
      Close-Busy -Keep
      Say $said.TrimEnd()
      Fail (T "Anthropic's installer did not finish." "Anthropic'in kurulum beti\u011fi tamamlanmad\u0131.")
    }
    if (-not (Find-Claude)) { Close-Busy -Keep; return $false }
    $cc = ('Claude Code ' + (Get-ClaudeVersion)).Trim()
    Ok (T "$cc installed" "$cc kuruldu")
    return $true
  }

  # `mode-code install`: shows every change to Claude Code and asks once (or not at all with -Yes). Its answer
  # goes to $S.SetupOk, and the function is called on its own: a program whose output a caller captures has no
  # console, and the questions of `mode-code install` would not reach the person.
  function Invoke-Setup {
    $S.Next = $null
    $S.SetupOk = $true
    if ($NoSetup) { $S.Next = "$App install"; return }
    if (Find-Claude) {
      $cc = ('Claude Code ' + (Get-ClaudeVersion)).Trim()
      Ok (T "$cc found" "$cc bulundu")
    } elseif (-not (Install-Claude)) {
      $S.Next = "$App install"
      Say (T "Install Claude Code (https://code.claude.com/docs/en/setup), then run: $App install" "Claude Code'u kur (https://code.claude.com/docs/en/setup), sonra \u015funu \u00e7al\u0131\u015ft\u0131r: $App install")
      $S.SetupOk = [bool]$S.Interactive
      return
    }
    Say ''
    if (-not $Yes -and -not $S.Interactive) {
      $S.Next = "$App install"
      Say (T "Nobody is at a terminal to confirm the changes to Claude Code: run $App install in one (or pass -Yes)." "Claude Code'daki de\u011fi\u015fiklikleri onaylayacak bir terminal yok: $App install komutunu bir terminalde \u00e7al\u0131\u015ft\u0131r (ya da -Yes ver).")
      return
    }
    $arguments = @($S.Cli, 'install')
    if ($Yes) { $arguments += '--yes' }
    # The program leaves its title out, as this installer's stands for both: told so for this run alone.
    $was = $env:MODE_CODE_INSTALLER
    $env:MODE_CODE_INSTALLER = '1'
    try { Invoke-Native $S.Node $arguments } finally { $env:MODE_CODE_INSTALLER = $was }
    $S.SetupOk = ($LASTEXITCODE -eq 0)
  }

  function Install-ModeCode {
    if ($Help) {
      Say "$Name installer for Windows: https://github.com/$Repo#install"
      Say ''
      Say "  & ([scriptblock]::Create((irm https://raw.githubusercontent.com/$Repo/main/install.ps1))) [options]"
      Say ''
      Say '  -Yes            answer yes to every question (for scripts: nothing is asked)'
      Say "  -InstallClaude  install Claude Code too when it is missing (Anthropic's installer; -Yes alone does not)"
      Say '  -Version <v>    install that version instead of the newest'
      Say '  -NoModifyPath   leave your user PATH alone'
      Say "  -NoSetup        install the program only; run ``$App install`` yourself later"
      Say ''
      Say "Run it again to update; ``$App uninstall`` removes everything it installed."
      return
    }
    if ([Environment]::OSVersion.Platform -ne 'Win32NT') {
      Say (T 'On macOS and Linux, run this in a terminal instead:' "macOS ve Linux'ta bunun yerine bir terminalde \u015funu \u00e7al\u0131\u015ft\u0131r:")
      Say "  curl -fsSL https://raw.githubusercontent.com/$Repo/main/install.sh | sh"
      $S.Code = 1
      return
    }
    if ($env:CLAUDECODE -eq '1' -or $env:CLAUDE_CODE_ENTRYPOINT) {
      Fail (T "Run this in your own terminal, not inside a Claude Code session: it changes Claude Code's settings, which a session must not do to itself." "Bunu bir Claude Code oturumunun i\u00e7inde de\u011fil, kendi terminalinde \u00e7al\u0131\u015ft\u0131r: Claude Code'un ayarlar\u0131n\u0131 de\u011fi\u015ftirir ve bir oturum bunu kendine yapmamal\u0131.")
    }
    if ($Version) { $S.Wanted = ([string]$Version).TrimStart('v') }
    $S.Interactive = [Environment]::UserInteractive -and -not [Console]::IsInputRedirected -and -not $env:CI
    $S.NewShell = $false
    $S.Home = $env:MODE_CODE_INSTALL_DIR
    if (-not $S.Home) { $S.Home = Join-Path $env:LOCALAPPDATA $App }
    $S.BinDir = $env:MODE_CODE_BIN_DIR
    if (-not $S.BinDir) { $S.BinDir = Join-Path $env:USERPROFILE '.local\bin' }
    $S.Home = $S.Home.TrimEnd('\')
    $S.BinDir = $S.BinDir.TrimEnd('\')
    # What an earlier run recorded: a PATH entry it added stays the installer's to remove after an update.
    $S.PreviousPath = $null
    $receiptFile = Join-Path $S.Home 'install.json'
    if (Test-Path -LiteralPath $receiptFile) {
      try { $S.PreviousPath = (Get-Content -LiteralPath $receiptFile -Raw | ConvertFrom-Json).path } catch { $null = $_ }
    }

    Out-Line "$Name $(T 'installer' 'kurulumu')" 'White'
    Say ''
    # TLS 1.2 for Windows PowerShell 5.1 on older .NET defaults.
    try { [Net.ServicePointManager]::SecurityProtocol = [Net.ServicePointManager]::SecurityProtocol -bor 3072 } catch { $null = $_ }
    $S.Tar = Join-Path $env:SystemRoot 'System32\tar.exe'
    if (-not (Test-Path -LiteralPath $S.Tar)) {
      $found = Get-Command tar -CommandType Application -ErrorAction SilentlyContinue | Select-Object -First 1
      if (-not $found) { Fail (T 'tar.exe was not found (it comes with Windows 10 1803 and newer).' "tar.exe bulunamad\u0131 (Windows 10 1803 ve sonras\u0131yla gelir).") }
      $S.Tar = $found.Source
    }
    New-Item -ItemType Directory -Path $S.Home -Force | Out-Null
    # Everything is prepared beside its final place and moved in at the end, so a failed run leaves the last good one.
    $S.Stage = Join-Path $S.Home (".staging." + [Guid]::NewGuid().ToString('N').Substring(0, 8))
    New-Item -ItemType Directory -Path $S.Stage | Out-Null
    try {
      Find-Node
      if (-not $S.Node -or $S.PrivateNode) {
        if ($S.OldNode) { Note (T "Node.js $($S.OldNode) is too old for $Name (22.13 or newer); a newer one is kept for $Name alone." "Node.js $($S.OldNode), $Name i\u00e7in eski (22.13 ya da sonras\u0131 gerekli); yaln\u0131z $Name i\u00e7in yenisi tutulacak.") }
        Install-PrivateNode
      } else {
        Ok (T "Node.js $($S.NodeVersion) found" "Node.js $($S.NodeVersion) bulundu")
      }
      Get-ModeCodePackage
      $S.Cli = Join-Path $S.Home 'app\dist\cli.mjs'
      try {
        Move-FolderIntoPlace $S.Package (Join-Path $S.Home 'app')
      } catch {
        Fail (T "The program in $($S.Home)\app is in use; close Mode_Code's windows and run this again." "$($S.Home)\app i\u00e7indeki program kullan\u0131mda; Mode_Code pencerelerini kapat\u0131p bunu yeniden \u00e7al\u0131\u015ft\u0131r.")
      }
      Write-Command
      Add-ToUserPath
      Write-Receipt
    } finally {
      Remove-Item -LiteralPath $S.Stage -Recurse -Force -ErrorAction SilentlyContinue
    }

    Invoke-Setup
    Say ''
    if (-not $S.SetupOk) {
      Out-Line (T "The program is installed, but connecting it to Claude Code did not finish. Run $App install to try again." "Program kuruldu ama Claude Code'a ba\u011flanmas\u0131 tamamlanmad\u0131. Yeniden denemek i\u00e7in $App install \u00e7al\u0131\u015ft\u0131r.") 'Red'
      $S.Code = 1
      return
    }
    # Connected to Claude Code, the program has said it is ready and what comes next.
    if ($S.Next) {
      Out-Line (T "$Name $($S.Version) is installed. Next: $($S.Next)" "$Name $($S.Version) kuruldu. S\u0131radaki: $($S.Next)") 'White'
    }
    if ($S.NewShell) {
      Note (T "This window can run $App now; windows opened before the installation need to be opened again." "Bu pencere $App komutunu hemen \u00e7al\u0131\u015ft\u0131rabilir; kurulumdan \u00f6nce a\u00e7\u0131lan pencereler yeniden a\u00e7\u0131lmal\u0131.")
    }
  }

  try {
    Install-ModeCode
  } catch {
    Close-Busy -Keep
    $message = $_.Exception.Message
    if ($message.StartsWith('MODECODE:')) { $message = $message.Substring(9) } else { $message = (T 'The installation stopped: ' "Kurulum durdu: ") + $message }
    Out-Line ("$([char]0x2717) " + $message) 'Red'
    $S.Code = 1
  }
  $global:LASTEXITCODE = $S.Code
} $Yes $InstallClaude $Version $NoModifyPath $NoSetup $Help

# Run as a file (powershell -File install.ps1), the exit code says how it went; pasted, the window stays.
if ($PSCommandPath) { exit $LASTEXITCODE }
