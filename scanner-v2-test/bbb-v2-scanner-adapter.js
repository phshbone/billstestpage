(function(){
'use strict';
const RULES_URL='./bbb-rules-v1.5.2.json';
const INGREDIENT_FLAGS_KEY='bbbIngredientFlagsV152';
let rulesPromise=null;
let liveBarcodeControls=null;
let liveBarcodeLock=false;
const loadRules=()=>rulesPromise||(rulesPromise=fetch(RULES_URL,{cache:'no-store'}).then(r=>{if(!r.ok)throw new Error(`Rules HTTP ${r.status}`);return r.json();}).then(r=>{if(r.version!=='1.5.2'||r.status!=='authoritative')throw new Error('Wrong rules source');return r;}));
const e=s=>typeof escapeHtml==='function'?escapeHtml(String(s??'')):String(s??'').replace(/[&<>"']/g,c=>({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot',"'":'&#039;'}[c]));
const labelPersonal=s=>s==='works'?'Works for Me':s==='not_for_me'?'Not for Me':'Hold On';
const fmtDate=s=>{try{return new Date(s).toLocaleDateString();}catch(_){return String(s||'');}};
function nutrientRows(record){
  const labels={calories:'Calories',fat:'Fat',saturatedFat:'Saturated fat',carbohydrates:'Carbohydrates',fiber:'Fiber',sugars:'Sugars',addedSugars:'Added sugars',sugarAlcohols:'Sugar alcohols',protein:'Protein',sodium:'Sodium'};
  const units={calories:'kcal',fat:'g',saturatedFat:'g',carbohydrates:'g',fiber:'g',sugars:'g',addedSugars:'g',sugarAlcohols:'g',protein:'g',sodium:'mg'};
  const ps=record.nutrition?.perServing||{},p100=record.nutrition?.per100g||{};
  return Object.keys(labels).filter(k=>ps[k]!=null||p100[k]!=null).map(k=>`<tr><th>${labels[k]}</th><td>${ps[k]!=null?e(ps[k]+' '+units[k]):'—'}</td><td>${p100[k]!=null?e(p100[k]+' '+units[k]):'—'}</td></tr>`).join('');
}
function personalControls(record,personal){
  return `<section class="food-card-section"><h3>Your Decision</h3>${personal?`<p><strong>${e(labelPersonal(personal.status))}</strong> • ${e(fmtDate(personal.date))}${personal.mode?` • ${e(personal.mode)} mode`:''}</p>${personal.reason?`<p class="small-muted">${e(personal.reason)}</p>`:''}`:'<p class="small-muted">No personal decision saved yet.</p>'}
    <label class="small-muted" for="bbbDecisionTiming">When are you marking it?</label><select id="bbbDecisionTiming" class="search-box"><option value="before">before trying/eating</option><option value="after">after eating/reaction</option></select>
    <input id="bbbDecisionReason" class="search-box" placeholder="optional reason" value="${e(personal?.reason||'')}">
    <div class="food-result-actions"><button class="secondary-action compact-action" data-bbb-personal="works" type="button">works for me</button><button class="secondary-action compact-action" data-bbb-personal="hold" type="button">hold on</button><button class="secondary-action compact-action" data-bbb-personal="not_for_me" type="button">not for me</button></div>
    <details class="support-drawer"><summary>optional ingredient-level flag</summary><p class="small-muted">A product marked Not for Me does not automatically make every ingredient a trigger. Add an ingredient only if you deliberately want it recorded.</p><input id="bbbIngredientFlag" class="search-box" placeholder="ingredient to flag"><button class="secondary-action full-width" data-bbb-ingredient-flag type="button">save ingredient flag</button></details>
  </section>`;
}
function resultView(){
  const a=state.bbbLiveEvaluation,r=state.bbbLiveProduct;if(!a||!r)return null;
  const cls=a.key==='hold'?'ehh':a.key;
  const evidence=(a.evidence||[]).map(x=>`<li><strong>${e(x.label)}</strong> — ${e(x.type)}. ${e(x.reason)}</li>`).join('');
  const source=(r.sources||[]).map(s=>`${s.name}${s.updatedAt?` (updated ${s.updatedAt.slice(0,10)})`:''}`).join(' + ')||'unknown';
  const missing=(a.missing||[]).length?`<p><strong>Missing:</strong> ${e(a.missing.join(', '))}</p>`:'<p>No essential product facts are missing.</p>';
  const rows=nutrientRows(r);
  return `<div class="screen-content">${screenTitle('Scan',r.productName||'Barcode result')}
    <section class="food-card-hero"><div class="food-result-top"><div><div class="food-meta">${e(r.barcode)} • ${e(r.brand||'brand unavailable')}</div><h2>${e(r.productName||'Unknown product')}</h2></div><button class="rating-pill rating-${cls}" type="button">${e(a.label)}</button></div><div class="food-meta">Mode: ${e(state.mode)} • Rules: ${e(a.rulesVersion)} • Source: ${e(a.sourceText)}</div></section>
    <section class="food-card-section"><h3>Why ${e(a.label)}</h3><p><strong>Main food:</strong> ${e(a.mainFood)}</p><p>${e(a.reason)}</p>${evidence?`<ul>${evidence}</ul>`:''}${missing}</section>
    ${a.personal?`<section class="food-card-section"><h3>Personal History</h3><p>You marked this <strong>${e(labelPersonal(a.personal.status))}</strong> on ${e(fmtDate(a.personal.date))}.</p></section>`:''}
    <section class="food-card-section"><h3>Product Facts</h3><p><strong>Brand:</strong> ${e(r.brand||'not supplied')}</p><p><strong>Category:</strong> ${e(r.category||'not supplied')}</p><p><strong>Serving size:</strong> ${e(r.serving?.size||'missing')}</p><p><strong>Servings/container:</strong> ${e(r.serving?.servingsPerContainer||'not explicitly supplied')}</p><p><strong>Package:</strong> ${e(r.packageQuantity||'not supplied')}</p><p><strong>Database:</strong> ${e(source)}</p></section>
    <section class="food-card-section"><h3>Ingredients</h3><p>${e(r.ingredientsText||'Ingredients missing.')}</p></section>
    <section class="food-card-section"><h3>Nutrition Facts</h3>${rows?`<div style="overflow-x:auto"><table style="width:100%;border-collapse:collapse"><thead><tr><th style="text-align:left">Nutrient</th><th>per serving</th><th>per 100g</th></tr></thead><tbody>${rows}</tbody></table></div>`:'<p>Nutrition details are not available from the retrieved record.</p>'}</section>
    ${personalControls(r,a.personal)}
    <div class="food-card-actions"><button class="secondary-action" data-bbb-save-cupboard type="button">save to cupboard</button><button class="primary-action" data-action="new-camera-scan" type="button">scan another</button></div>
    ${state.savedNotice?`<p class="save-notice">${e(state.savedNotice)}</p>`:''}
  </div>`;
}
function decisionsPanel(){
  let all={};try{all=JSON.parse(localStorage.getItem(BBBScanner.DECISIONS_KEY)||'{}');}catch(_){}
  const rows=Object.values(all).sort((a,b)=>String(b.date).localeCompare(String(a.date))).slice(0,50);if(!rows.length)return '';
  return `<section class="input-card"><h3>Personal Food Decisions</h3><p class="small-muted">Change a saved decision here; future scans use the updated choice.</p><div class="list-stack">${rows.map(d=>`<article class="food-result-card"><div class="food-result-top"><div><strong>${e(d.brand?d.brand+' '+d.productName:d.productName||d.barcode)}</strong><span>${e(d.barcode)} • ${e(labelPersonal(d.status))} • ${e(fmtDate(d.date))}</span></div></div><div class="food-result-actions"><button class="secondary-action compact-action" data-bbb-history-status="works" data-barcode="${e(d.barcode)}">works</button><button class="secondary-action compact-action" data-bbb-history-status="hold" data-barcode="${e(d.barcode)}">hold on</button><button class="secondary-action compact-action" data-bbb-history-status="not_for_me" data-barcode="${e(d.barcode)}">not for me</button></div></article>`).join('')}</div></section>`;
}
function stopLiveBarcodeScanner(){
  try{liveBarcodeControls?.stop();}catch(_){}
  liveBarcodeControls=null;
  const video=document.getElementById('cameraVideo');
  if(video?.srcObject){try{video.srcObject.getTracks().forEach(t=>t.stop());}catch(_){}video.srcObject=null;}
  const overlay=document.getElementById('cameraOverlay');
  if(overlay){overlay.classList.remove('active');overlay.setAttribute('aria-hidden','true');}
  liveBarcodeLock=false;
}
async function handleLiveBarcode(code){
  try{
    state.cameraStage='barcode';state.cameraMessage=`Barcode ${code} found. Checking product facts…`;render();
    const rules=await loadRules();
    const product=await BBBScanner.retrieveProduct(code,{storage:localStorage});
    state.cameraStage='identify';state.cameraMessage='Applying food/form rules…';render();
    const evaluation=BBBScanner.evaluateProduct(product,rules,{mode:state.mode,storage:localStorage});
    state.bbbLiveProduct=product;state.bbbLiveEvaluation=evaluation;state.cameraStage='complete';state.cameraMessage=`${evaluation.label} • ${evaluation.reason}`;render();
  }catch(err){state.cameraStage='complete';state.cameraMessage=err.message||'Barcode scan failed.';state.bbbLiveProduct=null;state.bbbLiveEvaluation=null;render();}
}
async function openLiveBarcodeScanner(){
  state.bbbLiveProduct=null;state.bbbLiveEvaluation=null;state.scanPhotos=[];state.cameraMessage='Scanning live barcode…';state.cameraStage='barcode';
  const overlay=document.getElementById('cameraOverlay'),video=document.getElementById('cameraVideo'),hint=document.getElementById('cameraHint');
  if(!overlay||!video)return;
  overlay.classList.add('active');overlay.setAttribute('aria-hidden','false');
  if(hint)hint.textContent='Center the barcode in the frame. The scanner will read it automatically.';
  liveBarcodeLock=false;
  try{
    if(typeof ZXingBrowser==='undefined')throw new Error('Barcode decoder unavailable');
    const reader=new ZXingBrowser.BrowserMultiFormatReader();
    const cb=(result,err,controls)=>{
      if(result&&!liveBarcodeLock){
        liveBarcodeLock=true;
        const raw=result.getText?result.getText():String(result.text||result);
        const code=String(raw||'').replace(/\D/g,'');
        try{controls.stop();}catch(_){}
        stopLiveBarcodeScanner();
        if(code)handleLiveBarcode(code);
      }
    };
    liveBarcodeControls=await reader.decodeFromConstraints({audio:false,video:{facingMode:{ideal:'environment'},width:{ideal:1920},height:{ideal:1080}}},video,cb);
    if(hint)hint.textContent='Scanning… hold the barcode steady inside the frame.';
  }catch(err){
    if(hint)hint.textContent=err.message||'Scanner could not open.';
  }
}
function storeIngredientFlag(record){
  const term=(document.getElementById('bbbIngredientFlag')?.value||'').trim();if(!term){state.savedNotice='enter an ingredient before saving a flag.';render();return;}
  let all={};try{all=JSON.parse(localStorage.getItem(INGREDIENT_FLAGS_KEY)||'{}');}catch(_){}all[record.barcode]=all[record.barcode]||[];if(!all[record.barcode].some(x=>x.ingredient.toLowerCase()===term.toLowerCase()))all[record.barcode].push({ingredient:term,date:new Date().toISOString()});localStorage.setItem(INGREDIENT_FLAGS_KEY,JSON.stringify(all));state.savedNotice=`ingredient flag saved for this product: ${term}.`;render();
}
function bindAdapterEvents(){
  document.querySelectorAll('[data-bbb-personal]').forEach(btn=>btn.onclick=()=>{const record=state.bbbLiveProduct;if(!record)return;const status=btn.dataset.bbbPersonal;const reason=document.getElementById('bbbDecisionReason')?.value||'';const timing=document.getElementById('bbbDecisionTiming')?.value||'before';BBBScanner.saveDecision(localStorage,record,status,{mode:state.mode,timing,reason});loadRules().then(rules=>{state.bbbLiveEvaluation=BBBScanner.evaluateProduct(record,rules,{mode:state.mode,storage:localStorage});state.savedNotice=`${labelPersonal(status)} saved.`;render();});});
  document.querySelector('[data-bbb-ingredient-flag]')?.addEventListener('click',()=>storeIngredientFlag(state.bbbLiveProduct));
  document.querySelector('[data-bbb-save-cupboard]')?.addEventListener('click',()=>{const r=state.bbbLiveProduct,a=state.bbbLiveEvaluation;if(!r||!a)return;const id=`GTIN-${r.barcode}`;if(!state.cupboardItems.some(x=>x.id===id))state.cupboardItems.unshift({id,barcode:r.barcode,name:r.productName,brand:r.brand,rating:a.label,mode:state.mode,timestamp:new Date().toISOString()});state.cupboardItems=state.cupboardItems.slice(0,100);localStorage.setItem('bbbCupboardItems',JSON.stringify(state.cupboardItems));state.savedNotice='saved to Your Cupboard.';render();});
  document.querySelectorAll('[data-bbb-history-status]').forEach(btn=>btn.onclick=()=>{const barcode=btn.dataset.barcode;const d=BBBScanner.getDecision(localStorage,barcode);if(!d)return;BBBScanner.saveDecision(localStorage,{barcode,productName:d.productName,brand:d.brand},btn.dataset.bbbHistoryStatus,{mode:d.mode||state.mode,timing:d.timing||'before',reason:d.reason||''});state.savedNotice='personal decision updated.';render();});
}
function installHoldOnDisplayOverrides(){
  /* BBB HOLD ON DISPLAY OVERRIDES: retain legacy CSS key `ehh`, never show Ehh as a food verdict. */
  if(typeof getRatingLabel==='function') getRatingLabel=function(rating){if(rating==='Green')return 'good';if(rating==='Red')return 'ugly';return 'hold on';};
  if(typeof ratingPill==='function') ratingPill=function(value){const key=getRatingKey(value);const label=key==='good'?'good':key==='ugly'?'ugly':'hold on';return `<button class="rating-pill rating-${key}" data-action="rating-info" data-rating="${key}" type="button" aria-label="${label} rating explanation">${label}</button>`;};
  if(typeof foodPanel==='function') foodPanel=function(icon,title,foods){const visible=title==='ehh'?'hold on':title;return `<article class="food-panel food-panel-${e(title)}"><div class="food-panel-title"><span class="icon">${icon}</span><h3>${e(visible)}</h3></div><ul>${foods.map(food=>`<li>${e(food)}</li>`).join('')}</ul></article>`;};
  if(typeof infoToast==='function'){const original=infoToast;infoToast=function(){if(state.infoTopic==='rating-ehh')return `<div class="info-toast" role="status"><button data-action="close-info" type="button" aria-label="Close explanation">×</button><strong>hold on</strong><p>Hold On is a decision state for mixed, conditional, incomplete, or uncertain information. It is not a medium numeric risk score and does not mean a small portion is automatically safe.</p></div>`;return original();};}
}
function install(){
  if(typeof BBBScanner==='undefined'||typeof scanScreen!=='function'||typeof bindEvents!=='function')return setTimeout(install,50);
  installHoldOnDisplayOverrides();
  const originalScanScreen=scanScreen;scanScreen=function(){return resultView()||originalScanScreen();};
  const originalHistory=typeof historyScreen==='function'?historyScreen:null;if(originalHistory)historyScreen=function(){const base=originalHistory();return base.replace(/<\/div>\s*$/,'')+decisionsPanel()+'</div>';};
  const originalBind=bindEvents;bindEvents=function(){originalBind();bindAdapterEvents();};
  openCameraOverlay=openLiveBarcodeScanner;
  closeCameraOverlay=stopLiveBarcodeScanner;
  runCameraFoundationPipeline=()=>{};
  loadRules().catch(err=>console.error('BBB rules load failed',err));render();
}
install();
})();
