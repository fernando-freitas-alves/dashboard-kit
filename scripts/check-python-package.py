"""Inspect distributions and import a wheel in a fresh, dependency-free location."""
from pathlib import Path
import subprocess
import sys
import tarfile
import tempfile
import zipfile

root=Path(__file__).resolve().parents[1]
out=root/'artifacts/python'
wheels=list(out.glob('*.whl'));archives=list(out.glob('*.tar.gz'))
assert len(wheels)==len(archives)==1, 'Build one wheel and one source archive first.'
for artifact in wheels+archives:
    if artifact.suffix=='.whl':
        with zipfile.ZipFile(artifact) as z:names=z.namelist()
    else:
        with tarfile.open(artifact) as z:names=z.getnames()
    assert not any('.env' in p or p.endswith(('.sqlite','.db','.pem','.key')) or '__pycache__' in p for p in names)
    assert any(p.endswith('LICENSE') for p in names)
with tempfile.TemporaryDirectory(prefix='dashboard-wheel-') as directory:
    subprocess.run(['uv','pip','install','--python',sys.executable,'--target',directory,'--no-deps',str(wheels[0])],check=True,capture_output=True)
    code='import sys;sys.path.insert(0,sys.argv[1]);from loadsmart_dashboard_kit.repository import Scope,SQLiteBoardRepository;from loadsmart_dashboard_kit.service import DashboardService;print("Wheel imports without the source checkout.")'
    subprocess.run([sys.executable,'-I','-S','-c',code,directory],check=True,cwd=directory)
print('Python wheel and source archive contents verified.')
