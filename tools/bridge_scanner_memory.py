from pathlib import Path
import re

p = Path('index.html')
text = p.read_text(encoding='utf-8')

v2 = 'BBB SCANNER MEMORY BRIDGE v2'
if v2 in text:
    print('scanner memory bridge v2 already present')
    raise SystemExit(0)

# Ensure bridge storage keys exist for older test builds.
if 'const CUPBOARD_KEY="bbbCupboardItems";' not in text:
    old = 'const STORAGE_KEY="bbb_v123_saved_foods";\nconst CHECKIN_KEY="bbb_v150_daily_checkins";'
    new = 'const STORAGE_KEY="bbb_v123_saved_foods";\nconst CUPBOARD_KEY="bbbCupboardItems";\nconst FOOD_LOG_KEY="bbbFoodLogs";\nconst CHECKIN_KEY="bbb_v150_daily_checkins";'
    if old not in text:
        raise SystemExit('storage constant anchor not found')
    text = text.replace(old, new, 1)

# Keep the visible status immediately below the action buttons.
old_actions = '<div class="button-row three-actions"><button class="secondary-action" data-action="save-current" type="button">save it</button><button class="primary-action" data-action="ate-current" type="button">ate it</button><button class="secondary-action" data-action="junk-current" type="button">junk for now</button></div>${ingredientDrawer}'
new_actions = '<div class="button-row three-actions"><button class="secondary-action" data-action="save-current" type="button">save it</button><button class="primary-action" data-action="ate-current" type="button">ate it</button><button class="secondary-action" data-action="junk-current" type="button">junk for now</button></div>${state.savedNotice?`<p class="save-notice" role="status">${escapeHtml(state.savedNotice)}</p>`:""}${ingredientDrawer}'
if old_actions in text:
    text = text.replace(old_actions, new_actions, 1)

old_notice = '${a?resultCard(a):""}${state.savedNotice?`<p class="save-notice">${escapeHtml(state.savedNotice)}</p>`:""}'
new_notice = '${a?resultCard(a):(state.savedNotice?`<p class="save-notice" role="status">${escapeHtml(state.savedNotice)}</p>`:"")}'
if old_notice in text:
    text = text.replace(old_notice, new_notice, 1)

start = text.find('/* BBB SCANNER MEMORY BRIDGE v1 */')
if start == -1:
    start = text.find('function getLocalList(key)')
if start == -1:
    raise SystemExit('existing scanner memory bridge not found')
end = text.find('function savedFoodsList()', start)
if end == -1:
    raise SystemExit('savedFoodsList anchor not found')

replacement = r'''/* BBB SCANNER MEMORY BRIDGE v2 */
function getLocalList(key){try{const v=JSON.parse(localStorage.getItem(key)||"[]");return Array.isArray(v)?v:[];}catch(e){return [];}}
function writeListVerified(key,items,matchFn){
  try{
    localStorage.setItem(key,JSON.stringify(items));
    const check=JSON.parse(localStorage.getItem(key)||"[]");
    return Array.isArray(check)&&(!matchFn||check.some(matchFn));
  }catch(e){return false;}
}
function currentScanIdentity(){
  const p=state.barcodeProduct||{};
  const barcode=barcodeDigits(p.code||state.barcodeValue||"");
  return {
    barcode,
    name:p.name||state.lastAnalysis?.detected||state.foodName||"Scanned food",
    brand:p.brand||"",
    source:p.source||state.currentSource||state.barcodeSource||"Manual",
    productText:p.text||state.ingredientText||""
  };
}
function canonicalVerdict(value){const label=String(value||"").trim().toLowerCase();if(label==="ehh"||label==="hold on"||label==="hold")return "HOLD ON";if(label==="good")return "GOOD";if(label==="ugly")return "UGLY";return String(value||"HOLD ON").toUpperCase();}
function sameProduct(item,identity){
  if(identity.barcode&&String(item?.barcode||"")===identity.barcode)return true;
  const a=String(item?.productName||item?.name||item?.detected||"").trim().toLowerCase();
  const b=String(identity.name||"").trim().toLowerCase();
  return !!a&&!!b&&a===b;
}
function recentDuplicate(items,identity,kind,nowMs,windowMs=15000){
  return items.find(item=>{
    if(item?.kind!==kind||!sameProduct(item,identity))return false;
    const t=Date.parse(item.timestamp||item.createdAt||"");
    return Number.isFinite(t)&&Math.abs(nowMs-t)<=windowMs;
  });
}
function saveCurrentFood(kind="saved"){
  if(!state.lastAnalysis){state.savedNotice="Run a check first.";render();return;}
  const identity=currentScanIdentity();
  const now=new Date();
  const nowMs=now.getTime();
  const timestamp=now.toISOString();
  const displayRating=ratingLabel(state.lastAnalysis.active);
  const verdict=canonicalVerdict(displayRating);
  const eventId=crypto?.randomUUID?.()||`evt-${nowMs}-${Math.random().toString(36).slice(2)}`;
  const recordId=identity.barcode?`GTIN-${identity.barcode}`:`SCAN-${timestamp}`;
  const previousMemory=getSavedFoods();

  if(recentDuplicate(previousMemory,identity,kind,nowMs)){
    state.savedNotice=kind==="ate"?"Already logged just now — no duplicate meal was added.":kind==="saved"?"Already saved just now — no duplicate was added.":"Already marked just now.";
    render();
    return;
  }

  const base={
    id:eventId,eventId,kind,
    detected:state.lastAnalysis.detected,
    productName:identity.name,
    barcode:identity.barcode,
    brand:identity.brand,
    source:identity.source,
    productText:identity.productText,
    rating:displayRating,
    verdict,
    mode:state.mode,
    category:state.lastAnalysis.primaryCategory||"unknown",
    ingredientFamilies:(state.lastAnalysis.ingredientFamilies||[]).map(x=>x.id),
    ingredients:state.lastAnalysis.rawIngredients||[],
    nutrition:state.lastAnalysis.nutrition||{},
    timestamp,
    createdAt:now.toLocaleString(),
    origin:identity.barcode?"barcode-scanner":"manual-or-ocr"
  };

  const nextMemory=[base,...previousMemory].slice(0,40);
  const memoryOK=writeListVerified(STORAGE_KEY,nextMemory,x=>x?.eventId===eventId||x?.id===eventId);
  if(!memoryOK){
    state.savedNotice="Storage could not be verified. Nothing was confirmed saved.";
    render();
    return;
  }

  let targetOK=true;
  if(kind==="saved"){
    const cupboard=getLocalList(CUPBOARD_KEY);
    const entry={id:recordId,eventId,barcode:identity.barcode,name:identity.name,brand:identity.brand,rating:verdict,mode:state.mode,timestamp,source:identity.source,ingredients:base.ingredients,ingredientFamilies:base.ingredientFamilies,nutrition:base.nutrition,origin:base.origin};
    const existing=cupboard.findIndex(x=>(identity.barcode&&String(x?.barcode||"")===identity.barcode)||x?.id===recordId);
    if(existing>=0)cupboard.splice(existing,1);
    const next=[entry,...cupboard].slice(0,100);
    targetOK=writeListVerified(CUPBOARD_KEY,next,x=>x?.eventId===eventId||x?.id===recordId);
  }else if(kind==="ate"){
    const logs=getLocalList(FOOD_LOG_KEY);
    if(recentDuplicate(logs,identity,"ate",nowMs)){
      writeListVerified(STORAGE_KEY,previousMemory);
      state.savedNotice="Already logged just now — no duplicate meal was added.";
      render();
      return;
    }
    const entry={id:eventId,eventId,kind:"ate",barcode:identity.barcode,name:identity.name,productName:identity.name,brand:identity.brand,rating:verdict,mode:state.mode,timestamp,source:identity.source,ingredients:base.ingredients,ingredientFamilies:base.ingredientFamilies,nutrition:base.nutrition,origin:base.origin};
    targetOK=writeListVerified(FOOD_LOG_KEY,[entry,...logs].slice(0,100),x=>x?.eventId===eventId||x?.id===eventId);
  }

  if(!targetOK){
    writeListVerified(STORAGE_KEY,previousMemory);
    state.savedNotice="The action could not be verified in storage, so it was not reported as saved.";
    render();
    return;
  }

  state.savedNotice=kind==="ate"?"Ate it logged and verified in food history.":kind==="saved"?"Saved and verified in Cupboard.":"Junked for now. It is not marked as a permanent trigger.";
  render();
}
'''

text = text[:start] + replacement + text[end:]
p.write_text(text, encoding='utf-8')

required = [
    v2,
    'writeListVerified',
    'recentDuplicate',
    'Ate it logged and verified in food history.',
    'Saved and verified in Cupboard.',
    'Already logged just now — no duplicate meal was added.'
]
for needle in required:
    if needle not in text:
        raise SystemExit(f'missing expected marker: {needle}')

print('patched scanner memory bridge v2')
