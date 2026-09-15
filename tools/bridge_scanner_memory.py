from pathlib import Path
import re

p = Path('index.html')
text = p.read_text(encoding='utf-8')
marker = 'BBB SCANNER MEMORY BRIDGE v1'

if marker in text:
    print('scanner memory bridge already present')
    raise SystemExit(0)

old_constants = 'const STORAGE_KEY="bbb_v123_saved_foods";\nconst CHECKIN_KEY="bbb_v150_daily_checkins";'
new_constants = 'const STORAGE_KEY="bbb_v123_saved_foods";\nconst CUPBOARD_KEY="bbbCupboardItems";\nconst FOOD_LOG_KEY="bbbFoodLogs";\nconst CHECKIN_KEY="bbb_v150_daily_checkins";'
if old_constants not in text:
    raise SystemExit('storage constant anchor not found')
text = text.replace(old_constants, new_constants, 1)

old_actions = '<div class="button-row three-actions"><button class="secondary-action" data-action="save-current" type="button">save it</button><button class="primary-action" data-action="ate-current" type="button">ate it</button><button class="secondary-action" data-action="junk-current" type="button">junk for now</button></div>${ingredientDrawer}'
new_actions = '<div class="button-row three-actions"><button class="secondary-action" data-action="save-current" type="button">save it</button><button class="primary-action" data-action="ate-current" type="button">ate it</button><button class="secondary-action" data-action="junk-current" type="button">junk for now</button></div>${state.savedNotice?`<p class="save-notice" role="status">${escapeHtml(state.savedNotice)}</p>`:""}${ingredientDrawer}'
if old_actions not in text:
    raise SystemExit('result action anchor not found')
text = text.replace(old_actions, new_actions, 1)

old_notice = '${a?resultCard(a):""}${state.savedNotice?`<p class="save-notice">${escapeHtml(state.savedNotice)}</p>`:""}'
new_notice = '${a?resultCard(a):(state.savedNotice?`<p class="save-notice" role="status">${escapeHtml(state.savedNotice)}</p>`:"")}'
if old_notice not in text:
    raise SystemExit('outer notice anchor not found')
text = text.replace(old_notice, new_notice, 1)

pattern = re.compile(r'function saveCurrentFood\(kind="saved"\)\{.*?\}\nfunction savedFoodsList\(\)', re.S)
match = pattern.search(text)
if not match:
    raise SystemExit('saveCurrentFood function not found')

replacement = r'''/* BBB SCANNER MEMORY BRIDGE v1 */
function getLocalList(key){try{const v=JSON.parse(localStorage.getItem(key)||"[]");return Array.isArray(v)?v:[];}catch(e){return [];}}
function setLocalList(key,items){localStorage.setItem(key,JSON.stringify(items));}
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
function saveCurrentFood(kind="saved"){
  if(!state.lastAnalysis){state.savedNotice="Run a check first.";render();return;}
  const identity=currentScanIdentity();
  const now=new Date();
  const timestamp=now.toISOString();
  const displayRating=ratingLabel(state.lastAnalysis.active);
  const verdict=canonicalVerdict(displayRating);
  const id=identity.barcode?`GTIN-${identity.barcode}`:`SCAN-${timestamp}`;
  const base={
    id:crypto?.randomUUID?.()||String(Date.now()),
    kind,
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

  const items=getSavedFoods();
  items.unshift(base);
  setSavedFoods(items.slice(0,40));

  if(kind==="saved"){
    const cupboard=getLocalList(CUPBOARD_KEY);
    const entry={id,barcode:identity.barcode,name:identity.name,brand:identity.brand,rating:verdict,mode:state.mode,timestamp,source:identity.source,ingredients:base.ingredients,ingredientFamilies:base.ingredientFamilies,nutrition:base.nutrition,origin:base.origin};
    const existing=cupboard.findIndex(x=>(identity.barcode&&String(x.barcode||"")===identity.barcode)||x.id===id);
    if(existing>=0)cupboard.splice(existing,1);
    cupboard.unshift(entry);
    setLocalList(CUPBOARD_KEY,cupboard.slice(0,100));
    state.savedNotice=identity.barcode?"Saved to Cupboard. Barcode product details were kept with it.":"Saved to Cupboard and Personal Food Memory.";
  }else if(kind==="ate"){
    const logs=getLocalList(FOOD_LOG_KEY);
    logs.unshift({id,barcode:identity.barcode,name:identity.name,brand:identity.brand,rating:verdict,mode:state.mode,timestamp,source:identity.source,ingredients:base.ingredients,ingredientFamilies:base.ingredientFamilies,nutrition:base.nutrition,origin:base.origin});
    setLocalList(FOOD_LOG_KEY,logs.slice(0,100));
    state.savedNotice=identity.barcode?"Ate it logged. This scanned product is now in your food history.":"Ate it logged in your food history.";
  }else{
    state.savedNotice="Junked for now. It is not marked as a permanent trigger.";
  }
  render();
}
function savedFoodsList()'''

text = text[:match.start()] + replacement + text[match.end():]
p.write_text(text, encoding='utf-8')

required = [
    marker,
    'const CUPBOARD_KEY="bbbCupboardItems"',
    'const FOOD_LOG_KEY="bbbFoodLogs"',
    'Ate it logged. This scanned product is now in your food history.',
    'Saved to Cupboard. Barcode product details were kept with it.',
    'role="status"',
    'canonicalVerdict'
]
for needle in required:
    if needle not in text:
        raise SystemExit(f'missing expected marker: {needle}')

print('patched and verified scanner memory bridge')
