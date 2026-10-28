"""Keep the data directory and the files in it private to the user.

~/.resumaker holds the database (the whole Record) and keys.json, so it is created 0700 and the
database 0600. Our own default directory (and a default-location database) is also tightened
if it already exists, as earlier versions created it at the default umask. A directory or
database file the user pointed RESUMAKER_DB / RESUMAKER_HOME at is left alone unless we
created it.
"""

import os
from pathlib import Path


def default_dir() -> Path:
    return Path.home() / ".resumaker"


def _ours(path: Path) -> bool:
    getuid = getattr(os, "getuid", None)
    return getuid is None or path.stat().st_uid == getuid()


def _is_default(path: Path) -> bool:
    try:
        return path.resolve() == default_dir().resolve()
    except OSError:
        return False


def private_dir(path: Path) -> None:
    """Create `path` with mode 0700 if missing (parents too); tighten our default directory."""
    path = Path(path)
    if not path.exists():
        path.mkdir(parents=True, mode=0o700, exist_ok=True)
        os.chmod(path, 0o700)  # mkdir's mode is masked by the umask
    elif _is_default(path) and _ours(path):
        os.chmod(path, 0o700)


def private_file(path: Path) -> None:
    """Create `path` empty with mode 0600 if missing; tighten it if it is in our default directory."""
    path = Path(path)
    private_dir(path.parent)
    try:
        os.close(os.open(path, os.O_WRONLY | os.O_CREAT | os.O_EXCL, 0o600))
        os.chmod(path, 0o600)
    except FileExistsError:
        if _is_default(path.parent) and _ours(path):
            os.chmod(path, 0o600)
