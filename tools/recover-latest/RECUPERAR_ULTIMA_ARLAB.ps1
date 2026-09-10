$ErrorActionPreference = 'Continue'
$ProgressPreference = 'SilentlyContinue'

$Here = Split-Path -Parent $MyInvocation.MyCommand.Path
$Out = Join-Path $Here 'RECUPERADO'
$Www = Join-Path $Out 'wwwroot'
$Data = Join-Path $Out 'data'
$Backup = Join-Path $Out 'browser-state-backup'
$Log = Join-Path $Out 'recovery-report.txt'
$Tmp = Join-Path $env:TEMP ('arlab-recovery-' + [guid]::NewGuid().ToString('N'))
New-Item -ItemType Directory -Force -Path $Out,$Www,$Data,$Backup,$Tmp | Out-Null
"ARLAB latest recovery - $(Get-Date -Format o)" | Set-Content -Encoding UTF8 $Log

function Log([string]$s){ Write-Host $s; Add-Content -Encoding UTF8 $Log $s }
function U32($b,[int]$o){ [BitConverter]::ToUInt32($b,$o) }
function U64($b,[int]$o){ [BitConverter]::ToUInt64($b,$o) }
$ENTRY_MAGIC = [Convert]::ToUInt64('FCFB6D1BA7725C30',16)
$EOF_MAGIC = [Convert]::ToUInt64('F4FA6F45970D41D8',16)
$Utf8 = [Text.Encoding]::UTF8
$BrotliExe = Join-Path $Here 'arlab-brotli.exe'

function Is-ArlabUrl([string]$u){
  if(!$u){ return $false }
  return $u -match '(?i)(arlab-app\.vercel\.app|arlab-v779-online\.vercel\.app|arlab-player-portal\.vercel\.app|wchzahvvujxxajlmxhqa\.supabase\.co|xnlkjkrkkehplsbbziil\.supabase\.co|/arlab-|macro-v|micro-v|tests-v|annotations-v|tindeq-v|gps-spro-v|strength-v|spro-monitor|wimu-formula)'
}
function Is-TextBytes([byte[]]$b){
  if(!$b -or $b.Length -lt 2){ return $false }
  $n=[Math]::Min($b.Length,512); $s=$Utf8.GetString($b,0,$n).TrimStart([char]0xFEFF,[char]0,[char]9,[char]10,[char]13,[char]32)
  return ($s -match '^(?is)(<!doctype|<html|<script|<style|/\*|//|\(|\{|\[|const\s|let\s|var\s|function\s|class\s|@|:root|body\b|html\b|"|\x27)')
}
function Decode-Body([byte[]]$body,[string]$tag){
  if(!$body){ return $body }
  if($body.Length -ge 2 -and $body[0] -eq 0x1f -and $body[1] -eq 0x8b){
    try{
      $mi=New-Object IO.MemoryStream(,$body); $gz=New-Object IO.Compression.GZipStream($mi,[IO.Compression.CompressionMode]::Decompress); $mo=New-Object IO.MemoryStream; $gz.CopyTo($mo); $gz.Dispose();$mi.Dispose(); $x=$mo.ToArray();$mo.Dispose(); return $x
    }catch{}
  }
  if(Is-TextBytes $body){ return $body }
  if(Test-Path $BrotliExe){
    try{
      $a=Join-Path $Tmp (([guid]::NewGuid().ToString('N'))+'.br'); $z=$a+'.out'; [IO.File]::WriteAllBytes($a,$body)
      $p=Start-Process -FilePath $BrotliExe -ArgumentList @($a,$z) -PassThru -Wait -WindowStyle Hidden
      if($p.ExitCode -eq 0 -and (Test-Path $z)){ $x=[IO.File]::ReadAllBytes($z); Remove-Item -Force $a,$z -ErrorAction SilentlyContinue; if((Is-TextBytes $x) -or $x.Length -gt 0){ return $x } }
      Remove-Item -Force $a,$z -ErrorAction SilentlyContinue
    }catch{}
  }
  return $body
}
function Url-Score([string]$url,[datetime]$mtime){
  $score=[int64]([DateTimeOffset]$mtime).ToUnixTimeSeconds()
  foreach($pat in @('(?:[?&])v=(\d+)','(?:[?&])build=(\d+)','(?:[?&])safe=(\d+)')){
    $m=[regex]::Match($url,$pat,[Text.RegularExpressions.RegexOptions]::IgnoreCase); if($m.Success){ $n=[int64]$m.Groups[1].Value; $score += ($n * 1000000000) }
  }
  if($url -match '(?i)arlab-app\.vercel\.app'){ $score += 900000000000000000 }
  return $score
}
function Output-Name([string]$url,[byte[]]$body){
  try{ $u=[uri]$url; $p=$u.AbsolutePath }catch{ return $null }
  if($p -match '(?i)/functions/v1/'){ return $null }
  $name=[IO.Path]::GetFileName($p)
  if([string]::IsNullOrWhiteSpace($name)){
    if(Is-TextBytes $body){ return 'index.html' } else { return $null }
  }
  if($name -notmatch '(?i)\.(html?|js|css|json|svg|png|jpe?g|webp|gif|ico|woff2?|ttf|map)$'){
    if(Is-TextBytes $body){ if($body.Length -gt 1000 -and $Utf8.GetString($body,0,[Math]::Min($body.Length,1000)) -match '(?i)<html'){ return 'index.html' } }
    return $null
  }
  return $name
}

$candidates=@{}
$cacheDirs=New-Object System.Collections.Generic.List[string]
$profiles=New-Object System.Collections.Generic.List[object]
$browserRoots=@(
  @{Name='Chrome'; Path=(Join-Path $env:LOCALAPPDATA 'Google\Chrome\User Data')},
  @{Name='Edge'; Path=(Join-Path $env:LOCALAPPDATA 'Microsoft\Edge\User Data')}
)
foreach($br in $browserRoots){
  if(!(Test-Path $br.Path)){ continue }
  $dirs=Get-ChildItem -LiteralPath $br.Path -Directory -ErrorAction SilentlyContinue | Where-Object { $_.Name -eq 'Default' -or $_.Name -like 'Profile *' -or $_.Name -eq 'Guest Profile' }
  foreach($pr in $dirs){
    $profiles.Add([pscustomobject]@{Browser=$br.Name;Name=$pr.Name;Path=$pr.FullName})
    foreach($rel in @('Cache\Cache_Data','Code Cache\js','Code Cache\wasm')){ $p=Join-Path $pr.FullName $rel; if(Test-Path $p){ $cacheDirs.Add($p) } }
    $sw=Join-Path $pr.FullName 'Service Worker\CacheStorage'
    if(Test-Path $sw){
      Get-ChildItem -LiteralPath $sw -Directory -Recurse -ErrorAction SilentlyContinue | ForEach-Object { if(Test-Path (Join-Path $_.FullName 'index')){ $cacheDirs.Add($_.FullName) } }
    }
  }
}
$cacheDirs=@($cacheDirs | Select-Object -Unique)
Log ("Perfiles encontrados: {0}. Cachés a revisar: {1}." -f $profiles.Count,$cacheDirs.Count)

foreach($dir in $cacheDirs){
  Log ("Revisando cache: " + $dir)
  $files=Get-ChildItem -LiteralPath $dir -File -Filter '*_0' -ErrorAction SilentlyContinue
  foreach($f in $files){
    try{
      $fs=[IO.File]::Open($f.FullName,[IO.FileMode]::Open,[IO.FileAccess]::Read,[IO.FileShare]::ReadWrite -bor [IO.FileShare]::Delete)
      try{
        if($fs.Length -lt 60){ continue }
        $head=New-Object byte[] 4096; $read=$fs.Read($head,0,[Math]::Min(4096,[int][Math]::Min($fs.Length,4096)))
        if($read -lt 24 -or (U64 $head 0) -ne $ENTRY_MAGIC){ continue }
        $urlLen=[int](U32 $head 12); if($urlLen -lt 1 -or $urlLen -gt 3000 -or (20+$urlLen) -gt $read){ continue }
        $url=$Utf8.GetString($head,20,$urlLen)
        if(!(Is-ArlabUrl $url)){ continue }
      } finally { $fs.Dispose() }
      $b=[IO.File]::ReadAllBytes($f.FullName); $L=$b.Length; if($L -lt 60){ continue }
      $e2=$L-20; if((U64 $b $e2) -ne $EOF_MAGIC){ continue }
      $flags=U32 $b ($e2+8); $s0=[int64](U32 $b ($e2+16)); $hashLen=0; if(($flags -band 2) -ne 0){$hashLen=32}
      $e1=[int64]$e2-$hashLen-$s0-20; if($e1 -lt (20+$urlLen) -or (U64 $b ([int]$e1)) -ne $EOF_MAGIC){ continue }
      $s1=[int64](U32 $b ([int]$e1+16)); $start=$e1-$s1; if($start -lt (20+$urlLen) -or $s1 -lt 0 -or ($start+$s1) -gt $L){ continue }
      $raw=New-Object byte[] ([int]$s1); [Array]::Copy($b,[int]$start,$raw,0,[int]$s1)
      $body=Decode-Body $raw $url
      if(!$body -or $body.Length -eq 0){ continue }
      $preview=$Utf8.GetString($body,0,[Math]::Min($body.Length,700))
      if($preview -match '(?i)Service for this project is restricted|exceed_cached_egress_quota|Payment Required'){ continue }
      $name=Output-Name $url $body; if(!$name){ continue }
      $score=Url-Score $url $f.LastWriteTimeUtc
      if(!$candidates.ContainsKey($name) -or $score -gt $candidates[$name].Score){ $candidates[$name]=[pscustomobject]@{Name=$name;Url=$url;Body=$body;Score=$score;MTime=$f.LastWriteTimeUtc;Source=$f.FullName} }
    }catch{}
  }
}

foreach($k in @($candidates.Keys)){
  $c=$candidates[$k]; try{ [IO.File]::WriteAllBytes((Join-Path $Www $c.Name),$c.Body); Add-Content -Encoding UTF8 $Log ("RECOVERED`t{0}`t{1}`t{2}" -f $c.Name,$c.Body.Length,$c.Url) }catch{}
}
Log ("Archivos ARLAB recuperados del cache: {0}" -f $candidates.Count)

# Copia de seguridad de los almacenes del navegador (solo para ARLAB; no se sube a ningún sitio).
foreach($pr in $profiles){
  $dst=Join-Path $Backup ($pr.Browser+'-'+$pr.Name.Replace(' ','_'))
  New-Item -ItemType Directory -Force -Path $dst | Out-Null
  foreach($rel in @('Local Storage\leveldb','Session Storage')){
    $src=Join-Path $pr.Path $rel; if(Test-Path $src){ try{ Copy-Item -LiteralPath $src -Destination (Join-Path $dst ([IO.Path]::GetFileName($rel))) -Recurse -Force -ErrorAction SilentlyContinue }catch{} }
  }
}

$index=Join-Path $Www 'index.html'; $safe=Join-Path $Www 'index-safe.html'; $fallback=Join-Path $Here 'fallback-index-safe.html'
if(!(Test-Path $index) -and (Test-Path $safe)){ Copy-Item $safe $index -Force }
if(!(Test-Path $index) -and (Test-Path $fallback)){ Copy-Item $fallback $index -Force; Log 'AVISO: no apareció HTML reciente en caché; se usa un index de rescate como armazón con los assets recuperados.' }
Copy-Item (Join-Path $Here 'arlab-local-bridge.js') (Join-Path $Www 'arlab-local-bridge.js') -Force
'window.ARLAB_LOCAL_MODE=true;console.info("[ARLAB] local state shim");' | Set-Content -Encoding UTF8 (Join-Path $Www 'arlab-local-shim.js')

if(Test-Path $index){
  try{
    $html=[IO.File]::ReadAllText($index)
    $html=[regex]::Replace($html,'(?is)<script[^>]+src=["''][^"'']*supabase\.co/functions/v1/[^"'']+["''][^>]*>\s*</script>','')
    $html=[regex]::Replace($html,'(?is)<head\b[^>]*>','$0<script src="arlab-local-bridge.js"></script>',1)
    $html=$html -replace 'https://wchzahvvujxxajlmxhqa\.supabase\.co/functions/v1/arlab-v779-web/?','http://127.0.0.1:8765/'
    $html=$html -replace 'https://xnlkjkrkkehplsbbziil\.supabase\.co/functions/v1/arlab-v699-bridge','http://127.0.0.1:8765/arlab-local-shim.js'
    [IO.File]::WriteAllText($index,$html,(New-Object Text.UTF8Encoding($false)))
  }catch{ Log ('No se pudo parchear index: '+$_.Exception.Message) }
}

# Lista de recursos que el HTML espera y no se han encontrado.
if(Test-Path $index){
  $html=[IO.File]::ReadAllText($index); $refs=[regex]::Matches($html,'(?is)(?:src|href)=["'']([^"'']+)["'']') | ForEach-Object {$_.Groups[1].Value} | Where-Object {$_ -notmatch '^(?:https?:|data:|#)' } | ForEach-Object { ($_ -split '[?#]')[0] } | Where-Object {$_}
  $missing=@(); foreach($r in ($refs|Select-Object -Unique)){ $p=Join-Path $Www $r; if(!(Test-Path $p)){ $missing+=$r } }
  if($missing.Count){ Add-Content -Encoding UTF8 $Log "`nMISSING ASSETS:"; $missing | Add-Content -Encoding UTF8 $Log; Log ("Faltan {0} recursos referenciados; mira recovery-report.txt." -f $missing.Count) } else { Log 'Todos los recursos locales referenciados por el HTML están presentes.' }
}

Copy-Item (Join-Path $Here 'arlab-local-server.exe') (Join-Path $Out 'ARLAB_LOCAL.exe') -Force
'@echo off`r`ncd /d "%~dp0"`r`nstart "ARLAB LOCAL" "%~dp0ARLAB_LOCAL.exe"`r`n' | Set-Content -Encoding ASCII (Join-Path $Out 'ABRIR_ARLAB_LOCAL.bat')
@"
ARLAB ÚLTIMA RECUPERADA
=======================
1. Abre ABRIR_ARLAB_LOCAL.bat.
2. La aplicación se abre en http://127.0.0.1:8765/
3. Los nuevos guardados se quedan en data\state.json.
4. recovery-report.txt indica exactamente qué versión/recursos se pudieron recuperar del navegador.

Este proceso NO sube datos ni revisa páginas ajenas a ARLAB. Solo filtra URLs de ARLAB en la caché local.
"@ | Set-Content -Encoding UTF8 (Join-Path $Out 'LEEME.txt')

$zip=Join-Path $Here 'ARLAB_ULTIMA_RECUPERADA.zip'; Remove-Item $zip -Force -ErrorAction SilentlyContinue
try{ Compress-Archive -Path (Join-Path $Out '*') -DestinationPath $zip -CompressionLevel Optimal -Force; Log ('ZIP generado: '+$zip) }catch{ Log ('No se pudo crear ZIP: '+$_.Exception.Message) }
Remove-Item $Tmp -Recurse -Force -ErrorAction SilentlyContinue
Log 'RECUPERACIÓN TERMINADA.'
Write-Host ''
Write-Host 'Ahora abre RECUPERADO\ABRIR_ARLAB_LOCAL.bat' -ForegroundColor Green
Write-Host 'También se ha creado ARLAB_ULTIMA_RECUPERADA.zip.' -ForegroundColor Green
