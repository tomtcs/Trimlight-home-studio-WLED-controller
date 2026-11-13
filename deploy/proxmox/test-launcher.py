import os
import pathlib
import pty
import select
import subprocess
import tempfile
import time

with tempfile.TemporaryDirectory() as temp:
    directory = pathlib.Path(temp)
    launcher = pathlib.Path("deploy/proxmox/create-lxc.sh").resolve()
    scripts = {
        "pveam": 'if [[ $1 == list ]]; then printf "%s\n" "local:vztmpl/$DEBIAN_TEMPLATE"; fi',
        "pvesh": 'printf "100\n"',
        "pct": '''printf '%s\n' "$*" >> "$STUDIO_TEST_LOG"
if [[ $1 == exec && $3 == -- && $4 == chpasswd ]]; then
  IFS= read -r input
  [[ $input == "$STUDIO_TEST_PASSWORD" ]]
elif [[ $1 == exec && $4 == bash ]]; then
  cat >/dev/null
elif [[ $1 == exec && $4 == ip ]]; then
  printf '1: eth0 inet 192.168.5.100/24 scope global eth0\n'
elif [[ $1 == exec && $4 == test ]]; then
  [[ ${STUDIO_TEST_KEY:-no} == yes ]]
fi''',
    }
    for name, script in scripts.items():
        stub = directory / name
        stub.write_text("#!/bin/bash\nset -e\n" + script + "\n")
        stub.chmod(0o700)
    password = "fake:pass with spaces\\!"
    for key in (False, True):
        logfile = directory / f"{key}.log"
        env = dict(os.environ, PATH=f"{temp}:{os.environ['PATH']}", STUDIO_TEST_LOG=str(logfile), STUDIO_TEST_PASSWORD=f"root:{password}", DEBIAN_TEMPLATE="debian-13-standard_13.1-1_amd64.tar.zst")
        if key:
            pub = directory / "key.pub"
            pub.write_text("public-key fixture")
            env["SSH_PUBLIC_KEY_FILE"] = str(pub)
        pid, terminal = pty.fork()
        if pid == 0:
            os.execve("/bin/bash", ["bash", str(launcher), "--yes"], env)
        output = b""
        transcript = b""
        for prompt, answer in [(b"New root password", "wrong"), (b"Confirm root password", "mismatch"), (b"Enter matching", password), (b"Confirm root password", password)]:
            deadline = time.monotonic() + 4
            while prompt not in output:
                if time.monotonic() > deadline:
                    raise RuntimeError(output)
                if select.select([terminal], [], [], 0.2)[0]:
                    output += os.read(terminal, 4096)
            if prompt == b"Enter matching":
                while b"New root password" not in output:
                    if time.monotonic() > deadline:
                        raise RuntimeError(output)
                    if select.select([terminal], [], [], 0.2)[0]:
                        output += os.read(terminal, 4096)
            os.write(terminal, (answer + "\n").encode())
            transcript += output
            output = b""
        deadline = time.monotonic() + 6
        while True:
            if time.monotonic() > deadline:
                os.kill(pid, 9)
                raise RuntimeError(output)
            child, status = os.waitpid(pid, os.WNOHANG)
            if child:
                while select.select([terminal], [], [], 0.1)[0]:
                    try:
                        chunk = os.read(terminal, 4096)
                    except OSError:
                        break
                    if not chunk: break
                    output += chunk
                break
            if select.select([terminal], [], [], 0.2)[0]:
                try:
                    output += os.read(terminal, 4096)
                except OSError:
                    _, status = os.waitpid(pid, 0)
                    break
        os.close(terminal)
        assert status == 0, output
        log = logfile.read_text()
        assert all(value not in transcript + output for value in (password.encode(), b"wrong\r\n", b"mismatch\r\n"))
        assert password not in log
        assert "exec 100 -- chpasswd" in log
        assert ("--ssh-public-keys" in log) == key
        assert ("key authentication" if key else "password authentication") in output.decode()
        logfile.unlink()
        env["STUDIO_TEST_KEY"] = "yes" if key else "no"
        result = subprocess.run(["bash", str(launcher), "--resume", "100"], env=env, text=True, capture_output=True, check=True, timeout=10)
        log = logfile.read_text()
        assert "create 100" not in log and "start 100" not in log and "chpasswd" not in log
        assert ("key authentication" if key else "password authentication") in result.stdout
print("Host launcher passed password confirmation, stdin transfer, optional SSH keys, and resume tests.")
