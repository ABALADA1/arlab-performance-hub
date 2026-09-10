package main
import (
  "fmt"
  "io"
  "os"
  "github.com/andybalholm/brotli"
)
func main(){
  if len(os.Args)!=3 { fmt.Fprintln(os.Stderr,"usage: arlab-brotli input output"); os.Exit(2) }
  in,e:=os.Open(os.Args[1]); if e!=nil { panic(e) }; defer in.Close()
  out,e:=os.Create(os.Args[2]); if e!=nil { panic(e) }; defer out.Close()
  if _,e=io.Copy(out,brotli.NewReader(in)); e!=nil { panic(e) }
}
