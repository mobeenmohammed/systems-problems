#!/usr/bin/env bash
# Start the Systems Lab runner under WSL Ubuntu — no Docker.
#
# From Windows, one command:
#
#     npm run runner
#
# which is this script via `wsl.exe -d Ubuntu`. Or from inside WSL:
#
#     ./judge/run-wsl.sh
#
# It checks the toolchains first and tells you exactly what to install for
# anything missing, rather than starting and failing later on a submission.

set -uo pipefail

cd "$(dirname "$0")/.." || exit 1

rule() { printf '%s\n' "------------------------------------------------------------"; }

# rustup installs to ~/.cargo/bin and does not touch PATH for non-login
# shells, which is exactly the shell this usually runs in.
export PATH="$HOME/.cargo/bin:$PATH"

rule
echo "  Systems Lab runner — toolchain check"
rule

missing_required=0

check() {
  local name="$1" cmd="$2" ver="$3" hint="$4" required="$5"
  if command -v "$cmd" >/dev/null 2>&1; then
    printf '  ok    %-8s %s\n' "$name" "$($ver 2>&1 | head -1)"
  else
    printf '  --    %-8s NOT INSTALLED\n' "$name"
    printf '        %s\n' "$hint"
    [ "$required" = "yes" ] && missing_required=1
  fi
}

check node   node   "node --version"           "sudo apt install nodejs" yes
check g++    g++    "g++ --version"            "sudo apt install g++" no
check rustc  rustc  "rustc --version"          "curl --proto '=https' --tlsv1.2 -sSf https://sh.rustup.rs | sh -s -- -y --profile minimal" no
check python python3 "python3 --version"       "sudo apt install python3" no
check prlimit prlimit "prlimit --version"      "sudo apt install util-linux" no

rule

if [ "$missing_required" = "1" ]; then
  echo "  node is required to run the runner itself. Install it and try again."
  rule
  exit 1
fi

# The sanitize profile needs the ASan runtime, which is a separate package from
# the compiler on some installs. Checking here beats a confusing link error on
# a submission.
if command -v g++ >/dev/null 2>&1; then
  tmp="$(mktemp -d)"
  printf 'int main(){return 0;}\n' > "$tmp/t.cpp"
  if g++ -fsanitize=address,undefined "$tmp/t.cpp" -o "$tmp/t" >/dev/null 2>&1; then
    echo "  ok    sanitizers available (-fsanitize=address,undefined links)"
  else
    echo "  --    sanitizers NOT available"
    echo "        sudo apt install libasan8 libubsan1"
    echo "        problems marked 'sanitize' will fail to build until then"
  fi
  rm -rf "$tmp"
  rule
fi

echo "  starting on 127.0.0.1:${JUDGE_PORT:-2000}"
rule
exec node judge/server.mjs
