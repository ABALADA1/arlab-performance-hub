package main

import (
  "encoding/json"
  "fmt"
  "io"
  "net/http"
  "os"
  "os/exec"
  "path/filepath"
  "strings"
  "time"
)

const addr = "127.0.0.1:8765"

func main() {
  exe, _ := os.Executable()
  base := filepath.Dir(exe)
  root := filepath.Join(base, "wwwroot")
  data := filepath.Join(base, "data")
  _ = os.MkdirAll(root, 0755)
  _ = os.MkdirAll(data, 0755)
  mux := http.NewServeMux()
  mux.HandleFunc("/api/health", func(w http.ResponseWriter, r *http.Request) { jsonOut(w, map[string]any{"ok": true, "mode": "ARLAB local", "time": time.Now().Format(time.RFC3339)}) })
  mux.HandleFunc("/api/state/meta", func(w http.ResponseWriter, r *http.Request) {
    p := filepath.Join(data, "state.json")
    st, err := os.Stat(p)
    if err != nil { jsonOut(w, map[string]any{"ok": true, "exists": false, "bytes": 0}); return }
    jsonOut(w, map[string]any{"ok": true, "exists": true, "bytes": st.Size(), "updatedAt": st.ModTime().Format(time.RFC3339)})
  })
  mux.HandleFunc("/api/state", func(w http.ResponseWriter, r *http.Request) { stateHandler(w, r, data) })
  mux.HandleFunc("/__state", func(w http.ResponseWriter, r *http.Request) { stateHandler(w, r, data) })
  mux.HandleFunc("/api/gps/manifest", func(w http.ResponseWriter, r *http.Request) { fileAPI(w, r, filepath.Join(data, "gps-manifest.json"), []byte(`{"version":1,"gpsState":{"gpsRawLogs":[],"gpsCutSessions":[]},"rawFiles":[]}`)) })
  mux.HandleFunc("/api/gps/raw/", func(w http.ResponseWriter, r *http.Request) {
    name := filepath.Base(strings.TrimPrefix(r.URL.Path, "/api/gps/raw/"))
    if name == "." || name == "" { http.Error(w, "missing file", 400); return }
    dir := filepath.Join(data, "gps")
    _ = os.MkdirAll(dir, 0755)
    fileAPI(w, r, filepath.Join(dir, name), nil)
  })
  mux.HandleFunc("/", func(w http.ResponseWriter, r *http.Request) {
    setCors(w)
    p := filepath.Clean(strings.TrimPrefix(r.URL.Path, "/"))
    if p == "." || p == "" { p = "index.html" }
    full := filepath.Join(root, p)
    if st, err := os.Stat(full); err == nil && !st.IsDir() { http.ServeFile(w, r, full); return }
    idx := filepath.Join(root, "index.html")
    if _, err := os.Stat(idx); err == nil { http.ServeFile(w, r, idx); return }
    http.Error(w, "ARLAB local: index.html no encontrado", 404)
  })
  go func(){ time.Sleep(700*time.Millisecond); _ = exec.Command("rundll32", "url.dll,FileProtocolHandler", "http://"+addr+"/").Start() }()
  fmt.Println("ARLAB local abierto en http://"+addr+"/")
  fmt.Println("No cierres esta ventana mientras uses la app.")
  if err := http.ListenAndServe(addr, mux); err != nil { fmt.Println(err); fmt.Scanln() }
}

func setCors(w http.ResponseWriter) {
  w.Header().Set("Access-Control-Allow-Origin", "*")
  w.Header().Set("Access-Control-Allow-Headers", "*")
  w.Header().Set("Access-Control-Allow-Methods", "GET,POST,PUT,PATCH,DELETE,OPTIONS")
  w.Header().Set("Cache-Control", "no-store")
}
func jsonOut(w http.ResponseWriter, v any){ setCors(w); w.Header().Set("Content-Type","application/json; charset=utf-8"); _=json.NewEncoder(w).Encode(v) }
func stateHandler(w http.ResponseWriter, r *http.Request, data string) {
  if r.Method == http.MethodOptions { setCors(w); w.WriteHeader(204); return }
  p := filepath.Join(data, "state.json")
  if r.Method == http.MethodGet || r.Method == http.MethodHead {
    setCors(w); w.Header().Set("Content-Type", "application/json; charset=utf-8")
    b, err := os.ReadFile(p); if err != nil { _, _ = w.Write([]byte(`{}`)); return }; _, _ = w.Write(b); return
  }
  if r.Method != http.MethodPost && r.Method != http.MethodPut && r.Method != http.MethodPatch { http.Error(w,"method",405); return }
  b, err := io.ReadAll(http.MaxBytesReader(w,r.Body,512<<20)); if err != nil { http.Error(w,err.Error(),400); return }
  if len(b)==0 { http.Error(w,"empty",400); return }
  if !json.Valid(b) { http.Error(w,"invalid json",400); return }
  _ = rotate(p)
  tmp := p+".tmp"; if err=os.WriteFile(tmp,b,0644); err!=nil { http.Error(w,err.Error(),500); return }
  if err=os.Rename(tmp,p); err!=nil { http.Error(w,err.Error(),500); return }
  jsonOut(w,map[string]any{"ok":true,"bytes":len(b)})
}
func rotate(p string) error {
  if _,e:=os.Stat(p); e!=nil { return nil }
  for i:=3;i>=1;i-- { old:=fmt.Sprintf("%s.previous-%d",p,i); if i==3 { _=os.Remove(old) } else { _=os.Rename(old,fmt.Sprintf("%s.previous-%d",p,i+1)) } }
  b,e:=os.ReadFile(p); if e==nil { _=os.WriteFile(p+".previous-1",b,0644) }
  return nil
}
func fileAPI(w http.ResponseWriter, r *http.Request, p string, fallback []byte) {
  if r.Method==http.MethodOptions { setCors(w); w.WriteHeader(204); return }
  if r.Method==http.MethodGet || r.Method==http.MethodHead { setCors(w); b,e:=os.ReadFile(p); if e!=nil { if fallback!=nil { _,_=w.Write(fallback); return }; http.NotFound(w,r); return }; _,_=w.Write(b); return }
  if r.Method!=http.MethodPost && r.Method!=http.MethodPut && r.Method!=http.MethodPatch { http.Error(w,"method",405); return }
  _=os.MkdirAll(filepath.Dir(p),0755); b,e:=io.ReadAll(http.MaxBytesReader(w,r.Body,1024<<20)); if e!=nil { http.Error(w,e.Error(),400); return }; if e=os.WriteFile(p,b,0644); e!=nil { http.Error(w,e.Error(),500); return }; jsonOut(w,map[string]any{"ok":true,"bytes":len(b)})
}
