import json
import pytest
from app import create_app
from data import DemoData, chart, query_spec
from loadsmart_dashboard_kit.repository import Scope

@pytest.fixture
def app(tmp_path,monkeypatch):
    monkeypatch.delenv('OPENAI_API_KEY',raising=False)
    return create_app(tmp_path/'boards.sqlite',secret='test-only',composer=None)

@pytest.fixture
def client(app):return app.test_client()

def headers(client):return {'X-Dashboard-CSRF':client.get('/api/session').json['csrf']}

def test_manual_demo_and_persistence(app,client):
    h=headers(client)
    workspace=client.get('/api/dashboards/workspace').json
    assert workspace['ai'] is False
    definition=workspace['default']
    created=client.post('/api/dashboards/boards',json={'definition':definition},headers=h).json
    definition['name']='My own board';definition['layouts'][0]['w']=6
    url='/api/dashboards/boards/'+created['id']
    assert client.put(url,json={'definition':definition,'revision':1},headers=h).json['revision']==2
    assert client.put(url,json={'definition':definition,'revision':1},headers=h).status_code==409
    saved=app.extensions['dashboard_service'].workspace(Scope('sample-sales','1','local-demo'))['boards'][0]
    assert saved['definition']['name']=='My own board'
    assert saved['definition']['layouts'][0]['w']==6
    assert client.post(url+'/archive',json={'revision':2,'archived':True},headers=h).status_code==200
    assert len(client.get('/api/dashboards/workspace').json['archived'])==1
    assert client.post(url+'/archive',json={'revision':3,'archived':False},headers=h).status_code==200

def test_csrf_origin_and_dns_rebinding(client):
    h=headers(client)
    path='/api/dashboards/query';body={'query':query_spec()}
    assert client.post(path,json=body).status_code==403
    assert client.post(path,json=body,headers={**h,'Origin':'https://attacker.invalid'}).status_code==403
    assert client.get('/api/session',headers={'Host':'attacker.invalid'}).status_code==403
    assert client.get('/api/session',headers={'Sec-Fetch-Site':'cross-site'}).status_code==403
    assert client.post(path,json=body,headers=h).status_code==200

@pytest.mark.parametrize('query',['SELECT * FROM secrets', '{"metric":"revenue","group":"user_email"}', '{"metric":"revenue","group":"month","sql":"DROP"}','[1]', 'null'])
def test_query_allowlist(client,query):
    assert client.post('/api/dashboards/query',json={'query':query},headers=headers(client)).status_code==422

def test_ai_off_and_failure(client):
    r=client.post('/api/dashboards/compose',json={'prompt':'Revenue by region'},headers=headers(client))
    assert r.status_code==422 and r.json['error']=='AI is not configured'

def test_ai_contract_and_budget(tmp_path,monkeypatch):
    monkeypatch.delenv('OPENAI_API_KEY',raising=False)
    prompts=[]
    def compose(prompt,metadata):
        prompts.append((prompt,metadata))
        return chart('Revenue by region','hbar','revenue','region')
    app=create_app(tmp_path/'ai.sqlite',secret='test',composer=compose);c=app.test_client();h=headers(c)
    for _ in range(6):assert c.post('/api/dashboards/compose',json={'prompt':'Revenue by region'},headers=h).status_code==200
    assert c.post('/api/dashboards/compose',json={'prompt':'Revenue by region'},headers=h).status_code==422
    assert 'rows' not in prompts[0][1]

def test_history_validated_and_preserved():
    d=DemoData();s=Scope('sample-sales','1','local-demo');c=chart('V2');old=chart('V1')
    c['history']=[{k:old[k] for k in ('title','prompt','query','kind','mapping','updatedAt','version')}]
    assert d.validate_chart(s,c)['history'][0]['title']=='V1'
    c['history'][0]['query']='DROP TABLE secrets'
    with pytest.raises(ValueError):d.validate_chart(s,c)

def test_empty_draft_saves_and_invalid_draft_cannot_execute(client):
    h=headers(client);definition=client.get('/api/dashboards/workspace').json['default']
    draft=dict(id='draft',title='New chart',prompt='',kind='bar',query='',mapping={},status='draft',createdAt=1,updatedAt=1)
    definition['widgets'].append(draft);definition['layouts'].append(dict(i='draft',x=0,y=12,w=6,h=8))
    assert client.post('/api/dashboards/boards',json={'definition':definition},headers=h).status_code==200
    draft['query']='SELECT secrets'
    assert client.post('/api/dashboards/boards',json={'definition':definition},headers=h).status_code==422

@pytest.mark.parametrize('query',['{"metric":[],"group":"month"}','{"metric":"revenue","group":{}}'])
def test_invalid_query_types_are_validation_errors(client,query):
    assert client.post('/api/dashboards/query',json={'query':query},headers=headers(client)).status_code==422


def test_region_breakdown_preserves_demo_totals(client):
    h = headers(client)
    regions = client.post('/api/dashboards/query', json={'query': query_spec('revenue', 'region')}, headers=h).json
    total = client.post('/api/dashboards/query', json={'query': query_spec('revenue', 'none')}, headers=h).json
    assert len(regions['rows']) == 9
    assert round(sum(row['value'] for row in regions['rows']), 2) == total['rows'][0]['value']


def test_showcase_series_and_map_roundtrip(client):
    h = headers(client)
    board = client.get('/api/dashboards/workspace').json['default']
    trend = next(w for w in board['widgets'] if w['id'] == 'trend')
    assert trend['kind'] == 'area' and trend['mapping']['series'] == 'series'
    series = client.post('/api/dashboards/query', json={'query': trend['query']}, headers=h).json['rows']
    assert len(series) == 72
    assert {r['series'] for r in series} == {'Organic', 'Paid', 'Referral'}
    monthly = client.post('/api/dashboards/query', json={'query': query_spec('revenue','month')}, headers=h).json['rows']
    for month in monthly:
        assert round(sum(r['value'] for r in series if r['label'][:7] == month['label'][:7]), 2) == month['value']
    map_chart = next(w for w in board['widgets'] if w['id'] == 'countries')
    assert map_chart['kind'] == 'map'
    assert map_chart['mapping'] == dict(region='label',value='value',scope='world')
    countries = client.post('/api/dashboards/query', json={'query': map_chart['query']}, headers=h).json['rows']
    assert len(countries) == 27
    assert round(sum(r['value'] for r in countries), 2) == 1256512.5
    created = client.post('/api/dashboards/boards', json={'definition': board}, headers=h)
    assert created.status_code == 200
    assert created.json['definition']['widgets'] == board['widgets']

@pytest.mark.parametrize('series',['none','month','secret',[],None])
def test_invalid_comparison_dimensions(client,series):
    query = json.dumps(dict(metric='revenue',group='month',series=series))
    assert client.post('/api/dashboards/query',json={'query':query},headers=headers(client)).status_code == 422

def test_date_filter_applies_before_every_aggregation(client):
    from datetime import date
    h = headers(client)
    period = {"from": (date(2026, 2, 8) - date(1970, 1, 1)).days,
              "to": (date(2026, 3, 16) - date(1970, 1, 1)).days}
    def query(q):
        response = client.post('/api/dashboards/query', json={'query': q}, headers=h)
        assert response.status_code == 200
        return response.json['rows']
    board = client.get('/api/dashboards/workspace').json['default']
    for widget in board['widgets']:
        q = json.loads(widget['query'])
        assert query(json.dumps(dict(q, period=period))) != query(widget['query'])
    detailed = query(query_spec('revenue', 'date', 'channel', period))
    assert len(detailed) == 18
    assert all('2026-02-08' <= r['label'] < '2026-03-16' for r in detailed)
    total = query(query_spec('revenue', 'none', period=period))[0]['value']
    assert round(sum(r['value'] for r in detailed), 2) == total
    assert query(query_spec('revenue', 'none'))[0]['value'] == 1256512.5

@pytest.mark.parametrize('period', [None, [], {}, {'from': 1}, {'from': 2, 'to': 1}, {'from': 1, 'to': 1}, {'from': -1, 'to': 1}, {'from': 1, 'to': 100001}, {'from': '1', 'to': 2}, {'from': True, 'to': 2}, {'from': 1.5, 'to': 2}, {'from': 1, 'to': 2, 'sql': 'select secret'}])
def test_invalid_date_periods(client, period):
    query = json.dumps(dict(metric='revenue', group='none', period=period))
    assert client.post('/api/dashboards/query', json={'query': query}, headers=headers(client)).status_code == 422

def test_legacy_monthly_chart_gets_complete_calendar_bucket():
    old = chart('Monthly revenue', kind='line', group='month')
    del old['mapping']['timeUnit']
    loaded = DemoData().validate_chart(None, old)
    assert loaded['mapping']['timeUnit'] == 'month'
    assert loaded['query'] == old['query']
    assert 'timeUnit' not in old['mapping']
