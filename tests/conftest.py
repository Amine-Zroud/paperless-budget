"""Test environment: a throw-away database and a generated Enable Banking key, set up before the app is imported."""
import os
import tempfile
from pathlib import Path

TMP = Path(tempfile.mkdtemp(prefix="paperless-budget-test-"))
os.environ.setdefault("DB_PATH", str(TMP / "budget.db"))
os.environ.setdefault("FILES_DIR", str(TMP / "files"))
os.environ.setdefault("PAPERLESS_URL", "http://127.0.0.1:9")          # never reached in tests
os.environ.setdefault("PAPERLESS_TOKEN", "test")
os.environ.setdefault("CURRENCY", "EUR")

from cryptography.hazmat.primitives import serialization          # noqa: E402
from cryptography.hazmat.primitives.asymmetric import rsa          # noqa: E402

_key = rsa.generate_private_key(public_exponent=65537, key_size=2048)
KEY_PEM = _key.private_bytes(serialization.Encoding.PEM, serialization.PrivateFormat.PKCS8, serialization.NoEncryption()).decode()
PUBLIC_KEY = _key.public_key()
(TMP / "enablebanking.pem").write_text(KEY_PEM)
os.environ.setdefault("ENABLEBANKING_APP_ID", "test-app-id")
os.environ.setdefault("ENABLEBANKING_KEY_FILE", str(TMP / "enablebanking.pem"))
