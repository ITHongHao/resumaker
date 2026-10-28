import json
import os
from pathlib import Path
from typing import Protocol

from app.datadir import private_dir


def home_dir() -> Path:
    return Path(os.environ.get("RESUMAKER_HOME") or Path.home() / ".resumaker")


class KeyStore(Protocol):
    def get(self, provider: str) -> str | None: ...

    def set(self, provider: str, key: str) -> None: ...


class FileKeyStore:
    """API keys in a JSON file created with mode 0600 (owner read/write only)."""

    def __init__(self, path: Path):
        self.path = Path(path)

    def _load(self) -> dict[str, str]:
        try:
            return json.loads(self.path.read_text())
        except FileNotFoundError:
            return {}

    def get(self, provider: str) -> str | None:
        return self._load().get(provider)

    def set(self, provider: str, key: str) -> None:
        data = self._load()
        data[provider] = key
        private_dir(self.path.parent)
        tmp = self.path.with_name(self.path.name + ".tmp")
        fd = os.open(tmp, os.O_WRONLY | os.O_CREAT | os.O_TRUNC, 0o600)
        with os.fdopen(fd, "w") as f:
            f.write(json.dumps(data))
        os.chmod(tmp, 0o600)
        os.replace(tmp, self.path)


def get_keystore() -> KeyStore:
    return FileKeyStore(home_dir() / "keys.json")
