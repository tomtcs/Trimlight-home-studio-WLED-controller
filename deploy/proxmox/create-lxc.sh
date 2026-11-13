#!/usr/bin/env bash
set -euo pipefail

repo=https://github.com/tomtcs/Trimlight-home-studio-WLED-controller.git
template_storage=${TEMPLATE_STORAGE:-local}
root_storage=${ROOT_STORAGE:-local-lvm}
bridge=${BRIDGE:-vmbr0}
hostname=${CT_HOSTNAME:-trimlight-studio}
net0=${NET0:-name=eth0,bridge=${bridge},ip=dhcp}
revision=${STUDIO_REVISION:-main}

usage() {
  cat <<'HELP'
Create a native Trimlight Studio WLED container on the Proxmox node.
Usage: bash create-lxc.sh [--yes]
Defaults: Debian 13, unprivileged, 1 vCPU, 512 MiB RAM, 4 GiB root disk.
Overrides: CTID, CT_HOSTNAME, TEMPLATE_STORAGE, ROOT_STORAGE, BRIDGE,
           NET0 (complete Proxmox network setting), DEBIAN_TEMPLATE,
           STUDIO_REVISION (initial Git branch, ref, or commit).
HELP
}

case "${1:-}" in
  -h|--help) usage; exit 0 ;;
  --yes|'') ;;
  *) usage >&2; exit 2 ;;
esac
if (( $# > 1 )); then usage >&2; exit 2; fi
if (( EUID != 0 )) || ! command -v pct >/dev/null || ! command -v pvesh >/dev/null; then
  echo "Run this script as root from the Proxmox VE node shell." >&2
  exit 1
fi

ctid=${CTID:-$(pvesh get /cluster/nextid)}
if [[ ! $ctid =~ ^[1-9][0-9]{2,8}$ ]]; then echo "Invalid CTID: $ctid" >&2; exit 1; fi
printf 'Container %s (%s)\nRoot storage: %s\nTemplate storage: %s\nNetwork: %s\n' "$ctid" "$hostname" "$root_storage" "$template_storage" "$net0"
if [[ ${1:-} != --yes ]]; then
  read -r -p 'Create this container? [y/N] ' reply
  [[ $reply =~ ^[Yy]([Ee][Ss])?$ ]] || exit 0
fi

template=${DEBIAN_TEMPLATE:-}
if [[ -z $template ]]; then
  pveam update
  template=$(pveam available --section system | awk '$2 ~ /^debian-13-standard_.*_amd64\.tar\.(zst|xz)$/ {print $2}' | sort -V | tail -n 1)
fi
if [[ ! $template =~ ^debian-(12|13)-standard_[a-zA-Z0-9._+-]+_amd64\.tar\.(zst|xz)$ ]]; then
  echo "No supported Debian template found. Set DEBIAN_TEMPLATE to a Debian 12 or 13 template from pveam available." >&2
  exit 1
fi
templates=$(pveam list "$template_storage")
if ! awk -v id="$template_storage:vztmpl/$template" '$1 == id {found=1} END {exit !found}' <<< "$templates"; then
  pveam download "$template_storage" "$template"
fi

pct create "$ctid" "$template_storage:vztmpl/$template" \
  --hostname "$hostname" --ostype debian --unprivileged 1 \
  --cores 1 --memory 512 --swap 256 --rootfs "$root_storage:4" \
  --net0 "$net0" --onboot 1

trap 'echo "Setup stopped. Container $ctid was retained. Use pct enter $ctid to inspect it." >&2' ERR
pct start "$ctid"
pct exec "$ctid" -- bash -se -- "$repo" "$revision" <<'GUEST'
set -euo pipefail
export DEBIAN_FRONTEND=noninteractive
apt-get -o Acquire::Retries=3 -o APT::Update::Error-Mode=any update
apt-get install -y --no-install-recommends ca-certificates curl git nginx python3 tzdata
install -d -m 0755 /opt/trimlight-studio
git init -q --bare /opt/trimlight-studio/repo.git
git --git-dir=/opt/trimlight-studio/repo.git remote add origin "$1"
git --git-dir=/opt/trimlight-studio/repo.git fetch --no-tags --depth=1 origin "$2"
installer=$(mktemp)
trap 'rm -f "$installer"' EXIT
git --git-dir=/opt/trimlight-studio/repo.git show FETCH_HEAD:deploy/proxmox/install.sh > "$installer"
bash "$installer"
GUEST
trap - ERR
ip=$(pct exec "$ctid" -- ip -4 -o addr show dev eth0 scope global | awk 'NR==1 {sub(/\/.*/, "", $4); print $4}') || ip=
printf '\nTrimlight Studio is ready in CT %s.\n' "$ctid"
if [[ -n $ip ]]; then printf 'Open http://%s:8080\n' "$ip"; else printf 'Find its address with pct exec %s -- ip -br addr.\n' "$ctid"; fi
printf 'Update from the Proxmox shell with: pct exec %s -- update\n' "$ctid"
printf 'The calendar scheduler starts paused. Restore your Studio backup before enabling it.\n'
