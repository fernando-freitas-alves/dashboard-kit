import pytest
import sqlite3
from loadsmart_dashboard_kit import validate_board
from loadsmart_dashboard_kit.repository import SQLiteBoardRepository, Scope, Conflict
from loadsmart_dashboard_kit.service import DashboardService


def test_repository_closes_connections_after_transaction(tmp_path):
    repository = SQLiteBoardRepository(tmp_path / "connections.sqlite")
    with repository.connect() as connection:
        assert connection.execute("SELECT 1").fetchone()[0] == 1
    with pytest.raises(sqlite3.ProgrammingError, match="closed"):
        connection.execute("SELECT 1")


def board():
    return dict(v=2, name="Revenue", widgets=[], layouts=[], locked=False, updatedAt=0)


class Data:
    def validate_chart(self, scope, chart):
        return chart

    def default_board(self, scope):
        return board()

    def validate_query(self, scope, query):
        if query != {"metric": "revenue"}:
            raise ValueError("Unknown metric")
        return query

    def execute(self, scope, query):
        return [{"value": 100}]

    def ai_metadata(self, scope, current):
        return {"fields": ["revenue"]}


@pytest.fixture
def service(tmp_path):
    return DashboardService(
        SQLiteBoardRepository(tmp_path / "boards.sqlite"),
        Data(),
        lambda scope, action: None,
    )


def test_non_forms_backend_complete_lifecycle(service):
    scope = Scope("sales", "2026", "alice")
    r = service.create(scope, board())
    assert service.workspace(scope)["boards"][0]["id"] == r["id"]
    service.preferences(scope, {"order": [r["id"]], "active": r["id"]})
    assert service.workspace(scope)["preferences"]["active"] == r["id"]
    assert service.save(scope, r["id"], board(), 1)["revision"] == 2
    assert service.archive(scope, r["id"], 2, True)["revision"] == 3
    assert len(service.workspace(scope)["archived"]) == 1
    assert service.archive(scope, r["id"], 3, False)["revision"] == 4
    assert service.query(scope, {"metric": "revenue"}) == [{"value": 100}]


@pytest.mark.parametrize(
    "other",
    [
        Scope("other", "2026", "alice"),
        Scope("sales", "2025", "alice"),
        Scope("sales", "2026", "bob"),
    ],
)
def test_scope_isolation(service, other):
    scope = Scope("sales", "2026", "alice")
    r = service.create(scope, board())
    assert service.workspace(other)["boards"] == []
    with pytest.raises(Conflict):
        service.save(other, r["id"], board(), 1)


def test_conflict_cannot_overwrite(service):
    s = Scope("sales", "1", "alice")
    r = service.create(s, board())
    service.save(s, r["id"], board(), 1)
    with pytest.raises(Conflict):
        service.save(s, r["id"], board(), 1)


@pytest.mark.parametrize(
    "method,args",
    [
        ("workspace", ()),
        ("create", (board(),)),
        ("save", ("id", board(), 1)),
        ("query", ({"metric": "revenue"},)),
        ("compose", ("show revenue",)),
        ("archive", ("id", 1, True)),
        ("preferences", ({"order": [], "active": ""},)),
    ],
)
def test_authorization_is_checked_for_every_operation(service, method, args):
    def deny(scope, action):
        raise PermissionError("Denied")

    service.authorize = deny
    with pytest.raises(PermissionError):
        getattr(service, method)(Scope("sales", "1", "bob"), *args)


@pytest.mark.parametrize(
    "change",
    [
        {"v": 1},
        {"name": ""},
        {"widgets": {}},
        {"layouts": [{}]},
        {"locked": "yes"},
        {"updatedAt": float("nan")},
    ],
)
def test_board_shape_rejected(change):
    with pytest.raises(ValueError):
        validate_board({**board(), **change}, lambda x: x)


@pytest.fixture
def http(service):
    from flask import Flask
    from loadsmart_dashboard_kit.flask import blueprint

    app = Flask(__name__)
    app.register_blueprint(
        blueprint(service, lambda: Scope("sales", "1", "alice")),
        url_prefix="/api/boards",
    )
    return app.test_client()


def test_http_workspace_create_save_archive_restore(http):
    assert http.get("/api/boards/workspace").json["boards"] == []
    created = http.post("/api/boards/boards", json={"definition": board()}).json
    base = "/api/boards/boards/" + created["id"]
    assert (
        http.put(base, json={"definition": board(), "revision": 1}).json["revision"]
        == 2
    )
    assert (
        http.put(base, json={"definition": board(), "revision": 1}).status_code == 409
    )
    assert (
        http.post(base + "/archive", json={"revision": 2, "archived": True}).json[
            "revision"
        ]
        == 3
    )
    assert len(http.get("/api/boards/workspace").json["archived"]) == 1
    assert (
        http.post(
            base + "/archive", json={"revision": 3, "archived": False}
        ).status_code
        == 200
    )
    assert http.post("/api/boards/query", json={"query": {"metric": "revenue"}}).json[
        "rows"
    ] == [{"value": 100}]


@pytest.mark.parametrize(
    "path,body",
    [
        ("/boards", {}),
        ("/boards", []),
        ("/query", {}),
        ("/compose", {}),
        ("/boards/a/archive", {"revision": 1}),
        ("/import", {}),
    ],
)
def test_http_malformed_request_is_actionable(http, path, body):
    result = http.post("/api/boards" + path, json=body)
    assert result.status_code == 422 and "error" in result.json


def test_http_permission_is_not_server_error(http, service):
    service.authorize = lambda s, a: (_ for _ in ()).throw(
        PermissionError("private details")
    )
    response = http.get("/api/boards/workspace")
    assert response.status_code == 403 and "private" not in response.text


@pytest.mark.parametrize("revision", [None, True, "1", 0, -1])
def test_revision_must_be_positive_integer(service, revision):
    s = Scope("sales", "1", "alice")
    r = service.create(s, board())
    with pytest.raises(ValueError):
        service.save(s, r["id"], board(), revision)


def test_documented_sales_example_runs_without_forms(tmp_path):
    import importlib.util
    from pathlib import Path
    from types import SimpleNamespace
    from flask import Flask

    spec = importlib.util.spec_from_file_location(
        "sales_example", Path(__file__).parents[1] / "examples/sales_backend.py"
    )
    module = importlib.util.module_from_spec(spec)
    spec.loader.exec_module(module)
    app = Flask(__name__)
    calls = []
    module.register_sales_dashboard(
        app,
        tmp_path / "example.sqlite",
        lambda: SimpleNamespace(id="sales-reader"),
        lambda scope, action: calls.append((scope.principal, action)),
        lambda principal, dataset: [{"value": 1250}],
    )
    http = app.test_client()
    base = "/api/sales/1/dashboards"
    definition = http.get(base + "/workspace").json["default"]
    assert definition["widgets"][0]["title"] == "Revenue"
    assert (
        http.post(base + "/boards", json={"definition": definition}).status_code == 200
    )
    assert http.post(base + "/query", json={"query": {"metric": "revenue"}}).json == {
        "rows": [{"value": 1250}]
    }
    assert (
        http.post(base + "/query", json={"query": {"metric": "private"}}).status_code
        == 422
    )
    assert calls == [
        ("sales-reader", "read"),
        ("sales-reader", "write"),
        ("sales-reader", "read"),
        ("sales-reader", "read"),
    ]
