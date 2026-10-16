"""Integration example: inject host authentication; no Forms dependencies."""

import json
from flask import Flask
from loadsmart_dashboard_kit.repository import Scope, SQLiteBoardRepository
from loadsmart_dashboard_kit.service import DashboardService
from loadsmart_dashboard_kit.flask import blueprint


class SalesData:
    def __init__(self, load_authorized_totals):
        self.load_authorized_totals = load_authorized_totals

    def validate_query(self, scope, query):
        value = json.loads(query) if isinstance(query, str) else query
        if value != {"metric": "revenue"}:
            raise ValueError("Choose the revenue measure.")
        return value

    def execute(self, scope, query):
        return self.load_authorized_totals(scope.principal, scope.dataset)

    def validate_chart(self, scope, chart):
        if not isinstance(chart, dict) or chart.get("kind") != "kpi":
            raise ValueError("This data source supports revenue KPI cards.")
        if not isinstance(chart.get("id"), str) or not chart["id"]:
            raise ValueError("Chart ID required.")
        self.validate_query(scope, chart.get("query"))
        return {
            "id": chart["id"],
            "kind": "kpi",
            "title": "Revenue",
            "prompt": "Revenue",
            "status": "ready",
            "query": '{"metric":"revenue"}',
            "mapping": {"value": "value"},
        }

    def default_board(self, scope):
        return {
            "v": 2,
            "name": "Sales",
            "widgets": [
                self.validate_chart(
                    scope,
                    {"id": "revenue", "kind": "kpi", "query": '{"metric":"revenue"}'},
                )
            ],
            "layouts": [{"i": "revenue", "x": 0, "y": 0, "w": 4, "h": 4}],
            "locked": True,
        }

    def ai_metadata(self, scope, current):
        return {"measures": ["revenue"], "chart_types": ["kpi"]}


def register_sales_dashboard(
    app: Flask, database, authenticated_user, authorize, load_authorized_totals
):
    """Call after registering the host's authentication and CSRF middleware."""
    service = DashboardService(
        SQLiteBoardRepository(database), SalesData(load_authorized_totals), authorize
    )

    def scope():
        user = authenticated_user()  # Must reject unauthenticated requests.
        return Scope("sales", "1", user.id)

    app.register_blueprint(
        blueprint(service, scope), url_prefix="/api/sales/1/dashboards"
    )
    return service
