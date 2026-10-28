"""Compile LaTeX to PDF with the `tectonic` binary."""

import subprocess
import tempfile
from pathlib import Path

TIMEOUT_S = 30
MAX_LOG = 8000
INSTALL_HINT = "tectonic is not installed. Install it with: brew install tectonic"


class CompileError(Exception):
    def __init__(self, log: str):
        super().__init__(log)
        self.log = log


def _truncate(log: str) -> str:
    # Tectonic reports errors near the end of its output, so keep the tail.
    if len(log) <= MAX_LOG:
        return log
    return "[... log truncated ...]\n" + log[-MAX_LOG:]


def _text(x: str | bytes | None) -> str:
    if x is None:
        return ""
    return x.decode("utf-8", "replace") if isinstance(x, bytes) else x


def compile_pdf(tex: str) -> bytes:
    with tempfile.TemporaryDirectory(prefix="resumaker-tex-") as d:
        (Path(d) / "main.tex").write_text(tex, encoding="utf-8")
        # --untrusted disables shell-escape and other insecure features: the
        # source may be hand-edited by the user.
        cmd = ["tectonic", "--untrusted", "--outdir", d, "main.tex"]
        try:
            proc = subprocess.run(
                cmd, cwd=d, capture_output=True, text=True, errors="replace",
                stdin=subprocess.DEVNULL, timeout=TIMEOUT_S, check=False)
        except FileNotFoundError:
            raise CompileError(INSTALL_HINT) from None
        except subprocess.TimeoutExpired as e:
            partial = _text(e.stdout) + _text(e.stderr)
            raise CompileError(_truncate(
                f"Compilation timed out after {TIMEOUT_S}s.\n{partial}")) from None
        log = _text(proc.stdout) + _text(proc.stderr)
        pdf = Path(d) / "main.pdf"
        if proc.returncode != 0:
            raise CompileError(_truncate(log or f"tectonic exited with {proc.returncode}"))
        if not pdf.is_file():
            raise CompileError(_truncate(log or "tectonic produced no PDF"))
        return pdf.read_bytes()
