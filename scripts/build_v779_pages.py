from pathlib import Path
from concurrent.futures import ThreadPoolExecutor, as_completed
from urllib.request import Request, urlopen
from urllib.parse import quote, urlencode, urlsplit, unquote
from urllib.error import HTTPError
import json
import re
import time

STATUS = 'https://wchzahvvujxxajlmxhqa.supabase.co/functions/v1/arlab-v779-package?action=status'
PACKAGE = 'https://wchzahvvujxxajlmxhqa.supabase.co/functions/v1/arlab-v779-package'
WEB = 'https://wchzahvvujxxajlmxhqa.supabase.co/functions/v1/arlab-v779-web/'
OUT = Path('site/v779')
PREFIX = '/arlab-performance-hub/v779/'
BUILD = 'V779-pages-7794'


def read_url(url, timeout=120, attempts=6):
    last = None
    for attempt in range(attempts):
        try:
            req = Request(url, headers={
                'User-Agent': 'ARLAB-V779-Pages/1.1',
                'Cache-Control': 'no-cache',
                'Pragma': 'no-cache',
            })
            with urlopen(req, timeout=timeout) as response:
                if response.status != 200:
                    raise RuntimeError(f'HTTP {response.status}')
                return response.read()
        except Exception as exc:
            last = exc
            time.sleep(min(4.0, 0.5 * (attempt + 1)))
    raise last or RuntimeError('Error de descarga desconocido')


status = json.loads(read_url(STATUS).decode('utf-8'))
cur = status.get('current') or {}
webroot = str(cur.get('webRoot') or '')
manifest = list(cur.get('manifest') or [])
if not webroot or not manifest:
    raise RuntimeError('V779 no tiene webRoot/manifest instalado')

rels = sorted({path[len(webroot):] for path in manifest if path.startswith(webroot) and path[len(webroot):]})
if 'index.html' not in rels:
    raise RuntimeError('V779 no contiene index.html en wwwroot')

OUT.mkdir(parents=True, exist_ok=True)


def web_url(rel):
    return WEB + quote(rel, safe='/._-~()[]@+') + '?pages=7794'


def package_url(rel):
    return PACKAGE + '?' + urlencode({'action': 'file', 'path': webroot + rel})


def fetch_one(rel):
    errors = []
    # La ruta web aplica los parches online de index y del router V759.
    try:
        data = read_url(web_url(rel), attempts=4)
        source = 'web'
    except Exception as exc:
        errors.append(f'web={exc}')
        # Fallback directo al paquete instalado para cualquier ruta rara del manifiesto.
        try:
            data = read_url(package_url(rel), attempts=6)
            source = 'package'
        except Exception as exc2:
            errors.append(f'package={exc2}')
            raise RuntimeError(f'{rel}: ' + ' | '.join(errors))

    dest = OUT / rel
    dest.parent.mkdir(parents=True, exist_ok=True)
    dest.write_bytes(data)
    return rel, len(data), source


# index.html primero: si falla, no merece la pena descargar el resto.
rel, size, source = fetch_one('index.html')
print(f'V779 index.html OK · {size} bytes · {source}')

total = size
done = 1
fallbacks = []
failures = []
others = [r for r in rels if r != 'index.html']
with ThreadPoolExecutor(max_workers=8) as executor:
    futures = {executor.submit(fetch_one, rel): rel for rel in others}
    for future in as_completed(futures):
        rel = futures[future]
        try:
            _, file_size, source = future.result()
            total += file_size
            done += 1
            if source == 'package':
                fallbacks.append(rel)
            if done % 50 == 0 or done == len(rels):
                print(f'V779: {done}/{len(rels)} archivos · {total/1024/1024:.1f} MB · fallback {len(fallbacks)}')
        except Exception as exc:
            failures.append(str(exc))

# Segundo intento secuencial para fallos transitorios.
if failures:
    print(f'Reintentando {len(failures)} archivos de forma secuencial...')
    retry_names = [item.split(':', 1)[0] for item in failures]
    failures = []
    for rel in retry_names:
        try:
            _, file_size, source = fetch_one(rel)
            total += file_size
            done += 1
            if source == 'package':
                fallbacks.append(rel)
        except Exception as exc:
            failures.append(str(exc))

index = OUT / 'index.html'
html = index.read_text(encoding='utf-8')

# Conserva todos los recursos raíz dentro del subdirectorio V779 de Pages.
html = re.sub(
    r'(\b(?:src|href)=(["\']))/(?!/)',
    lambda match: match.group(1) + PREFIX,
    html,
    flags=re.I,
)
# El router V759 local se sustituye por la versión online parcheada.
html = re.sub(
    r'arlab-v759-import-router\.js\?v=[^"\']+',
    'arlab-v759-import-router.js?v=779online4',
    html,
    flags=re.I,
)
html = html.replace('</head>', f'<meta name="arlab-online-build" content="{BUILD}"></head>', 1)
index.write_text(html, encoding='utf-8')

# Verifica todos los JS/CSS/recursos declarados directamente por index.html.
missing_refs = []
for ref in re.findall(r'(?:src|href)\s*=\s*["\']([^"\']+)', html, flags=re.I):
    raw = ref.strip()
    if not raw or raw.startswith(('#', 'data:', 'http://', 'https://', '//', 'mailto:', 'javascript:')):
        continue
    path = unquote(urlsplit(raw).path)
    if path.startswith(PREFIX):
        path = path[len(PREFIX):]
    elif path.startswith('/'):
        path = path.lstrip('/')
    path = path.lstrip('./')
    if not path or path.endswith('/'):
        continue
    if not (OUT / path).exists():
        missing_refs.append(path)

critical = [
    'arlab-v620-app.bundle.js',
    'arlab-v679-json-store-router.js',
    'arlab-v759-import-router.js',
    'arlab-v779-persistence-watchdog.js',
]
for path in critical:
    if not (OUT / path).exists() and path not in missing_refs:
        missing_refs.append(path)

if failures:
    print('Archivos no recuperados del manifiesto (no necesariamente usados por index):')
    for item in failures[:40]:
        print(' -', item)
if missing_refs:
    raise RuntimeError('Faltan recursos usados por index.html: ' + ', '.join(sorted(set(missing_refs))[:80]))

print(f'V779 completa preparada: {done}/{len(rels)} archivos descargados · {total/1024/1024:.1f} MB')
print(f'Fallback directo al paquete: {len(set(fallbacks))} archivos')
print(f'Fallos no referenciados tolerados: {len(failures)}')
