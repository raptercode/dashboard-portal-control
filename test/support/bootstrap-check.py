"""Offline bootstrap behavior checks. Run with python3 on Linux (or WSL).

Only the bootstrap's real Bash, tar, sha256sum and controlling-terminal behavior
run. OS/download/sudo are fixtures and the extracted installer records arguments.
"""
import hashlib
import io
import json
import os
from pathlib import Path
import pty
import select
import shlex
import signal
import subprocess
import tarfile
import tempfile
import time
import unittest

ROOT = Path(__file__).resolve().parents[2]


class BootstrapChecks(unittest.TestCase):
    def run_bootstrap(self, *, version=True, mode='ok', answers=None, tty=True, unprivileged=False, node_major=None):
        with tempfile.TemporaryDirectory(prefix='portal-bootstrap-test-') as fixture:
            base = Path(fixture)
            archive = base / 'dashboard-portal-0.8.3.tar.gz'
            installer = b'''#!/usr/bin/env bash
set -euo pipefail
printf '%s\\n' "$@" > "$FIXTURE_ROOT/arguments"
read -r -p 'Fixture password: ' password
[[ "$password" == 'fixture-password' ]]
printf 'Fixture installer completed\\n'
'''
            with tarfile.open(archive, 'w:gz') as tar:
                for name, content in [('dashboard-portal.sh', installer), ('package.json', b'{"version":"0.8.3"}')]:
                    if mode == 'missing-installer' and name == 'dashboard-portal.sh':
                        continue
                    info = tarfile.TarInfo(name)
                    info.size = len(content)
                    info.mode = 0o644
                    tar.addfile(info, io.BytesIO(content))
            digest = hashlib.sha256(archive.read_bytes()).hexdigest()
            if mode == 'bad-hash': digest = '0' * 64
            checksum_name = 'other.tar.gz' if mode == 'wrong-name' else archive.name
            checksum = f'{digest}  {checksum_name}\n'
            if mode == 'extra-checksum': checksum += f'{digest}  extra.tar.gz\n'
            (base / (archive.name + '.sha256')).write_text(checksum)
            (base / 'mock-env').write_text(r'''
source() {
  if [[ "$1" == /etc/os-release ]]; then
    ID=ubuntu; VERSION_ID=24.04
    [[ "$FIXTURE_MODE" != unsupported-os ]] || VERSION_ID=26.04
  else builtin source "$@"; fi
}
uname() {
  case "$1" in
    -s) printf 'Linux\n' ;;
    -m) if [[ "$FIXTURE_MODE" == wrong-arch ]]; then printf 'aarch64\n'; else printf 'x86_64\n'; fi ;;
  esac
}
mktemp() { command mktemp -d "$FIXTURE_ROOT/bootstrap.XXXXXX"; }
curl() {
  [[ "$FIXTURE_MODE" != download-failure ]] || return 22
  local output='' url='' latest=false
  while (( $# )); do
    case "$1" in
      -o) output="$2"; shift 2 ;;
      -w) latest=true; shift 2 ;;
      --proto|--proto-redir) shift 2 ;;
      https://*) url="$1"; shift ;;
      *) shift ;;
    esac
  done
  printf '%s\n' "$url" >> "$FIXTURE_ROOT/downloads"
  if [[ "$latest" == true ]]; then
    if [[ "$FIXTURE_MODE" == bad-latest ]]; then
      printf 'https://example.invalid/releases/tag/v0.8.3'
    else printf 'https://github.com/raptercode/dashboard-portal-control/releases/tag/v0.8.3'; fi
  else command cp "$FIXTURE_ROOT/${url##*/}" "$output"; fi
}
sudo() {
  printf 'sudo\n' > "$FIXTURE_ROOT/privilege"
  [[ "$1" == -- ]] && shift
  "$@"
}
''')
            if unprivileged and os.geteuid() == 0:
                # Permit only the fixture directory; the child receives no root
                # identity and sudo is a fixture function, never the host binary.
                base.chmod(0o777)
            env = dict(os.environ, BASH_ENV=str(base/'mock-env'), FIXTURE_ROOT=str(base), FIXTURE_MODE=mode)
            args = '--version v0.8.3' if version else ''
            if node_major: args += f' --node-major={shlex.quote(node_major)}'
            command = f'cat {shlex.quote(str(ROOT / "install.sh"))} | bash -s -- {args}'
            if not tty:
                result = subprocess.run(['bash', '-c', command], env=env, stdout=subprocess.PIPE,
                                        stderr=subprocess.STDOUT, timeout=15, start_new_session=True)
                output = result.stdout.decode(errors='replace'); code = result.returncode
            else:
                pid, master = pty.fork()
                if pid == 0:
                    if unprivileged and os.geteuid() == 0:
                        os.setgroups([])
                        os.setgid(65534)
                        os.setuid(65534)
                    os.execvpe('bash', ['bash', '-c', command], env)
                chunks = []
                payload = answers or 'portal.example.com\nadmin@example.com\nfixture-password\n'
                os.write(master, payload.encode())
                deadline = time.monotonic() + 15
                code = None
                while time.monotonic() < deadline:
                    if select.select([master], [], [], .1)[0]:
                        try:
                            chunk = os.read(master, 8192)
                            if chunk: chunks.append(chunk)
                        except OSError: break
                    done, status = os.waitpid(pid, os.WNOHANG)
                    if done:
                        code = os.waitstatus_to_exitcode(status)
                        break
                if code is None:
                    done, status = os.waitpid(pid, os.WNOHANG)
                    if not done:
                        os.kill(pid, signal.SIGKILL)
                        _, status = os.waitpid(pid, 0)
                    code = os.waitstatus_to_exitcode(status)
                os.close(master)
                output = b''.join(chunks).decode(errors='replace')
            arguments = (base/'arguments').read_text().splitlines() if (base/'arguments').exists() else []
            downloads = (base/'downloads').read_text().splitlines() if (base/'downloads').exists() else []
            self.assertFalse(list(base.glob('bootstrap.*')), 'Temporary extraction was not cleaned up')
            if unprivileged:
                self.assertTrue((base/'privilege').exists(), output)
            return code, output, arguments, downloads

    def test_pinned_pipe_and_password_terminal(self):
        code, output, args, urls = self.run_bootstrap()
        self.assertEqual(code, 0, output)
        self.assertEqual(args, ['--domain=portal.example.com', '--email=admin@example.com', '--node-major=24'])
        self.assertEqual(len(urls), 2)
        self.assertTrue(all('/download/v0.8.3/' in url for url in urls))
        self.assertIn('Fixture installer completed', output)

    def test_latest_and_selected_node(self):
        code, output, args, urls = self.run_bootstrap(version=False, node_major='20')
        self.assertEqual(code, 0, output)
        self.assertEqual(args[-1], '--node-major=20')
        self.assertTrue(urls[0].endswith('/releases/latest'))

    def test_sudo_handoff_with_terminal_stdin(self):
        code, output, args, _ = self.run_bootstrap(unprivileged=True)
        self.assertEqual(code, 0, output)
        self.assertEqual(args[-1], '--node-major=24')
        self.assertIn('Fixture installer completed', output)

    def test_fail_closed_before_installer(self):
        for mode in ['bad-hash', 'wrong-name', 'extra-checksum', 'download-failure', 'bad-latest',
                     'unsupported-os', 'wrong-arch', 'missing-installer']:
            with self.subTest(mode=mode):
                code, output, args, _ = self.run_bootstrap(mode=mode, version=mode != 'bad-latest')
                self.assertNotEqual(code, 0, output)
                self.assertEqual(args, [])

    def test_invalid_prompt(self):
        for answers in ['invalid\nadmin@example.com\n',
                        'portal.example.com\ninvalid\n']:
            with self.subTest(answers=answers):
                code, output, args, urls = self.run_bootstrap(answers=answers)
                self.assertNotEqual(code, 0, output)
                self.assertEqual(args, [])
                self.assertEqual(urls, [])

    def test_no_controlling_terminal(self):
        code, output, args, _ = self.run_bootstrap(tty=False)
        self.assertNotEqual(code, 0, output)
        self.assertIn('interactive terminal is required', output)
        self.assertEqual(args, [])

    def test_argument_validation_without_host_actions(self):
        for args in [['--version', '../bad'], ['--version'], ['--unknown'],
                     ['--node-major', '25'], ['--node-major'],
                     ['--version', 'v0.8.3', '--version', 'v0.8.4']]:
            with self.subTest(args=args):
                result = subprocess.run(['bash', str(ROOT/'install.sh'), *args], capture_output=True)
                self.assertNotEqual(result.returncode, 0)
        result = subprocess.run(['bash', str(ROOT/'install.sh'), '--help'], capture_output=True)
        self.assertEqual(result.returncode, 0)


if __name__ == '__main__':
    unittest.main(verbosity=2)
