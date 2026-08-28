(function(root,factory){
  const api=factory();
  if(typeof module==='object'&&module.exports) module.exports=api;
  root.BBBScanner=api;
})(typeof globalThis!=='undefined'?globalThis:this,function(){
  'use strict';

  const ENGINE_VERSION='1.5.2';
  const DEFAULT_USDA_WORKER='https://bad-belly-usda.phshbone.workers.dev';
  const CACHE_KEY='bbbProductCacheV152';
  const DECISIONS_KEY='bbbPersonalDecisionsV152';

  const clean=v=>String(v==null?'':v).trim();
  const lower=v=>clean(v).toLowerCase();
  const nowIso=()=>new Date().toISOString();
  const num=v=>{const n=Number(v);return Number.isFinite(n)?n:null;};
  const has=(text,term)=>lower(text).includes(lower(term));
  const hasAny=(text,terms=[])=>terms.some(t=>has(text,t));
  const uniq=a=>[...new Set((a||[]).filter(Boolean))];

  function safeRead(storage,key,fallback){
    try { const raw=storage&&storage.getItem(key); return raw?JSON.parse(raw):fallback; }
    catch(_){ return fallback; }
  }
  function safeWrite(storage,key,value){
    try { if(storage) storage.setItem(key,JSON.stringify(value)); return true; }
    catch(_){ return false; }
  }

  function offNutrients(n={}){
    const fields={calories:'energy-kcal',fat:'fat',saturatedFat:'saturated-fat',carbohydrates:'carbohydrates',fiber:'fiber',sugars:'sugars',addedSugars:'added-sugars',sugarAlcohols:'polyols',protein:'proteins',sodium:'sodium'};
    const per100g={},perServing={};
    for(const [out,key] of Object.entries(fields)){per100g[out]=num(n[`${key}_100g`]);perServing[out]=num(n[`${key}_serving`]);if(out==='sodium'){if(per100g[out]!=null)per100g[out]*=1000;if(perServing[out]!=null)perServing[out]*=1000;}}
    return {per100g,perServing};
  }

  function normalizeOFF(product,barcode){
    const nutr=offNutrients(product.nutriments||{});
    const ingredientText=clean(product.ingredients_text||product.ingredients_text_en);
    const servingSize=clean(product.serving_size);
    const servingsPerContainer=product.number_of_servings!=null?clean(product.number_of_servings):'';
    const quantity=clean(product.quantity||[product.product_quantity,product.product_quantity_unit].filter(Boolean).join(' '));
    return {barcode:clean(barcode||product.code),productName:clean(product.product_name||product.product_name_en||product.generic_name),brand:clean(product.brands),category:clean(product.categories),ingredientsText:ingredientText,parsedIngredientFamilies:[],ingredientForms:[],nutrition:nutr,serving:{size:servingSize,servingsPerContainer},packageQuantity:quantity,sources:[{name:'Open Food Facts',retrievedAt:nowIso(),updatedAt:product.last_modified_t?new Date(product.last_modified_t*1000).toISOString():''}],confidence:'database',completeness:{},verificationState:'database',fallbackPhotoRefs:[],rulesVersion:ENGINE_VERSION,raw:{off:product}};
  }

  function mapUSDANutrients(food){
    const per100g={},perServing={};
    const alias={'Energy':'calories','Total lipid (fat)':'fat','Fatty acids, total saturated':'saturatedFat','Carbohydrate, by difference':'carbohydrates','Fiber, total dietary':'fiber','Sugars, total including NLEA':'sugars','Sugars, added':'addedSugars','Sugar alcohol':'sugarAlcohols','Protein':'protein','Sodium, Na':'sodium'};
    if(food.nutrients&&typeof food.nutrients==='object'&&!Array.isArray(food.nutrients)){
      for(const [k,v] of Object.entries(food.nutrients)){const target=alias[k]||k;if(['calories','fat','saturatedFat','carbohydrates','fiber','sugars','addedSugars','sugarAlcohols','protein','sodium'].includes(target)) perServing[target]=num(v&&typeof v==='object'?(v.value??v.amount):v);}
    }
    const arr=food.foodNutrients||[];
    for(const item of arr){const name=clean(item.nutrientName||item.nutrient?.name);const target=alias[name];if(!target)continue;per100g[target]=num(item.value??item.amount);}
    return {per100g,perServing};
  }

  function normalizeUSDAServing(food){
    const metric=clean([food.servingSize,food.servingSizeUnit].filter(v=>v!=null&&v!=='').join(' '));
    const household=clean(food.householdServingFullText);
    const size=household&&metric?`${household} (${metric})`:(household||metric);
    const servingsPerContainer=food.numberOfServings!=null?clean(food.numberOfServings):'';
    return {size,servingsPerContainer};
  }

  function normalizeUSDA(food,barcode){
    return {barcode:clean(food.gtinUpc||barcode),productName:clean(food.description||food.lowercaseDescription),brand:clean(food.brandName||food.brandOwner),category:clean(food.brandedFoodCategory||food.foodCategory),ingredientsText:clean(food.ingredients),parsedIngredientFamilies:[],ingredientForms:[],nutrition:mapUSDANutrients(food),serving:normalizeUSDAServing(food),packageQuantity:clean(food.packageWeight||food.packageQuantity),sources:[{name:'USDA FoodData Central via protected Worker',retrievedAt:nowIso(),updatedAt:clean(food.publicationDate||food.modifiedDate)}],confidence:'database',completeness:{},verificationState:'database',fallbackPhotoRefs:[],rulesVersion:ENGINE_VERSION,raw:{usda:food}};
  }

  function mergeRecords(primary,supplement){
    if(!primary)return supplement;if(!supplement)return primary;
    const out=JSON.parse(JSON.stringify(primary));
    for(const k of ['productName','brand','category','ingredientsText','packageQuantity']) if(!clean(out[k])&&clean(supplement[k])) out[k]=supplement[k];
    out.serving=out.serving||{};for(const k of ['size','servingsPerContainer']) if(!clean(out.serving[k])&&clean(supplement.serving&&supplement.serving[k])) out.serving[k]=supplement.serving[k];
    out.nutrition=out.nutrition||{per100g:{},perServing:{}};
    for(const basis of ['per100g','perServing']){out.nutrition[basis]=out.nutrition[basis]||{};const src=(supplement.nutrition&&supplement.nutrition[basis])||{};for(const [k,v] of Object.entries(src)) if(out.nutrition[basis][k]==null&&v!=null) out.nutrition[basis][k]=v;}
    out.sources=[...(primary.sources||[]),...(supplement.sources||[])];out.raw={...(primary.raw||{}),...(supplement.raw||{})};return out;
  }

  function completeness(record){
    const ingredients=!!clean(record.ingredientsText),serving=!!clean(record.serving&&record.serving.size),name=!!clean(record.productName);
    const nutrition=Object.values((record.nutrition&&record.nutrition.per100g)||{}).some(v=>v!=null)||Object.values((record.nutrition&&record.nutrition.perServing)||{}).some(v=>v!=null);
    const missing=[];if(!name)missing.push('product name');if(!ingredients)missing.push('ingredients');if(!serving)missing.push('serving information');
    return {name,ingredients,serving,nutrition,essentialComplete:name&&ingredients&&serving,missing};
  }

  function cacheGet(storage,barcode){const all=safeRead(storage,CACHE_KEY,{});return all[clean(barcode)]||null;}
  function cacheSet(storage,record){const all=safeRead(storage,CACHE_KEY,{});all[record.barcode]={...record,cachedAt:nowIso()};const keys=Object.keys(all);if(keys.length>250){keys.sort((a,b)=>clean(all[a].cachedAt).localeCompare(clean(all[b].cachedAt)));while(keys.length>250)delete all[keys.shift()];}safeWrite(storage,CACHE_KEY,all);return record;}

  async function fetchJson(fetchFn,url){const res=await fetchFn(url,{headers:{Accept:'application/json'}});let data=null;try{data=await res.json();}catch(_){throw new Error(`Invalid JSON from ${url}`);}if(!res.ok)throw new Error((data&&data.error)||`HTTP ${res.status}`);return data;}

  async function lookupOFF(barcode,fetchFn){
    const fields=['code','product_name','product_name_en','generic_name','brands','categories','ingredients_text','ingredients_text_en','nutriments','serving_size','number_of_servings','quantity','product_quantity','product_quantity_unit','last_modified_t'].join(',');
    const url=`https://world.openfoodfacts.org/api/v2/product/${encodeURIComponent(barcode)}.json?fields=${fields}`;const data=await fetchJson(fetchFn,url);return data&&data.status===1&&data.product?normalizeOFF(data.product,barcode):null;
  }

  async function lookupUSDA(barcode,fetchFn,worker=DEFAULT_USDA_WORKER){
    const url=`${worker}/search?query=${encodeURIComponent(barcode)}&pageSize=10&mode=all`;const data=await fetchJson(fetchFn,url);if(!data||data.ok===false)throw new Error((data&&data.error)||'USDA lookup failed');const foods=Array.isArray(data.foods)?data.foods:[];if(!foods.length)return null;const exact=foods.find(f=>clean(f.gtinUpc)===clean(barcode))||foods[0];return normalizeUSDA(exact,barcode);
  }

  async function retrieveProduct(barcode,opts={}){
    barcode=clean(barcode);if(!barcode)throw new Error('Barcode is required');const storage=opts.storage||(typeof localStorage!=='undefined'?localStorage:null);const fetchFn=opts.fetchFn||(typeof fetch!=='undefined'?fetch.bind(globalThis):null);if(!fetchFn)throw new Error('Fetch unavailable');
    const cached=cacheGet(storage,barcode);if(cached)return {...cached,retrieval:{cacheHit:true,attempts:['local verified cache']}};
    const attempts=[];let off=null,usda=null;const errors=[];try{attempts.push('Open Food Facts');off=await lookupOFF(barcode,fetchFn);}catch(e){errors.push(`Open Food Facts: ${e.message}`);}const offComp=off?completeness(off):null;
    if(!off||!offComp.essentialComplete||!offComp.nutrition){try{attempts.push('USDA FoodData Central');usda=await lookupUSDA(barcode,fetchFn,opts.usdaWorker||DEFAULT_USDA_WORKER);}catch(e){errors.push(`USDA: ${e.message}`);}}
    let record=mergeRecords(off,usda);if(!record)return {barcode,notFound:true,sources:[],completeness:{essentialComplete:false,missing:['product facts']},retrieval:{cacheHit:false,attempts,errors},rulesVersion:ENGINE_VERSION};
    record.barcode=barcode;record.completeness=completeness(record);record.retrieval={cacheHit:false,attempts,errors};cacheSet(storage,record);return record;
  }

  function getDecision(storage,barcode){return safeRead(storage,DECISIONS_KEY,{})[clean(barcode)]||null;}
  function saveDecision(storage,record,status,meta={}){
    if(!['works','hold','not_for_me'].includes(status))throw new Error('Invalid personal status');const all=safeRead(storage,DECISIONS_KEY,{});const prior=all[record.barcode];
    all[record.barcode]={barcode:record.barcode,productName:record.productName||'',brand:record.brand||'',status,date:nowIso(),mode:meta.mode||'normal',reason:clean(meta.reason),timing:meta.timing==='after'?'after':'before',ingredientFlag:meta.ingredientFlag||null,history:uniq([...(prior&&prior.history||[]),prior&&prior.status?`${prior.date}|${prior.status}`:''])};safeWrite(storage,DECISIONS_KEY,all);return all[record.barcode];
  }

  function productText(record){return [record.productName,record.brand,record.category,record.ingredientsText].filter(Boolean).join(' | ').toLowerCase();}
  function preparationText(record){return [record.productName,record.category,record.ingredientsText].filter(Boolean).join(' ').toLowerCase();}
  function matchedEntries(text,entries,field='terms'){return (entries||[]).filter(e=>hasAny(text,e[field]||[]));}

  function parseForms(record,rules){const text=productText(record),hits=[];for(const fam of rules.formFamilies||[])for(const form of fam.forms||[])if(hasAny(text,form.terms||[]))hits.push({familyId:fam.id,familyLabel:fam.label,form:form.name,result:form.result,kind:form.kind,strength:form.strength||'',matched:(form.terms||[]).filter(t=>has(text,t))});return hits;}
  function identifyMain(record,rules){const text=lower([record.productName,record.category].join(' '));const matches=(rules.mainFoodPatterns||[]).filter(p=>hasAny(text,p.terms||[]));if(matches.length)return matches[0];return {id:'product',main:clean(record.productName)||'packaged food',normal:'hold',flare:'hold',reason:'The product name and construction establish the starting lane.'};}

  function evaluateProduct(record,rules,opts={}){
    if(!rules||rules.version!=='1.5.2')throw new Error('Authoritative rules v1.5.2 required');const mode=lower(opts.mode)==='flare'?'flare':'normal';const storage=opts.storage||(typeof localStorage!=='undefined'?localStorage:null);const personal=opts.personalDecision||getDecision(storage,record.barcode);
    if(record.notFound)return {label:'HOLD ON',key:'hold',mainFood:'unknown product',reason:'No product record was found in the configured databases.',evidence:[],missing:['product facts'],sourceText:'No database match',rulesVersion:rules.version,personal};
    const comp=record.completeness&&record.completeness.missing?record.completeness:completeness(record);const text=productText(record),prep=preparationText(record),evidence=[];const main=identifyMain(record,rules);const forms=parseForms(record,rules);record.parsedIngredientFamilies=uniq(forms.map(f=>f.familyId));record.ingredientForms=forms;
    if(personal&&personal.status==='not_for_me'){evidence.push({type:'personal hard stop',label:'Previously marked Not for Me',reason:personal.reason||'Your saved personal decision takes precedence.'});return finish('ugly','UGLY',main,`You marked this Not for Me on ${new Date(personal.date).toLocaleDateString()}.`,evidence,comp,record,rules,personal);}
    const structural=matchedEntries(text,rules.structuralDont);if(structural.length){for(const h of structural)evidence.push({type:'physical structure',label:h.label,reason:h.reason});return finish('ugly','UGLY',main,structural[0].reason,evidence,comp,record,rules,personal);}
    const prepDont=matchedEntries(prep,rules.preparationDont);if(prepDont.length){for(const h of prepDont)evidence.push({type:'preparation',label:h.label,reason:h.reason});return finish('ugly','UGLY',main,prepDont[0].reason,evidence,comp,record,rules,personal);}
    const formUgly=forms.filter(f=>f.result==='ugly');if(formUgly.length){for(const f of formUgly)evidence.push({type:'ingredient form',label:`${f.familyLabel}: ${f.form}`,reason:'This form preserves the structural concern.'});return finish('ugly','UGLY',main,'A structural ingredient form was identified.',evidence,comp,record,rules,personal);}
    if(!comp.essentialComplete){evidence.push({type:'incomplete data',label:'Essential product facts missing',reason:`Missing: ${comp.missing.join(', ')}.`});return finish('hold','HOLD ON',main,'Essential facts are missing, so the app will not fabricate certainty.',evidence,comp,record,rules,personal);}
    const conditional=[];for(const f of forms.filter(f=>f.result==='hold'))conditional.push({type:'ingredient form',label:`${f.familyLabel}: ${f.form}`,reason:`This ${f.kind.replace(/_/g,' ')} form requires a conditional read.`});for(const fam of rules.conditionalFamilies||[])if(hasAny(text,fam.terms||[]))conditional.push({type:fam.doseSensitive?'dose-sensitive concern':'conditional ingredient',label:fam.label,reason:fam.reason,modeResult:fam[mode]||'hold'});if(personal&&personal.status==='hold')conditional.unshift({type:'personal history',label:'You marked this Hold On',reason:personal.reason||'Your saved personal decision keeps this conditional.'});
    const modeUgly=conditional.filter(c=>c.modeResult==='ugly');if(modeUgly.length){evidence.push(...conditional);return finish('ugly','UGLY',main,modeUgly[0].reason,evidence,comp,record,rules,personal);}
    const doMatches=matchedEntries(lower([record.productName,record.category,record.ingredientsText].join(' ')),rules.doPatterns);const mainGood=(main[mode]||main.normal)==='good';
    if((doMatches.length||mainGood)&&!conditional.length){const h=doMatches[0]||main;evidence.push({type:'clear Do pattern',label:h.label||main.main,reason:h.reason||main.reason});if(personal&&personal.status==='works')evidence.push({type:'personal history',label:'Works for Me',reason:personal.reason||'Your saved personal history agrees with the general guidance.'});return finish('good','GOOD',main,h.reason||main.reason,evidence,comp,record,rules,personal);}
    if(conditional.length){evidence.push(...conditional);if(personal&&personal.status==='works')evidence.unshift({type:'personal history',label:'Works for Me',reason:personal.reason||'Your saved personal history is positive, but the general guidance remains conditional.'});return finish('hold','HOLD ON',main,'The product is mixed or conditional; ingredient form, dose-sensitive factors, preparation, or personal history need to stay visible.',evidence,comp,record,rules,personal);}
    if(doMatches.length||mainGood){const h=doMatches[0]||main;evidence.push({type:'clear Do pattern',label:h.label||main.main,reason:h.reason||main.reason});return finish('good','GOOD',main,h.reason||main.reason,evidence,comp,record,rules,personal);}
    evidence.push({type:'uncertain',label:'No decisive structural Do/Don’t found',reason:'The food remains a decision state rather than being forced into a numeric middle band.'});return finish('hold','HOLD ON',main,'The available facts do not support a clear Good or Ugly decision.',evidence,comp,record,rules,personal);
  }

  function finish(key,label,main,reason,evidence,comp,record,rules,personal){return {key,label,mainFood:main.main||main.label||record.productName||'product',reason,evidence,missing:comp.missing||[],sourceText:(record.sources||[]).map(s=>s.name).join(' + ')||'unknown source',rulesVersion:rules.version,personal,record};}
  function getBarcodeReader(){const ZX=typeof globalThis!=='undefined'&&globalThis.ZXingBrowser;if(!ZX)return null;try{return new ZX.BrowserMultiFormatReader();}catch(_){return null;}}

  return {ENGINE_VERSION,DEFAULT_USDA_WORKER,CACHE_KEY,DECISIONS_KEY,normalizeOFF,normalizeUSDA,mergeRecords,completeness,retrieveProduct,lookupOFF,lookupUSDA,evaluateProduct,getDecision,saveDecision,parseForms,identifyMain,getBarcodeReader};
});
