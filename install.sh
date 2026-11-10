#!/usr/bin/env bash
# sPi - Simple Pi Agent GUI. Downloads a verified native runtime; no AppImage or sudo.
set -euo pipefail
umask 077
SPI_DEFAULT_REPOSITORY='DiamondGo/spi'
SPI_BOOTSTRAP_VERSION='latest'
if [[ "${1:-}" == '--help' || "${1:-}" == '-h' ]]; then
  printf '%s\n' 'Usage: bash install.sh [--version VERSION] [--install-dir DIR] [--bin-dir DIR]' 'Offline: --version VERSION --archive FILE --manifest FILE (from a prepared checkout)'
  exit 0
fi
node_bin="$(command -v node || true)"
if [[ -z "$node_bin" && -x "${XDG_DATA_HOME:-$HOME/.local/share}/pi-node/current/bin/node" ]]; then
  node_bin="${XDG_DATA_HOME:-$HOME/.local/share}/pi-node/current/bin/node"
fi
if [[ -z "$node_bin" ]]; then printf '%s\n' 'sPi: Node.js >=22.19 is required (PATH or the Pi-managed runtime).' >&2; exit 1; fi
"$node_bin" -e 'const [a,b]=process.versions.node.split(".").map(Number);if(a<22||(a===22&&b<19))process.exit(1)' || { printf '%s\n' 'sPi: update Node.js to >=22.19.' >&2; exit 1; }
script_dir="$(cd -- "$(dirname -- "${BASH_SOURCE[0]}")" && pwd)"
# A developer checkout/offline installation uses the same prepared standalone engine.
if [[ -f "$script_dir/dist/release/spi-installer.cjs" ]]; then
  "$node_bin" "$script_dir/dist/release/spi-installer.cjs" install "$@"
  exit $?
fi
repo="${SPI_RELEASE_REPOSITORY:-$SPI_DEFAULT_REPOSITORY}"
version="$SPI_BOOTSTRAP_VERSION"
args=("$@")
for ((i=0;i<${#args[@]};i++)); do
  if [[ "${args[i]}" == '--version' ]]; then version="${args[i+1]:-}"; fi
done
if [[ ! "$repo" =~ ^[A-Za-z0-9_.-]+/[A-Za-z0-9_.-]+$ && -z "${SPI_RELEASE_BASE_URL:-}" ]]; then
  printf '%s\n' 'sPi: repository not configured. Use the install.sh asset from a published Release or set SPI_RELEASE_REPOSITORY=owner/repo.' >&2; exit 1
fi
tmp="$(mktemp -d "${TMPDIR:-/tmp}/spi-bootstrap.XXXXXXXX")"
trap 'rm -rf -- "$tmp"' EXIT
fetch() {
  "$node_bin" - "$1" "$2" <<'NODE'
const fs=require('node:fs')
function trusted(value){
  const u=new URL(value),test=process.env.SPI_ALLOW_TEST_HTTP==='1'&&u.protocol==='http:'&&['127.0.0.1','localhost','[::1]'].includes(u.hostname)
  const normal=u.protocol==='https:'&&(u.hostname==='github.com'||u.hostname==='api.github.com'||u.hostname.endsWith('.githubusercontent.com'))
  if(u.username||u.password||(!normal&&!test))throw Error('Untrusted bootstrap URL')
  return u
}
;(async()=>{
  for(let attempt=0;attempt<3;attempt++)try{
    let url=trusted(process.argv[2]),response
    const signal=AbortSignal.timeout(180000)
    for(let n=0;n<6;n++){
      response=await fetch(url,{redirect:'manual',signal,headers:{'User-Agent':'sPi-bootstrap'}})
      if([301,302,303,307,308].includes(response.status)){url=trusted(new URL(response.headers.get('location'),url));await response.body.cancel();continue}
      break
    }
    if(!response?.ok)throw Error('Bootstrap HTTP error')
    const chunks=[];let bytes=0
    for await(const chunk of response.body){bytes+=chunk.length;if(bytes>4*1024*1024)throw Error('Bootstrap size limit exceeded');chunks.push(chunk)}
    fs.writeFileSync(process.argv[3],Buffer.concat(chunks),{mode:0o600});return
  }catch(error){if(attempt===2)throw error;await new Promise(r=>setTimeout(r,500))}
})().catch(()=>{console.error('sPi: verified bootstrap download failed');process.exitCode=1})
NODE
}
if [[ "$version" == 'latest' ]]; then
  fetch "https://api.github.com/repos/$repo/releases/latest" "$tmp/latest.json"
  version="$("$node_bin" -e 'process.stdout.write(JSON.parse(require("fs").readFileSync(process.argv[1])).tag_name.replace(/^v/,""))' "$tmp/latest.json")"
fi
[[ "$version" =~ ^[0-9]+\.[0-9]+\.[0-9]+(-[A-Za-z0-9.-]+)?$ ]] || { printf '%s\n' 'sPi: invalid version.' >&2; exit 1; }
base="https://github.com/$repo/releases/download/v$version"
if [[ -n "${SPI_RELEASE_BASE_URL:-}" ]]; then base="${SPI_RELEASE_BASE_URL%/}/v$version"; fi
fetch "$base/SHA256SUMS" "$tmp/SHA256SUMS"
fetch "$base/spi-installer.cjs" "$tmp/spi-installer.cjs"
"$node_bin" - "$tmp" <<'NODE'
const fs=require('node:fs'),crypto=require('node:crypto'),path=require('node:path'),dir=process.argv[2]
const matches=fs.readFileSync(path.join(dir,'SHA256SUMS'),'utf8').split('\n').filter(l=>/^[a-f0-9]{64}  spi-installer\.cjs$/i.test(l))
const actual=crypto.createHash('sha256').update(fs.readFileSync(path.join(dir,'spi-installer.cjs'))).digest('hex')
if(matches.length!==1||matches[0].slice(0,64).toLowerCase()!==actual){console.error('sPi: installer checksum mismatch');process.exit(1)}
NODE
"$node_bin" "$tmp/spi-installer.cjs" install --version "$version" "$@"
