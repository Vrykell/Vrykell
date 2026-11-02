"""Run the native jump tests against isolated loopback protocol servers.

Usage: uv run --with paramiko python scripts/test-ssh-jumps.py
"""

import json
import logging
import os
from pathlib import Path
import socket
import stat
import subprocess
import tempfile
import threading
import time

import paramiko

logging.getLogger("paramiko").setLevel(logging.CRITICAL)
MFA_SUCCESSES = {}
MFA_LOCK = threading.Lock()
CANCELLED_PASSWORD_ATTEMPTS = 0


def background(action, *args):
    threading.Thread(target=action, args=args, daemon=True).start()


def copy_stream(source, destination):
    try:
        while data := source.recv(16384):
            destination.sendall(data)
        destination.shutdown(1)
    except (OSError, EOFError):
        pass


def bridge(channel, remote):
    upstream = threading.Thread(target=copy_stream, args=(channel, remote), daemon=True)
    upstream.start()
    copy_stream(remote, channel)
    upstream.join(timeout=5)
    channel.close()
    remote.close()


class Files(paramiko.SFTPServerInterface):
    def canonicalize(self, path):
        return "/"

    def list_folder(self, path):
        entry = paramiko.SFTPAttributes()
        entry.filename = "fixture.txt"
        entry.st_mode = stat.S_IFREG | 0o600
        entry.st_size = 7
        return [entry]


class Server(paramiko.ServerInterface):
    def __init__(self, name, public_key, destinations):
        self.name = name
        self.public_key = public_key
        self.destinations = destinations
        self.channels = {}

    def get_allowed_auths(self, username):
        if username == f"mfa-{self.name}-user":
            return "keyboard-interactive"
        return "password,publickey"

    def check_auth_interactive(self, username, submethods):
        if username != f"mfa-{self.name}-user":
            return paramiko.AUTH_FAILED
        self.interactive_round = 1
        return paramiko.InteractiveQuery("", "First factor", ("Password:", False), ("Account confirmation:", True))

    def check_auth_interactive_response(self, responses):
        if self.interactive_round == 1 and responses == [f"{self.name}-test-secret", f"mfa-{self.name}-user"]:
            self.interactive_round = 2
            return paramiko.InteractiveQuery("", "Second factor", ("One-time code:", False))
        if self.interactive_round == 2 and responses == [f"{self.name}-one-time-code"]:
            with MFA_LOCK:
                MFA_SUCCESSES[self.name] = MFA_SUCCESSES.get(self.name, 0) + 1
            return paramiko.AUTH_SUCCESSFUL
        return paramiko.AUTH_FAILED

    def check_auth_password(self, username, password):
        global CANCELLED_PASSWORD_ATTEMPTS
        if username.startswith("cancelled-"):
            CANCELLED_PASSWORD_ATTEMPTS += 1
        valid = username == f"{self.name}-user" and password == f"{self.name}-test-secret"
        return paramiko.AUTH_SUCCESSFUL if valid else paramiko.AUTH_FAILED

    def check_auth_publickey(self, username, key):
        valid = username == f"{self.name}-user" and key == self.public_key
        return paramiko.AUTH_SUCCESSFUL if valid else paramiko.AUTH_FAILED

    def check_channel_request(self, kind, chanid):
        return paramiko.OPEN_SUCCEEDED if kind == "session" else paramiko.OPEN_FAILED_ADMINISTRATIVELY_PROHIBITED

    def check_channel_direct_tcpip_request(self, chanid, origin, destination):
        if destination not in self.destinations:
            return paramiko.OPEN_FAILED_ADMINISTRATIVELY_PROHIBITED
        self.channels[chanid] = destination
        return paramiko.OPEN_SUCCEEDED

    def check_channel_pty_request(self, channel, term, width, height, pixelwidth, pixelheight, modes):
        return True

    def check_channel_subsystem_request(self, channel, name):
        if name == "sftp":
            self.sftp_channel = channel
        return super().check_channel_subsystem_request(channel, name)

    def check_channel_exec_request(self, channel, command):
        if command == b"sh -s" and getattr(self, "stall_status_once", False):
            self.stall_status_once = False
            return True
        def respond():
            if command == b"fixture-disconnect":
                channel.get_transport().close()
                return
            if command == b"fixture-close-sftp":
                self.sftp_channel.close()
            if command == b"fixture-stall-next-status":
                self.stall_status_once = True
            if command == b"sh -s":
                while channel.recv(16384):
                    pass
                channel.sendall(b"system=Fixture Unix\nhostname=internal\ncpuTotal=100\ncpuIdle=60\nmemoryTotal=1024\nmemoryAvailable=512\n")
            elif command == b"fixture-probe":
                channel.sendall(b"destination reached\n")
            channel.send_exit_status(0)
            channel.shutdown_write()
            channel.close()

        background(respond)
        return True


def serve(listener, name, key, client_key, destinations, transports):
    alternate_key = paramiko.ECDSAKey.generate()

    def connection(stream):
        transport = paramiko.Transport(stream)
        transport.get_security_options().kex = ("diffie-hellman-group14-sha256",)
        transports.append(transport)
        transport.add_server_key(key)
        transport.add_server_key(alternate_key)
        transport.set_subsystem_handler("sftp", paramiko.SFTPServer, Files)
        server = Server(name, client_key, destinations)
        try:
            transport.start_server(server=server)
            channels = []
            while transport.is_active():
                channel = transport.accept(0.2)
                if channel is None:
                    continue
                channels.append(channel)
                destination = server.channels.get(channel.get_id())
                if destination:
                    remote = socket.create_connection(destination, timeout=5)
                    remote.settimeout(None)
                    background(bridge, channel, remote)
        except (OSError, EOFError, paramiko.SSHException) as error:
            if os.environ.get("VRYKELL_SSH_FIXTURE_TRACE"):
                print(f"Fixture {name}: {type(error).__name__}: {error}", flush=True)
        finally:
            transport.close()

    while True:
        try:
            stream, _ = listener.accept()
        except OSError:
            return
        background(connection, stream)


def listen():
    listener = socket.socket()
    listener.bind(("127.0.0.1", 0))
    listener.listen()
    return listener


def main():
    with tempfile.TemporaryDirectory(prefix="ssh-jump-test-") as directory:
        root = Path(directory)
        client_key = paramiko.RSAKey.generate(2048)
        client_key.write_private_key_file(str(root / "client-key"))
        if os.name == "nt":
            subprocess.run(["icacls", str(root / "client-key"), "/inheritance:r", "/grant:r", f"{os.environ['USERNAME']}:F", "/remove:g", "*S-1-3-4"],
                           check=True, stdout=subprocess.DEVNULL)
        else:
            (root / "client-key").chmod(0o600)
        listeners = [listen() for _ in range(4)]
        addresses = [listener.getsockname() for listener in listeners]
        transports = []
        trusted = []
        for index, name in enumerate(["first", "second", "target"]):
            key = paramiko.RSAKey.generate(2048)
            trusted.append(f"[127.0.0.1]:{addresses[index][1]} {key.get_name()} {key.get_base64()}\n")
            destinations = [addresses[index + 1]] if index < 2 else [addresses[3]]
            background(serve, listeners[index], name, key, client_key, destinations, transports)
        (root / "known_hosts").write_text("".join(trusted), encoding="utf-8")

        def echo():
            while True:
                try:
                    stream, _ = listeners[3].accept()
                except OSError:
                    return
                background(copy_stream, stream, stream)

        background(echo)
        environment = {**os.environ, "VRYKELL_SSH_JUMP_FIXTURE": json.dumps({
            "ports": [address[1] for address in addresses], "directory": str(root),
        })}
        try:
            result = subprocess.run(["cargo", "test", "--lib", "protocol_fixture", "--", "--ignored", "--nocapture", "--test-threads=1"],
                                    cwd=Path(__file__).resolve().parents[1] / "src-tauri", env=environment, timeout=180)
            if result.returncode == 0 and MFA_SUCCESSES != {"first": 1, "second": 1, "target": 1}:
                raise RuntimeError(f"Unexpected interactive reauthentication: {MFA_SUCCESSES}")
            if CANCELLED_PASSWORD_ATTEMPTS:
                raise RuntimeError("A cancelled authentication sent a password")
            deadline = time.monotonic() + 5
            while any(transport.is_active() for transport in transports) and time.monotonic() < deadline:
                time.sleep(0.05)
            leaked = sum(transport.is_active() for transport in transports)
            if leaked:
                raise RuntimeError(f"{leaked} protocol connections remained active after the test")
            return result.returncode
        finally:
            for transport in transports:
                transport.close()
            for listener in listeners:
                listener.close()


if __name__ == "__main__":
    raise SystemExit(main())
