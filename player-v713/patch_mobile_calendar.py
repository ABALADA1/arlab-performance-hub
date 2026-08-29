from pathlib import Path
import base64,gzip,re,hashlib
root=Path('player-v713'); names=['p0','p1','r0','r1','r2','r3','r4']; target=113139
html=''.join(gzip.decompress(base64.b64decode(''.join((root/f'{n}.b64').read_text().split()))).decode() for n in names)
assert len(html)==target
assert 'async function loadSchedule()' in html and 'CHECK-OUT APP NORMAL V714' in html
m=re.search(r'<!--x+-->',html)
if m: html=html[:m.start()]+html[m.end():]
repls={
'.cal-grid{grid-template-columns:1fr}':'.cal-grid{grid-template-columns:repeat(7,minmax(0,1fr))}',
'.cal-dow{display:none}':'.cal-dow{display:block;padding:6px 1px;font-size:8px}',
'.cal-day{min-height:70px;border-right:0}':'.cal-day{min-height:72px;border-right:1px solid #edf2f6;padding:3px 2px;overflow:hidden}',
'.cal-day.out{display:none}':'.cal-day.out{display:block;opacity:.34;background:#fafbfd}',
'.cal-day:empty{display:none}':'.cal-day:empty{display:block}',
'.cal-day .day-num{font-size:12px}':'.cal-day .day-num{font-size:10px;width:22px;height:22px;border-radius:50%;display:grid;place-items:center;margin:0 auto 2px}.cal-day.today .day-num{background:var(--blue);color:#fff}',
'.week-grid .cal-day{min-height:80px}':'.week-grid .cal-day{min-height:118px}.week-grid .week-head{font-size:8px;line-height:1.15}.event-chip{height:15px;padding:1px 2px;margin:2px 0;border-radius:4px;border-left:3px solid var(--ec)!important;font-size:7px;line-height:12px}.cal-toolbar{padding:10px}.cal-title{font-size:15px}.cal-controls{flex:1}.cal-modes{margin-left:auto}.cal-btn{padding:6px 8px;font-size:10px}.cal-detail{margin:8px;padding:10px}'
}
for a,b in repls.items():
    assert a in html, a
    html=html.replace(a,b,1)
marker='/* MOBILE CALENDAR V715 */'
html=html.replace('@media(max-width:760px){',marker+'@media(max-width:760px){',1)
assert marker in html
if len(html)>target: raise SystemExit(f'too large {len(html)}>{target}')
pad=target-len(html); filler='<!--'+('x'*(pad-7))+'-->' if pad>=7 else ' '*pad
html=html.replace('</body>',filler+'</body>',1); assert len(html)==target
bounds=[round(i*len(html)/7) for i in range(8)]
for i,n in enumerate(names):
    chunk=html[bounds[i]:bounds[i+1]]
    (root/f'{n}.b64').write_text(base64.b64encode(gzip.compress(chunk.encode(),9,mtime=0)).decode())
back=''.join(gzip.decompress(base64.b64decode(''.join((root/f'{n}.b64').read_text().split()))).decode() for n in names)
assert back==html
print('VALID_MOBILE_CALENDAR',len(html),hashlib.sha256(html.encode()).hexdigest())
