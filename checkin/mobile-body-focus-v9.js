(()=>{'use strict';
const style=document.createElement('style');
style.textContent=`
@media(max-width:780px){
  .bodyPanel{position:relative;cursor:zoom-in}
  .bodyPanel>h4{display:flex;align-items:center;justify-content:space-between;gap:8px;cursor:pointer;user-select:none}
  .bodyPanel>h4::after{content:'⛶ Ampliar';font-size:11px;font-weight:900;color:#1264d8;background:#eef5ff;border:1px solid #cfe0f7;border-radius:999px;padding:5px 9px}
  .bodyPanel.arlab-body-focus{position:fixed!important;inset:0!important;z-index:100000!important;background:#f4f7fb!important;padding:calc(12px + env(safe-area-inset-top)) 12px calc(12px + env(safe-area-inset-bottom))!important;display:flex!important;flex-direction:column!important;overflow:auto!important;cursor:default!important;margin:0!important;border-radius:0!important}
  .bodyPanel.arlab-body-focus>h4{font-size:18px;margin:0 52px 10px 4px;flex:0 0 auto}
  .bodyPanel.arlab-body-focus>h4::after{display:none}
  .bodyPanel.arlab-body-focus .pointMap{width:min(94vw,560px)!important;max-width:none!important;margin:auto!important;flex:1 0 auto;display:flex!important;align-items:center!important;justify-content:center!important;min-height:68vh!important;background:white;border:1px solid #dbe7f4;border-radius:18px;padding:8px;box-shadow:0 14px 40px rgba(31,56,86,.12)}
  .bodyPanel.arlab-body-focus .pointMap img{width:auto!important;max-width:100%!important;height:auto!important;max-height:76vh!important;object-fit:contain!important}
  .bodyPanel.arlab-body-focus .pointHelp{font-size:13px;padding:10px 4px 2px;flex:0 0 auto}
  .bodyPanel.arlab-body-focus .bodyPoint{width:24px!important;height:24px!important;border-width:3px!important;z-index:100003!important}
  .arlab-focus-close{position:fixed;right:14px;top:calc(12px + env(safe-area-inset-top));z-index:100004;width:42px;height:42px;border-radius:12px;border:1px solid #d5e1ef;background:#fff;color:#17324f;font-size:24px;line-height:1;display:grid;place-items:center;box-shadow:0 6px 18px rgba(31,56,86,.15);font-weight:700}
  body.arlab-map-open{overflow:hidden!important;touch-action:none}
  body.arlab-map-open .arlab-body-focus{touch-action:pan-y pinch-zoom}
  /* El editor del punto debe aparecer ENCIMA del mapa ampliado. */
  body.arlab-map-open #modalRoot .modalBack{z-index:100020!important;background:rgba(8,24,42,.58)!important;backdrop-filter:blur(2px);-webkit-backdrop-filter:blur(2px)}
  body.arlab-map-open #modalRoot .modal{width:min(94vw,520px)!important;max-height:82vh;overflow:auto;box-shadow:0 24px 70px rgba(0,0,0,.34)!important}
}
`;
document.head.appendChild(style);
function isMobile(){return window.matchMedia('(max-width:780px)').matches}
function focused(){return document.querySelector('.bodyPanel.arlab-body-focus')}
function focusInfo(){const p=focused(),m=p?.querySelector('.pointMap[data-point-map][data-kind]');return m?{side:m.dataset.pointMap,kind:m.dataset.kind}:null}
function closeFocus(){const p=focused();if(p)p.classList.remove('arlab-body-focus');document.querySelectorAll('.arlab-focus-close').forEach(x=>x.remove());document.body.classList.remove('arlab-map-open')}
function openFocus(panel){if(!isMobile()||!panel)return;closeFocus();panel.classList.add('arlab-body-focus');document.body.classList.add('arlab-map-open');const b=document.createElement('button');b.type='button';b.className='arlab-focus-close';b.setAttribute('aria-label','Cerrar vista ampliada');b.textContent='×';b.onclick=e=>{e.preventDefault();e.stopPropagation();closeFocus()};document.body.appendChild(b);requestAnimationFrame(()=>panel.scrollIntoView({block:'start'}))}
function reopen(info){if(!info||!isMobile())return;requestAnimationFrame(()=>requestAnimationFrame(()=>{const map=document.querySelector(`.pointMap[data-kind="${CSS.escape(info.kind)}"][data-point-map="${CSS.escape(info.side)}"]`);if(map)openFocus(map.closest('.bodyPanel'))}))}

document.addEventListener('click',e=>{if(!isMobile())return;const title=e.target.closest('.bodyPanel>h4');if(title){e.preventDefault();e.stopPropagation();openFocus(title.closest('.bodyPanel'));return}const panel=e.target.closest('.bodyPanel');if(panel&&!panel.classList.contains('arlab-body-focus')&&e.target.closest('.pointHelp')){e.preventDefault();openFocus(panel)}},false);

/* Guardar/eliminar un punto reconstruye el mapa en portal-v6.js. Recordamos la vista
   ampliada antes de ese cambio y la volvemos a abrir automáticamente después. */
document.addEventListener('click',e=>{if(!isMobile())return;const action=e.target.closest('#savePoint,#deletePoint');if(!action)return;const info=focusInfo();if(info)setTimeout(()=>reopen(info),0)},true);

/* Cancelar el editor no toca el mapa: simplemente mantiene el popup inferior abierto. */
document.addEventListener('keydown',e=>{if(e.key==='Escape'){if(document.querySelector('#modalRoot .modalBack'))return;closeFocus()}});
window.addEventListener('resize',()=>{if(!isMobile())closeFocus()});
})();
