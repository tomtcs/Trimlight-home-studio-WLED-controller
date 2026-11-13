#!/usr/bin/env bash
set -euo pipefail

mode=${1:-password}
if (( EUID != 0 || $# > 1 )) || [[ $mode != password && $mode != key ]]; then
  echo 'Run as root inside the LXC: bash configure-ssh.sh [password|key]' >&2
  exit 1
fi
if [[ $mode == password ]]; then
  status=$(passwd -S root)
  if [[ $status != 'root P '* ]]; then
    echo 'Run passwd root to set a usable root password first.' >&2
    exit 1
  fi
  root_login=yes
  password_auth=yes
else
  if [[ ! -s /root/.ssh/authorized_keys ]]; then
    echo 'Install a public key in /root/.ssh/authorized_keys first.' >&2
    exit 1
  fi
  root_login=prohibit-password
  password_auth=no
fi

if [[ ! -x /usr/sbin/sshd ]]; then
  export DEBIAN_FRONTEND=noninteractive
  apt-get -o Acquire::Retries=3 -o APT::Update::Error-Mode=any update
  apt-get install -y --no-install-recommends openssh-server
fi
ssh-keygen -A
install -d -m 0755 /run/sshd /etc/ssh/sshd_config.d
config=/etc/ssh/sshd_config.d/00-trimlight-studio.conf
candidate=$(mktemp)
backup=$(mktemp)
had_config=false
trap 'rm -f "$candidate" "$backup"' EXIT
if [[ -f $config ]]; then cp -- "$config" "$backup"; had_config=true; fi
printf 'PermitRootLogin %s\nPasswordAuthentication %s\nPermitEmptyPasswords no\n' "$root_login" "$password_auth" > "$candidate"
install -m 0644 "$candidate" "$config"
validate() {
  local effective
  /usr/sbin/sshd -t || return 1
  effective=$(/usr/sbin/sshd -T -C user=root,host=localhost,addr=127.0.0.1) || return 1
  grep -Fxq "permitrootlogin $root_login" <<< "$effective" ||
    { [[ $mode == key ]] && grep -Fxq 'permitrootlogin without-password' <<< "$effective"; } || return 1
  grep -Fxq "passwordauthentication $password_auth" <<< "$effective"
}
if ! validate; then
  if $had_config; then install -m 0644 "$backup" "$config"; else rm -f "$config"; fi
  echo 'OpenSSH rejected the settings or another configuration takes precedence.' >&2
  exit 1
fi
if ! systemctl enable ssh.service || ! systemctl restart ssh.service; then
  echo 'OpenSSH could not start. Recent ssh.service logs:' >&2
  journalctl -b -u ssh.service -n 25 --no-pager >&2 || true
  exit 1
fi
