"""Reference persistence with scope isolation and optimistic concurrency."""

import json
import sqlite3
from contextlib import contextmanager
from dataclasses import dataclass
from uuid import uuid4


@dataclass(frozen=True)
class Scope:
    dataset: str
    version: str
    principal: str

    @property
    def key(self):
        return json.dumps(
            [self.dataset, self.version, self.principal], separators=(",", ":")
        )


class Conflict(ValueError):
    pass


class SQLiteBoardRepository:
    def __init__(self, path):
        self.path = path
        with self.connect() as db:
            db.executescript("""CREATE TABLE IF NOT EXISTS dashboard_boards(scope TEXT NOT NULL,id TEXT NOT NULL,document TEXT NOT NULL,revision INTEGER NOT NULL,archived INTEGER NOT NULL DEFAULT 0,PRIMARY KEY(scope,id));
            CREATE TABLE IF NOT EXISTS dashboard_preferences(scope TEXT PRIMARY KEY,document TEXT NOT NULL);""")

    @contextmanager
    def connect(self):
        db = sqlite3.connect(self.path)
        db.row_factory = sqlite3.Row
        try:
            with db:
                yield db
        finally:
            db.close()

    def list(self, scope):
        with self.connect() as db:
            rows = db.execute(
                "SELECT * FROM dashboard_boards WHERE scope=? ORDER BY rowid",
                (scope.key,),
            ).fetchall()
        return [
            dict(
                id=r["id"],
                definition=json.loads(r["document"]),
                revision=r["revision"],
                archived=bool(r["archived"]),
            )
            for r in rows
        ]

    def create(self, scope, definition):
        id = str(uuid4())
        with self.connect() as db:
            db.execute(
                "INSERT INTO dashboard_boards(scope,id,document,revision) VALUES(?,?,?,1)",
                (scope.key, id, json.dumps(definition)),
            )
        return dict(id=id, definition=definition, revision=1)

    def save(self, scope, id, definition, revision):
        if type(revision) is not int or revision < 1:
            raise ValueError("Invalid revision")
        with self.connect() as db:
            changed = db.execute(
                "UPDATE dashboard_boards SET document=?,revision=revision+1 WHERE scope=? AND id=? AND revision=?",
                (json.dumps(definition), scope.key, id, revision),
            ).rowcount
            if not changed:
                raise Conflict("Board changed or unavailable. Reload before saving.")
        return {"revision": revision + 1}

    def archive(self, scope, id, revision, archived):
        if type(revision) is not int or revision < 1:
            raise ValueError("Invalid revision")
        with self.connect() as db:
            changed = db.execute(
                "UPDATE dashboard_boards SET archived=?,revision=revision+1 WHERE scope=? AND id=? AND revision=?",
                (int(archived), scope.key, id, revision),
            ).rowcount
            if not changed:
                raise Conflict("Board changed or unavailable. Reload before saving.")
        return {"revision": revision + 1}

    def preferences(self, scope):
        with self.connect() as db:
            r = db.execute(
                "SELECT document FROM dashboard_preferences WHERE scope=?", (scope.key,)
            ).fetchone()
        return json.loads(r["document"]) if r else {}

    def save_preferences(self, scope, value):
        with self.connect() as db:
            db.execute(
                "INSERT INTO dashboard_preferences VALUES(?,?) ON CONFLICT(scope) DO UPDATE SET document=excluded.document",
                (scope.key, json.dumps(value)),
            )
