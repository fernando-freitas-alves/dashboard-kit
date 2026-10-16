"""Fictional sales data. Queries are a bounded JSON vocabulary, never SQL."""
import json
import math
import time
from collections import defaultdict
from copy import deepcopy
from uuid import uuid4

METRICS = {"revenue", "orders", "tickets", "satisfaction"}
GROUPS = {"month", "channel", "region", "product", "none"}
KINDS = {"bar", "area", "line", "hbar", "donut", "kpi", "table"}
from pathlib import Path

ROWS = json.loads((Path(__file__).resolve().parents[1] / 'data' / 'sales.json').read_text())


def query_spec(metric="revenue", group="month"):
    return json.dumps(dict(metric=metric, group=group), separators=(",", ":"))


def chart(title, kind="bar", metric="revenue", group="month", id=None):
    return dict(id=id or str(uuid4()), title=title, prompt=title, kind=kind,
                query=query_spec(metric,group), mapping=dict(x="label", y="value", label="label", value="value"),
                status="ready", createdAt=int(time.time()*1000), updatedAt=int(time.time()*1000), version=1)


class DemoData:
    def validate_query(self, scope, query):
        try:
            if not isinstance(query, str) or len(query)>500: raise ValueError()
            q=json.loads(query)
            if not isinstance(q,dict) or set(q)!={"metric","group"}: raise ValueError()
            if not isinstance(q["metric"], str) or not isinstance(q["group"], str): raise ValueError()
            if q["metric"] not in METRICS or q["group"] not in GROUPS: raise ValueError()
            return q
        except (ValueError,TypeError):
            raise ValueError("Choose a supported measure and grouping.") from None

    def execute(self, scope, q):
        buckets=defaultdict(list)
        for row in ROWS: buckets[row[q["group"]] if q["group"]!="none" else "Total"].append(row[q["metric"]])
        return [dict(label=k,value=round(sum(v)/len(v) if q["metric"]=="satisfaction" else sum(v),2)) for k,v in sorted(buckets.items())]

    def validate_chart(self, scope, raw):
        def text(v,limit,required=True):
            if not isinstance(v,str) or len(v)>limit or (required and not v.strip()): raise ValueError("Invalid chart text.")
            return v
        def revision(r):
            if not isinstance(r,dict): raise ValueError("Invalid chart version.")
            kind=r.get("kind")
            if not isinstance(kind, str) or kind not in KINDS: raise ValueError("Unsupported chart type for this demo.")
            self.validate_query(scope,r.get("query"))
            mapping=r.get("mapping")
            if not isinstance(mapping,dict) or any(k not in {"x","y","label","value"} or not isinstance(v,str) or v not in {"label","value"} for k,v in mapping.items()): raise ValueError("Invalid chart fields.")
            for k in ("updatedAt","version"):
                v=r.get(k,1)
                if type(v) not in (int,float) or not math.isfinite(v) or v<0: raise ValueError("Invalid chart version.")
            return dict(title=text(r.get("title"),160),prompt=text(r.get("prompt",""),2000,False),kind=kind,
                        query=r["query"],mapping=mapping,updatedAt=r.get("updatedAt",1),version=r.get("version",1))
        if not isinstance(raw,dict): raise ValueError("Invalid chart.")
        created=raw.get("createdAt",1)
        if type(created) not in (int,float) or not math.isfinite(created) or created<0: raise ValueError("Invalid chart timestamp.")
        if raw.get("status")=="draft":
            if raw.get("query", "") or raw.get("mapping", {}) or raw.get("history") or raw.get("previous"):
                raise ValueError("A draft cannot contain a query or previous results.")
            return dict(id=text(raw.get("id"),100),title=text(raw.get("title"),160),
                        prompt=text(raw.get("prompt",""),2000,False),query="",mapping={},kind="bar",
                        status="draft",createdAt=created,updatedAt=created)
        result=dict(id=text(raw.get("id"),100),**revision(raw),status="ready",createdAt=raw.get("createdAt",1))
        history=raw.get("history",[])
        if not isinstance(history,list) or len(history)>20: raise ValueError("Invalid chart history.")
        if history: result["history"]=[revision(r) for r in history]
        if raw.get("previous"): result["previous"]=revision(raw["previous"])
        return result

    def default_board(self, scope):
        widgets=[chart("Revenue", "kpi", "revenue", "none", "revenue"),chart("Orders", "kpi", "orders", "none", "orders"),
                 chart("Customer satisfaction", "kpi", "satisfaction", "none", "satisfaction"),chart("Revenue over time","bar",id="trend"),
                 chart("Revenue by channel","donut","revenue","channel","channels")]
        sizes=[(0,0,4,4),(4,0,4,4),(8,0,4,4),(0,4,8,8),(8,4,4,8)]
        return dict(v=2,name="Sales overview",widgets=widgets,layouts=[dict(i=w["id"],x=x,y=y,w=width,h=h) for w,(x,y,width,h) in zip(widgets,sizes)],locked=False,updatedAt=1)

    def ai_metadata(self, scope, current):
        return dict(measures=sorted(METRICS),groups=sorted(GROUPS),chart_types=sorted(KINDS),
                    current=self.validate_chart(scope,current) if current else None,
                    note="Fictional sales dataset. Only choose the supplied measures and groupings.")
