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
