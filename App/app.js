/* ============================================================
   10x Chef — meal planning + smart grocery list
   Single-file app. Data persists on this device via localStorage.
   ============================================================ */

/* ---------- Persistent storage helpers ---------- */
const K = { recipes:'mise:recipes', plan:'mise:plan', checked:'mise:checked', layout:'mise:layout', pantry:'mise:pantry' };

/* Where the 10x Chef backend (FastAPI scraper) is running.
   Local testing:  http://127.0.0.1:8000
   Production:     your public https URL (e.g. the Cloudflare tunnel). */
/* Where the Easy Recipe Manager backend (FastAPI scraper) is running.
   The app calls `${API_BASE}/scrape`, so requests resolve to e.g.
   https://api.emmettcatanese.com/recipes/scrape
   No trailing slash (the code appends the path).
   Local testing: 'http://127.0.0.1:8000' with the route at '/scrape' */
const API_BASE = 'https://api.emmettcatanese.com/recipes';

/* Recipes, plan, pantry and settings are stored on this device in localStorage. */
async function load(key, fallback){
  try{ const v = localStorage.getItem(key); return v!=null ? JSON.parse(v) : fallback; }
  catch(e){ return fallback; }
}
async function save(key, val){
  try{ localStorage.setItem(key, JSON.stringify(val)); }
  catch(e){ console.error('save failed', e); }
}

/* ---------- Units & quantity math ---------- */
const UNIT_SYNONYMS = {
  teaspoon:'tsp',teaspoons:'tsp',tsp:'tsp',tsps:'tsp',
  tablespoon:'tbsp',tablespoons:'tbsp',tbsp:'tbsp',tbsps:'tbsp',tbs:'tbsp',
  'fluid ounce':'fl oz','fluid ounces':'fl oz','fl oz':'fl oz',floz:'fl oz','fl. oz':'fl oz',
  cup:'cup',cups:'cup',
  pint:'pint',pints:'pint',pt:'pint',
  quart:'quart',quarts:'quart',qt:'quart',
  gallon:'gallon',gallons:'gallon',gal:'gallon',
  milliliter:'ml',milliliters:'ml',millilitre:'ml',millilitres:'ml',ml:'ml',
  liter:'l',liters:'l',litre:'l',litres:'l',l:'l',
  gram:'g',grams:'g',g:'g',gr:'g',
  kilogram:'kg',kilograms:'kg',kg:'kg',
  ounce:'oz',ounces:'oz',oz:'oz',
  pound:'lb',pounds:'lb',lb:'lb',lbs:'lb',
  clove:'clove',cloves:'clove',
  can:'can',cans:'can', slice:'slice',slices:'slice', stick:'stick',sticks:'stick',
  head:'head',heads:'head', bunch:'bunch',bunches:'bunch', sprig:'sprig',sprigs:'sprig',
  pinch:'pinch',pinches:'pinch', piece:'piece',pieces:'piece', leaf:'leaf',leaves:'leaf',
  stalk:'stalk',stalks:'stalk', package:'package',packages:'package',pkg:'package',
  jar:'jar',jars:'jar', box:'box',boxes:'box', sheet:'sheet',sheets:'sheet', dash:'dash',dashes:'dash'
};
const VOL_ML = { tsp:4.92892, tbsp:14.7868, 'fl oz':29.5735, cup:236.588, pint:473.176, quart:946.353, gallon:3785.41, ml:1, l:1000 };
const WT_G   = { g:1, kg:1000, oz:28.3495, lb:453.592 };
const METRIC = new Set(['ml','l','g','kg']);

function unitCategory(u){
  if(VOL_ML[u]!=null) return 'vol';
  if(WT_G[u]!=null) return 'wt';
  if(!u) return 'count';
  return 'unit:'+u; // non-convertible named unit (clove, can, ...)
}
function normalizeUnit(raw){
  if(!raw) return '';
  let u = String(raw).toLowerCase().trim().replace(/\.$/,'');
  return UNIT_SYNONYMS[u] || u;
}

const UNICODE_FRAC = { '¼':.25,'½':.5,'¾':.75,'⅓':1/3,'⅔':2/3,'⅛':.125,'⅜':.375,'⅝':.625,'⅞':.875,'⅕':.2,'⅖':.4,'⅗':.6,'⅘':.8,'⅙':1/6,'⅚':5/6 };
function parseQty(str){
  if(str==null) return null;
  let s = String(str).trim();
  for(const f in UNICODE_FRAC){ s = s.replace(new RegExp(f,'g'), ' '+UNICODE_FRAC[f]+' '); }
  s = s.replace(/\s+/g,' ').trim();
  // range -> take first
  s = s.split(/\s*(?:-|–|—|to)\s*/)[0].trim();
  const mixed = s.match(/^(\d+)\s+(\d+)\/(\d+)$/);
  if(mixed) return +mixed[1] + (+mixed[2]/+mixed[3]);
  const frac = s.match(/^(\d+)\/(\d+)$/);
  if(frac) return +frac[1]/+frac[2];
  // "1 0.5" leftover from unicode replace -> sum
  const parts = s.split(' ').map(Number).filter(n=>!isNaN(n));
  if(parts.length) return parts.reduce((a,b)=>a+b,0);
  return null;
}

const CATEGORY_KEYWORDS = {
  'Produce':['onion','garlic','tomato','lettuce','spinach','pepper','carrot','potato','lime','lemon','cilantro','parsley','avocado','cucumber','celery','broccoli','mushroom','apple','banana','ginger','scallion','kale','zucchini','herb','basil','corn'],
  'Meat & Seafood':['chicken','beef','pork','bacon','sausage','turkey','shrimp','salmon','fish','steak','ground','tofu','chorizo'],
  'Dairy & Eggs':['milk','butter','cheese','egg','cream','yogurt','sour cream','parmesan','mozzarella','cheddar'],
  'Bakery':['bread','tortilla','bun','roll','bagel','pita','naan','dough'],
  'Frozen':['frozen','ice cream','peas'],
  'Spices':['salt','pepper','cumin','paprika','oregano','cinnamon','chili powder','turmeric','spice','seasoning','bay leaf','nutmeg'],
  'Pantry':['flour','sugar','oil','rice','pasta','bean','stock','broth','vinegar','sauce','can','tomato paste','honey','syrup','baking','vanilla','yeast','noodle','lentil','oat','cornstarch','soy sauce','ketchup','mustard','mayo','peanut butter','coconut milk']
};
function guessCategory(item){
  const t = (item||'').toLowerCase();
  for(const cat in CATEGORY_KEYWORDS){
    if(CATEGORY_KEYWORDS[cat].some(k=>t.includes(k))) return cat;
  }
  return 'Other';
}
/* descriptor / prep words that shouldn't be treated as the item itself */
const DESC = new Set(['skinless','boneless','bone-in','skin-on','fresh','freshly','ripe','peeled','cored','seeded','trimmed','cooked','raw','thawed','drained','rinsed','divided','optional','packed','softened','melted','chopped','diced','sliced','minced','shredded','grated','ground','crushed','halved','quartered','cubed','julienned','thinly','finely','roughly','large','medium','small','of']);
function isDescOnly(seg){
  const w = seg.toLowerCase().replace(/[^a-z\- ]/g,'').split(/\s+/).filter(Boolean);
  return w.length>0 && w.every(x=>DESC.has(x));
}
/* pull the actual food out of a messy line: pick the comma-segment with a food word
   (or the first non-descriptor segment), then drop leading descriptors and " or …" tails */
function pickItem(rest){
  rest = rest.replace(/\([^)]*\)/g,' ').trim();
  const segs = rest.split(',').map(s=>s.trim()).filter(Boolean);
  if(!segs.length) return rest.toLowerCase();
  let chosen = segs.find(s=>guessCategory(s)!=='Other')   // segment with a known food word
            || segs.find(s=>!isDescOnly(s))               // else first non-descriptor segment
            || segs[0];                                   // else fall back to the first
  chosen = chosen.split(/\s+\bor\b\s+/)[0];               // "thighs or breasts" -> "thighs"
  let cw = chosen.toLowerCase().replace(/^of\s+/,'').split(/\s+/);
  while(cw.length>1 && DESC.has(cw[0].replace(/[^a-z\-]/g,''))) cw.shift();
  return cw.join(' ').trim();
}
const CAT_ORDER = ['Produce','Meat & Seafood','Dairy & Eggs','Bakery','Frozen','Pantry','Spices','Other'];

/* Parse a free-text ingredient line into {quantity,unit,item,category,raw} */
function parseLine(line){
  const raw = line.trim();
  if(!raw) return null;
  // split a fraction glyph off a preceding digit ("1½" -> "1 ½") so it isn't glued into "10.5"
  let s = raw.replace(/(\d)([¼½¾⅓⅔⅛⅜⅝⅞⅕⅖⅗⅘⅙⅚])/g,'$1 $2');
  const m = s.match(/^(\d+\s+\d+\/\d+|\d+\s+[¼½¾⅓⅔⅛⅜⅝⅞⅕⅖⅗⅘⅙⅚]|\d+\/\d+|\d+(?:\.\d+)?|[¼½¾⅓⅔⅛⅜⅝⅞⅕⅖⅗⅘⅙⅚])(?:\s*(?:-|–|to)\s*(?:\d+\/\d+|\d+(?:\.\d+)?|[¼½¾⅓⅔⅛⅜⅝⅞⅕⅖⅗⅘⅙⅚]))?\s*(.*)$/);
  let quantity=null, rest=raw;
  if(m){ quantity = parseQty(m[1]); rest = m[2]; }
  let unit='';
  // try two-word unit first ("fl oz") then one word
  const words = rest.split(/\s+/);
  const two = normalizeUnit((words[0]||'')+' '+(words[1]||''));
  if(UNIT_SYNONYMS[(words[0]||'').toLowerCase()+' '+(words[1]||'').toLowerCase()]){ unit=two; rest=words.slice(2).join(' '); }
  else {
    const one = normalizeUnit(words[0]||'');
    if(words[0] && UNIT_SYNONYMS[words[0].toLowerCase().replace(/\.$/,'')]){ unit=one; rest=words.slice(1).join(' '); }
  }
  let item = pickItem(rest);
  if(!item) item = raw.toLowerCase();
  return { quantity, unit, item, category:guessCategory(item), raw };
}

/* fraction-friendly number formatting */
function fmtNum(n){
  if(n==null) return '';
  const r = Math.round(n*100)/100;
  const whole = Math.floor(r+1e-9);
  const frac = r - whole;
  const table=[[0,''],[1/8,'⅛'],[1/4,'¼'],[1/3,'⅓'],[3/8,'⅜'],[1/2,'½'],[5/8,'⅝'],[2/3,'⅔'],[3/4,'¾'],[7/8,'⅞'],[1,'']];
  let best=table[0], bd=Infinity;
  for(const t of table){ const d=Math.abs(frac-t[0]); if(d<bd){bd=d; best=t;} }
  let carry = best[0]===1 ? 1 : 0;
  const w = whole+carry;
  const sym = best[0]===1 ? '' : best[1];
  if(sym) return w>0 ? w+sym : sym;
  if(w===0 && r>0) return (Math.round(r*100)/100).toString();
  return String(w);
}
function pluralUnit(u,n){
  if(n<=1) return u;
  const irr={pinch:'pinches',bunch:'bunches',leaf:'leaves',box:'boxes',dash:'dashes'};
  return irr[u] || (u+'s');
}
function prettyVol(ml, metric){
  if(metric){ return ml>=1000 ? fmtNum(ml/1000)+' l' : Math.round(ml)+' ml'; }
  if(ml>=3785.41) return fmtNum(ml/3785.41)+' gal';
  if(ml>=946.353) return fmtNum(ml/946.353)+' qt';
  if(ml>=236.588*0.5) return fmtNum(ml/236.588)+' cup'+(ml/236.588>=2?'s':'');
  if(ml>=14.7868) return fmtNum(ml/14.7868)+' tbsp';
  return fmtNum(ml/4.92892)+' tsp';
}
function prettyWt(g, metric){
  if(metric){ return g>=1000 ? fmtNum(g/1000)+' kg' : Math.round(g)+' g'; }
  if(g>=453.592) return fmtNum(g/453.592)+' lb';
  return fmtNum(g/28.3495)+' oz';
}

/* Consolidate ingredient instances into grocery lines.
   instances: [{item,unit,quantity,category,raw,recipeTitle}] */
function consolidate(instances){
  const groups = {};
  for(const ing of instances){
    const key = (ing.item||'').toLowerCase().trim();
    if(!groups[key]) groups[key] = { item:ing.item, category:ing.category||guessCategory(ing.item), buckets:{}, sources:[] };
    const g = groups[key];
    g.sources.push(ing);
    if(ing.category && g.category==='Other') g.category = ing.category;
    const u = normalizeUnit(ing.unit);
    const cat = unitCategory(u);
    if(!g.buckets[cat]) g.buckets[cat] = { ml:0, g:0, count:0, unit:u, metric:false, hasQty:false };
    const b = g.buckets[cat];
    const q = ing.quantity;
    if(cat==='vol' && q!=null){ b.ml += q*VOL_ML[u]; b.hasQty=true; if(METRIC.has(u)) b.metric=true; }
    else if(cat==='wt' && q!=null){ b.g += q*WT_G[u]; b.hasQty=true; if(METRIC.has(u)) b.metric=true; }
    else if(q!=null){ b.count += q; b.hasQty=true; b.unit=u; }
    // q null -> "as needed", no number
  }
  const lines = [];
  for(const key in groups){
    const g = groups[key];
    const parts = [];
    for(const cat in g.buckets){
      const b = g.buckets[cat];
      if(cat==='vol' && b.hasQty) parts.push(prettyVol(b.ml, b.metric && !hasImperialVol(g,key)));
      else if(cat==='wt' && b.hasQty) parts.push(prettyWt(b.g, b.metric && !hasImperialWt(g,key)));
      else if(cat==='count' && b.hasQty) parts.push(fmtNum(b.count));
      else if(cat.startsWith('unit:') && b.hasQty){ const u=cat.slice(5); parts.push(fmtNum(b.count)+' '+pluralUnit(u,b.count)); }
    }
    const amt = parts.length ? parts.join(' + ') : 'as needed';
    const recipeSet = new Set(g.sources.map(s=>s.recipeTitle));
    lines.push({
      item:g.item, category:g.category, amount:amt,
      recipeCount:recipeSet.size,
      combined:g.sources.length>1,
      sources:g.sources.map(s=>({
        recipe:s.recipeTitle,
        text: (s.quantity!=null? fmtNum(s.quantity)+' ' : '') + (s.unit? s.unit+' ':'') || 'as needed'
      }))
    });
  }
  return lines;
}
// decide metric vs imperial display: if ANY source unit for this bucket type was imperial, show imperial
function hasImperialVol(g){ return g.sources.some(s=>{const u=normalizeUnit(s.unit); return unitCategory(u)==='vol' && !METRIC.has(u);}); }
function hasImperialWt(g){ return g.sources.some(s=>{const u=normalizeUnit(s.unit); return unitCategory(u)==='wt' && !METRIC.has(u);}); }

/* ---------- Date helpers ---------- */
function getMonday(d){ const x=new Date(d); const day=(x.getDay()+6)%7; x.setHours(0,0,0,0); x.setDate(x.getDate()-day); return x; }
function isoDate(d){ const x=new Date(d); return x.getFullYear()+'-'+String(x.getMonth()+1).padStart(2,'0')+'-'+String(x.getDate()).padStart(2,'0'); }
function weekDays(monday){ return Array.from({length:7},(_,i)=>{ const d=new Date(monday); d.setDate(d.getDate()+i); return d; }); }
const DOW=['Mon','Tue','Wed','Thu','Fri','Sat','Sun'];
const MON=['Jan','Feb','Mar','Apr','May','Jun','Jul','Aug','Sep','Oct','Nov','Dec'];
function rangeLabel(monday){ const days=weekDays(monday); const a=days[0],b=days[6];
  const sameMonth=a.getMonth()===b.getMonth();
  return MON[a.getMonth()]+' '+a.getDate()+' – '+(sameMonth?'':MON[b.getMonth()]+' ')+b.getDate(); }

/* ---------- State ---------- */
const state = { view:'recipes', recipes:[], plan:{}, checked:{}, weekStart:getMonday(new Date()), expanded:{}, layout:CAT_ORDER.slice(), listMode:'aisle', pantry:[], recipeSearch:'' };
const $ = s=>document.querySelector(s);
function uid(){ return 'r'+Date.now().toString(36)+Math.random().toString(36).slice(2,6); }
function esc(s){ return String(s==null?'':s).replace(/[&<>"]/g,c=>({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;'}[c])); }
function domain(url){ try{ return new URL(url).hostname.replace(/^www\./,''); }catch(e){ return url||''; } }
function fmtTime(min){ min=Number(min); if(!min||min<=0) return ''; const h=Math.floor(min/60), m=Math.round(min%60); return (h&&m)?`${h} hr ${m} min`:(h?`${h} hr`:`${m} min`); }
function escRe(s){ return String(s).replace(/[.*+?^${}()|[\]\\]/g,'\\$&'); }
function inPantry(name){ return (state.pantry||[]).some(p=> new RegExp('\\b'+escRe(p)+'\\b','i').test(name||'')); }

/* ---------- Toast ---------- */
let toastT;
function toast(msg){ const t=$('#toast'); t.textContent=msg; t.classList.add('show'); clearTimeout(toastT); toastT=setTimeout(()=>t.classList.remove('show'),2200); }

/* ---------- Recipe scrape via the backend (FastAPI) ----------
   The backend (main.py) tries cache -> Wayback -> live and returns:
   { title, servings, ingredients:[string], instructions:[string], source }
   The ingredient strings are parsed locally by parseLine() into the
   {quantity, unit, item, category} shape the rest of the app expects. */
async function scrapeRecipe(rec){
  rec.status='scraping'; rec.error=null; rec.source=null; renderRecipes();
  try{
    const res = await fetch(API_BASE + '/scrape?url=' + encodeURIComponent(rec.url));
    if(!res.ok){
      let detail = 'HTTP '+res.status;
      try{ const j = await res.json(); if(j && j.detail) detail = j.detail; }catch(e){}
      throw new Error(detail);
    }
    const data = await res.json();
    rec.ingredients = (data.ingredients||[]).map(parseLine).filter(Boolean);
    rec.instructions = data.instructions || [];
    rec.servings = data.servings || null;
    rec.total_time = data.total_time || null;   // minutes
    rec.source = data.source || null;   // cache | wayback | live
    if(data.title && (!rec.title || rec.title===domain(rec.url))) rec.title = data.title;
    if(!rec.ingredients.length) throw new Error('No ingredients found in the page.');
    rec.status='ok';
    toast('Imported "'+rec.title+'"'+(rec.source?' · via '+rec.source:''));
  }catch(e){
    rec.status='error';
    const unreachable = /Failed to fetch|NetworkError|Load failed|ERR_/i.test(e.message||'');
    rec.error = unreachable
      ? ('Could not reach the backend at '+API_BASE+'. Make sure it\'s running ('+'uvicorn main:app'+') and reachable.')
      : (e.message || 'Could not read this recipe.');
    toast(unreachable ? 'Backend unreachable — is the server running?' : 'Import failed — add ingredients manually or retry');
  }
  await save(K.recipes, state.recipes);
  renderRecipes();
}

/* ---------- Renders ---------- */
function setView(v){
  state.view=v;
  document.querySelectorAll('.tab').forEach(t=>t.setAttribute('aria-selected', String(t.dataset.view===v)));
  ['plan','list'].forEach(name=>{ $('#view-'+name).hidden = (name!==v); });
  const map={plan:renderPlan, list:renderList};
  map[v]();
}
function updateBadges(){
  const days = weekDays(state.weekStart).map(isoDate);
  let planned = 0;
  for(const iso of days) planned += (state.plan[iso]||[]).length;
  $('#tab-recipes').textContent = planned;
  const n = currentWeekItems().lines.length;
  $('#tab-list').textContent = n;
}

/* renderRecipes kept as an alias so existing callers still work */
function renderRecipes(){ renderPlan(); }

/* expandable detail (ingredients / instructions / edit) shared by chips */
/* scaling: multiply amounts by chosen target servings / base servings */
function scaleFactor(r){ return (r.servings && r.targetServings) ? r.targetServings/r.servings : 1; }
function targetServings(r){ return r.targetServings || r.servings || null; }

function recipeDetail(r){
  const open = state.expanded['rec:'+r.id];
  const editing = state.expanded['edit:'+r.id];
  if(!open && !editing) return '';
  let body='';
  if(editing){
    const lines = r.ingredients.map(i=>i.raw || ((i.quantity!=null?fmtNum(i.quantity)+' ':'')+(i.unit?i.unit+' ':'')+i.item)).join('\n');
    const steps = (r.instructions||[]).join('\n');
    body = `<div class="recipe-body open edit-doc">
      <input class="ed-title" id="edname-${r.id}" value="${esc(r.title||'')}" placeholder="Untitled recipe">
      <div class="ed-meta">
        <span class="ed-meta-item"><i class="ph ph-fork-knife"></i>
          <input class="ed-inline ed-num" id="edserv-${r.id}" type="number" min="1" step="1" value="${esc(r.servings||'')}" placeholder="–"> servings</span>
        <span class="ed-meta-item ed-src"><i class="ph ph-link-simple"></i>
          <input class="ed-inline ed-url" id="edurl-${r.id}" value="${esc(r.url||'')}" placeholder="source URL"></span>
      </div>
      <div class="ed-section">
        <div class="ed-head">Ingredients <span class="ed-hint">one per line</span></div>
        <textarea class="ed-area ed-auto" id="eding-${r.id}" placeholder="1 cup whole milk&#10;2 cloves garlic&#10;salt to taste">${esc(lines)}</textarea>
      </div>
      <div class="ed-section">
        <div class="ed-head">Instructions <span class="ed-hint">one step per line</span></div>
        <textarea class="ed-area ed-auto" id="edsteps-${r.id}" placeholder="Preheat the oven to 400°F&#10;Toss the vegetables with oil and roast 25 min">${esc(steps)}</textarea>
      </div>
      <div class="ed-actions">
        <button class="btn btn-green btn-sm" data-act="save-edit" data-id="${r.id}"><i class="ph ph-check"></i> Save</button>
        <button class="btn btn-ghost btn-sm" data-act="cancel-edit" data-id="${r.id}">Cancel</button>
      </div></div>`;
  } else {
    const f = scaleFactor(r);
    const scaler = (r.status==='ok' && r.servings) ? `<div class="scale-row">
        <span class="scale-label">Scale to</span>
        <div class="serv-scaler sm">
          <button class="btn-icon btn-ghost" data-act="scale-serv" data-id="${r.id}" data-d="-1" ${targetServings(r)<=1?'disabled':''}><i class="ph ph-minus"></i></button>
          <span class="serv-val"><i class="ph ph-fork-knife"></i> ${esc(targetServings(r))} servings</span>
          <button class="btn-icon btn-ghost" data-act="scale-serv" data-id="${r.id}" data-d="1"><i class="ph ph-plus"></i></button>
        </div>
        ${f!==1?`<span class="scale-note">×${esc(fmtNum(f))} · base ${esc(r.servings)}</span>`:''}
      </div>` : '';
    const ings = (r.ingredients&&r.ingredients.length) ? '<ul class="ing-list">'+r.ingredients.map(i=>
      `<li><span class="amt">${esc((i.quantity!=null?fmtNum(i.quantity*f):'')+(i.unit?' '+i.unit:''))||'—'}</span><span>${esc(i.item)}</span></li>`).join('')+'</ul>'
      : '<p style="color:var(--faint);font-size:13px;margin:0">No ingredients yet — use "Add ingredients" to type them in.</p>';
    const steps = (r.instructions&&r.instructions.length) ? '<h4>Instructions</h4><ol class="steps">'+r.instructions.map(s=>`<li>${esc(s)}</li>`).join('')+'</ol>' : '';
    body = `<div class="recipe-body open">${r.error?`<p class="chip warn" style="display:inline-block">${esc(r.error)}</p>`:''}${scaler}<h4>Ingredients</h4>${ings}${steps}</div>`;
  }
  return body + `<div class="recipe-foot">
      ${r.status==='error'?`<button class="btn btn-ghost btn-sm" data-act="retry" data-id="${r.id}"><i class="ph ph-arrow-clockwise"></i> Retry import</button>`:''}
      <button class="linklike" data-act="${editing?'save-edit':'edit'}" data-id="${r.id}">${editing?'Done editing':'Edit recipe'}</button>
      <div class="spacer"></div>
      ${r.status==='ok'?`<button class="btn btn-green btn-sm" data-act="cook" data-id="${r.id}"><i class="ph ph-cooking-pot"></i> Cook</button>`:''}
      <a class="linklike" href="${esc(r.url)}" target="_blank" rel="noopener">Source <i class="ph ph-arrow-up-right"></i></a>
      <button class="btn-icon" data-act="delete" data-id="${r.id}" title="Delete recipe" style="color:var(--faint)"><i class="ph ph-trash"></i></button>
    </div>`;
}

/* a single draggable recipe chip */
function recipeChip(r){
  const editing = state.expanded['edit:'+r.id];
  const open = !!(state.expanded['rec:'+r.id] || editing);
  const draggable = r.status==='ok' && !open;   // don't drag while expanded (keeps textarea usable)
  const canExpand = r.status!=='scraping';
  let meta;
  if(r.status==='scraping') meta=`<div class="chiprow"><span class="chip work"><span class="spin"></span> reading…</span></div>`;
  else if(r.status==='error') meta=`<div class="chiprow"><span class="chip warn">⚠ needs ingredients</span></div>`;
  else {
    const pills=[];
    if(r.total_time) pills.push(`<span class="chip key"><i class="ph ph-timer"></i> ${esc(fmtTime(r.total_time))}</span>`);
    if(r.servings){ const t=targetServings(r); pills.push(`<span class="chip key"><i class="ph ph-fork-knife"></i> serves ${esc(t)}</span>`); if(scaleFactor(r)!==1) pills.push(`<span class="chip">scaled from ${esc(r.servings)}</span>`); }
    pills.push(`<span class="chip">${r.ingredients?r.ingredients.length:0} ingredients</span>`);
    if(r.source) pills.push(`<span class="chip">via ${esc(r.source)}</span>`);
    meta=`<div class="chiprow">${pills.join('')}</div>`;
  }
  return `<div class="rchip ${r.status}${open?' open':''}" data-name="${esc((r.title||domain(r.url)).toLowerCase())}" ${draggable?`draggable="true" data-drag-rid="${r.id}"`:''}>
    <div class="rchip-head" data-act="toggle-view" data-id="${r.id}">
      ${draggable?'<span class="grip" title="Drag onto a day"><i class="ph ph-dots-six-vertical"></i></span>':'<span class="grip ghost">•</span>'}
      <div class="rchip-text">
        <span class="rchip-title">${esc(r.title||domain(r.url))}</span>
        ${meta}
      </div>
      ${r.status==='error'?`<button class="btn btn-amber btn-sm" data-act="edit" data-id="${r.id}">Add ingredients</button>`:''}
      ${canExpand?`<span class="caret">${open?'<i class="ph ph-caret-up"></i>':'<i class="ph ph-caret-down"></i>'}</span>`:''}
    </div>
    ${recipeDetail(r)}
  </div>`;
}

function renderPlan(){
  updateBadges();
  const el=$('#view-plan');
  const days = weekDays(state.weekStart);
  const todayISO = isoDate(new Date());
  const board = days.map((d,i)=>{
    const iso=isoDate(d);
    const meals=(state.plan[iso]||[]).map((rid,idx)=>{
      const r=state.recipes.find(x=>x.id===rid);
      const name = r?r.title:'(removed)';
      return `<div class="meal" data-act="cook" data-id="${rid}" title="Open cooking mode"><span>${esc(name)}</span><button data-act="rm-meal" data-iso="${iso}" data-idx="${idx}" title="Remove"><i class="ph ph-x"></i></button></div>`;
    }).join('');
    return `<div class="day ${iso===todayISO?'today':''}" data-iso="${iso}">
      <div class="day-head"><div class="dow">${DOW[i]}</div><div class="date">${d.getDate()}</div></div>
      <div class="day-meals">${meals||'<div class="day-empty">drop a recipe</div>'}</div>
      <button class="add-meal" data-act="add-meal" data-iso="${iso}"><i class="ph ph-plus"></i> Add meal</button>
    </div>`;
  }).join('');

  const chips = state.recipes.length
    ? `<div class="recipes-head">
         <h2 class="recipes-h">Your recipes</h2>
         <input class="recipe-search" type="text" placeholder="Search your recipes…" autocomplete="off" value="${esc(state.recipeSearch||'')}">
       </div>
       <div class="rchips">${state.recipes.map(recipeChip).join('')}</div>
       <p class="rchips-empty" style="display:none">No recipes match your search.</p>`
    : `<div class="empty" style="padding:32px"><div class="ico"><i class="ph ph-basket"></i></div><h3>No recipes yet</h3><p>Paste a recipe link above, or drop in a few samples to try planning and the grocery list.</p><div class="row"><button class="btn btn-amber" data-act="seed">Add 3 sample recipes</button></div></div>`;

  el.innerHTML = `
    <div class="view-head">
      <div><h1>This week</h1><p>Drag a recipe onto a day to plan it — your grocery list builds from what's planned.</p></div>
      <div class="weeknav">
        <button class="btn-icon btn-ghost" data-act="week" data-d="-1" title="Previous week"><i class="ph ph-caret-left"></i></button>
        <div class="range">${rangeLabel(state.weekStart)}</div>
        <button class="btn-icon btn-ghost" data-act="week" data-d="1" title="Next week"><i class="ph ph-caret-right"></i></button>
        <button class="btn btn-ghost btn-sm" data-act="week" data-d="0">Today</button>
      </div>
    </div>
    <div class="board">${board}</div>
    <div class="add-card">
      <div class="add-row">
        <div class="field"><label>Recipe name <span style="color:var(--faint);font-weight:400">(optional)</span></label><input id="r-title" placeholder="Weeknight chicken burritos"></div>
        <div class="field" style="flex:2"><label>Recipe link</label><input id="r-url" placeholder="https://…" inputmode="url"></div>
        <div class="add-actions"><button class="btn btn-green" id="r-add">Add recipe</button></div>
      </div>
      <div class="hint">Paste a link and we pull the ingredients and instructions. If a page can't be read, add ingredients yourself.</div>
    </div>
    ${chips}`;
  applyRecipeFilter();
}
/* live filter for the home-page recipe chips (show/hide, no re-render) */
function applyRecipeFilter(){
  const q=(state.recipeSearch||'').trim().toLowerCase();
  const grid=document.querySelector('#view-plan .rchips'); if(!grid) return;
  let any=false;
  grid.querySelectorAll('.rchip').forEach(el=>{ const m=!q||(el.dataset.name||'').includes(q); el.style.display=m?'':'none'; if(m) any=true; });
  const note=document.querySelector('#view-plan .rchips-empty');
  if(note) note.style.display = any ? 'none' : '';
}

/* gather this week's planned ingredient instances + consolidated lines */
function currentWeekItems(){
  const days = weekDays(state.weekStart).map(isoDate);
  const instances=[];
  let recipeOccurrences=0;
  for(const iso of days){
    for(const rid of (state.plan[iso]||[])){
      const r=state.recipes.find(x=>x.id===rid);
      if(!r||!r.ingredients) continue;
      recipeOccurrences++;
      const f = scaleFactor(r);
      for(const ing of r.ingredients) instances.push({...ing, quantity: ing.quantity!=null? ing.quantity*f : null, recipeTitle:r.title});
    }
  }
  const lines = consolidate(instances);
  return { lines, recipeOccurrences };
}

/* one grocery line, used by both the aisle list and the route */
function groceryRow(l, wk){
  const ckey = wk+'|'+l.category+'|'+l.item;
  const done = !!state.checked[ckey];
  const exKey='gx:'+ckey; const ex=state.expanded[exKey];
  const breakdown = l.sources.map(s=>`<div><span class="b-amt">${esc(s.text)}</span><span>${esc(s.recipe)}</span></div>`).join('');
  return `<div class="gitem ${done?'done':''}">
    <div class="gitem-main">
      <button class="check" data-act="check" data-key="${esc(ckey)}" aria-label="Mark ${esc(l.item)}"><svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="3.5" stroke-linecap="round" stroke-linejoin="round"><polyline points="20 6 9 17 4 12"/></svg></button>
      <span class="name">${esc(l.item)}</span>
      ${l.combined?`<span class="combined">${l.recipeCount} recipes</span>`:''}
      <span class="amt">${esc(l.amount)}</span>
      ${l.sources.length>1?`<button class="expand" data-act="gexpand" data-key="${esc(exKey)}" title="Show breakdown">${ex?'<i class="ph ph-caret-up"></i>':'<i class="ph ph-caret-down"></i>'}</button>`:''}
    </div>
    <div class="breakdown ${ex?'open':''}">${breakdown}</div>
  </div>`;
}

function renderList(){
  updateBadges();
  const el=$('#view-list');
  const {lines: allLines, recipeOccurrences} = currentWeekItems();
  const wk = isoDate(state.weekStart);
  const pantryLines = allLines.filter(l=>inPantry(l.item));
  const lines = allLines.filter(l=>!inPantry(l.item));   // what you actually need to buy
  const combinedCount = lines.filter(l=>l.combined).length;
  const mode = state.listMode || 'aisle';

  const pantryNote = pantryLines.length
    ? `<div class="pantry-note">🧂 In your pantry — skipped: ${pantryLines.map(l=>esc(l.item)).sort().join(', ')}</div>`
    : '';

  let content;
  if(!allLines.length){
    content = `<div class="empty"><div class="ico"><i class="ph ph-shopping-cart-simple"></i></div><h3>Nothing on the list yet</h3><p>Plan some meals for this week and your grocery list builds itself — combining duplicate ingredients automatically.</p><div class="row"><button class="btn btn-green" data-act="goto" data-v="plan">Plan the week</button></div></div>`;
  } else if(!lines.length){
    content = `<div class="empty"><div class="ico">✅</div><h3>It's all in your pantry</h3><p>Everything this week's recipes call for is already on your pantry list — nothing to buy.</p></div>${pantryNote}`;
  } else {
    const byCat={};
    for(const l of lines){ (byCat[l.category]=byCat[l.category]||[]).push(l); }
    for(const c in byCat) byCat[c].sort((a,b)=>a.item.localeCompare(b.item));
    const cats = state.layout.filter(c=>byCat[c]);   // store order, only sections that have items
    if(mode==='route'){
      const stops = cats.map((cat,idx)=>`
        <div class="route-stop">
          <div class="route-pin">${idx+1}</div>
          <div class="route-card">
            <h3>${esc(cat)} <span class="route-count">${byCat[cat].length}</span></h3>
            <div class="glist">${byCat[cat].map(l=>groceryRow(l,wk)).join('')}</div>
          </div>
        </div>`).join('');
      content = `<div class="route">${stops}
        <div class="route-stop end"><div class="route-pin"><i class="ph ph-check"></i></div><div class="route-card"><div class="route-finish">Checkout — ${lines.length} items</div></div></div>
      </div>${pantryNote}`;
    } else {
      content = cats.map(cat=>`<div class="cat"><h3>${esc(cat)}</h3><div class="glist">${byCat[cat].map(l=>groceryRow(l,wk)).join('')}</div></div>`).join('') + pantryNote;
    }
  }

  el.innerHTML = `
    <div class="view-head">
      <div><h1>Grocery list</h1><p>${mode==='route'?'Your route through the store.':'For the week of '+rangeLabel(state.weekStart)+'.'}</p></div>
      <div class="weeknav">
        <button class="btn-icon btn-ghost" data-act="week" data-d="-1"><i class="ph ph-caret-left"></i></button>
        <div class="range">${rangeLabel(state.weekStart)}</div>
        <button class="btn-icon btn-ghost" data-act="week" data-d="1"><i class="ph ph-caret-right"></i></button>
      </div>
    </div>
    ${allLines.length?`<div class="summary">
      <span class="stat"><b>${recipeOccurrences}</b> meals planned</span>
      <span class="stat"><b>${lines.length}</b> items to buy</span>
      ${combinedCount?`<span class="stat hl"><i class="ph ph-sparkle"></i> <b>${combinedCount}</b> combined from multiple recipes</span>`:''}
      ${pantryLines.length?`<span class="stat"><b>${pantryLines.length}</b> from pantry</span>`:''}
      <span class="spacer"></span>
      <div class="seg">
        <button class="seg-btn ${mode==='aisle'?'on':''}" data-act="list-mode" data-m="aisle">By aisle</button>
        <button class="seg-btn ${mode==='route'?'on':''}" data-act="list-mode" data-m="route">Route</button>
      </div>
      <button class="btn btn-ghost btn-sm" data-act="open-pantry">🧂 Pantry</button>
      <button class="btn btn-ghost btn-sm" data-act="open-layout"><i class="ph ph-gear"></i> Store layout</button>
      <button class="btn btn-ghost btn-sm" data-act="copy">Copy</button>
      <button class="btn btn-ghost btn-sm" data-act="uncheck">Uncheck all</button>
    </div>`:''}
    ${content}`;
}

/* ---------- Modal: pick a recipe for a day ---------- */
function openPicker(iso){
  const d=new Date(iso+'T00:00:00');
  const items = state.recipes.length ? state.recipes.map(r=>
    `<button class="pick" data-act="pick" data-iso="${iso}" data-id="${r.id}" data-name="${esc((r.title||domain(r.url)).toLowerCase())}">
      <span class="p-title">${esc(r.title||domain(r.url))}</span>
      <span class="p-meta">${r.ingredients&&r.ingredients.length?r.ingredients.length+' ing':'no ingredients'}</span>
    </button>`).join('') : `<p style="color:var(--muted)">No recipes yet — add some first.</p>`;
  $('#modal').innerHTML = `
    <div class="modal-head"><h3>Add to ${DOW[(d.getDay()+6)%7]}, ${MON[d.getMonth()]} ${d.getDate()}</h3>
      <button class="btn-icon" data-act="close" style="color:var(--faint)"><i class="ph ph-x"></i></button></div>
    <div class="modal-body">
      ${state.recipes.length?'<input class="pick-search" type="text" placeholder="Search recipes…" autocomplete="off">':''}
      ${items}
    </div>`;
  $('#scrim').classList.add('open');
  focusPickSearch();
}
function closeModal(){ $('#scrim').classList.remove('open'); }

/* live search inside the recipe pickers */
function focusPickSearch(){ setTimeout(()=>{ const s=document.querySelector('#modal .pick-search'); if(s) s.focus(); }, 30); }
/* grow a textarea to fit its content (document-style editor) */
function autoGrow(el){ if(!el) return; el.style.height='auto'; el.style.height=(el.scrollHeight+2)+'px'; }
function filterPicks(q){
  q=(q||'').trim().toLowerCase();
  const body=document.querySelector('#modal .modal-body'); if(!body) return;
  let any=false;
  body.querySelectorAll('.pick').forEach(el=>{ const m=!q||(el.dataset.name||'').includes(q); el.style.display=m?'':'none'; if(m) any=true; });
  let note=body.querySelector('.pick-empty');
  if(!any){ if(!note){ note=document.createElement('p'); note.className='pick-empty'; note.textContent='No matching recipes.'; body.appendChild(note); } note.style.display=''; }
  else if(note){ note.style.display='none'; }
}

/* ---------- Store layout editor ---------- */
function openLayoutEditor(){ renderLayoutEditor(); $('#scrim').classList.add('open'); }
function renderLayoutEditor(){
  const rows = state.layout.map((cat,idx)=>`
    <div class="lay-row">
      <span class="lay-num">${idx+1}</span>
      <span class="lay-name">${esc(cat)}</span>
      <div class="lay-moves">
        <button class="btn-icon btn-ghost" data-act="layout-up" data-cat="${esc(cat)}" ${idx===0?'disabled':''} title="Move up"><i class="ph ph-caret-up"></i></button>
        <button class="btn-icon btn-ghost" data-act="layout-down" data-cat="${esc(cat)}" ${idx===state.layout.length-1?'disabled':''} title="Move down"><i class="ph ph-caret-down"></i></button>
      </div>
    </div>`).join('');
  $('#modal').innerHTML = `
    <div class="modal-head"><h3>Store layout</h3><button class="btn-icon" data-act="close" style="color:var(--faint)"><i class="ph ph-x"></i></button></div>
    <div class="modal-body">
      <p style="color:var(--muted);font-size:13px;margin:0 0 14px">Arrange these sections in the order you walk your store, from the entrance to checkout. Your grocery list and route follow this order.</p>
      ${rows}
    </div>`;
}

/* ---------- Pantry (staples you already have) ---------- */
const PANTRY_SUGGESTIONS = ['salt','black pepper','olive oil','water','sugar','butter','garlic','flour','baking soda','vanilla extract'];
function openPantryEditor(){ renderPantryEditor(); $('#scrim').classList.add('open'); }
function renderPantryEditor(){
  const items = (state.pantry||[]).slice().sort();
  const chips = items.length
    ? items.map(p=>`<span class="pan-item">${esc(p)}<button data-act="pantry-remove" data-item="${esc(p)}" title="Remove"><i class="ph ph-x"></i></button></span>`).join('')
    : '<p style="color:var(--faint);font-size:13px;margin:0">Nothing in your pantry yet.</p>';
  const sugg = PANTRY_SUGGESTIONS.filter(s=>!items.includes(s))
    .map(s=>`<button class="pan-sugg" data-act="pantry-add-suggest" data-item="${esc(s)}">+ ${esc(s)}</button>`).join('');
  $('#modal').innerHTML = `
    <div class="modal-head"><h3>Your pantry</h3><button class="btn-icon" data-act="close" style="color:var(--faint)"><i class="ph ph-x"></i></button></div>
    <div class="modal-body">
      <p style="color:var(--muted);font-size:13px;margin:0 0 12px">Staples you always keep at home. These are left off your grocery list automatically.</p>
      <div class="pan-add"><input id="pantry-input" placeholder="e.g. olive oil" autocomplete="off"><button class="btn btn-green btn-sm" data-act="pantry-add">Add</button></div>
      ${sugg?`<div class="pan-suggs">${sugg}</div>`:''}
      <div class="pan-items">${chips}</div>
    </div>`;
}

/* ---------- Cooking mode ---------- */
let cookState = null;   // { rids:[id], ing:{id:Set}, steps:{id:Set} }
let wakeLock = null;
async function requestWake(){ try{ if('wakeLock' in navigator) wakeLock = await navigator.wakeLock.request('screen'); }catch(e){} }
function releaseWake(){ try{ if(wakeLock){ wakeLock.release(); wakeLock=null; } }catch(e){} }

function openCook(rid){
  const r = state.recipes.find(x=>x.id===rid);
  if(!r) { toast('That recipe is no longer available'); return; }
  cookState = { rids:[rid], ing:{[rid]:new Set()}, steps:{[rid]:new Set()} };
  renderCook();
  $('#cook').classList.add('open');
  document.body.style.overflow='hidden';
  requestWake();
}
function cookAdd(rid){
  if(!cookState || cookState.rids.includes(rid) || cookState.rids.length>=2) return;
  cookState.rids.push(rid); cookState.ing[rid]=new Set(); cookState.steps[rid]=new Set();
  renderCook();
}
function cookRemove(rid){
  if(!cookState || cookState.rids.length<=1) return;
  cookState.rids = cookState.rids.filter(x=>x!==rid);
  delete cookState.ing[rid]; delete cookState.steps[rid];
  renderCook();
}
function closeCook(){
  $('#cook').classList.remove('open');
  document.body.style.overflow='';
  cookState=null;
  releaseWake();
}
function openCookPicker(){
  const avail = state.recipes.filter(r=>r.status==='ok' && !cookState.rids.includes(r.id));
  const items = avail.length ? avail.map(r=>
    `<button class="pick" data-act="cook-pick" data-id="${r.id}" data-name="${esc((r.title||domain(r.url)).toLowerCase())}">
      <span class="p-title">${esc(r.title||domain(r.url))}</span>
      <span class="p-meta">${r.ingredients?r.ingredients.length:0} ing${r.total_time?' · '+esc(fmtTime(r.total_time)):''}</span>
    </button>`).join('') : `<p style="color:var(--muted)">No other recipes to add — import another first.</p>`;
  $('#modal').innerHTML = `
    <div class="modal-head"><h3>Cook alongside…</h3><button class="btn-icon" data-act="close" style="color:var(--faint)"><i class="ph ph-x"></i></button></div>
    <div class="modal-body">
      ${avail.length?'<input class="pick-search" type="text" placeholder="Search recipes…" autocomplete="off">':''}
      ${items}
    </div>`;
  $('#scrim').classList.add('open');
  focusPickSearch();
}

/* one recipe's content inside cooking mode; `dual` stacks ingredients above method */
function cookPanel(r, dual){
  const f = scaleFactor(r);
  const ing = cookState.ing[r.id] || new Set();
  const stp = cookState.steps[r.id] || new Set();
  const ings = (r.ingredients||[]).map((i,idx)=>{
    const done = ing.has(idx);
    const amt = (i.quantity!=null) ? esc(fmtNum(i.quantity*f)+(i.unit?' '+i.unit:'')) : (i.unit?esc(i.unit):'');
    return `<li class="cook-ing ${done?'done':''}" data-act="cook-ing" data-rid="${r.id}" data-i="${idx}">
      <span class="cbox">${done?'<i class="ph ph-check"></i>':''}</span><span class="cook-amt">${amt}</span><span class="cook-iname">${esc(i.item)}</span></li>`;
  }).join('');
  const steps = (r.instructions||[]).map((s,idx)=>{
    const done = stp.has(idx);
    return `<div class="cook-step ${done?'done':''}" data-act="cook-step" data-rid="${r.id}" data-i="${idx}">
      <div class="cook-num">${idx+1}</div><div class="cook-stext">${esc(s)}</div></div>`;
  }).join('');
  const base = r.servings;
  const scaler = base ? `<div class="serv-scaler sm">
      <button class="btn-icon btn-ghost" data-act="cook-serv" data-id="${r.id}" data-d="-1" ${targetServings(r)<=1?'disabled':''}><i class="ph ph-minus"></i></button>
      <span class="serv-val"><i class="ph ph-fork-knife"></i> ${esc(targetServings(r))}${f!==1?` <span style="color:var(--faint);font-weight:500">(of ${esc(base)})</span>`:''}</span>
      <button class="btn-icon btn-ghost" data-act="cook-serv" data-id="${r.id}" data-d="1"><i class="ph ph-plus"></i></button></div>` : '';
  const head = dual
    ? `<div class="cook-rhead"><h2 class="cook-rtitle">${esc(r.title||domain(r.url))}</h2>
         <button class="btn-icon btn-ghost" data-act="cook-remove" data-id="${r.id}" title="Remove"><i class="ph ph-x"></i></button></div>`
    : `<h1 class="cook-title">${esc(r.title||domain(r.url))}</h1>`;
  return `<section class="cook-recipe">
    ${head}
    <div class="cook-head">
      <div class="chiprow">${r.total_time?`<span class="chip key"><i class="ph ph-timer"></i> ${esc(fmtTime(r.total_time))}</span>`:''}<a class="chip" href="${esc(r.url)}" target="_blank" rel="noopener">source <i class="ph ph-arrow-up-right"></i></a></div>
      ${scaler}
    </div>
    <div class="cook-cols">
      <section class="cook-panel"><h2>Ingredients</h2><ul class="cook-inglist">${ings||'<p class="muted">No ingredients captured.</p>'}</ul></section>
      <section class="cook-panel"><h2>Method</h2><div class="cook-steps">${steps||'<p class="muted">No instructions were captured. Open the source link to follow along.</p>'}</div></section>
    </div>
  </section>`;
}

function renderCook(){
  if(!cookState) return;
  const recs = cookState.rids.map(id=>state.recipes.find(r=>r.id===id)).filter(Boolean);
  if(!recs.length){ closeCook(); return; }
  const dual = recs.length>1;
  $('#cook').innerHTML = `
    <div class="cook-bar">
      <div class="cook-bartitle">${dual?'Cooking '+recs.length+' recipes':esc(recs[0].title||domain(recs[0].url))}</div>
      ${('wakeLock' in navigator)?'<span class="cook-awake">screen stays on</span>':''}
      ${recs.length<2?'<button class="btn btn-ghost btn-sm" data-act="cook-add"><i class="ph ph-plus"></i> Cook alongside</button>':''}
      <button class="btn btn-ghost btn-sm" data-act="cook-close"><i class="ph ph-x"></i> Done</button>
    </div>
    <div class="cook-wrap ${dual?'dual':''}">
      <div class="${dual?'cook-duo':'cook-single'}">${recs.map(r=>cookPanel(r,dual)).join('')}</div>
    </div>`;
}

/* ---------- Sample data ---------- */
function sampleRecipes(){
  return [
    { id:uid(), title:'Weeknight Chicken Burritos', url:'https://example.com/chicken-burritos', status:'ok', servings:4, total_time:40,
      ingredients:[
        {quantity:1,unit:'lb',item:'chicken breast',category:'Meat & Seafood',raw:'1 lb chicken breast'},
        {quantity:4,unit:'',item:'flour tortilla',category:'Bakery',raw:'4 large flour tortillas'},
        {quantity:1,unit:'cup',item:'shredded cheddar',category:'Dairy & Eggs',raw:'1 cup shredded cheddar'},
        {quantity:1,unit:'cup',item:'rice',category:'Pantry',raw:'1 cup rice'},
        {quantity:1,unit:'can',item:'black beans',category:'Pantry',raw:'1 can black beans'},
        {quantity:2,unit:'clove',item:'garlic',category:'Produce',raw:'2 cloves garlic'},
        {quantity:1,unit:'',item:'onion',category:'Produce',raw:'1 onion'},
        {quantity:1,unit:'tbsp',item:'olive oil',category:'Pantry',raw:'1 tbsp olive oil'},
        {quantity:null,unit:'',item:'salt',category:'Spices',raw:'salt to taste'}
      ], instructions:['Cook the rice.','Sauté onion and garlic, add diced chicken and spices.','Warm tortillas, fill with chicken, rice, beans and cheese, then roll.'] },
    { id:uid(), title:'Creamy Tomato Pasta', url:'https://example.com/tomato-pasta', status:'ok', servings:4, total_time:30,
      ingredients:[
        {quantity:12,unit:'oz',item:'pasta',category:'Pantry',raw:'12 oz pasta'},
        {quantity:2,unit:'cup',item:'milk',category:'Dairy & Eggs',raw:'2 cups milk'},
        {quantity:1,unit:'can',item:'crushed tomatoes',category:'Pantry',raw:'1 can crushed tomatoes'},
        {quantity:3,unit:'clove',item:'garlic',category:'Produce',raw:'3 cloves garlic'},
        {quantity:0.5,unit:'cup',item:'parmesan',category:'Dairy & Eggs',raw:'½ cup parmesan'},
        {quantity:2,unit:'tbsp',item:'olive oil',category:'Pantry',raw:'2 tbsp olive oil'},
        {quantity:1,unit:'',item:'onion',category:'Produce',raw:'1 onion'},
        {quantity:null,unit:'',item:'salt',category:'Spices',raw:'salt to taste'}
      ], instructions:['Boil pasta until al dente.','Simmer garlic, onion, tomatoes and milk into a sauce.','Toss pasta with sauce and parmesan.'] },
    { id:uid(), title:'Morning Oat Pancakes', url:'https://example.com/oat-pancakes', status:'ok', servings:2, total_time:20,
      ingredients:[
        {quantity:1,unit:'cup',item:'flour',category:'Pantry',raw:'1 cup flour'},
        {quantity:1,unit:'cup',item:'milk',category:'Dairy & Eggs',raw:'1 cup milk'},
        {quantity:2,unit:'',item:'egg',category:'Dairy & Eggs',raw:'2 eggs'},
        {quantity:1,unit:'tbsp',item:'sugar',category:'Pantry',raw:'1 tbsp sugar'},
        {quantity:2,unit:'tbsp',item:'butter',category:'Dairy & Eggs',raw:'2 tbsp butter'},
        {quantity:0.5,unit:'cup',item:'oats',category:'Pantry',raw:'½ cup oats'}
      ], instructions:['Whisk dry and wet ingredients separately, then combine.','Cook on a buttered griddle until golden.'] }
  ];
}

/* ---------- Events ---------- */
document.addEventListener('click', async (e)=>{
  const tab=e.target.closest('.tab'); if(tab){ setView(tab.dataset.view); return; }
  const btn=e.target.closest('[data-act]'); if(!btn) return;
  const act=btn.dataset.act, id=btn.dataset.id;

  if(act==='goto'){ setView(btn.dataset.v); return; }
  if(act==='seed'){ state.recipes=sampleRecipes(); await save(K.recipes,state.recipes); renderRecipes(); toast('Added 3 sample recipes'); return; }

  if(act==='retry'){ const r=state.recipes.find(x=>x.id===id); if(r) scrapeRecipe(r); return; }
  if(act==='delete'){ state.recipes=state.recipes.filter(x=>x.id!==id);
    for(const k in state.plan){ state.plan[k]=state.plan[k].filter(rid=>rid!==id); if(!state.plan[k].length) delete state.plan[k]; }
    await save(K.recipes,state.recipes); await save(K.plan,state.plan); renderRecipes(); return; }
  if(act==='toggle-view'){ const k='rec:'+id; state.expanded[k]=!state.expanded[k]; delete state.expanded['edit:'+id]; renderRecipes(); return; }
  if(act==='edit'){ state.expanded['edit:'+id]=true; delete state.expanded['rec:'+id]; renderRecipes();
    setTimeout(()=>{document.querySelectorAll('.ed-auto').forEach(autoGrow); const t=document.getElementById('edname-'+id); if(t)t.focus();},30); return; }
  if(act==='cancel-edit'){ delete state.expanded['edit:'+id]; renderRecipes(); return; }
  if(act==='save-edit'){
    const r=state.recipes.find(x=>x.id===id);
    if(r){
      const nm=document.getElementById('edname-'+id), sv=document.getElementById('edserv-'+id),
            ur=document.getElementById('edurl-'+id), ing=document.getElementById('eding-'+id),
            st=document.getElementById('edsteps-'+id);
      if(nm) r.title = nm.value.trim() || r.title;
      if(sv){ const n=parseInt(sv.value,10); r.servings = (n>0 ? n : null); if(!(n>0)) r.targetServings=null; }
      if(ur) r.url = ur.value.trim();
      if(ing) r.ingredients = ing.value.split('\n').map(parseLine).filter(Boolean);
      if(st) r.instructions = st.value.split('\n').map(x=>x.trim()).filter(Boolean);
      r.status='ok'; r.error=null;
      delete state.expanded['edit:'+id]; state.expanded['rec:'+id]=true;
      await save(K.recipes,state.recipes); renderRecipes(); toast('Recipe saved'); }
    return; }

  if(act==='week'){ const d=+btn.dataset.d;
    state.weekStart = d===0 ? getMonday(new Date()) : (()=>{const x=new Date(state.weekStart); x.setDate(x.getDate()+d*7); return getMonday(x);})();
    state.view==='plan'?renderPlan():renderList(); return; }

  if(act==='add-meal'){ openPicker(btn.dataset.iso); return; }
  if(act==='close'){ closeModal(); return; }
  if(act==='pick'){ const iso=btn.dataset.iso; (state.plan[iso]=state.plan[iso]||[]).push(btn.dataset.id);
    await save(K.plan,state.plan); closeModal(); renderPlan(); toast('Added to plan'); return; }
  if(act==='rm-meal'){ const iso=btn.dataset.iso; const idx=+btn.dataset.idx;
    if(state.plan[iso]){ state.plan[iso].splice(idx,1); if(!state.plan[iso].length) delete state.plan[iso]; }
    await save(K.plan,state.plan); renderPlan(); return; }

  if(act==='cook'){ openCook(id); return; }
  if(act==='cook-add'){ openCookPicker(); return; }
  if(act==='cook-pick'){ cookAdd(id); closeModal(); return; }
  if(act==='cook-remove'){ cookRemove(id); return; }
  if(act==='scale-serv'){ const r=state.recipes.find(x=>x.id===id); if(!r||!r.servings) return;
    r.targetServings=Math.max(1,(r.targetServings||r.servings)+(+btn.dataset.d));
    await save(K.recipes,state.recipes); renderPlan(); return; }
  if(act==='cook-close'){ closeCook(); return; }
  if(act==='cook-serv'){ if(!cookState) return; const r=state.recipes.find(x=>x.id===id);
    if(r && r.servings){ r.targetServings=Math.max(1,(r.targetServings||r.servings)+(+btn.dataset.d)); await save(K.recipes,state.recipes); }
    renderCook(); return; }
  if(act==='cook-ing'){ if(!cookState) return; const rid=btn.dataset.rid, i=+btn.dataset.i;
    const set=cookState.ing[rid]; if(!set) return; const on=set.has(i); on?set.delete(i):set.add(i);
    btn.classList.toggle('done', !on); const box=btn.querySelector('.cbox'); if(box) box.innerHTML = on?'':'<i class="ph ph-check"></i>'; return; }
  if(act==='cook-step'){ if(!cookState) return; const rid=btn.dataset.rid, i=+btn.dataset.i;
    const set=cookState.steps[rid]; if(!set) return; const on=set.has(i); on?set.delete(i):set.add(i);
    btn.classList.toggle('done', !on); return; }

  if(act==='check'){ const k=btn.dataset.key; const on=!!state.checked[k]; if(on) delete state.checked[k]; else state.checked[k]=true;
    await save(K.checked,state.checked); const item=btn.closest('.gitem'); if(item) item.classList.toggle('done',!on); return; }
  if(act==='gexpand'){ const k=btn.dataset.key; state.expanded[k]=!state.expanded[k]; renderList(); return; }
  if(act==='list-mode'){ state.listMode=btn.dataset.m; renderList(); return; }
  if(act==='open-layout'){ openLayoutEditor(); return; }
  if(act==='open-pantry'){ openPantryEditor(); return; }
  if(act==='pantry-add'){ const inp=$('#pantry-input'); const v=((inp&&inp.value)||'').trim().toLowerCase();
    if(v && !state.pantry.includes(v)){ state.pantry.push(v); await save(K.pantry,state.pantry); renderPantryEditor(); renderList(); }
    else if(inp){ inp.focus(); } return; }
  if(act==='pantry-add-suggest'){ const v=btn.dataset.item; if(!state.pantry.includes(v)){ state.pantry.push(v); await save(K.pantry,state.pantry); renderPantryEditor(); renderList(); } return; }
  if(act==='pantry-remove'){ const v=btn.dataset.item; state.pantry=state.pantry.filter(x=>x!==v); await save(K.pantry,state.pantry); renderPantryEditor(); renderList(); return; }
  if(act==='layout-up' || act==='layout-down'){
    const cat=btn.dataset.cat, i=state.layout.indexOf(cat), j=(act==='layout-up'?i-1:i+1);
    if(i>=0 && j>=0 && j<state.layout.length){ const a=state.layout; [a[i],a[j]]=[a[j],a[i]];
      await save(K.layout, state.layout); renderLayoutEditor(); renderList(); }
    return; }
  if(act==='uncheck'){ const wk=isoDate(state.weekStart); for(const k in state.checked){ if(k.startsWith(wk+'|')) delete state.checked[k]; }
    await save(K.checked,state.checked); renderList(); return; }
  if(act==='copy'){
    const {lines}=currentWeekItems(); const byCat={}; for(const l of lines){ if(inPantry(l.item)) continue; (byCat[l.category]=byCat[l.category]||[]).push(l); }
    let txt='Grocery list — week of '+rangeLabel(state.weekStart)+'\n';
    for(const c of state.layout){ if(!byCat[c])continue; txt+='\n'+c+'\n'; for(const l of byCat[c].sort((a,b)=>a.item.localeCompare(b.item))) txt+='  • '+l.item+' — '+l.amount+'\n'; }
    try{ await navigator.clipboard.writeText(txt); toast('List copied'); }catch(err){ toast('Copy not available here'); }
    return; }
});
$('#scrim').addEventListener('click',e=>{ if(e.target.id==='scrim') closeModal(); });
document.addEventListener('input', e=>{
  if(!e.target.classList) return;
  if(e.target.classList.contains('pick-search')) filterPicks(e.target.value);
  else if(e.target.classList.contains('recipe-search')){ state.recipeSearch=e.target.value; applyRecipeFilter(); }
  else if(e.target.classList.contains('ed-auto')) autoGrow(e.target);
});

// add recipe (button + Enter key)
document.addEventListener('click', async (e)=>{
  if(!e.target.closest('#r-add')) return;
  const titleEl=$('#r-title'), urlEl=$('#r-url'); const url=(urlEl.value||'').trim();
  if(!url){ urlEl.focus(); toast('Paste a recipe link to add it'); return; }
  let fixed=url; if(!/^https?:\/\//i.test(fixed)) fixed='https://'+fixed;
  const rec={ id:uid(), title:(titleEl.value||'').trim(), url:fixed, status:'scraping', ingredients:[], instructions:[], servings:null };
  state.recipes.unshift(rec); await save(K.recipes,state.recipes);
  titleEl.value=''; urlEl.value=''; renderRecipes(); scrapeRecipe(rec);
});
document.addEventListener('keydown', e=>{ if(e.key==='Enter' && (e.target.id==='r-url'||e.target.id==='r-title')){ const b=$('#r-add'); if(b)b.click(); } });
document.addEventListener('keydown', e=>{ if(e.key==='Enter' && e.target.id==='pantry-input'){ const b=document.querySelector('[data-act="pantry-add"]'); if(b)b.click(); } });
document.addEventListener('keydown', e=>{ if(e.key==='Escape'){ if(cookState) closeCook(); else if($('#scrim').classList.contains('open')) closeModal(); } });
document.addEventListener('visibilitychange', ()=>{ if(document.visibilityState==='visible' && cookState && !wakeLock) requestWake(); });

/* ---------- Drag a recipe chip onto a day ---------- */
let dragRid = null;
document.addEventListener('dragstart', e=>{
  const chip = e.target.closest('[data-drag-rid]');
  if(!chip) return;
  dragRid = chip.getAttribute('data-drag-rid');
  e.dataTransfer.effectAllowed='copy';
  try{ e.dataTransfer.setData('text/plain', dragRid); }catch(_){}
  chip.classList.add('dragging');
});
document.addEventListener('dragend', e=>{
  const chip = e.target.closest('[data-drag-rid]'); if(chip) chip.classList.remove('dragging');
  dragRid=null;
  document.querySelectorAll('.day.drop-hover').forEach(d=>d.classList.remove('drop-hover'));
});
document.addEventListener('dragover', e=>{
  const day = e.target.closest('.day'); if(!day || !dragRid) return;
  e.preventDefault(); e.dataTransfer.dropEffect='copy';
  day.classList.add('drop-hover');
});
document.addEventListener('dragleave', e=>{
  const day = e.target.closest('.day');
  if(day && !day.contains(e.relatedTarget)) day.classList.remove('drop-hover');
});
document.addEventListener('drop', async e=>{
  const day = e.target.closest('.day'); if(!day) return;
  e.preventDefault();
  const iso = day.getAttribute('data-iso');
  const rid = dragRid || (e.dataTransfer && e.dataTransfer.getData('text/plain'));
  day.classList.remove('drop-hover');
  if(iso && rid && state.recipes.some(r=>r.id===rid)){
    (state.plan[iso]=state.plan[iso]||[]).push(rid);
    await save(K.plan,state.plan);
    renderPlan();
    const r=state.recipes.find(x=>x.id===rid);
    toast('Added '+(r?'“'+r.title+'”':'recipe')+' to plan');
  }
});

/* ---------- Init ---------- */
(async function init(){
  state.recipes = await load(K.recipes, []);
  state.plan = await load(K.plan, {});
  state.checked = await load(K.checked, {});
  state.layout = await load(K.layout, CAT_ORDER.slice());
  // keep layout valid: drop unknown sections, append any missing ones
  state.layout = state.layout.filter(c=>CAT_ORDER.includes(c));
  CAT_ORDER.forEach(c=>{ if(!state.layout.includes(c)) state.layout.push(c); });
  state.pantry = await load(K.pantry, []);
  // re-normalize any older units defensively
  state.recipes.forEach(r=>{ (r.ingredients||[]).forEach(i=>{ i.unit=normalizeUnit(i.unit); if(!i.category)i.category=guessCategory(i.item); }); });
  setView('plan');
})();
