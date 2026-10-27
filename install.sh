#!/bin/sh
# SPDX-License-Identifier: Apache-2.0
#
# Mode_Code installer for macOS and Linux. Paste this into a terminal:
#
#   curl -fsSL https://raw.githubusercontent.com/OzcanOrhanDemirci/Mode_Code/main/install.sh | sh
#
# With options:  curl -fsSL <the address above> | sh -s -- --yes --version 1.2.0
#
# What it does, in this order, and nothing else:
#   1. Finds Node.js 22.13 or newer on your PATH. Without one it downloads the official Node.js 24 build
#      from nodejs.org, checks it against nodejs.org's SHA-256 list, and keeps it for Mode_Code alone:
#      no sudo, nothing installed system-wide.
#   2. Downloads the Mode_Code package from the newest GitHub release and checks its SHA-256.
#   3. Puts the program in ~/.local/share/mode-code and the `mode-code` command in ~/.local/bin, and adds
#      that folder to PATH in your shell's startup file when it is not on PATH yet.
#   4. Runs `mode-code install`, which shows every change it will make to Claude Code and asks once.
#      Without Claude Code it offers to run Anthropic's official installer first.
#
# Run it again to update. `mode-code uninstall` removes everything it installed.
#
# Options:
#   --yes               answer yes to every question (for scripts: nothing is asked)
#   --install-claude    install Claude Code too when it is missing (Anthropic's installer; --yes alone does not)
#   --version <v>       install that version instead of the newest
#   --no-modify-path    leave your shell's startup files alone
#   --no-setup          install the program only; run `mode-code install` yourself later
#   --help              show this
# Environment:
#   MODE_CODE_INSTALL_DIR   where the program goes (default ~/.local/share/mode-code)
#   MODE_CODE_BIN_DIR       where the command goes (default ~/.local/bin)
#   MODE_CODE_PACKAGE       a package to install instead of a release's: a .tgz file or its address
#   MODE_CODE_RELEASE_URL   where a release's files are, checked against its SHA256SUMS (default: GitHub)
#   MODE_CODE_NODE_MIRROR   where Node.js is downloaded from (default https://nodejs.org/dist)
#   MODE_CODE_LANG          en or tr: the language of these messages (default: your system's)
#
# The whole script is functions; the last line runs them, so a download cut short runs nothing.

set -eu

REPO="OzcanOrhanDemirci/Mode_Code"
APP="mode-code"
NAME="Mode_Code"
NODE_MIN="22.13.0"
NODE_LINE="24"
# Marks what this installer writes into files that are not its own, so it is recognised and removed later.
MARK="# Added by the Mode_Code installer"
COMMAND_MARK="# Written by the Mode_Code installer"

# ── output ──

ui_lang() {
  l="${MODE_CODE_LANG:-${LC_ALL:-${LC_MESSAGES:-${LANG:-}}}}"
  case "$l" in tr* | TR*) echo tr ;; *) echo en ;; esac
}

# t <English> <Turkish>: the text in the person's language.
t() {
  if [ "$UI" = tr ]; then printf '%s' "$2"; else printf '%s' "$1"; fi
}

colors() {
  if [ -t 1 ] && [ -z "${NO_COLOR:-}" ] && [ "${TERM:-}" != dumb ]; then
    B=$(printf '\033[1m') D=$(printf '\033[2m') R=$(printf '\033[31m') G=$(printf '\033[32m')
    Y=$(printf '\033[33m') C=$(printf '\033[36m') N=$(printf '\033[0m')
  else
    B='' D='' R='' G='' Y='' C='' N=''
  fi
}

say() { printf '%s\n' "$*"; }
# busy <text>: what is under way, on a line the next ok writes over in a terminal; a log gets it as a line.
busy() {
  if [ -t 1 ]; then
    printf '  %s›%s %s…' "$C" "$N" "$*"
    BUSY=1
  else
    printf '  › %s...\n' "$*"
  fi
}
# The line busy left open: written over by its outcome, or ended (unbusy keep) when something else comes first.
unbusy() {
  [ "${BUSY:-0}" = 1 ] || return 0
  if [ "${1:-}" = keep ]; then printf '\n'; else printf '\r\033[K'; fi
  BUSY=0
}
ok() {
  unbusy
  printf '  %s✓%s %s\n' "$G" "$N" "$*"
}
note() {
  unbusy keep
  printf '  %s%s%s\n' "$D" "$*" "$N"
}
warn() {
  unbusy keep
  printf '  %s!%s %s\n' "$Y" "$N" "$*" >&2
}
die() {
  unbusy keep
  printf '%s✗ %s%s\n' "$R" "$*" "$N" >&2
  exit 1
}

# ask_no <question>: for a program of another maker. Enter means no, and --yes does not answer it: only
# --install-claude does (a script that wants Claude Code too says so). Asked as every question of Mode_Code's
# is (docs/design.md): the hint says what Enter answers, and another word asks again.
ask_no() {
  [ "$CLAUDE" = 1 ] && return 0
  [ "$TTY" = 1 ] || return 1
  while :; do
    printf '%s %s%s%s ' "$1" "$D" "$(t '[y/n, Enter = no]' '[e/h, Enter = hayır]')" "$N"
    read -r answer </dev/tty || return 1
    case "$answer" in
      '' | n | N | no | No | NO | h | H | hayir | Hayir | HAYIR | hayır | Hayır) return 1 ;;
      y | Y | yes | Yes | YES | e | E | evet | Evet | EVET) return 0 ;;
    esac
  done
}

usage() {
  say "$NAME installer for macOS and Linux: https://github.com/$REPO#install"
  say
  say "  curl -fsSL https://raw.githubusercontent.com/$REPO/main/install.sh | sh -s -- [options]"
  say
  say "  --yes               answer yes to every question (for scripts: nothing is asked)"
  say "  --install-claude    install Claude Code too when it is missing (Anthropic's installer; --yes alone does not)"
  say "  --version <v>       install that version instead of the newest"
  say "  --no-modify-path    leave your shell's startup files alone"
  say "  --no-setup          install the program only; run \`$APP install\` yourself later"
  say
  say "Run it again to update; \`$APP uninstall\` removes everything it installed."
}

# ── tools ──

has() { command -v "$1" >/dev/null 2>&1; }

# download <address> <file>: https only, unless the address is one you chose (a mirror or a package), which
# may also be a file on this computer.
download() {
  case "$1" in
    https://*) proto_curl="--proto =https --tlsv1.2" proto_wget="--https-only" ;;
    http://*) proto_curl="" proto_wget="" ;;
    *)
      cp "${1#file://}" "$2"
      return
      ;;
  esac
  if has curl; then
    # shellcheck disable=SC2086 # the protocol options are two words or none
    curl -fsSL --retry 3 --connect-timeout 20 $proto_curl -o "$2" "$1"
  elif has wget; then
    # shellcheck disable=SC2086
    wget -q $proto_wget -O "$2" "$1"
  else
    die "$(t 'Neither curl nor wget is installed; install one of them and run this again.' 'curl da wget de kurulu değil; birini kurup bunu yeniden çalıştır.')"
  fi
}

sha256() {
  if has sha256sum; then
    sha256sum "$1" | cut -d' ' -f1
  elif has shasum; then
    shasum -a 256 "$1" | cut -d' ' -f1
  elif has openssl; then
    openssl dgst -sha256 "$1" | sed 's/^.*= *//'
  else
    die "$(t 'No SHA-256 tool (sha256sum, shasum or openssl) was found.' 'SHA-256 aracı (sha256sum, shasum ya da openssl) bulunamadı.')"
  fi
}

# version_ge <a> <b>: a >= b, both dotted numbers.
version_ge() {
  awk -v a="$1" -v b="$2" 'BEGIN {
    split(a, x, "."); split(b, y, ".")
    for (i = 1; i <= 3; i++) { if (x[i] + 0 > y[i] + 0) exit 0; if (x[i] + 0 < y[i] + 0) exit 1 }
    exit 0 }'
}

# A path in single quotes, for a shell script this installer writes.
quote() {
  printf "'%s'" "$(printf '%s' "$1" | sed "s/'/'\\\\''/g")"
}

# ── steps ──

platform() {
  case "$(uname -s)" in
    Linux) OS=linux ;;
    Darwin) OS=darwin ;;
    MINGW* | MSYS* | CYGWIN*)
      say "$(t 'On Windows, run this in PowerShell instead:' "Windows'ta bunun yerine PowerShell'de şunu çalıştır:")"
      say "  irm https://raw.githubusercontent.com/$REPO/main/install.ps1 | iex"
      exit 1
      ;;
    *) die "$(t "This system ($(uname -s)) is not supported." "Bu sistem ($(uname -s)) desteklenmiyor.")" ;;
  esac
  case "$(uname -m)" in
    x86_64 | amd64) ARCH=x64 ;;
    aarch64 | arm64) ARCH=arm64 ;;
    armv7l) ARCH=armv7l ;;
    *) ARCH=$(uname -m) ;;
  esac
  # An Apple silicon Mac running this shell under Rosetta still runs the arm64 build of Node.js natively.
  if [ "$OS" = darwin ] && [ "$ARCH" = x64 ] && [ "$(sysctl -n sysctl.proc_translated 2>/dev/null || echo 0)" = 1 ]; then ARCH=arm64; fi
}

# NODE: a Node.js new enough, by a path that outlives this shell; empty when there is none.
find_node() {
  NODE=""
  PRIVATE_NODE=0
  OLD_NODE=""
  if has node; then
    v=$(node -p 'process.versions.node' 2>/dev/null) || v=""
    if [ -n "$v" ] && version_ge "$v" "$NODE_MIN"; then
      # Version managers hand out per-shell links that disappear; the hooks need the installation itself.
      NODE=$(node -p 'require("fs").realpathSync(process.execPath)')
      NODE_VERSION="$v"
      return 0
    fi
    OLD_NODE="$v"
  fi
  # One this installer downloaded before.
  if [ -x "$INSTALL_DIR/node/bin/node" ]; then
    v=$("$INSTALL_DIR/node/bin/node" -p 'process.versions.node' 2>/dev/null) || v=""
    if [ -n "$v" ] && version_ge "$v" "$NODE_MIN"; then
      NODE="$INSTALL_DIR/node/bin/node"
      NODE_VERSION="$v"
      PRIVATE_NODE=1
    fi
  fi
}

# Downloads the newest Node.js $NODE_LINE build for this system into $INSTALL_DIR/node, checked against
# nodejs.org's SHA-256 list; keeps the one already there when it is the newest.
private_node() {
  if [ "$OS" = linux ] && { [ -f /etc/alpine-release ] || (ldd --version 2>&1 | grep -qi musl); }; then
    die "$(t 'Node.js 22.13 or newer is needed, and nodejs.org has no build for this Linux (musl). Install it with your package manager (for example: apk add nodejs), then run this again.' "Node.js 22.13 ya da sonrası gerekli ve nodejs.org'da bu Linux (musl) için derleme yok. Paket yöneticinle kur (örneğin: apk add nodejs), sonra bunu yeniden çalıştır.")"
  fi
  mirror="${MODE_CODE_NODE_MIRROR:-https://nodejs.org/dist}"
  mirror="${mirror%/}/latest-v$NODE_LINE.x"
  download "$mirror/SHASUMS256.txt" "$STAGE/SHASUMS256.txt" ||
    die "$(t "Could not reach $mirror to download Node.js." "Node.js'i indirmek için $mirror adresine ulaşılamadı.")"
  file=$(awk '{ print $2 }' "$STAGE/SHASUMS256.txt" | grep -E "^node-v[0-9]+\.[0-9]+\.[0-9]+-$OS-$ARCH\.tar\.gz\$" | head -n 1) || true
  [ -n "$file" ] || die "$(t "nodejs.org has no Node.js build for $OS-$ARCH. Install Node.js 22.13 or newer yourself, then run this again." "nodejs.org'da $OS-$ARCH için Node.js derlemesi yok. Node.js 22.13 ya da sonrasını kendin kur, sonra bunu yeniden çalıştır.")"
  want=$(awk -v f="$file" '$2 == f { print $1 }' "$STAGE/SHASUMS256.txt")
  version=${file#node-v}
  version=${version%%-*}
  if [ "$PRIVATE_NODE" = 1 ] && [ "${NODE_VERSION:-}" = "$version" ]; then
    ok "$(t "Node.js $version found (used by $NAME alone)" "Node.js $version bulundu (yalnız $NAME kullanır)")"
    return 0
  fi
  busy "$(t 'Downloading Node.js' 'Node.js indiriliyor')"
  download "$mirror/$file" "$STAGE/$file" || die "$(t 'The Node.js download failed.' 'Node.js indirilemedi.')"
  got=$(sha256 "$STAGE/$file")
  [ "$got" = "$want" ] || die "$(t "The Node.js download does not match nodejs.org's checksum; nothing was installed." "İndirilen Node.js, nodejs.org'un sağlama toplamıyla eşleşmiyor; hiçbir şey kurulmadı.")"
  mkdir -p "$STAGE/nodex" "$STAGE/node/bin"
  tar -xzf "$STAGE/$file" -C "$STAGE/nodex"
  # Only the program and its license: npm and the headers are not needed to run Mode_Code.
  cp "$STAGE/nodex/${file%.tar.gz}/bin/node" "$STAGE/node/bin/node"
  cp "$STAGE/nodex/${file%.tar.gz}/LICENSE" "$STAGE/node/LICENSE"
  chmod 755 "$STAGE/node/bin/node"
  replace_dir "$STAGE/node" "$INSTALL_DIR/node"
  NODE="$INSTALL_DIR/node/bin/node"
  NODE_VERSION="$version"
  PRIVATE_NODE=1
  ok "$(t "Node.js downloaded and verified (used by $NAME alone)" "Node.js indirildi ve doğrulandı (yalnız $NAME kullanır)")"
}

# replace_dir <new> <old>: the new folder takes the old one's place; the old one is removed after.
replace_dir() {
  rm -rf "$2.old"
  if [ -e "$2" ]; then mv "$2" "$2.old"; fi
  mv "$1" "$2"
  rm -rf "$2.old"
}

# The package: from the release (checksum verified) or from MODE_CODE_PACKAGE; unpacked into $STAGE/pkg.
fetch_package() {
  SHA=""
  if [ -n "${MODE_CODE_PACKAGE:-}" ]; then
    SOURCE="$MODE_CODE_PACKAGE"
    case "$SOURCE" in
      http://* | https://*) download "$SOURCE" "$STAGE/package.tgz" || die "$(t "Could not download $SOURCE." "$SOURCE indirilemedi.")" ;;
      *)
        [ -f "$SOURCE" ] || die "$(t "No package at $SOURCE." "$SOURCE konumunda paket yok.")"
        cp "$SOURCE" "$STAGE/package.tgz"
        ;;
    esac
    warn "$(t "Installing the package you named ($SOURCE); it has no checksum to verify." "Belirttiğin paket kuruluyor ($SOURCE); doğrulanacak sağlama toplamı yok.")"
  else
    if [ -n "$VERSION" ]; then
      base="https://github.com/$REPO/releases/download/v$VERSION"
      asset="$APP-$VERSION.tgz"
    else
      base="https://github.com/$REPO/releases/latest/download"
      asset="$APP.tgz"
    fi
    # A release's files elsewhere (a mirror, a fork, a rehearsal): checked against its SHA256SUMS the same way.
    if [ -n "${MODE_CODE_RELEASE_URL:-}" ]; then base="${MODE_CODE_RELEASE_URL%/}"; fi
    SOURCE="$base/$asset"
    busy "$(t "Downloading $NAME${VERSION:+ $VERSION}" "$NAME${VERSION:+ $VERSION} indiriliyor")"
    if ! download "$base/SHA256SUMS" "$STAGE/SHA256SUMS"; then
      [ -n "$VERSION" ] && die "$(t "Could not download release v$VERSION: it may not exist, or the network is down. The releases: https://github.com/$REPO/releases" "v$VERSION sürümü indirilemedi: böyle bir sürüm olmayabilir ya da ağ kapalı olabilir. Sürümler: https://github.com/$REPO/releases")"
      die "$(t "Could not reach the release at $base." "$base adresindeki sürüme ulaşılamadı.")"
    fi
    download "$SOURCE" "$STAGE/package.tgz" || die "$(t "Could not download $SOURCE." "$SOURCE indirilemedi.")"
    want=$(awk -v f="$asset" '$2 == f || $2 == "*" f { print $1 }' "$STAGE/SHA256SUMS" | head -n 1)
    [ -n "$want" ] || die "$(t "The release lists no checksum for $asset." "Sürüm $asset için sağlama toplamı vermiyor.")"
    SHA=$(sha256 "$STAGE/package.tgz")
    [ "$SHA" = "$want" ] || die "$(t 'The download does not match the release checksum; nothing was installed.' 'İndirilen dosya sürümün sağlama toplamıyla eşleşmiyor; hiçbir şey kurulmadı.')"
  fi
  mkdir -p "$STAGE/pkg"
  tar -xzf "$STAGE/package.tgz" -C "$STAGE/pkg" || die "$(t 'The package could not be unpacked.' 'Paket açılamadı.')"
  for f in cli.mjs hook.mjs; do
    [ -f "$STAGE/pkg/package/dist/$f" ] || die "$(t 'That is not a Mode_Code package.' 'Bu bir Mode_Code paketi değil.')"
  done
  PKG_VERSION=$("$NODE" -p 'require(process.argv[1]).version' "$STAGE/pkg/package/package.json")
  [ -n "$SHA" ] && ok "$(t "$NAME $PKG_VERSION downloaded and verified" "$NAME $PKG_VERSION indirildi ve doğrulandı")"
  return 0
}

# The `mode-code` command: a small script that runs the program with the Node.js chosen above.
write_command() {
  mkdir -p "$BIN_DIR"
  COMMAND="$BIN_DIR/$APP"
  if [ -e "$COMMAND" ] && ! grep -q "$COMMAND_MARK" "$COMMAND" 2>/dev/null; then
    die "$(t "$COMMAND exists and was not written by this installer; it was left as it is. Remove it, or set MODE_CODE_BIN_DIR to another folder." "$COMMAND var ve bu kurulumun yazdığı değil; olduğu gibi bırakıldı. Kaldır ya da MODE_CODE_BIN_DIR ile başka bir klasör seç.")"
  fi
  {
    say '#!/bin/sh'
    say "$COMMAND_MARK: runs $NAME with the Node.js it chose."
    say "node=$(quote "$NODE")"
    # shellcheck disable=SC2016 # written as it is: the variable belongs to the command file
    say '[ -x "$node" ] || node=node'
    say "exec \"\$node\" $(quote "$CLI") \"\$@\""
  } >"$COMMAND.new"
  chmod 755 "$COMMAND.new"
  mv "$COMMAND.new" "$COMMAND"
  ok "$(t "The $APP command is added" "$APP komutu eklendi")"
}

on_path() {
  case ":${PATH:-}:" in *":$1:"* | *":$1/:"*) return 0 ;; esac
  return 1
}

# Adds $BIN_DIR to PATH in the shell's startup file, once, marked so `mode-code uninstall` finds it.
setup_path() {
  PATH_FILE=""
  PATH_LINE=""
  on_path "$BIN_DIR" && return 0
  if [ "$MODIFY_PATH" = 0 ]; then
    warn "$(t "$BIN_DIR is not on PATH; add it yourself (--no-modify-path)." "$BIN_DIR PATH'te değil; kendin ekle (--no-modify-path).")"
    return 0
  fi
  # shellcheck disable=SC2016 # $HOME stays a variable in the startup file
  if [ "$BIN_DIR" = "$HOME/.local/bin" ]; then dir='$HOME/.local/bin'; else dir=$BIN_DIR; fi
  case "$(basename "${SHELL:-sh}")" in
    zsh) rc="${ZDOTDIR:-$HOME}/.zshrc" line="export PATH=\"$dir:\$PATH\"" ;;
    bash)
      if [ "$OS" = darwin ]; then rc="$HOME/.bash_profile"; else rc="$HOME/.bashrc"; fi
      line="export PATH=\"$dir:\$PATH\""
      ;;
    fish) rc="${XDG_CONFIG_HOME:-$HOME/.config}/fish/conf.d/$APP.fish" line="fish_add_path --global \"$BIN_DIR\"" ;;
    *) rc="$HOME/.profile" line="export PATH=\"$dir:\$PATH\"" ;;
  esac
  if [ -f "$rc" ] && grep -qxF "$line" "$rc" 2>/dev/null; then
    # Already there (an earlier run): only ours to remove when it carries the mark.
    if grep -qxF "$MARK" "$rc" 2>/dev/null; then PATH_FILE="$rc" PATH_LINE="$line"; fi
  else
    mkdir -p "$(dirname "$rc")"
    printf '\n%s\n%s\n' "$MARK" "$line" >>"$rc"
    PATH_FILE="$rc" PATH_LINE="$line"
  fi
  NEW_SHELL=1
  PATH="$BIN_DIR:$PATH"
  export PATH
}

# The record `mode-code uninstall` reads: what was put where. Written with Node.js, which quotes JSON right.
write_receipt() {
  R_FILE="$INSTALL_DIR/install.json" R_VERSION="$PKG_VERSION" R_HOME="$INSTALL_DIR" R_PROGRAM="$CLI" \
    R_NODE="$NODE" R_PRIVATE="$PRIVATE_NODE" R_COMMAND="$COMMAND" R_PATH_FILE="$PATH_FILE" R_PATH_LINE="$PATH_LINE" \
    R_SOURCE="$SOURCE" R_SHA="$SHA" "$NODE" -e '
      const e = process.env, fs = require("fs");
      const r = {
        v: 1, app: "mode-code", version: e.R_VERSION, installedAt: new Date().toISOString(),
        home: e.R_HOME, program: e.R_PROGRAM, node: e.R_NODE, privateNode: e.R_PRIVATE === "1",
        command: e.R_COMMAND, path: e.R_PATH_FILE ? { file: e.R_PATH_FILE, line: e.R_PATH_LINE } : null,
        source: e.R_SOURCE, sha256: e.R_SHA || null,
      };
      fs.writeFileSync(e.R_FILE + ".new", JSON.stringify(r, null, 2) + "\n");
      fs.renameSync(e.R_FILE + ".new", e.R_FILE);'
}

find_claude() {
  has claude && return 0
  # Anthropic's installer puts it here; a shell started before it ran may not have the folder on PATH yet.
  if [ -x "$HOME/.local/bin/claude" ]; then
    PATH="$HOME/.local/bin:$PATH"
    export PATH
    return 0
  fi
  return 1
}

# The version Claude Code says it is, "2.1.310 (Claude Code)" read as 2.1.310; nothing when it does not say.
claude_version() {
  claude --version 2>/dev/null | awk 'NR == 1 && $1 ~ /^[0-9]+\.[0-9]+\.[0-9]+/ { print $1 }'
}

install_claude() {
  say
  say "  $(t "$NAME works inside Claude Code; Claude Code was not found on this computer." "$NAME, Claude Code'un içinde çalışır; bu bilgisayarda Claude Code bulunamadı.")"
  say
  if ! ask_no "  $(t "Install Claude Code now with Anthropic's official installer?" "Claude Code, Anthropic'in resmî kurulumuyla şimdi kurulsun mu?")"; then
    return 1
  fi
  say
  has bash || die "$(t "Anthropic's installer needs bash, which is not installed." "Anthropic'in kurulum betiği bash istiyor ve bash kurulu değil.")"
  busy "$(t 'Installing Claude Code' 'Claude Code kuruluyor')"
  download https://claude.ai/install.sh "$STAGE/claude-install.sh" || die "$(t 'Could not reach claude.ai.' "claude.ai'ye ulaşılamadı.")"
  # What it says is kept and shown only when it fails: its lines are its own, in English.
  if ! bash "$STAGE/claude-install.sh" </dev/null >"$STAGE/claude-install.log" 2>&1; then
    unbusy keep
    cat "$STAGE/claude-install.log"
    die "$(t "Anthropic's installer did not finish." "Anthropic'in kurulum betiği tamamlanmadı.")"
  fi
  if ! find_claude; then
    unbusy keep
    return 1
  fi
  v=$(claude_version)
  ok "$(t "Claude Code${v:+ $v} installed" "Claude Code${v:+ $v} kuruldu")"
}

# `mode-code install`: shows every change to Claude Code and asks once (or not at all with --yes).
setup() {
  NEXT=""
  if [ "$SETUP" = 0 ]; then
    NEXT="$APP install"
    return 0
  fi
  if find_claude; then
    v=$(claude_version)
    ok "$(t "Claude Code${v:+ $v} found" "Claude Code${v:+ $v} bulundu")"
  elif ! install_claude; then
    NEXT="$APP install"
    say "$(t "Install Claude Code (https://code.claude.com/docs/en/setup), then run: $APP install" "Claude Code'u kur (https://code.claude.com/docs/en/setup), sonra şunu çalıştır: $APP install")"
    [ "$TTY" = 1 ] && return 0
    return 1
  fi
  say
  # The program leaves its title out, as this installer's stands for both.
  if [ "$YES" = 1 ]; then
    MODE_CODE_INSTALLER=1 "$NODE" "$CLI" install --yes </dev/null || return 1
  elif [ "$TTY" = 1 ]; then
    MODE_CODE_INSTALLER=1 "$NODE" "$CLI" install </dev/tty || return 1
  else
    NEXT="$APP install"
    say "$(t "Nobody is at a terminal to confirm the changes to Claude Code: run $APP install in one (or pass --yes)." "Claude Code'daki değişiklikleri onaylayacak bir terminal yok: $APP install komutunu bir terminalde çalıştır (ya da --yes ver).")"
  fi
}

main() {
  UI=$(ui_lang)
  colors
  YES=0 CLAUDE=0 VERSION="" MODIFY_PATH=1 SETUP=1 NEW_SHELL=0 STAGE=""
  while [ $# -gt 0 ]; do
    case "$1" in
      -y | --yes) YES=1 ;;
      --install-claude) CLAUDE=1 ;;
      --version)
        [ $# -ge 2 ] || die "--version <v>"
        VERSION=${2#v}
        shift
        ;;
      --version=*)
        VERSION=${1#--version=}
        VERSION=${VERSION#v}
        ;;
      --no-modify-path) MODIFY_PATH=0 ;;
      --no-setup) SETUP=0 ;;
      -h | --help)
        usage
        exit 0
        ;;
      *) die "$(t "Unknown option: $1 (see --help)" "Bilinmeyen seçenek: $1 (bkz. --help)")" ;;
    esac
    shift
  done
  if [ "${CLAUDECODE:-}" = 1 ] || [ -n "${CLAUDE_CODE_ENTRYPOINT:-}" ]; then
    die "$(t "Run this in your own terminal, not inside a Claude Code session: it changes Claude Code's settings, which a session must not do to itself." "Bunu bir Claude Code oturumunun içinde değil, kendi terminalinde çalıştır: Claude Code'un ayarlarını değiştirir ve bir oturum bunu kendine yapmamalı.")"
  fi
  [ -n "${HOME:-}" ] || die "HOME is not set."
  TTY=0
  if [ -z "${CI:-}" ] && (exec </dev/tty) 2>/dev/null; then TTY=1; fi
  INSTALL_DIR="${MODE_CODE_INSTALL_DIR:-${XDG_DATA_HOME:-$HOME/.local/share}/$APP}"
  BIN_DIR="${MODE_CODE_BIN_DIR:-$HOME/.local/bin}"
  INSTALL_DIR="${INSTALL_DIR%/}" BIN_DIR="${BIN_DIR%/}"

  say "${B}$NAME$N $(t 'installer' 'kurulumu')"
  say
  platform
  has tar || die "$(t 'tar is not installed.' 'tar kurulu değil.')"
  mkdir -p "$INSTALL_DIR"
  # Everything is prepared beside its final place and moved in at the end, so a failed run leaves the last good one.
  STAGE=$(mktemp -d "$INSTALL_DIR/.staging.XXXXXX")
  trap 'rm -rf "$STAGE"' EXIT
  trap 'exit 130' INT TERM

  find_node
  if [ -z "$NODE" ] || [ "$PRIVATE_NODE" = 1 ]; then
    if [ -n "$OLD_NODE" ] && [ "$PRIVATE_NODE" = 0 ]; then
      note "$(t "Node.js $OLD_NODE is too old for $NAME (22.13 or newer); a newer one is kept for $NAME alone." "Node.js $OLD_NODE, $NAME için eski (22.13 ya da sonrası gerekli); yalnız $NAME için yenisi tutulacak.")"
    fi
    private_node
  else
    ok "$(t "Node.js $NODE_VERSION found" "Node.js $NODE_VERSION bulundu")"
  fi

  fetch_package
  CLI="$INSTALL_DIR/app/dist/cli.mjs"
  replace_dir "$STAGE/pkg/package" "$INSTALL_DIR/app"
  write_command
  setup_path
  write_receipt

  status=0
  setup || status=$?
  say
  if [ "$status" -ne 0 ]; then
    say "${R}$(t "The program is installed, but connecting it to Claude Code did not finish. Run $APP install to try again." "Program kuruldu ama Claude Code'a bağlanması tamamlanmadı. Yeniden denemek için $APP install çalıştır.")$N"
    if [ "$NEW_SHELL" = 1 ]; then
      say "${D}$(t "Open a new terminal to use the $APP command (or run: export PATH=\"$BIN_DIR:\$PATH\")." "$APP komutunu kullanmak için yeni bir terminal aç (ya da şunu çalıştır: export PATH=\"$BIN_DIR:\$PATH\").")$N"
    fi
    exit "$status"
  fi
  # Connected to Claude Code, the program has said it is ready and what comes next.
  if [ -n "$NEXT" ]; then
    say "${B}$(t "$NAME $PKG_VERSION is installed. Next: $NEXT" "$NAME $PKG_VERSION kuruldu. Sıradaki: $NEXT")$N"
  fi
  # This terminal reaches the command only when its PATH already held the folder; else a new one does.
  if [ "$NEW_SHELL" = 1 ]; then
    say "  ${D}$(t "Open a new terminal to use the $APP command (or run: export PATH=\"$BIN_DIR:\$PATH\")." "$APP komutunu kullanmak için yeni bir terminal aç (ya da şunu çalıştır: export PATH=\"$BIN_DIR:\$PATH\").")$N"
  fi
}

main "$@"
