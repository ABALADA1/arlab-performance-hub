from pathlib import Path
import base64, gzip, re, hashlib

root=Path('player-v713')
names=['p0','p1','r0','r1','r2','r3','r4']
html=''.join(gzip.decompress(base64.b64decode(''.join((root/f'{n}.b64').read_text().split()))).decode('utf-8') for n in names)
target=113139
assert len(html)==target, len(html)
assert 'function renderField()' in html and 'function renderStrength()' in html

# Remove previous padding first.
m=re.search(r'<!--x+-->',html)
if m:
    html=html[:m.start()]+html[m.end():]

css=""".session-participants{margin:0 0 12px;padding:10px;border:1px solid #e1eaf3;border-radius:10px;background:#f8fbfe}.session-participants b{font-size:10px;color:#35536e}.participant-chips{display:flex;flex-wrap:wrap;gap:5px;margin-top:7px}.participant-chip{padding:5px 8px;border:1px solid #dbe5ef;border-radius:99px;background:#fff;font-size:9px;font-weight:800}.participant-chip.me{background:#e8f3ff;color:#0b57a4;border-color:#b9d7f5}.event-chip{border-left:5px solid var(--ec,#5f7f9f)!important}"""
html=html.replace('</style>',css+'</style>',1)

helper="""function participantHtml(list,color){list=arr(list);if(!list.length)return '';return '<div class=\"session-participants\"><b>Compañeros que participan · '+list.length+'</b><div class=\"participant-chips\">'+list.map(function(p){return '<span class=\"participant-chip '+(p.isMe?'me':'')+'\">'+esc(p.name||p.firstName||'Jugador')+(p.isMe?' · Tú':'')+'</span>'}).join('')+'</div></div>'}\n"""
html=html.replace('function renderField(){',helper+'function renderField(){',1)

old="function eventRow(x){return '<div class=\"card\" style=\"padding:12px 14px;display:flex;justify-content:space-between;gap:12px;align-items:center\"><div><b style=\"font-size:12px\">'+esc(x.title)+'</b><div class=\"meta\">'+esc(dstr(x.date))+(x.time?' · '+esc(x.time):'')+(x.duration?' · '+esc(x.duration)+' min':'')+'</div></div><span class=\"pill '+esc(x.kind||'event')+'\">'+(x.kind==='strength'?'Fuerza':x.kind==='field'?'Campo':'Evento')+'</span></div>'}"
new="function eventRow(x){var c=x.color||'#5f7f9f';return '<div class=\"card\" style=\"padding:12px 14px;display:flex;justify-content:space-between;gap:12px;align-items:center;border-left:6px solid '+esc(c)+'\"><div><b style=\"font-size:12px\">'+esc(x.title)+'</b><div class=\"meta\">'+esc(dstr(x.date))+(x.time?' · '+esc(x.time):'')+(x.duration?' · '+esc(x.duration)+' min':'')+'</div></div><span class=\"pill\" style=\"background:'+esc(c)+';color:#fff\">'+(x.kind==='strength'?'Fuerza':x.kind==='field'?'Campo':x.kind==='match'?'Partido':'Evento')+'</span></div>'}"
assert old in html
html=html.replace(old,new,1)

old="function eventChip(x){return '<button class=\"event-chip '+esc(x.kind||'event')+'\" data-event-id=\"'+esc(x.id)+'\" title=\"'+esc((x.time?x.time+' · ':'')+x.title)+'\">'+esc((x.time?x.time+' ':'')+x.title)+'</button>'}"
new="function eventChip(x){var c=x.color||'#5f7f9f';return '<button class=\"event-chip '+esc(x.kind||'event')+'\" style=\"--ec:'+esc(c)+';background:'+esc(c)+'22;color:'+esc(c)+'\" data-event-id=\"'+esc(x.id)+'\" title=\"'+esc((x.time?x.time+' · ':'')+x.title)+'\">'+esc((x.time?x.time+' ':'')+x.title)+'</button>'}"
assert old in html
html=html.replace(old,new,1)

pat=r"function showCalEvent\(id\)\{.*?\}\nvar V713_FRONT"
m=re.search(pat,html,re.S); assert m
new="function showCalEvent(id){var x=arr(model.calendar).find(function(e){return String(e.id)===String(id)});if(!x)return;var c=x.color||'#5f7f9f';el('calDetail').innerHTML='<div class=\"cal-detail\" style=\"border-left:6px solid '+esc(c)+'\"><b>'+esc(x.title)+'</b><div style=\"margin-top:4px\">'+esc(dstr(x.date))+(x.time?' · '+esc(x.time):'')+(x.duration?' · '+esc(x.duration)+' min':'')+'</div>'+(x.comment?'<div style=\"margin-top:6px\">'+esc(x.comment)+'</div>':'')+participantHtml(x.participants,c)+'</div>'}\nvar V713_FRONT"
html=html[:m.start()]+new+html[m.end():]

needle="return '<details class=\"session\" '+(i<2?'open':'')+'><summary>"
assert html.count(needle)==2
html=html.replace(needle,"return '<details class=\"session\" style=\"border-left:6px solid '+esc(x.color||'#5f7f9f')+'\" '+(i<2?'open':'')+'><summary>",2)

needle="<span class=\"pill field\">Campo</span></summary><div class=\"session-body\">'+body+'"
assert needle in html
html=html.replace(needle,"<span class=\"pill field\" style=\"background:'+esc(x.color||'#2f80ed')+';color:#fff\">Campo</span></summary><div class=\"session-body\">'+participantHtml(x.participants,x.color)+body+'",1)

needle="<span class=\"pill strength\">Fuerza</span></summary><div class=\"session-body\">'+sum+table+'"
assert needle in html
html=html.replace(needle,"<span class=\"pill strength\" style=\"background:'+esc(x.color||'#7055b8')+';color:#fff\">Fuerza</span></summary><div class=\"session-body\">'+participantHtml(x.participants,x.color)+sum+table+'",1)

assert 'Compañeros que participan' in html
assert 'participantHtml(x.participants' in html
assert '--ec:' in html
assert 'CHECK-OUT APP NORMAL V714' in html

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
    b64=base64.b64encode(gzip.compress(chunk.encode('utf-8'),9,mtime=0)).decode()
    (root/f'{name}.b64').write_text(b64)

back=''.join(gzip.decompress(base64.b64decode(''.join((root/f'{n}.b64').read_text().split()))).decode('utf-8') for n in names)
assert back==html
print('VALID',len(html),hashlib.sha256(html.encode()).hexdigest())
