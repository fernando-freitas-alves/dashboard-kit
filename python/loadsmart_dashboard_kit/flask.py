"""Optional Flask transport. scope_resolver authenticates every request;
register only behind the host's authentication and CSRF middleware.
"""

from .repository import Conflict


def blueprint(service, scope_resolver, name="dashboards"):
    from flask import Blueprint, request, jsonify

    bp = Blueprint(name, __name__)

    def payload(*required):
        value = request.get_json(silent=True)
        if not isinstance(value, dict) or any(k not in value for k in required):
            raise ValueError("Missing or invalid request fields")
        return value

    @bp.errorhandler(PermissionError)
    def forbidden(e):
        return jsonify(error="Access denied"), 403

    @bp.errorhandler(Conflict)
    def conflict(e):
        return jsonify(error=str(e)), 409

    @bp.errorhandler(ValueError)
    def invalid(e):
        return jsonify(error=str(e)), 422

    @bp.get("/workspace")
    def workspace():
        return jsonify(service.workspace(scope_resolver()))

    @bp.post("/boards")
    def create():
        return jsonify(
            service.create(scope_resolver(), payload("definition")["definition"])
        )

    @bp.put("/boards/<id>")
    def save(id):
        body = payload("definition", "revision")
        return jsonify(
            service.save(scope_resolver(), id, body["definition"], body["revision"])
        )

    @bp.post("/boards/<id>/archive")
    def archive(id):
        body = payload("revision", "archived")
        return jsonify(
            service.archive(scope_resolver(), id, body["revision"], body["archived"])
        )

    @bp.put("/preferences")
    def preferences():
        service.preferences(scope_resolver(), payload())
        return jsonify(ok=True)

    @bp.post("/query")
    def query():
        return jsonify(rows=service.query(scope_resolver(), payload("query")["query"]))

    @bp.post("/compose")
    def compose():
        body = payload("prompt")
        return jsonify(
            widget=service.compose(
                scope_resolver(), body.get("prompt"), body.get("current")
            )
        )

    @bp.post("/import")
    def import_board():
        scope = scope_resolver()
        service.authorize(scope, "read")
        return jsonify(
            definition=service.validate(scope, payload("definition")["definition"])
        )

    return bp
