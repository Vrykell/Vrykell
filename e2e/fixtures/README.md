# SSH terminal recordings

`ssh-conpty-output.json` contains sanitized output captured on Windows using the production SSH command builder, remote shell integration script, native OpenSSH, ConPTY, and synchronous stream scanner. Hostnames and the home directory were replaced with fixture values; authentication output and credentials are excluded.

The four commands cover an empty `ls` result, `pwd`, `ls /usr`, and a standard-error message. The blank-screen repaint sequences are retained so frontend regression tests exercise the native output rather than a simplified mock. Empty command output should remain blank in the UI, with only the command header and exit status.

Browser tests replay these recordings through the frontend event path; they do not make network connections or validate the complete desktop IPC path.
