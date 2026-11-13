# Proxmox LXC deployment

Run these commands as root in the **Proxmox node shell**. The script shows the container ID, storage and network before creating the container. Defaults are an unprivileged Debian 13 LXC with 1 vCPU, 512 MiB RAM, a 4 GiB root disk, and DHCP on `vmbr0`.

```sh
curl -fsSLo create-lxc.sh https://raw.githubusercontent.com/tomtcs/Trimlight-home-studio-WLED-controller/main/deploy/proxmox/create-lxc.sh
bash create-lxc.sh
```

Set overrides before running the script if your node uses different storage, a different bridge, or a tagged network. `ROOT_STORAGE` must support container disks and `TEMPLATE_STORAGE` must support container templates. `CTID` defaults to the next available cluster ID. This example uses VLAN 50 on a VLAN-aware bridge.

```sh
ROOT_STORAGE=local-zfs NET0='name=eth0,bridge=vmbr0,tag=50,ip=dhcp' bash create-lxc.sh
```

Open the container address shown by the script on port **8080**. The browser and the LXC both need network access to WLED. Use the controller’s LAN IP if its hostname is unavailable. The LXC also needs outbound HTTPS to GitHub and access to its configured Debian package mirrors. Keep the Studio web interface on your trusted LAN.

## Move from Portainer

1. In the old app, download a JSON backup from **Wiring & setup → Backup & restore**.
2. On the LXC, open the same screen and restore the JSON backup. Studio starts with its scheduler paused, and the import leaves it paused.
3. Confirm your looks, schedule, mapping, and controller address. When ready to switch, pause the old scheduler or stop the old Studio stack, then enable the LXC scheduler under **Schedule → Calendar → Enable calendar scheduler**. WLED retains its existing controller-side timers during the move.

Studio stores its SQLite database on the LXC root disk at `/var/lib/trimlight-studio/studio.sqlite3`. It is included in normal Proxmox container backups. The JSON backup covers Studio’s data. WLED's own preset and configuration exports are managed on the controller.

## Update Studio

In the LXC console, run:

```sh
update --check
update
```

From the Proxmox node, the equivalent is `pct exec CTID -- update`. The updater fetches GitHub’s `main` branch, checks the new files, takes a consistent SQLite backup, switches releases, restarts the API, and reloads Nginx. If the health checks fail, it switches the app files back to the previous release. The pre-update database copy is at `/opt/trimlight-studio/backups/studio-before-update.sqlite3`.

Use `systemctl status trimlight-studio nginx` to check services and `journalctl -u trimlight-studio -n 60 --no-pager` to read API logs. The web app is on port 8080 and the Python API listens on the LXC’s loopback interface.
