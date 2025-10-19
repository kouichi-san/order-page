/*!
 * PPP Order Page - app.js
 * SavePoint: SP-20251019-FavLater-1
 * Version: 20251019b
 * Purpose: お気に入り（♡）/ あとで の実装安定化 & 表示整合
 */
window.PPP = window.PPP || {};
PPP.meta = Object.freeze({
  sp: 'SP-20251019-FavLater-1',
  ver: '20251019b',
  builtAt: '2025-10-19T00:00:00+09:00'
});

// 画像などのキャッシュバストに使う既存の IMG_BUST が未定義ならフォールバック
if (typeof window.IMG_BUST === 'undefined') window.IMG_BUST = PPP.meta.ver;

// バナー表示（本番でも邪魔にならないよう1行）
console.info(`[PPP] ${PPP.meta.sp} / ver ${PPP.meta.ver}`);

/** ========= 設定 ========= **/
const PRODUCTS_URL = "https://script.google.com/macros/s/AKfycby4489YlOmucAj4DguggZsQox2Kg3yfALImCfma0rYPCNTV_OBQ13u_llxSOv8xO6USKw/exec?endpoint=products";
const FORM_BASE    = "https://docs.google.com/forms/d/e/1FAIpQLScWyIhn4F9iS-ZFhHQlQerLu7noGWSu4xauMPgISh1DmNFD_w/viewform";
const CUTOVER_HOUR = 2; // 26時 (=午前2:00) までは前日扱い
const MAX_ADVANCE_DAYS = 20; // 最短日から＋20日（合計21候補）


let PRODUCTS = [];
let productById = new Map();

/** ========= アプリ状態 ========= **/
const state = {
  cart: {},
  minDateISO: null,
  selectedDateISO: null,
  selectedSlot: "14時〜17時",
  memo: "",
  agreeStock: false,
};

/** ========= フィルタ状態（Variant Mode対応） ========= **/
const filterState = {
  cat: null,
  subcat: null,
  sort: 'default',
  favsOnly: false,
  // Variant Mode
  variantGroup: null,     // 代表ID（Union-Find root想定・無くてもOK）
  variantSelected: null,  // 選択id
  variantBackup: null,    // 元のcat/sub/sort退避
};

/** ========= ユーティリティ ========= **/
const clamp = (n,min,max)=>Math.max(min,Math.min(max,n));
const norm  = (s)=>String(s||'').trim().toLowerCase();
function ensureTopProgress(){
  if(!document.getElementById('topProgress')){
    const d=document.createElement('div'); d.id='topProgress'; document.body.appendChild(d);
  }
}
function ensureSr(){
  if(!document.getElementById('srStatus')){
    const s=document.createElement('div'); s.id='srStatus'; s.className='sr-only'; s.setAttribute('aria-live','polite'); document.body.appendChild(s);
  }
}
function toJst(d=new Date()){
  const tzOffset = 9*60; // Asia/Tokyo
  return new Date(d.getTime() + (d.getTimezoneOffset() + tzOffset)*60000);
}
// function isoDate(d){ const z=new Date(d); z.setHours(0,0,0,0); return z.toISOString().slice(0,10); }
function isoDate(d){
  const x = new Date(d);
  // ローカル日の 00:00 をそのままローカル基準の YYYY-MM-DD で返す（UTCにしない）
  const y = x.getFullYear();
  const m = String(x.getMonth()+1).padStart(2,'0');
  const da = String(x.getDate()).padStart(2,'0');
  return `${y}-${m}-${da}`;
}
function fmtJP(d){
  const y=d.getFullYear(), m=d.getMonth()+1, da=d.getDate();
  const w='日月火水木金土'[d.getDay()];
  return `${y}/${String(m).padStart(2,'0')}/${String(da).padStart(2,'0')} (${w})`;
}
function yen(n){ n=Number(n||0); return n.toLocaleString('ja-JP',{style:'currency',currency:'JPY',maximumFractionDigits:0}); }
function el(html){ const t=document.createElement('template'); t.innerHTML=html.trim(); return t.content.firstElementChild; }
function escapeHtml(str){ return String(str||'').replace(/[&<>"]/g, s => ({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;'}[s])); }

// --- 最短受取：2箇所（+任意のInline）を同時に更新する安全版 ---
function setMinDateAll(date){
  var d = (date instanceof Date) ? date : new Date(date);
  var s = fmtJP(d);
  var map = [
    ['minDate', s],                 // 旧ステータスバー（残っていれば更新される）
    ['cartMinDate', s],             // SP/PC 通常フッターの値
    ['cartMinDateDrawer', s],       // カートドロワ上部
    ['cartMinDateInline', '最短受取 ' + s] // 左のピル
  ];
  for (var i=0;i<map.length;i++){
    var el = document.getElementById(map[i][0]);
    if (el) el.textContent = map[i][1];
  }
}

/** ========= Loading UX（200msルール） ========= **/
let loadingTimer = null;
function showSkeleton(){
  const grid = document.getElementById('productGrid');
  if(!grid) return;
  ensureTopProgress(); ensureSr();
  grid.setAttribute('aria-busy','true');
  grid.innerHTML = '';
  const count = window.matchMedia('(max-width:720px)').matches ? 4 : 4;
  for(let i=0;i<count;i++){
    grid.insertAdjacentHTML('beforeend',
      `<article class="skel-card">
         <div class="skel-img"></div>
         <div class="skel-line big"></div>
         <div class="skel-line" style="width:70%"></div>
         <div class="skel-btn"></div>
       </article>`);
  }
  document.getElementById('topProgress')?.classList.add('on');
  document.getElementById('srStatus').textContent='商品を読み込んでいます';
}
function hideSkeleton(){
  const grid = document.getElementById('productGrid');
  if(grid){ grid.removeAttribute('aria-busy'); }
  document.getElementById('topProgress')?.classList.remove('on');
  const sr=document.getElementById('srStatus'); if(sr) sr.textContent='';
}

/** ========= 並べ替え ========= **/
function sortProducts(list){
  const s = filterState.sort || 'default';
  const byNum = (a,b)=> (a||0)-(b||0);
  const byNumDesc = (a,b)=> (b||0)-(a||0);
  switch(s){
    case 'price_asc':  return list.slice().sort((a,b)=>byNum(a.price,b.price));
    case 'price_desc': return list.slice().sort((a,b)=>byNumDesc(a.price,b.price));
    case 'popular':    return list.slice().sort((a,b)=>byNumDesc(a._pop,b._pop));
    case 'new':        return list.slice().sort((a,b)=>byNumDesc(a._newTS,b._newTS));
    default:           return list.slice().sort((a,b)=>a._idx-b._idx);
  }
}
function renderSortActive(){
  document.querySelectorAll('.sortbtn').forEach(b=>{
    b.classList.toggle('active', b.dataset.sort===String(filterState.sort||'default'));
  });
}
/** ========= あとで ========= **/
function getLaterIds(){
  const ids = [];
  for (let i=0;i<localStorage.length;i++){
    const k = localStorage.key(i);
    if(k && k.startsWith('later:') && localStorage.getItem(k)==='1'){
      ids.push(k.slice(6));
    }
  }
  return ids.filter(id => productById.has(id));
}
/** ========= お気に入り ========= **/
function getFavIds(){
  const ids = [];
  for (let i=0;i<localStorage.length;i++){
    const k = localStorage.key(i);
    if(k && k.startsWith('fav:') && localStorage.getItem(k)==='1'){
      ids.push(k.slice(4));
    }
  }
  return ids.filter(id => productById.has(id));
}
/** ========= あとで描画 ========= **/
function renderLaterList(){
  const box = document.getElementById('laterList'); if(!box) return;
  const ids = getLaterIds();
  if(ids.length===0){ box.innerHTML = '<div class="muted">「あとで」に入れた商品はありません</div>'; return; }
  box.innerHTML = ids.map(id=>{
    const p = productById.get(id); const img = p.img || 'https://dummyimage.com/160x120/ffffff/e5e7eb&text=No+Image';
    return `
      <div class="cartrow" data-id="${p.id}">
        <div class="rowline">
          <div class="ttl">${escapeHtml(p.name)}</div>
          <div class="prc">${(p.price>0?yen(p.price):'店頭価格')}</div>
        </div>
        <div class="g2">
          <div class="thumb"><img src="${img}" alt="${escapeHtml(p.name)}" onerror="this.onerror=null;this.src='https://dummyimage.com/160x120/ffffff/e5e7eb&text=No+Image'"></div>
          <div class="qtybar">
            <div class="group">
              <button class="btn" data-later-move="cart">カートへ</button>
            </div>
            <button class="btn warn" data-later-del="1">解除</button>
          </div>
        </div>
      </div>`;
  }).join('');
  document.getElementById('laterCount')?.replaceChildren(document.createTextNode(`（${ids.length}）`));
  const laterSec = document.getElementById('laterSec');
  // if (laterSec) laterSec.open = ids.length > 0;   // 0件なら自動で畳む
  // document.getElementById('laterCount')?.textContent = `（${ids.length}）`;
   { const el = document.getElementById('laterCount'); if (el) el.textContent = `（${ids.length}）`; }


}
/** ========= お気に入り描画 ========= **/
function renderFavList(limit=8){
  const box = document.getElementById('favList'); if(!box) return;
  const ids = getFavIds().slice(0,limit);
  if(ids.length===0){ box.innerHTML = '<div class="muted">お気に入りは未登録です（♡で登録）</div>'; return; }
  box.innerHTML = ids.map(id=>{
    const p = productById.get(id); const img = p.img || 'https://dummyimage.com/160x120/ffffff/e5e7eb&text=No+Image';
    return `
      <div class="cartrow" data-id="${p.id}">
        <div class="rowline">
          <div class="ttl">${escapeHtml(p.name)}</div>
          <div class="prc">${(p.price>0?yen(p.price):'店頭価格')}</div>
        </div>
        <div class="g2">
          <div class="thumb"><img src="${img}" alt="${escapeHtml(p.name)}"></div>
          <div class="qtybar">
            <div class="group">
              <button class="btn" data-fav-addcart="1">カートへ</button>
            </div>
            <button class="btn warn" data-fav-del="1">お気に入り解除</button>
          </div>
        </div>
      </div>`;
  }).join('');
  document.getElementById('favCount')?.replaceChildren(document.createTextNode(`（${ids.length}）`));
  const favSec = document.getElementById('favSec');
  // if (favSec) favSec.open = ids.length > 0;       // 0件なら自動で畳む
    // document.getElementById('favCount')?.textContent = `（${ids.length}）`;
   { const el = document.getElementById('favCount'); if (el) el.textContent = `（${ids.length}）`; }

}

/** ========= 最短受取関係 ========= **/
function calcMinDate(){
  const now=toJst();
  const base=new Date(now);
  if(now.getHours()<CUTOVER_HOUR){ base.setDate(base.getDate()-1); }
  const min=new Date(base);
  min.setDate(min.getDate()+1);
  min.setHours(0,0,0,0);
  return min;
}
function renderMinDateEverywhere(){
  const d = calcMinDate();
  state.minDateISO = isoDate(d);
  setMinDateAll(d);   // ← ここだけに集約
}



/** ========= 「最終更新」表示 ========= **/
function renderLastUpdated(ts){
  const el=document.getElementById('lastUpdated'); if(!el) return;
  const d = ts ? toJst(new Date(ts)) : toJst();
  el.textContent = '最終更新 ' + fmtJP(d);
}

/** ========= 読み込み ========= **/
async function loadProducts(){
  try{
    loadingTimer = setTimeout(showSkeleton, 200);
    const res = await fetch(PRODUCTS_URL, { cache:'no-store' });
    const data = await res.json();
    PRODUCTS = (data.items||[]).map((x,i)=>({
      id:String(x.id||x.code||''), name:x.name, price:Number(x.price||0),
      img:x.img||x.imageUrl||'', desc:x.desc||'',
      prenote:x.prenote||'', unitNote:x.unitNote||'',
      catGroup:x.catGroup||x.cat||'', subcatGroup:x.subcatGroup||'',
      var1Id:x.var1Id||'', var1Label:x.var1Label||'',
      var2Id:x.var2Id||'', var2Label:x.var2Label||'',
      group: String(x.group||''),
      variant: String(x.variant||''),
      stock:(x.stock!==undefined?Number(x.stock):undefined),
      active:(x.active===undefined?true:Boolean(x.active)),
      leadDays:Number(x.leadDays||1),
      _idx:i, _pop:Number(x.popularity||x.pop||x.rank||0),
      _newTS: Date.parse(x.newAt||x.createdAt||x.updatedAt||x.date||'') || 0
    }));
    productById = new Map(PRODUCTS.map(p=>[p.id,p]));
    buildVariantGroups();
    renderProducts(); updateCategoryButtonLabel(); renderSortActive();
    renderLastUpdated(data.updated);
  }catch(e){
    console.error(e); renderLastUpdated();
  }finally{
    clearTimeout(loadingTimer); hideSkeleton();
  }
}

/** ========= バリエーショングループ構築（Union-Find） ========= **/
function buildVariantGroups(){
  const ids = new Set(PRODUCTS.map(p=>p.id));
  const parent = new Map();
  const find=(x)=>{ if(parent.get(x)!==x) parent.set(x, find(parent.get(x)||x)); return parent.get(x)||x; };
  const unite=(a,b)=>{
    if(!a||!b||!ids.has(a)||!ids.has(b)) return;
    if(!parent.has(a)) parent.set(a,a);
    if(!parent.has(b)) parent.set(b,b);
    const ra=find(a), rb=find(b);
    if(ra===rb) return;
    const [root,child] = [ra,rb].sort();
    parent.set(child, root);
  };
  PRODUCTS.forEach(p=>{ if(!parent.has(p.id)) parent.set(p.id,p.id); });
  PRODUCTS.forEach(p=>{
    const v1=String(p.var1Id||''); const v2=String(p.var2Id||'');
    if(v1) unite(p.id, v1);
    if(v2) unite(p.id, v2);
    if(p.group) unite(p.id, String(p.group));
  });
  PRODUCTS.forEach(p=>{ p.group = find(p.id); });
}

/** ========= Variantバー ========= **/
function showVariantbar(title){
  const bar = document.getElementById('variantbar'); if(!bar) return;
  bar.setAttribute('aria-hidden','false');
  const t = document.getElementById('variantTitle'); if(t) t.textContent = title || 'バリエーション';
}
function hideVariantbar(){
  const bar = document.getElementById('variantbar'); if(!bar) return;
  bar.setAttribute('aria-hidden','true');
  const t = document.getElementById('variantTitle'); if(t) t.textContent = '';
}
document.getElementById('variantBack')?.addEventListener('click', (e)=>{ e.preventDefault(); clearVariantMode(); });
document.getElementById('variantClose')?.addEventListener('click', (e)=>{ e.preventDefault(); clearVariantMode(); });

/** ========= Variant集合のフォールバック構築 ========= **/
function getVariantMembers(seedId, group){
  const out = new Map();
  const put = (id)=>{ const p=productById.get(String(id)); if(p) out.set(p.id,p); };

  const seed = productById.get(String(seedId));
  if(seed){
    put(seed.id);
    if(seed.var1Id) put(seed.var1Id);
    if(seed.var2Id) put(seed.var2Id);
  }
  // 逆参照（自分を指している子）
  (PRODUCTS||[]).forEach(x=>{
    if(x.var1Id===seedId || x.var2Id===seedId) put(x.id);
  });
  // group一致（Union-Findが効いていればここで兄弟が入る）
  if(group){
    (PRODUCTS||[]).forEach(x=>{ if((x.group||x.id)===group) put(x.id); });
  }
  return Array.from(out.values());
}

/** ========= Variant Mode ========= **/
function inVariantMode(){ return !!filterState.variantSelected; }
let _scrollBackup = 0;
function enterVariantMode(group, selectedId){
  filterState.variantBackup = { cat:filterState.cat, subcat:filterState.subcat, sort:filterState.sort };
  filterState.variantGroup = group || null;
  filterState.variantSelected = selectedId || null;

  try{ history.pushState({ppp:'variant', group, selectedId}, ''); }catch(_){}
  _scrollBackup = window.scrollY || document.documentElement.scrollTop || 0;

  let title = '';
  const chosen = productById.get(selectedId); if(chosen) title = chosen.name||'';
  if(!title){
    const mem = getVariantMembers(selectedId, group);
    if(mem[0]) title = mem[0].name||'';
  }
  showVariantbar(title || 'バリエーション');

  renderProducts();
  window.scrollTo({ top: 0, behavior: 'smooth' });
  requestAnimationFrame(()=> document.getElementById('variantBack')?.focus({preventScroll:true}));
}
function clearVariantMode(){
  if(!inVariantMode()) return;
  const b=filterState.variantBackup||{};
  filterState.variantGroup=null; filterState.variantSelected=null; filterState.variantBackup=null;
  filterState.cat=b.cat ?? filterState.cat;
  filterState.subcat=b.subcat ?? filterState.subcat;
  filterState.sort=b.sort ?? filterState.sort;
  hideVariantbar();
  renderProducts();
  window.scrollTo(0, _scrollBackup);
}
window.addEventListener('popstate', ()=>{ if(inVariantMode()) clearVariantMode(); });

/** ========= カテゴリラベル生成 ========= **/
function buildCatTree(){
  const map = new Map();
  (PRODUCTS||[]).forEach(p=>{
    const c=(p.catGroup||p.cat||'').trim(); const s=(p.subcatGroup||'').trim();
    if(!c) return;
    if(!map.has(c)) map.set(c,{label:c, subs:new Set()});
    if(s) map.get(c).subs.add(s);
  });
  const arr=[...map.values()].map(v=>({label:v.label, subs:[...v.subs]}));
  arr.sort((a,b)=>a.label.localeCompare(b.label,'ja'));
  arr.forEach(x=>x.subs.sort((a,b)=>a.localeCompare(b,'ja')));
  return arr;
}
function buildCatTreeCached(){ if(!buildCatTree._cache){ buildCatTree._cache=buildCatTree(); } return buildCatTree._cache; }
/** ========= カテゴリボタンラベル更新 ========= **/
function updateCategoryButtonLabel(){
  const btn = document.getElementById('btnCategories'); if(!btn) return;
  const noSel = !filterState.cat && !filterState.subcat;
  if (noSel){
    btn.textContent = 'カテゴリ';         // ← 未選択は常にこれ
    btn.classList.remove('has-filter');
    return;
  }
  const s1 = filterState.cat || 'すべて';
  const s2 = filterState.subcat ? ` / ${filterState.subcat}` : '';
  btn.textContent = `${s1}${s2}`;
  btn.classList.add('has-filter');
}
/* ====== お気に入りボタンのON/OFF反映 ====== */
function renderFavButtonActive(){
  const b=document.getElementById('btnFavs'); if(!b) return;
  b.setAttribute('aria-pressed', String(!!filterState.favsOnly));
}
/** ========= 商品描画 ========= **/
function renderProducts(){
  const grid=document.getElementById('productGrid'); if(!grid) return;
  grid.className='ppp-grid'; grid.innerHTML='';

  // Variant Mode（Union-Find失敗時もフォールバック集合で3枚まで）
  if(inVariantMode()){
    const selId = filterState.variantSelected;
    const members = getVariantMembers(selId, filterState.variantGroup);
    members.sort((a,b)=> (a.id===selId?-1:b.id===selId?1:(a._idx||0)-(b._idx||0)));
    members.slice(0,3).forEach((p, idx)=>appendProductCard(grid,p,idx, selId));
    return;
  }

  // 通常描画
  const nCat=norm(filterState.cat), nSub=norm(filterState.subcat);
  let filtered=(PRODUCTS||[]).filter(p=>{
    if(p.active===false) return false;
    const pc=norm(p.catGroup||p.cat||''); const ps=norm(p.subcatGroup||'');
    if(nCat && pc!==nCat) return false;
    if(nSub && ps!==nSub) return false;
    return true;
  });

  // ★ ここが“差し込み場所”
  // 「お気に入り」ON中は、localStorage の fav: を元に絞り込み
  if (filterState.favsOnly) {
    const favSet = new Set(getFavIds());
    filtered = filtered.filter(p => favSet.has(p.id));
  }

  const list = sortProducts(filtered);
  if (list.length === 0) {
    // 空のときの見栄え（任意）
    grid.innerHTML = '<div class="muted">条件に合う商品がありません（♡を付けると「お気に入り」で一覧できます）</div>';
    return;
  }
  list.forEach((p, idx)=>appendProductCard(grid,p,idx, null));

}

function appendProductCard(grid, p, idx, selectedId){
  const soldout=(p.stock!==undefined&&Number(p.stock)<=0);
  const catLabel=p.catGroup||p.cat||''; const subcatLabel=p.subcatGroup||'';
  const crumbHTML=[
    catLabel?`<a href="#" class="ppp-crumb-link" data-cat="${escapeHtml(catLabel)}">${escapeHtml(catLabel)}</a>`:'',
    subcatLabel?`<a href="#" class="ppp-crumb-link" data-subcat="${escapeHtml(subcatLabel)}">${escapeHtml(subcatLabel)}</a>`:''
  ].filter(Boolean).join(' › ');

  const vars=[]; if(p.var1Id&&p.var1Label)vars.push({id:String(p.var1Id),label:p.var1Label});
  if(p.var2Id&&p.var2Label)vars.push({id:String(p.var2Id),label:p.var2Label});
  const varsHTML=vars.slice(0,2).map(v=>`<button class="ppp-pill" data-var="${v.id}">${escapeHtml(v.label)}</button>`).join('');

  const el=document.createElement('article'); el.className='ppp-card'; el.dataset.id=p.id; el.dataset.group=p.group||'';
  el.style.animationDelay = (Math.min(idx||0, 18) * 0.03) + 's';
  if(soldout){ el.classList.add('is-soldout'); }
  if(selectedId && p.id===selectedId){ el.classList.add('is-selected'); el.setAttribute('aria-current','true'); }

  el.innerHTML=`
    <div class="ppp-crumbrow"><div class="ppp-crumb">${crumbHTML}</div></div>
    <div class="ppp-titlebar"><div class="ppp-name">${escapeHtml(p.name||'')}</div><button class="ppp-fav" data-fav="${p.id}" aria-label="お気に入り">♡</button></div>
    <div class="ppp-mi">
      <div class="ppp-media"><div class="ppp-img">
        <img onload="this.classList.add('is-ready')" src="${p.img||''}" alt="${escapeHtml(p.name||'')}" loading="lazy" decoding="async" referrerpolicy="no-referrer" onerror="this.onerror=null;this.src='https://dummyimage.com/1080x720/ffffff/e5e7eb&text=No+Image';this.classList.add('is-ready');">
      </div></div>
      <div class="ppp-info">
        ${p.prenote?`<div class="ppp-prenote">${escapeHtml(p.prenote)}</div>`:''}
        <div class="ppp-price">${(p.price>0&&!isNaN(p.price))?yen(p.price):'店頭価格'}</div>
        ${p.unitNote?`<div class="ppp-unit">${escapeHtml(p.unitNote)}</div>`:''}
        <div class="ppp-actions">
          <button class="ppp-btn add" data-add="${p.id}" ${soldout?'disabled':''} aria-label="カート追加"><span class="label">${soldout?'品切れ':'カート追加'}</span></button>
          <button class="ppp-btn" data-later="${p.id}">${localStorage.getItem('later:'+p.id)==='1'?'あとで済':'あとで'}</button>
        </div>
        ${varsHTML?`<div class="ppp-vars">${varsHTML}</div>`:''}
      </div>
    </div>
    <div class="ppp-descwrap">
      <div class="ppp-desc">${escapeHtml(p.desc||'')}</div>
      <!-- 明確なボタンでのみ詳細へ -->
      <a class="ppp-morebtn" href="#" data-detail="${p.id}" aria-label="もっと見る">もっと見る</a>
    </div>`;
      // 初期表示（お気に入り状態）
  if(localStorage.getItem('fav:'+p.id)==='1'){
    el.querySelector('.ppp-fav').classList.add('active');
    el.querySelector('.ppp-fav').textContent = '♥';
  }
  grid.appendChild(el);
}

/** ========= カート計算・表示 ========= **/
function totals(){
  const items=[]; let total=0, count=0;
  for(const id in state.cart){
    const qty = Number(state.cart[id]||0)|0;
    if(qty<=0) continue;
    const p = productById.get(id); if(!p) continue;
    items.push({ id, code:id, name:p.name, price:p.price, qty, total: p.price*qty });
    total += p.price*qty; count += qty;
  }
  return { items, total, count };
}
function renderCartBar(){
  const t = totals();
  const cnt = document.getElementById('cartCount'); if(cnt) cnt.textContent = `${t.count||0}点`;
  const sum = document.getElementById('cartTotal'); if(sum) sum.textContent = yen(t.total||0);
}
function renderCartFooterTotals(){
  const t = totals();
  document.getElementById('cartTotalFooter')?.replaceChildren(document.createTextNode(yen(t.total||0)));
}

/** ========= カートドロワ ========= **/
const cartDrawer = document.getElementById('cartDrawer');
function lockScroll(on){ document.documentElement.classList.toggle('ppp-no-scroll', on); document.body.classList.toggle('ppp-no-scroll', on); }
function openCartDrawer(){ cartDrawer?.setAttribute('aria-hidden','false'); lockScroll(true); renderCartDrawer(); window.addEventListener('keydown',onCartKeydown); PPP.guard.run(); PPP.guard.run && PPP.guard.run(); PPP.patch.cartFooter();}
function closeCartDrawer(){ cartDrawer?.setAttribute('aria-hidden','true');  lockScroll(false); window.removeEventListener('keydown',onCartKeydown); }
function onCartKeydown(e){ if(e.key==='Escape') closeCartDrawer(); }
document.querySelector('#cartDrawer .ppp-drawer__scrim')?.addEventListener('click',(e)=>{ if(e.target.matches('.ppp-drawer__scrim')) closeCartDrawer(); });
document.getElementById('cartDrawerClose')?.addEventListener('click', closeCartDrawer);
document.getElementById('cartDrawerCancel')?.addEventListener('click', closeCartDrawer);
document.getElementById('checkoutBtn2')?.addEventListener('click',(e)=>{ e.preventDefault(); openCartDrawer(); });

function updateProceedDisabled(){
  const btn=document.getElementById('cartProceed'); if(!btn) return;
  const on = !!state.agreeStock;
  btn.disabled = !on; btn.setAttribute('aria-disabled', String(!on));
  btn.classList.toggle('is-disabled', !on);
}

function renderCartDrawer(){
  const d=calcMinDate();
  state.minDateISO=isoDate(d);
  if(!state.selectedDateISO) state.selectedDateISO = state.minDateISO;

  // document.getElementById('cartMinDateDrawer')?.replaceChildren(document.createTextNode(fmtJP(toJst(new Date(state.minDateISO)))));
  const t = totals();
  document.getElementById('cartCountFooter')?.replaceChildren(document.createTextNode(`${t.count||0}点`));
  document.getElementById('cartTotalFooter')?.replaceChildren(document.createTextNode(yen(t.total||0)));

  const list = document.getElementById('cartList');
  if(list){
    if(t.items.length===0){
      list.innerHTML = '<div class="muted">カートは空です</div>';
    }else{
      list.innerHTML = t.items.map(it=>{
        const p = productById.get(it.id) || {};
        const img = p.img || 'https://dummyimage.com/160x120/ffffff/e5e7eb&text=No+Image';
        const name = escapeHtml(it.name);
        return `
          <div class="cartrow" data-id="${it.id}">
            <div class="rowline">
              <div class="ttl">${name}</div>
              <div class="prc">${yen(it.price)} × ${it.qty} = ${yen(it.price*it.qty)}</div>
            </div>
            <div class="g2">
              <div class="thumb"><img src="${img}" alt="${name}" onerror="this.onerror=null;this.src='https://dummyimage.com/160x120/ffffff/e5e7eb&text=No+Image'"></div>
              <div class="qtybar">
                <div class="group">
                  <button class="btn" data-cart="dec">−</button>
                  <input class="cartqty" type="number" min="0" step="1" value="${it.qty}">
                  <button class="btn" data-cart="inc">＋</button>
                </div>
                <button class="btn warn" data-cart="rm">削除</button>
              </div>
            </div>
          </div>`;
      }).join('');
    }
  }

  const dateEl = document.getElementById('pickupDate');
  if(dateEl){
      // const d0 = new Date(state.minDateISO);
      // const opts = [0,1,2,3].map(n=>{ const dd=new Date(d0); dd.setDate(dd.getDate()+n); return { iso: isoDate(dd), label: fmtJP(dd) }; });
      // dateEl.innerHTML = opts.map(o=>`<option value="${o.iso}" ${o.iso===state.selectedDateISO?'selected':''}>${o.label}</option>`).join('');
    const d0 = new Date(state.minDateISO);
    const opts = Array.from({length: MAX_ADVANCE_DAYS + 1}, (_, n) => {
    const dd = new Date(d0);
    dd.setDate(dd.getDate() + n);
    return { iso: isoDate(dd), label: fmtJP(dd) };
    });
    dateEl.innerHTML = opts
      .map(o => `<option value="${o.iso}" ${o.iso===state.selectedDateISO?'selected':''}>${o.label}</option>`)
      .join('');

    // 既存選択が候補外なら最短日に巻き戻す（安全策）
    const values = opts.map(o => o.iso);
    if (!values.includes(state.selectedDateISO)) {
      state.selectedDateISO = values[0];
      dateEl.value = state.selectedDateISO;
  }
  // const slotEl = document.getElementById('pickupSlot');
  // if(slotEl){
  //   const slots = ['14時〜17時','17時〜19時'];
  //   slotEl.innerHTML = slots.map(s=>`<option ${s===state.selectedSlot?'selected':''}>${s}</option>`).join('');
  // }
  const slotEl = document.getElementById('pickupSlot');
  if (slotEl) {
    // 既存HTMLの選択肢を尊重：一致すれば選択、なければ現行の先頭を採用
    const has = [...slotEl.options].some(o => o.value===state.selectedSlot || o.textContent===state.selectedSlot);
    slotEl.value = has ? state.selectedSlot : slotEl.value;
    state.selectedSlot = slotEl.value;
  }
  const memo = document.getElementById('pickupMemo');
  if(memo){ memo.value = state.memo||''; }

  const agree = document.getElementById('agreeStock');
  if(agree){ agree.checked = !!state.agreeStock; }
  updateProceedDisabled();
  renderCartFooterTotals();
  renderLaterList();
  renderFavList();

  }
 }

/** ========= クリック委譲 ========= **/
// 数量・削除（del/rm 両対応）
document.addEventListener('click',(ev)=>{
  const btn=ev.target.closest('[data-cart]'); if(!btn) return;
  const row=btn.closest('.cartrow'); const id=row?.dataset.id; if(!id) return;
  const cur = Number(state.cart[id]||0)|0;
  const kind = btn.dataset.cart;
  if(kind==='inc'){ state.cart[id]=clamp(cur+1,0,999); }
  if(kind==='dec'){ state.cart[id]=clamp(cur-1,0,999); if(state.cart[id]===0) delete state.cart[id]; }
  if(kind==='del' || kind==='rm'){ delete state.cart[id]; }
  localStorage.setItem('cart',JSON.stringify(state.cart));
  renderCartBar(); renderCartDrawer();
});
// あとで買う → カートへ／解除
document.addEventListener('click', (ev)=>{
  const row = ev.target.closest('#laterList .cartrow'); if(!row) return;
  const id = row.dataset.id;
  if(ev.target.matches('[data-later-move="cart"]')){
    state.cart[id] = clamp((state.cart[id]||0)+1, 0, 999);
    localStorage.setItem('cart', JSON.stringify(state.cart));
    localStorage.removeItem('later:'+id);
    renderCartBar(); renderCartDrawer();
  }
  if(ev.target.matches('[data-later-del]')){
    localStorage.removeItem('later:'+id);
    renderLaterList();
  }
});
// お気に入り → カートへ／解除
document.addEventListener('click', (ev)=>{
  const row = ev.target.closest('#favList .cartrow'); if(!row) return;
  const id = row.dataset.id;
  if(ev.target.matches('[data-fav-addcart]')){
    state.cart[id] = clamp((state.cart[id]||0)+1, 0, 999);
    localStorage.setItem('cart', JSON.stringify(state.cart));
    renderCartBar(); renderCartDrawer();
  }
  if(ev.target.matches('[data-fav-del]')){
    localStorage.removeItem('fav:'+id);
    renderFavList();
  }
});


// 入力や選択
document.addEventListener('change',(ev)=>{
  const input=ev.target.closest('#cartList .cartqty');
  if(input){
    const row=input.closest('.cartrow'); const id=row?.dataset.id; if(!id) return;
    const v=Math.max(0, Number(input.value||0)|0);
    if(v===0) delete state.cart[id]; else state.cart[id]=v;
    localStorage.setItem('cart',JSON.stringify(state.cart));
    renderCartBar(); renderCartDrawer(); return;
  }
  if(ev.target.id==='pickupDate'){ state.selectedDateISO = ev.target.value; }
  if(ev.target.id==='pickupSlot'){ state.selectedSlot = ev.target.value; }
  if(ev.target.id==='agreeStock'){ state.agreeStock = ev.target.checked; updateProceedDisabled(); }
});
document.addEventListener('input',(ev)=>{ if(ev.target.id==='pickupMemo'){ state.memo = ev.target.value; } });

// 注文へ
document.getElementById('cartProceed')?.addEventListener('click',(e)=>{
  e.preventDefault();
  const before = state.minDateISO;
  const chosen = state.selectedDateISO || before;
  const slot   = state.selectedSlot || '';
  const memo   = state.memo || '';
  const t = totals(); if(t.items.length===0) return;
  const json = encodeURIComponent(JSON.stringify(t.items));
  const text = encodeURIComponent(t.items.map(x=>`${x.name} x${x.qty} = ${x.total}`).join('\n'));
  const url = new URL(FORM_BASE);
  url.searchParams.set('usp','pp_url');
  url.searchParams.set('entry.1000001', before);
  url.searchParams.set('entry.1000002', chosen);
  url.searchParams.set('entry.1000003', slot);
  url.searchParams.set('entry.1000004', memo);
  url.searchParams.set('entry.1000005', json);
  url.searchParams.set('entry.1000006', text);
  window.location.href = url.toString();
});
// ===== 「もっと見る」→商品詳細ドロワ =====
document.addEventListener('click',(ev)=>{
  const a = ev.target.closest('[data-detail]');
  if(a){
    ev.preventDefault();
    openDetailDrawer(a.dataset.detail);
  }
});
document.addEventListener('click',(e)=>{
  const g = e.target.closest('[data-goto-cat]');
  if(!g) return;
  e.preventDefault();
  filterState.cat = g.dataset.gotoCat;
  filterState.subcat = null;
  updateCategoryButtonLabel && updateCategoryButtonLabel();
  renderProducts && renderProducts();
  closeDetailDrawer && closeDetailDrawer();   // ← ここで必ず閉じる
});

/** ========= クリック（一覧・並べ替え・カテゴリ・Variant） ========= **/
document.addEventListener('click',(ev)=>{
  // 並べ替えメニュー開閉
  if(ev.target.closest('#btnSort')){
    ev.preventDefault();
    const sortbar = document.getElementById('sortbar');
    if(sortbar) sortbar.setAttribute('aria-hidden', String(!(sortbar.getAttribute('aria-hidden')==='true')));
    return;
  }
  // 並べ替えオプション
  const sortBtn = ev.target.closest('.sortbtn');
  if(sortBtn){
    ev.preventDefault();
    filterState.sort = sortBtn.dataset.sort || 'default';
    renderSortActive(); renderProducts(); return;
  }
  // カート追加（自動でドロワは開かない）
  const addBtn = ev.target.closest('.ppp-btn.add[data-add]');
  if(addBtn){
    ev.preventDefault();
    const id = addBtn.dataset.add;
    state.cart[id] = clamp((state.cart[id]||0)+1, 0, 999);
    localStorage.setItem('cart',JSON.stringify(state.cart));
    renderCartBar(); return;
  }
  // あとで
  const later = ev.target.closest('.ppp-btn[data-later]');
  if(later){
    ev.preventDefault();
    const id = later.dataset.later;
    const k = 'later:'+id; const on = localStorage.getItem(k)==='1';
    if(on) localStorage.removeItem(k); else localStorage.setItem(k,'1');
    later.textContent = (localStorage.getItem(k)==='1') ? 'あとで済' : 'あとで';
    renderLaterList();
    return;
  }
  // お気に入り（♡）トグル
  const favBtn = ev.target.closest('.ppp-fav[data-fav]');
  if(favBtn){
    ev.preventDefault();
    const id = favBtn.dataset.fav;
    const k = 'fav:'+id; const on = localStorage.getItem(k)==='1';
    if(on){ localStorage.removeItem(k); favBtn.classList.remove('active'); favBtn.textContent = '♡'; }
    else  { localStorage.setItem(k,'1'); favBtn.classList.add('active'); favBtn.textContent = '♥'; }
    // ドロワーを開いていたら一覧も更新
    renderFavList();
    if(filterState.favsOnly) renderProducts();
    return;
  }
  // バリエーションPill -> Variant Mode（Union-Find不発でも動く）
  const pill = ev.target.closest('.ppp-vars .ppp-pill');
  if(pill){
    ev.preventDefault();
    const card = pill.closest('.ppp-card'); if(!card) return;
    const p = productById.get(card.dataset.id); if(!p) return;
    const group = p.group || p.id;
    let targetId = pill.dataset.var || p.id;
    let cand = productById.get(targetId);
    if(!cand){
      const label = pill.textContent.trim();
      cand = (PRODUCTS||[]).find(x => (x.group||x.id)===group && (
        (x.variant && x.variant.includes(label)) || (x.name && x.name.includes(label))
      ));
      targetId = cand ? cand.id : p.id;
    }
    enterVariantMode(group, targetId); return;
  }
  // すべて
  if(ev.target.closest('#btnAll')){
    ev.preventDefault();
    clearVariantMode();
    filterState.cat=null; filterState.subcat=null;
    updateCategoryButtonLabel(); renderProducts(); return;
  }
  // パンくず
  const crumb = ev.target.closest('.ppp-crumb-link');
  if(crumb){
    ev.preventDefault();
    clearVariantMode();
    const c = crumb.dataset.cat || null;
    const s = crumb.dataset.subcat || null;
    filterState.cat = c; filterState.subcat = s;
    updateCategoryButtonLabel(); renderProducts(); return;
  }
  // カテゴリドロワー（開く）
  if(ev.target.closest('#btnCategories') && !ev.target.closest('#btnCategories .x')){
    ev.preventDefault(); clearVariantMode(); openDrawer(); return;
  }
  // 「×」でクリア
  if(ev.target.closest('#btnCategories .x')){
    ev.preventDefault();
    clearVariantMode();
    filterState.cat=null; filterState.subcat=null;
    updateCategoryButtonLabel(); renderProducts(); return;
  }
    // お気に入りフィルタ（メニューバー）
  if(ev.target.closest('#btnFavs')){
    ev.preventDefault();
    clearVariantMode();
    filterState.favsOnly = !filterState.favsOnly;
    renderFavButtonActive();
    renderProducts();
    return;
  }

});

/** ========= カテゴリドロワ ========= **/
const drawer = document.getElementById('catDrawer');
const titleEl= document.getElementById('catDrawerTitle');
const backBtn= document.getElementById('catDrawerBack');
const grid   = document.getElementById('catDrawerGrid');
const chips  = document.getElementById('catDrawerChips');
const closeBtn= document.getElementById('catDrawerClose');
let CURRENT = { cat:null, sub:null };

function onKeydown(e){ if(e.key==='Escape') closeDrawer(); }
function openDrawer(){ drawer?.setAttribute('aria-hidden','false'); lockScroll(true); renderCategories(); window.addEventListener('keydown',onKeydown); }
function closeDrawer(){ drawer?.setAttribute('aria-hidden','true');  lockScroll(false); window.removeEventListener('keydown',onKeydown); }
document.querySelector('#catDrawer .ppp-drawer__scrim')?.addEventListener('click',(e)=>{ if(e.target.matches('.ppp-drawer__scrim')) closeDrawer(); });
closeBtn?.addEventListener('click', closeDrawer);

function renderChips(){
  if(!chips) return;
  const arr=[];
  if(CURRENT.cat){ arr.push(`<span class="chip">${escapeHtml(CURRENT.cat.label)}</span>`); }
  if(CURRENT.sub){ arr.push(`<span class="chip">${escapeHtml(CURRENT.sub.label)}</span>`); }
  chips.innerHTML = arr.join(' ');
}
function renderCategories(){
  const tree = buildCatTreeCached();
  if(!grid) return;
  grid.innerHTML = '';
  renderChips();

  if(!CURRENT.cat){
    titleEl.textContent = 'カテゴリを選ぶ';
    backBtn.style.visibility='hidden';
    tree.forEach(c=>{
      grid.appendChild(el(`<button class="pill" data-cat="${escapeHtml(c.label)}">${escapeHtml(c.label)}</button>`));
    });
    return;
  }
  // 2階層目
  titleEl.textContent = CURRENT.cat.label;
  backBtn.style.visibility='visible';
  CURRENT.cat.subs.forEach(s=>{
    grid.appendChild(el(`<button class="pill" data-sub="${escapeHtml(s)}">${escapeHtml(s)}</button>`));
  });
}
backBtn?.addEventListener('click',(e)=>{
  e.preventDefault();
  if(!CURRENT.cat){ closeDrawer(); return; }
  if(CURRENT.sub){ CURRENT.sub=null; } else { CURRENT.cat=null; }
  renderCategories();
});
grid?.addEventListener('click',(e)=>{
  const b = e.target.closest('.pill');
  if(!b) return;
  const cat = b.dataset.cat;
  const sub = b.dataset.sub;
  if(cat){ CURRENT.cat = buildCatTreeCached().find(x=>x.label===cat)||{label:cat, subs:[]}; CURRENT.sub=null; renderCategories(); return; }
  if(sub){ CURRENT.sub = { label: sub }; renderCategories(); return; }
});
document.getElementById('catDrawerClear')?.addEventListener('click',(e)=>{
  e.preventDefault(); CURRENT={cat:null, sub:null}; renderCategories();
});
document.getElementById('catDrawerApply')?.addEventListener('click',(e)=>{
  e.preventDefault();
  filterState.cat = CURRENT.cat ? CURRENT.cat.label : null;
  filterState.subcat = CURRENT.sub ? CURRENT.sub.label : null;
  updateCategoryButtonLabel(); renderProducts(); closeDrawer();
});

/** ========= 初期化 ========= **/
(function init(){
  ensureTopProgress(); ensureSr();
  try{ state.cart=JSON.parse(localStorage.getItem('cart')||'{}') }catch(_){}
  renderMinDateEverywhere();
  renderCartBar();
  document.getElementById('sortbar')?.setAttribute('aria-hidden','true');
  renderFavButtonActive();              // ★ 初期反映
  updateCategoryButtonLabel();          // ★ 初期は「カテゴリ」固定表示
  loadProducts();
})();

/* === PPP Core Contract (SP-20251017-SPCartDrawer-1) === */
window.PPP = window.PPP || {};
(function(PPP){
  PPP = PPP || (window.PPP = window.PPP || {});
  PPP.util = PPP.util || {};
  PPP.util.toYen = PPP.util.toYen || (n => n.toLocaleString('ja-JP',{style:'currency',currency:'JPY',maximumFractionDigits:0}));
  PPP.util.formatYMDW = PPP.util.formatYMDW || function(d){
  if(!(d instanceof Date)) d = new Date(d);
  return fmtJP(d);              // ← ここで一本化（括弧前スペース含む現行表記を維持）
  };

  PPP.patch = PPP.patch || {};
  // PPP.patch.cartFooter = function(){
  //   var elCnt = document.getElementById('cartCountFooter');
  //   var elTot = document.getElementById('cartTotalFooter');
  //   if(!elCnt || !elTot) return;
  //   var count = 0, total = 0;
  //   // 既存のカート配列/DOMから集計（環境に合わせて片方だけでOK）
  //   if (PPP.cart && Array.isArray(PPP.cart.items)) {
  //     PPP.cart.items.forEach(it => { count += (it.qty||0); total += (it.price||0) * (it.qty||0); });
  //   } else {
  //     document.querySelectorAll('#cartList .cartrow').forEach(row=>{
  //       var qty = +(row.querySelector('[data-qty]')?.value || row.querySelector('.qtybar input')?.value || 0);
  //       var price = +(row.getAttribute('data-price') || row.querySelector('[data-price]')?.textContent?.replace(/[^0-9]/g,'') || 0);
  //       count += qty; total += price * qty;
  //     });
  //   }
  //   elCnt.textContent = count + '点';
  //   elTot.textContent = PPP.util.toYen(total);
  // };
    PPP.patch.cartFooter = function(){
      var elCnt = document.getElementById('cartCountFooter');
      var elTot = document.getElementById('cartTotalFooter');
      if(!elCnt || !elTot) return;
      var t = totals();
      elCnt.textContent = (t.count||0) + '点';
      elTot.textContent = yen(t.total||0);
    };
  // 追記
  PPP.ui = PPP.ui || {};
  // PPP.ui.setMinDate = function(date){
  // const s = PPP.util.formatYMDW(date);
  // document.getElementById('minDate')?.replaceChildren(document.createTextNode(s));
  // document.getElementById('cartMinDateDrawer')?.replaceChildren(document.createTextNode(s));
  // インラインの “最短受取 …” を使っている箇所があればここでまとめて
  // document.getElementById('cartMinDateInline')?.replaceChildren(document.createTextNode('最短受取 ' + s));



  /* [LOCKED] セレクタ契約（改名は仕様から） */
  const SEL = Object.freeze({
    drawer: '#cartDrawer',
    list:   '#cartList',
    footer: '.ppp-drawer__footer',
    checkout: '#checkoutBtn2',
    spGuardNodes: ['.rowline', '.g2', '.qtybar'] // SP行構成の必須ノード
  });

  /* [LOCKED] 超軽量ガード（自動テストじゃなく“鳴る”仕組み） */
  function runGuard() {
    const missing = Object.entries(SEL)
      .filter(([k, s]) => typeof s === 'string' && !document.querySelector(s))
      .map(([k, s]) => `${k}:${s}`);

    const issues = [];
    if (missing.length) issues.push(`Missing nodes → ${missing.join(', ')}`);

  // --- SPカート構造チェックは「行が存在する時だけ」実施 ---
  const list = document.querySelector(SEL.list);
  const firstRow = list && list.querySelector('.cartrow');
  if (firstRow) {
    SEL.spGuardNodes.forEach(s => {
      if (!firstRow.querySelector(s)) issues.push(`SP構造NG → ${s}`);
    });
  }
    showBadge(issues);
  }

  /* [LOCKED] 画面で知らせる小さなバッジ */
  function showBadge(issues) {
    let badge = document.querySelector('.ppp-dev-badge');
    if (!badge) {
      badge = document.createElement('button');
      badge.className = 'ppp-dev-badge';
      badge.type = 'button';
      badge.style.cssText =
        'position:fixed;top:8px;right:8px;z-index:9999;padding:.4em .7em;border-radius:9999px;font:12px/1.2 system-ui;color:#fff;background:#ef4444;border:0;box-shadow:0 1px 6px rgba(0,0,0,.2);';
      badge.title = 'Dev check';
      document.body.appendChild(badge);
    }
    if (issues.length) {
      badge.hidden = false;
      badge.textContent = `CHECK ${issues.length}`;
      badge.onclick = () => alert(issues.join('\n'));
      console.warn('[PPP-DEV]', issues);
    } else {
      badge.hidden = true;
    }
  }

  /* [API] 公開：任意のタイミングで再チェックできるように */
  PPP.guard = { run: runGuard };

  /* 初期化：DOMContentLoaded + カート変化で再チェック */
  document.addEventListener('DOMContentLoaded', runGuard);
  document.addEventListener('DOMContentLoaded', () => {
    const target = document.querySelector(SEL.list);
    if (target) {
      const mo = new MutationObserver(runGuard);
      mo.observe(target, { childList: true, subtree: true });
    }
  setMinDateAll(calcMinDate());   // ← まずは即時表示（確定値も同じなので上書きOK）
  });

  /* [PATCH] 今日の小修正はここだけで完結させる */
  PPP.patch = (function () {
    return {
      // 例：カート追加後に自動でドロワを開かない仕様の再確認
      ensureNoAutoOpen() {
        // 既存のイベントがあればここで無効化/上書き（idempotentに）
      }
    };
  })();

  // 初期・変更時に都度更新
  document.addEventListener('DOMContentLoaded', PPP.patch.cartFooter);
})(window.PPP);

/* ===== 商品詳細ドロワ（翌日受取・クロスセル必須） ===== */
let currentDetailId = null;

function openDetailDrawer(id){
  const p = productById.get(String(id)); if(!p) return;
  currentDetailId = p.id;
  renderDetailDrawer(p);
  const drawer = document.getElementById('detailDrawer');
  drawer?.setAttribute('aria-hidden','false');
  lockScroll(true);
  drawer.querySelector('.ppp-drawer__scrim')?.addEventListener('click',(e)=>{
    if(e.target.matches('.ppp-drawer__scrim')) closeDetailDrawer();
  }, { once:true });
  document.getElementById('detailDrawerClose')?.addEventListener('click', closeDetailDrawer, { once:true });
  document.getElementById('detailBack')?.addEventListener('click', closeDetailDrawer, { once:true });

  window.addEventListener('keydown', onDetailKeydown);
}
function onDetailKeydown(e){ if(e.key==='Escape') closeDetailDrawer(); }
function closeDetailDrawer(){
  document.getElementById('detailDrawer')?.setAttribute('aria-hidden','true');
  lockScroll(false);
  window.removeEventListener('keydown', onDetailKeydown);
}

function renderDetailDrawer(p){
  const body = document.getElementById('detailBody'); if(!body) return;

  // 最短受取（常に翌日。CUTOVER_HOURを考慮）
  const min = calcMinDate();
  document.getElementById('detailMinDate')?.replaceChildren(document.createTextNode(fmtJP(min)));

  // 在庫/終売チップ（在庫は有無のみ／終売=active=false）
  const hasStock = (p.stock===undefined) ? true : Number(p.stock)>0;
  const eol = (p.active===false);
  const stockChip = document.getElementById('detailStockChip');
  const eolChip   = document.getElementById('detailEolChip');
  if(stockChip){ stockChip.hidden = !hasStock; stockChip.textContent = hasStock ? '在庫あり' : '入荷待ち'; }
  if(eolChip){ eolChip.hidden = !eol; }

  const img = p.img || 'https://dummyimage.com/1080x720/ffffff/e5e7eb&text=No+Image';
  const vars = [];
  if (p.var1Id && p.var1Label) vars.push({id:String(p.var1Id), label:p.var1Label});
  if (p.var2Id && p.var2Label) vars.push({id:String(p.var2Id), label:p.var2Label});

  body.innerHTML = `
    <div class="detail-media">
      <!-- 未来の複数画像に備えたラッパ（現状1枚） -->
      <img src="${img}" alt="${escapeHtml(p.name)}"
           loading="lazy" decoding="async" referrerpolicy="no-referrer"
           onerror="this.onerror=null;this.src='https://dummyimage.com/1080x720/ffffff/e5e7eb&text=No+Image'">
    </div>
    <div class="detail-info">
      <div class="detail-name">${escapeHtml(p.name)}</div>
      ${p.prenote?`<div class="detail-prenote">${escapeHtml(p.prenote)}</div>`:''}
      <div class="detail-price">${(p.price>0?yen(p.price):'店頭価格')}</div>
      ${p.unitNote?`<div class="detail-unit">${escapeHtml(p.unitNote)}</div>`:''}
      <div class="detail-min">この商品の最短受取 <strong>${fmtJP(min)}</strong></div>
      ${vars.length? `<div class="detail-variants">${
        vars.map(v=>`<button class="ppp-pill" data-var="${v.id}">${escapeHtml(v.label)}</button>`).join('')
      }</div>`:''}
      <div class="detail-desc">${escapeHtml(p.desc||'')}</div>
      <div style="margin-top:8px">
        <button class="sortbtn" data-sort="popular">人気順で一覧</button>
        ${(p.catGroup||p.cat)?`<button class="sortbtn" data-goto-cat="${escapeHtml(p.catGroup||p.cat)}">${escapeHtml(p.catGroup||p.cat)} を開く</button>`:''}
      </div>
    </div>
  `;

  // フッターCTAの状態反映
  const laterBtn = document.getElementById('detailLater');
  const favBtn   = document.getElementById('detailFav');
  const addBtn   = document.getElementById('detailAdd');

  const laterOn = localStorage.getItem('later:'+p.id)==='1';
  laterBtn.textContent = laterOn ? 'あとで済' : 'あとで';
  favBtn.textContent   = localStorage.getItem('fav:'+p.id)==='1' ? '♥ お気に入り' : '♡ お気に入り';
  addBtn.disabled      = !hasStock || eol;
  addBtn.innerHTML     = (!hasStock || eol) ? '入荷待ち' : 'カート追加';

  // バリエーション（＝フル/小分け 想定）
  body.querySelector('.detail-variants')?.addEventListener('click',(e)=>{
    const b = e.target.closest('[data-var]'); if(!b) return;
    openDetailDrawer(b.dataset.var);
  });

  // CTA
  addBtn?.addEventListener('click',()=>{
    if(addBtn.disabled) return;
    state.cart[p.id] = (state.cart[p.id]||0) + 1;
    localStorage.setItem('cart', JSON.stringify(state.cart));
    renderCartBar();
  });
  laterBtn?.addEventListener('click',()=>{
    const k='later:'+p.id; const on = localStorage.getItem(k)==='1';
    on ? localStorage.removeItem(k) : localStorage.setItem(k,'1');
    laterBtn.textContent = localStorage.getItem(k)==='1' ? 'あとで済' : 'あとで';
    renderLaterList();
  });
  favBtn?.addEventListener('click',()=>{
    const k='fav:'+p.id; const on = localStorage.getItem(k)==='1';
    on ? localStorage.removeItem(k) : localStorage.setItem(k,'1');
    favBtn.textContent = localStorage.getItem(k)==='1' ? '♥ お気に入り' : '♡ お気に入り';
    renderFavList();
    if(filterState.favsOnly) renderProducts();
  });

  // クロスセル（同カテゴリ 人気上位 3〜4件）
  renderDetailSuggest(p);
}

function renderDetailSuggest(p){
  const box = document.getElementById('detailSuggest'); if(!box) return;
  const list = (PRODUCTS||[])
    .filter(x => x.id!==p.id && (x.catGroup||x.cat)===(p.catGroup||p.cat) && x.active!==false)
    .sort((a,b)=> (b._pop||0)-(a._pop||0))
    .slice(0,4);
  if(list.length===0){ box.innerHTML = '<div class="muted">—</div>'; return; }
  box.innerHTML = list.map(x=>`
    <div class="sugg" data-id="${x.id}">
      <div class="img"><img src="${x.img||''}" alt="${escapeHtml(x.name)}"
           onerror="this.onerror=null;this.src='https://dummyimage.com/160x120/ffffff/e5e7eb&text=No+Image'"></div>
      <div class="nm">${escapeHtml(x.name)}</div>
      <div class="pr">${x.price>0?yen(x.price):'店頭価格'}</div>
      <button class="btn" data-suggest-add="${x.id}">＋ カート</button>
    </div>`).join('');

  box.addEventListener('click',(e)=>{
    const b = e.target.closest('[data-suggest-add]'); if(!b) return;
    const id = b.dataset.suggestAdd;
    state.cart[id] = (state.cart[id]||0) + 1;
    localStorage.setItem('cart', JSON.stringify(state.cart));
    renderCartBar();
  }, { once:true });
}

