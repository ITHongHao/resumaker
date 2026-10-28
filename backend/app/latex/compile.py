"""Compile LaTeX to PDF with the `tectonic` binary.

The boundary is capped so a hostile or broken .tex cannot exhaust memory or processes: at most
MAX_CONCURRENT compiles run at once (others wait up to QUEUE_WAIT_S, then get CompilerBusy),
compiler output goes to an anonymous temp file of which only the last MAX_OUTPUT_BYTES are
read, and a PDF larger than MAX_PDF_BYTES is refused before it is read into memory.
"""

import subprocess
import tempfile
import threading
from pathlib import Path
from typing import IO

TIMEOUT_S = 30
MAX_LOG = 8000
MAX_OUTPUT_BYTES = 64 * 1024
MAX_PDF_BYTES = 10 * 1024 * 1024
MAX_CONCURRENT = 2
QUEUE_WAIT_S = 15.0
INSTALL_HINT = "tectonic is not installed. Install it with: brew install tectonic"

_slots = threading.BoundedSemaphore(MAX_CONCURRENT)


class CompileError(Exception):
    def __init__(self, log: str):
        super().__init__(log)
        self.log = log


class CompilerBusy(Exception):
    """MAX_CONCURRENT compiles are already running and none finished within QUEUE_WAIT_S."""


def _truncate(log: str) -> str:
    # Tectonic reports errors near the end of its output, so keep the tail.
    if len(log) <= MAX_LOG:
        return log
    return "[... log truncated ...]\n" + log[-MAX_LOG:]


def _tail(f: IO[bytes]) -> str:
    """The last MAX_OUTPUT_BYTES written to `f`, decoded."""
    f.flush()
    f.seek(0, 2)
    size = f.tell()
    f.seek(max(0, size - MAX_OUTPUT_BYTES))
    return f.read(MAX_OUTPUT_BYTES).decode("utf-8", "replace")


def compile_pdf(tex: str) -> bytes:
    if not _slots.acquire(timeout=QUEUE_WAIT_S):
        raise CompilerBusy()
    try:
        return _compile(tex)
    finally:
        _slots.release()


def _compile(tex: str) -> bytes:
    with tempfile.TemporaryDirectory(prefix="resumaker-tex-") as d, tempfile.TemporaryFile() as out:
        (Path(d) / "main.tex").write_text(tex, encoding="utf-8")
        # --untrusted turns off shell-escape (\write18), the one insecure feature Tectonic
        # gates; the source may be hand-edited. It does not sandbox file reads: \input can still
        # read files this user can read, which is acceptable for a local, single-user app whose
        # API refuses cross-site requests.
        cmd = ["tectonic", "--untrusted", "--outdir", d, "main.tex"]
        try:
            proc = subprocess.run(
                cmd, cwd=d, stdout=out, stderr=subprocess.STDOUT,
                stdin=subprocess.DEVNULL, timeout=TIMEOUT_S, check=False)
        except FileNotFoundError:
            raise CompileError(INSTALL_HINT) from None
        except subprocess.TimeoutExpired:
            raise CompileError(_truncate(
                f"Compilation timed out after {TIMEOUT_S}s.\n{_tail(out)}")) from None
        log = _tail(out)
        pdf = Path(d) / "main.pdf"
        if proc.returncode != 0:
            raise CompileError(_truncate(log or f"tectonic exited with {proc.returncode}"))
        if not pdf.is_file():
            raise CompileError(_truncate(log or "tectonic produced no PDF"))
        if pdf.stat().st_size > MAX_PDF_BYTES:
            raise CompileError(
                f"The PDF is larger than {MAX_PDF_BYTES // (1024 * 1024)} MB, so it was not loaded. "
                "Check the source for very large images or runaway loops.")
        return pdf.read_bytes()
