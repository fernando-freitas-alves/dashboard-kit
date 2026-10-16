"""Backend orchestration with explicit host authorization and data adapters.

`authorize(scope, action)` must raise on denied access. Query validation/execution,
metadata projection, chart validation and default boards belong to `data`.
"""

from .documents import validate_board


class DashboardService:
    def __init__(self, repository, data, authorize, composer=None):
        self.repository = repository
        self.data = data
        self.authorize = authorize
        self.composer = composer

    def validate(self, scope, definition):
        return validate_board(
            definition, lambda chart: self.data.validate_chart(scope, chart)
        )

    def workspace(self, scope):
        self.authorize(scope, "read")
        rows = self.repository.list(scope)
        return dict(
            boards=[r for r in rows if not r["archived"]],
            archived=[r for r in rows if r["archived"]],
            default=self.validate(scope, self.data.default_board(scope)),
            preferences=self.repository.preferences(scope),
            ai=self.composer is not None,
        )

    def create(self, scope, definition):
        self.authorize(scope, "write")
        return self.repository.create(scope, self.validate(scope, definition))

    def save(self, scope, id, definition, revision):
        self.authorize(scope, "write")
        return self.repository.save(
            scope, id, self.validate(scope, definition), revision
        )

    def archive(self, scope, id, revision, archived):
        self.authorize(scope, "write")
        if type(archived) is not bool:
            raise ValueError("archived must be boolean")
        return self.repository.archive(scope, id, revision, archived)

    def preferences(self, scope, value):
        self.authorize(scope, "write")
        ids = {r["id"] for r in self.repository.list(scope) if not r["archived"]}
        if (
            not isinstance(value, dict)
            or not isinstance(value.get("order"), list)
            or any(not isinstance(i, str) for i in value["order"])
        ):
            raise ValueError("Invalid board order")
        if (
            set(value["order"]) != ids
            or len(value["order"]) != len(ids)
            or value.get("active") not in ids
        ):
            raise ValueError("Invalid board order")
        self.repository.save_preferences(scope, value)

    def query(self, scope, query):
        self.authorize(scope, "read")
        return self.data.execute(scope, self.data.validate_query(scope, query))

    def compose(self, scope, prompt, current=None):
        self.authorize(scope, "compose")
        if not isinstance(prompt, str) or not prompt.strip() or len(prompt) > 2000:
            raise ValueError("Describe a chart in up to 2000 characters.")
        if not self.composer:
            raise ValueError("AI is not configured")
        metadata = self.data.ai_metadata(scope, current)
        return self.data.validate_chart(scope, self.composer(prompt, metadata))
