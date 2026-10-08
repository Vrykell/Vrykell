"""Bridge a real editor's PTY to the browser test through JSON lines."""
import base64
import fcntl
import json
import os
import pty
import select
import signal
import struct
import sys
import termios

pid, master = pty.fork()
if pid == 0:
    os.environ['TERM'] = 'xterm-256color'
    os.execl('/usr/bin/vi', 'vi', '-N', '-u', 'DEFAULTS', '-i', 'NONE', '-n', '-c', 'set showcmd', sys.argv[1])
fcntl.ioctl(master, termios.TIOCSWINSZ, struct.pack('HHHH', int(sys.argv[3]) if len(sys.argv) > 3 else 24, int(sys.argv[2]) if len(sys.argv) > 2 else 100, 0, 0))

def stop(*_):
    try:
        os.kill(pid, signal.SIGTERM)
        os.waitpid(pid, 0)
    except ProcessLookupError:
        pass
    sys.exit(0)

signal.signal(signal.SIGTERM, stop)
pending = b''
while True:
    ready, _, _ = select.select([master, sys.stdin.fileno()], [], [])
    if master in ready:
        try:
            data = os.read(master, 65536)
        except OSError:
            break
        if not data:
            break
        print(base64.b64encode(data).decode('ascii'), flush=True)
    if sys.stdin.fileno() in ready:
        data = os.read(sys.stdin.fileno(), 65536)
        if not data:
            stop()
        pending += data
        while b'\n' in pending:
            line, pending = pending.split(b'\n', 1)
            message = json.loads(line)
            if 'resize' in message:
                size = message['resize']
                fcntl.ioctl(master, termios.TIOCSWINSZ, struct.pack('HHHH', size['rows'], size['cols'], 0, 0))
            else:
                os.write(master, message['data'].encode('utf-8'))
os.waitpid(pid, 0)
