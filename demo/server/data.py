"""Fictional sales data. Queries are a bounded JSON vocabulary, never SQL."""
import json
import math
import time
from datetime import date
from collections import defaultdict
from copy import deepcopy
from uuid import uuid4

METRICS = {"revenue", "orders", "tickets", "satisfaction"}
GROUPS = {"date", "month", "channel", "region", "country", "product", "none"}
KINDS = {"bar", "area", "line", "hbar", "donut", "map", "kpi", "table"}
from pathlib import Path

ROWS = json.loads((Path(__file__).resolve().parents[1] / 'data' / 'sales.json').read_text())


def query_spec(metric="revenue", group="month", series=None, period=None):
    return json.dumps(dict(metric=metric, group=group, **({"series":series} if series else {}), **({"period":period} if period else {})), separators=(",", ":"))


def chart(title, kind="bar", metric="revenue", group="month", id=None, series=None):
    if kind == "map": group, series = "country", None
    mapping = dict(region="label",value="value",scope="world") if kind == "map" else dict(x="label",y="value",label="label",value="value",**({"series":"series"} if series else {}))
    if kind == "area": mapping["stacked"] = False
    if group in {"month","date"}: mapping["timeUnit"] = "month" if group == "month" else "day"
    return dict(id=id or str(uuid4()), title=title, prompt=title, kind=kind,
                query=query_spec(metric,group,series), mapping=mapping,
                status="ready", createdAt=int(time.time()*1000), updatedAt=int(time.time()*1000), version=1)


class DemoData:
    def validate_query(self, scope, query):
        try:
            if not isinstance(query, str) or len(query)>500: raise ValueError()
            q=json.loads(query)
            if not isinstance(q,dict) or not {"metric","group"} <= set(q) <= {"metric","group","series","period"}: raise ValueError()
            if not isinstance(q["metric"], str) or not isinstance(q["group"], str): raise ValueError()
            if q["metric"] not in METRICS or q["group"] not in GROUPS: raise ValueError()
            if "series" in q and (not isinstance(q["series"], str) or q["series"] not in GROUPS-{"none",q["group"]} or q["group"]=="none"): raise ValueError()
            if "period" in q:
                p = q["period"]
                if not isinstance(p,dict) or set(p)!={"from","to"} or any(type(p[k]) is not int for k in p) or not 0 <= p["from"] < p["to"] <= 100000: raise ValueError()
            return q
        except (ValueError,TypeError):
            raise ValueError("Choose a supported measure and grouping.") from None

    def execute(self, scope, q):
        buckets=defaultdict(list)
        for row in ROWS:
            day = (date.fromisoformat(row["date"]) - date(1970,1,1)).days
            if q.get("period") and not q["period"]["from"] <= day < q["period"]["to"]: continue
            key=(row[q["group"]] if q["group"]!="none" else "Total", row[q["series"]] if q.get("series") else "")
            buckets[key].append(row[q["metric"]])
        return [dict(label=label,**({"series":series} if series else {}),value=round(sum(v)/len(v) if q["metric"]=="satisfaction" else sum(v),2)) for (label,series),v in sorted(buckets.items())]

    def validate_chart(self, scope, raw):
        def text(v,limit,required=True):
            if not isinstance(v,str) or len(v)>limit or (required and not v.strip()): raise ValueError("Invalid chart text.")
            return v
        def revision(r):
            if not isinstance(r,dict): raise ValueError("Invalid chart version.")
            kind=r.get("kind")
            if not isinstance(kind, str) or kind not in KINDS: raise ValueError("Unsupported chart type for this demo.")
            query = self.validate_query(scope,r.get("query"))
            mapping=r.get("mapping")
            if not isinstance(mapping, dict): raise ValueError("Invalid chart fields.")
            for key, value in mapping.items():
                if key == "scope": valid = value == "world"
                elif key == "stacked": valid = type(value) is bool
                elif key == "timeUnit": valid = isinstance(value, str) and value in {"day", "week", "month"}
                else: valid = key in {"x", "y", "label", "value", "series", "region"} and isinstance(value, str) and value in {"label", "value", "series"}
                if not valid: raise ValueError("Invalid chart fields.")
            mapping = dict(mapping)
            if "timeUnit" not in mapping and kind in {"bar", "area", "line"} and query["group"] == "month": mapping["timeUnit"] = "month"
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
                 chart("Customer satisfaction", "kpi", "satisfaction", "none", "satisfaction"),chart("Revenue by channel over time","area",group="date",id="trend",series="channel"),
                 chart("Revenue by channel","donut","revenue","channel","channels"),
                 chart("Revenue by region","hbar","revenue","region","regions"),chart("Revenue by country","map","revenue","country","countries")]
        sizes=[(0,0,4,4),(4,0,4,4),(8,0,4,4),(0,4,8,8),(8,4,4,8),(0,12,6,10),(6,12,6,10)]
        return dict(v=2,name="Sales overview",widgets=widgets,layouts=[dict(i=w["id"],x=x,y=y,w=width,h=h) for w,(x,y,width,h) in zip(widgets,sizes)],locked=False,updatedAt=1)

    def ai_metadata(self, scope, current):
        return dict(measures=sorted(METRICS),groups=sorted(GROUPS),chart_types=sorted(KINDS),
                    current=self.validate_chart(scope,current) if current else None,
                    note="Fictional sales dataset. Revenue is in USD. Use date with series channel for detailed trends, month for monthly totals; country for maps. Only choose the supplied measures and groupings.")
