"""Base SQLite 100 % locale (fichier backend/data/astro.db)."""
import os, sqlite3, time
from contextlib import contextmanager

DATA_DIR = os.environ.get("ASTRO_DATA_DIR") or os.path.join(os.path.dirname(os.path.abspath(__file__)), "..", "data")
DB_PATH = os.path.join(DATA_DIR, "astro.db")
KEEP_DAYS = int(os.environ.get("ASTRO_KEEP_DAYS", "30"))

@contextmanager
def conn():
    os.makedirs(DATA_DIR, exist_ok=True)
    c = sqlite3.connect(DB_PATH, timeout=10)
    c.row_factory = sqlite3.Row
    try:
        yield c
        c.commit()
    finally:
        c.close()

def init():
    with conn() as c:
        c.execute("PRAGMA journal_mode=WAL")
        c.executescript("""
        CREATE TABLE IF NOT EXISTS users(
            id TEXT PRIMARY KEY, name TEXT NOT NULL, age INTEGER NOT NULL,
            mission TEXT NOT NULL DEFAULT '', mission_key TEXT NOT NULL DEFAULT '',
            role TEXT NOT NULL, pass_hash TEXT NOT NULL, created REAL NOT NULL);
        CREATE TABLE IF NOT EXISTS measurements(
            id INTEGER PRIMARY KEY AUTOINCREMENT, owner TEXT NOT NULL, kind TEXT NOT NULL,
            ts REAL NOT NULL, blob BLOB NOT NULL);
        CREATE INDEX IF NOT EXISTS ix_meas ON measurements(owner, kind, ts);
        CREATE TABLE IF NOT EXISTS alerts(
            id INTEGER PRIMARY KEY AUTOINCREMENT, ts REAL NOT NULL, owner TEXT NOT NULL,
            mission_key TEXT NOT NULL, blob BLOB NOT NULL);
        CREATE INDEX IF NOT EXISTS ix_alerts ON alerts(mission_key, ts);
        CREATE TABLE IF NOT EXISTS audit(
            id INTEGER PRIMARY KEY AUTOINCREMENT, ts REAL NOT NULL, actor TEXT NOT NULL,
            action TEXT NOT NULL, target TEXT NOT NULL);
        """)
        c.execute("DELETE FROM measurements WHERE ts < ?", (time.time() - KEEP_DAYS * 86400,))
        c.execute("DELETE FROM alerts WHERE ts < ?", (time.time() - 90 * 86400,))

def recent(owner, kind, n):
    with conn() as c:
        return c.execute("SELECT ts, blob FROM measurements WHERE owner=? AND kind=? ORDER BY ts DESC LIMIT ?",
                         (owner, kind, n)).fetchall()

def list_astronauts(mission_key=None):
    with conn() as c:
        if mission_key is None:
            return c.execute("SELECT * FROM users WHERE role='astronaut' ORDER BY id").fetchall()
        return c.execute("SELECT * FROM users WHERE role='astronaut' AND mission_key=? ORDER BY id", (mission_key,)).fetchall()
