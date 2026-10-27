"""Netlify에 올릴 폴더(dist)를 만드는 스크립트: python3 build_netlify.py <API_URL> [출력폴더]"""
import sys, os, re, shutil, json
api = sys.argv[1]; out = sys.argv[2] if len(sys.argv) > 2 else 'dist'
here = os.path.dirname(os.path.abspath(__file__))
root = os.path.join(here, '..', 'apps-script') if os.path.isdir(os.path.join(here, '..', 'apps-script')) else here
shim_path = os.path.join(here, 'netlify_src', 'api.js')
style = open(os.path.join(root, 'Style.html')).read()
def page(src, repl):
    s = open(os.path.join(root, src)).read()
    s = s.replace("<?!= include('Style') ?>", style)
    for k, v in repl.items(): s = s.replace(k, v)
    assert '<?' not in s, (src, re.findall(r'<\?.*?\?>', s))
    s = s.replace('<head>', '<head>\n<script src="/api.js"></script>', 1)
    s = s.replace('<base target="_top">', '')
    return s
if out != '.':
    shutil.rmtree(out, ignore_errors=True)
os.makedirs(out, exist_ok=True)
def w(path, text):
    p = os.path.join(out, path); os.makedirs(os.path.dirname(p), exist_ok=True); open(p, 'w').write(text)
w('api.js', open(shim_path).read().replace('__API_URL__', api))
for n in ('1', '2'):
    w(f'{n}/index.html', page('Checkin.html', {'<?!= JSON.stringify(storeParam) ?>': json.dumps(n), '<?!= init ?>': 'null'}))
board = page('Board.html', {})
w('board/index.html', board)
w('index.html', board)
w('admin/index.html', page('App.html', {'<?!= JSON.stringify(mode) ?>': '"admin"', '<?!= JSON.stringify(appUrl) ?>': json.dumps(api)}))
w('_headers', "/*\n  Cache-Control: public, max-age=0, must-revalidate\n/api.js\n  Cache-Control: public, max-age=60\n")
print('built', out, sorted(os.listdir(out)))
