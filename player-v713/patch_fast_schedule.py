from pathlib import Path
import base64,gzip,re,hashlib

root=Path('player-v713')
names=['p0','p1','r0','r1','r2','r3','r4']
target=113139
html=''.join(gzip.decompress(base64.b64decode(''.join((root/f'{n}.b64').read_text().split()))).decode('utf-8') for n in names)
assert len(html)==target, len(html)
assert 'async function loadData()' in html
assert 'async function refreshPortalData()' in html
assert 'CHECK-OUT APP NORMAL V714' in html
assert 'Compañeros que participan' in html

# Remove fixed-length padding before editing.
m=re.search(r'<!--x+-->',html)
if m:
    html=html[:m.start()]+html[m.end():]

load_marker="async function loadData(){var r=await fetch(DATA,{method:'POST',headers:{'content-type':'text/plain;charset=UTF-8'},body:JSON.stringify({token:token||''}),cache:'no-store'}),j=await r.json().catch(function(){return {error:'Respuesta no válida'}});if(!r.ok)throw Error(j.error||'Error');return j}"
assert load_marker in html
schedule_fn="async function loadSchedule(){var u=DATA.replace('arlab-player-data','arlab-player-schedule'),r=await fetch(u,{method:'POST',headers:{'content-type':'text/plain;charset=UTF-8'},body:JSON.stringify({token:token||''}),cache:'no-store'}),j=await r.json().catch(function(){return {error:'Respuesta no válida'}});if(!r.ok)throw Error(j.error||'No se pudieron cargar calendario y sesiones');return j}"
html=html.replace(load_marker,schedule_fn+load_marker,1)

pat=r"async function refreshPortalData\(\)\{.*?\}\nasync function enter\(\)\{"
m=re.search(pat,html,re.S)
assert m, 'refreshPortalData block not found'
refresh="""async function refreshPortalData(){try{var m=await withTimeout(callApi('me'),6000,'El perfil está tardando demasiado');me=m;today=m.today||today||localToday();calendarCursor=new Date(today+'T12:00:00');renderCheckin(false);renderCheckout(false)}catch(e){console.warn('ARLAB me',e)}try{var s=await withTimeout(loadSchedule(),7000,'Las sesiones están tardando demasiado'),old=model||{};model=Object.assign({},old,s,{player:s.player||old.player,fieldSessions:arr(s.fieldSessions),strengthSessions:arr(s.strengthSessions),calendar:arr(s.calendar)});renderAll()}catch(e){console.warn('ARLAB schedule',e)}setTimeout(async function(){try{var fast=model||{},d=await withTimeout(loadData(),12000,'Los datos están tardando demasiado');if(arr(fast.calendar).length)d.calendar=fast.calendar;if(arr(fast.fieldSessions).length){var fm={};arr(fast.fieldSessions).forEach(function(x){fm[String(x.id)]=x});d.fieldSessions=arr(d.fieldSessions).map(function(x){var f=fm[String(x.id)]||{};return Object.assign({},f,x,{color:f.color||x.color||'#2f80ed',participants:arr(f.participants).length?f.participants:x.participants})})}if(arr(fast.strengthSessions).length){var sm={};arr(fast.strengthSessions).forEach(function(x){sm[String(x.id)]=x});d.strengthSessions=arr(d.strengthSessions).map(function(x){var f=sm[String(x.id)]||{};return Object.assign({},f,x,{color:f.color||x.color||'#f59e0b',participants:arr(f.participants).length?f.participants:x.participants})})}model=d;renderAll()}catch(e){console.warn('ARLAB data',e)}},500)}
async function enter(){"""
html=html[:m.start()]+refresh+html[m.end():]

# Desired color fallbacks everywhere.
html=html.replace("var c=x.color||'#5f7f9f'", "var c=x.color||(x.kind==='field'?'#2f80ed':x.kind==='strength'?'#f59e0b':x.kind==='match'?'#dc2626':'#7c3aed')")
html=html.replace("x.color||'#7055b8'", "x.color||'#f59e0b'")
html=html.replace("x.color||'#5f7f9f'", "x.color||(x.kind==='field'?'#2f80ed':x.kind==='strength'?'#f59e0b':x.kind==='match'?'#dc2626':'#7c3aed')")

assert 'arlab-player-schedule' in html
assert "withTimeout(loadSchedule(),7000" in html
assert "'#f59e0b'" in html
assert "'#dc2626'" in html
assert "'#7c3aed'" in html
assert 'CHECK-OUT APP NORMAL V714' in html
assert 'Compañeros que participan' in html

if len(html)>target:
    raise SystemExit(f'patched html too large: {len(html)} > {target}')
pad=target-len(html)
filler='<!--'+('x'*(pad-7))+'-->' if pad>=7 else ' '*pad
assert len(filler)==pad
html=html.replace('</body>',filler+'</body>',1)
assert len(html)==target

bounds=[round(i*len(html)/7) for i in range(8)]
for name,i in zip(names,range(7)):
    chunk=html[bounds[i]:bounds[i+1]]
    (root/f'{name}.b64').write_text(base64.b64encode(gzip.compress(chunk.encode('utf-8'),9,mtime=0)).decode())

back=''.join(gzip.decompress(base64.b64decode(''.join((root/f'{n}.b64').read_text().split()))).decode('utf-8') for n in names)
assert back==html
print('VALID_FAST_SCHEDULE',len(html),hashlib.sha256(html.encode()).hexdigest())
