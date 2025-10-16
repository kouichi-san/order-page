/** ========= 設定 ========= **/
const PRODUCTS_URL = "https://script.google.com/macros/s/AKfycbx-yCsl4gt8OvsP52llzlBmiWEW1JFyXAp3rmMRkKIll4r7IHO8hOiKO4dXoKgWAQJMTA/exec?endpoint=products";
const FORM_BASE    = "https://docs.google.com/forms/d/e/1FAIpQLScWyIhn4F9iS-ZFhHQlQerLu7noGWSu4xauMPgISh1DmNFD_w/viewform";
const CUTOVER_HOUR = 2; // 26時(=午前2:00)までは前日扱い

let PRODUCTS = [];
let productById = new Map();
const state = { cart:{}, minDateISO:null, selectedDateISO:null, selectedSlot:"14時〜17時", memo:"", agreeStock:false };

/** ========= フィルタ状態 ========= **/
const filterState = { cat:null, subcat:null, sort:'default' };
const norm = (s)=> String(s||'').replace(/\s+/g,' ').trim().toLowerCase();

/** ========= SP判定 ========= **/
const mqSP = window.matchMedia('(max-width: 420px)');
const isSP = () => mqSP.matches;

/** ========= ユーティリティ ========= **/
function yen(n){ try{ return Number(n||0).toLocaleString('ja-JP',{style:'currency',currency:'JPY',maximumFractionDigits:0}); }catch(e){ return '¥'+(n||0); } }
function toJst(d=new Date()){ return new Date(new Intl.DateTimeFormat('en-US',{timeZone:'Asia/Tokyo'}).format(d)+' '+d.toTimeString().split(' ')[0]); }
function fmtJP(d){ const w='日月火水木金土'[d.getDay()]; return `${d.getFullYear()}/${String(d.getMonth()+1).padStart(2,'0')}/${String(d.getDate()).padStart(2,'0')}(${w})`; }
function isoDate(d){ return d.toISOString().slice(0,10); }

/** ========= カテゴリボタンのラベル更新（SPは固定文言） ========= **/
function updateCategoryButtonLabel(){
  const btn = document.getElementById('btnCategories');
  if(!btn) return;
  if(isSP()){ btn.classList.remove('has-filter'); btn.innerHTML='カテゴリ'; return; }
  const cat=filterState.cat||'', sub=filterState.subcat||'';
  if(!cat && !sub){ btn.classList.remove('has-filter'); btn.innerHTML='カテゴリ'; return; }
  btn.classList.add('has-filter');
  const label = sub ? `<span class="tag">${cat}</span><span class="sep"></span><span class="tag">${sub}</span>` : `<span class="tag">${cat}</span>`;
  btn.innerHTML = `カテゴリ: ${label}<span class="x" aria-label="条件クリア" title="条件クリア">×</span>`;
}

/** ========= カテゴリツリー構築 ========= **/
function buildCatTree(){
  const map=new Map();
  (PRODUCTS||[]).forEach(p=>{
    const c=(p.catGroup||p.cat||'').trim(); if(!c) return;
    const s=(p.subcatGroup||'').trim();
    const k=norm(c);
    if(!map.has(k)) map.set(k,{label:c, subs:new Set()});
    if(s) map.get(k).subs.add(s);
  });
  const arr=[...map.values()].map(v=>({label:v.label, subs:[...v.subs]}));
  arr.sort((a,b)=>a.label.localeCompare(b.label,'ja'));
  arr.forEach(x=>x.subs.sort((a,b)=>a.localeCompare(b,'ja')));
  return arr;
}
function buildCatTreeCached(){ if(!buildCatTree._cache){ buildCatTree._cache=buildCatTree(); } return buildCatTree._cache; }

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
  const d=calcMinDate();
  state.minDateISO=isoDate(d);
  const pill=document.getElementById('cartMinDateInline');
  const sp=document.getElementById('cartMinDate');
  if(pill)pill.textContent=`最短受取 ${fmtJP(d)}`;
  if(sp)sp.textContent=fmtJP(d);
}

/** ========= 「最終更新」ピル ========= **/
function renderLastUpdated(ts){
  const el=document.getElementById('lastUpdated'); if(!el) return;
  const d = ts ? toJst(new Date(ts)) : toJst();
  el.textContent = '最終更新 ' + fmtJP(d);
}

/** ========= カート小計 ========= **/
function totals(){
  const ids=Object.keys(state.cart); let total=0,count=0;
  ids.forEach(id=>{
    const p=productById.get(id); const q=Number(state.cart[id]||0);
    if(p&&q>0){ total+=(p.price||0)*q; count+=q; }
  });
  return {total,count};
}
function renderCartBar(){
  const t=totals();
  const totalEl=document.getElementById('cartTotal');
  const countEl=document.getElementById('cartCount');
  if(totalEl) totalEl.textContent=yen(t.total);
  if(countEl) countEl.textContent=`${t.count}点`;
}
function addToCart(p,qty){
  const q=Number(state.cart[p.id]||0)+Number(qty||1);
  state.cart[p.id]=q;
  localStorage.setItem('cart',JSON.stringify(state.cart));
  renderCartBar();
}

/** ========= 受取日候補 ========= **/
function buildPickupDateOptions(){
  const min = calcMinDate();
  const opts = [];
  for(let i=0;i<=20;i++){
    const d = new Date(min); d.setDate(d.getDate()+i);
    const mm = String(d.getMonth()+1).padStart(2,'0');
    const dd = String(d.getDate()).padStart(2,'0');
    const md = `${mm}-${dd}`;
    if(md==='12-31' || md==='01-01' || md==='01-02') continue;
    opts.push({ iso: isoDate(d), label: fmtJP(d) });
  }
  return opts;
}

/** ========= 商品描画（フィルタ→並べ替え） ========= **/
function renderProducts(){
  const grid=document.getElementById('productGrid'); grid.className='ppp-grid'; grid.innerHTML='';
  const nCat=norm(filterState.cat), nSub=norm(filterState.subcat);
  const filtered=(PRODUCTS||[]).filter(p=>{
    if(p.active===false) return false;
    const pc=norm(p.catGroup||p.cat||''); const ps=norm(p.subcatGroup||'');
    if(nCat && pc!==nCat) return false; if(nSub && ps!==nSub) return false; return true;
  });
  const list = sortProducts(filtered);
  list.forEach(p=>{
    const soldout=(p.stock!==undefined&&Number(p.stock)<=0);
    const catLabel=p.catGroup||p.cat||''; const subcatLabel=p.subcatGroup||'';
    const crumbHTML=[ catLabel?`<a href="#" class="ppp-crumb-link" data-cat="${catLabel}">${catLabel}</a>`:'', subcatLabel?`<a href="#" class="ppp-crumb-link" data-subcat="${subcatLabel}">${subcatLabel}</a>`:'' ].filter(Boolean).join(' › ');
    const vars=[]; if(p.var1Id&&p.var1Label)vars.push({id:String(p.var1Id),label:p.var1Label}); if(p.var2Id&&p.var2Label)vars.push({id:String(p.var2Id),label:p.var2Label});
    const varsHTML=vars.slice(0,2).map(v=>`<button class="ppp-pill" data-var="${v.id}">${v.label}</button>`).join('');
    const el=document.createElement('article'); el.className='ppp-card'; el.dataset.id=p.id;
    if(soldout){ try{ el.classList.add('is-soldout'); }catch(_){} }
    el.innerHTML=`
      <div class="ppp-crumbrow"><div class="ppp-crumb">${crumbHTML}</div></div>
      <div class="ppp-titlebar"><div class="ppp-name">${p.name||''}</div><button class="ppp-fav" data-fav="${p.id}">♡</button></div>
      <div class="ppp-mi">
        <div class="ppp-media"><div class="ppp-img"><img src="${p.img||''}" alt="${p.name||''}" loading="lazy" decoding="async" referrerpolicy="no-referrer" onerror="this.onerror=null;this.src='https://dummyimage.com/1080x720/ffffff/e5e7eb&text=No+Image';"></div></div>
        <div class="ppp-info">
          ${p.prenote?`<div class="ppp-prenote">${p.prenote}</div>`:''}
          <div class="ppp-price">${(p.price>0&&!isNaN(p.price))?yen(p.price):'店頭価格'}</div>
          ${p.unitNote?`<div class="ppp-unit">${p.unitNote}</div>`:''}
          <div class="ppp-actions">
            <button class="ppp-btn add" data-add="${p.id}" ${soldout?'disabled':''} aria-label="カート追加"><span class="label">${soldout?'品切れ':'カート追加'}</span></button>
            <button class="ppp-btn" data-later="${p.id}">${localStorage.getItem('later:'+p.id)==='1'?'あとで済':'あとで'}</button>
          </div>
          ${varsHTML?`<div class="ppp-vars">${varsHTML}</div>`:''}
        </div>
      </div>
      <div class="ppp-descwrap" data-detail="${p.id}">
        <div class="ppp-desc">${p.desc||''}</div>
        <a class="ppp-more more--chev" href="#" data-detail="${p.id}" aria-label="詳しく"></a>
      </div>`;
    grid.appendChild(el);
  });
}

/** ========= データ読込 ========= **/
async function loadProducts(){
  try{
    const res=await fetch(PRODUCTS_URL,{cache:'no-store'});
    const data=await res.json();
    PRODUCTS=(data.items||[]).map((x,i)=>({
      id:String(x.id||x.code||''), name:x.name, price:Number(x.price||0),
      img:x.img||x.imageUrl||'', desc:x.desc||'', prenote:x.prenote||'', unitNote:x.unitNote||'',
      catGroup:x.catGroup||x.cat||'', subcatGroup:x.subcatGroup||'',
      var1Id:x.var1Id||'', var1Label:x.var1Label||'', var2Id:x.var2Id||'', var2Label:x.var2Label||'',
      stock:(x.stock!==undefined?Number(x.stock):undefined),
      active:(x.active===undefined?true:Boolean(x.active)),
      leadDays:Number(x.leadDays||1),
      _idx:i,
      _pop:Number(x.popularity||x.pop||x.rank||0),
      _newTS: Date.parse(x.newAt||x.createdAt||x.updatedAt||x.date||'') || 0
    }));
    productById=new Map(PRODUCTS.map(p=>[p.id,p]));
    buildCatTree._cache = null; // カテゴリキャッシュリセット
    renderProducts(); updateCategoryButtonLabel(); renderSortActive();
    renderLastUpdated(data.updated);
  }catch(e){ console.error(e); renderLastUpdated(); }
}

/** ========= 並べ替えUI ========= **/
const sortbar = document.getElementById('sortbar');
function toggleSortbar(show){
  const on = (show===undefined) ? sortbar.getAttribute('aria-hidden')==='true' : show;
  sortbar.setAttribute('aria-hidden', on?'false':'true');
  document.getElementById('btnSort')?.setAttribute('aria-expanded', on?'true':'false');
}
function renderSortActive(){
  document.querySelectorAll('.sortbtn').forEach(b=>{
    b.classList.toggle('active', b.dataset.sort===String(filterState.sort||'default'));
  });
}

/** ========= カートドロワ ========= **/
const cartDrawer = document.getElementById('cartDrawer');
function lockScroll(on){ document.documentElement.classList.toggle('ppp-no-scroll', on); document.body.classList.toggle('ppp-no-scroll', on); }
function openCartDrawer(){ cartDrawer.setAttribute('aria-hidden','false'); lockScroll(true); renderCartDrawer(); window.addEventListener('keydown',onCartKeydown); }
function closeCartDrawer(){ cartDrawer.setAttribute('aria-hidden','true'); lockScroll(false); window.removeEventListener('keydown',onCartKeydown); }
function onCartKeydown(e){ if(e.key==='Escape') closeCartDrawer(); }
document.querySelector('#cartDrawer .ppp-drawer__scrim')?.addEventListener('click',(e)=>{ if(e.target.matches('.ppp-drawer__scrim')) closeCartDrawer(); });
document.getElementById('cartDrawerClose')?.addEventListener('click', closeCartDrawer);
document.getElementById('cartDrawerCancel')?.addEventListener('click', closeCartDrawer);

/** ========= 必須チェック→ボタン活性 ========= **/
function updateProceedDisabled(){
  const btn=document.getElementById('cartProceed');
  if(!btn) return;
  const on = !!state.agreeStock;
  btn.disabled = !on;
  btn.setAttribute('aria-disabled', String(!on));
  btn.classList.toggle('is-disabled', !on);
}

function renderCartDrawer(){
  const d=calcMinDate();
  state.minDateISO=isoDate(d);
  document.getElementById('cartMinDateDrawer').textContent=fmtJP(d);

  const t=totals();
  document.getElementById('cartCountDrawer').textContent=`${t.count}点`;
  document.getElementById('cartTotalDrawer').textContent=yen(t.total);
  document.getElementById('cartTotalFooter').textContent=yen(t.total);

  const wrap=document.getElementById('cartList');
  wrap.innerHTML='';
  const ids=Object.keys(state.cart);
  if(ids.length===0){ wrap.innerHTML='<div class="cart-empty">カートは空です</div>'; }
  else{
    ids.forEach(id=>{
      const p=productById.get(id); const q=Number(state.cart[id]||0); if(!p||q<=0) return;
      const row=document.createElement('div'); row.className='cartrow'; row.dataset.id=id;
      row.innerHTML=`
        <div class="rowline">
          <div class="ttl">${p.name||id}</div>
          <div class="prc">${yen(p.price)}</div>
        </div>
        <div class="g2" style="margin-top:6px">
          <div class="thumb"><img src="${p.img||''}" alt="${p.name||''}" onerror="this.onerror=null;this.src='https://dummyimage.com/224x160/ffffff/e5e7eb&text=No+Image';"></div>
          <div class="qtybar">
            <div class="group">
              <button class="btn" data-cart="dec">−</button>
              <input class="cartqty" type="number" min="0" step="1" value="${q}">
              <button class="btn" data-cart="inc">＋</button>
            </div>
            <button class="btn" data-cart="rm" title="削除">削除</button>
          </div>
        </div>
        <div class="totalline">合計 ${yen((p.price||0)*q)}(税込)</div>`;
      wrap.appendChild(row);
    });
  }

  const opts = buildPickupDateOptions();
  const sel = document.getElementById('pickupDate');
  if(sel){ sel.innerHTML = opts.map(o=>`<option value="${o.iso}">${o.label}</option>`).join(''); }
  const initial = (state.selectedDateISO && opts.some(o=>o.iso===state.selectedDateISO)) ? state.selectedDateISO : (opts[0]?opts[0].iso:state.minDateISO);
  state.selectedDateISO = initial; if(sel) sel.value = initial;

  document.getElementById('pickupSlot').value = state.selectedSlot;
  document.getElementById('pickupMemo').value = state.memo;
  document.getElementById('agreeStock').checked = !!state.agreeStock;

  updateProceedDisabled();
}

/** ========= 各種イベント ========= **/
// カート中の行ボタン
document.addEventListener('click',(ev)=>{
  const btn=ev.target.closest('#cartList .btn[data-cart]');
  if(!btn) return;
  const row=btn.closest('.cartrow'); if(!row) return;
  const id=row.dataset.id; const p=productById.get(id); if(!p) return;
  const act=btn.dataset.cart;
  let q=Number(state.cart[id]||0);
  if(act==='inc') q++;
  if(act==='dec') q=Math.max(0,q-1);
  if(act==='rm') q=0;
  if(q===0) delete state.cart[id]; else state.cart[id]=q;
  localStorage.setItem('cart',JSON.stringify(state.cart));
  renderCartBar(); renderCartDrawer();
});

// 数量直接入力 & フォーム値
document.addEventListener('change',(ev)=>{
  const input=ev.target.closest('#cartList .cartqty');
  if(input){
    const row=input.closest('.cartrow'); const id=row?.dataset.id; if(!id) return;
    const v=Math.max(0, Number(input.value||0)|0);
    if(v===0) delete state.cart[id]; else state.cart[id]=v;
    localStorage.setItem('cart',JSON.stringify(state.cart));
    renderCartBar(); renderCartDrawer();
    return;
  }
  if(ev.target.id==='pickupDate'){ state.selectedDateISO = ev.target.value; }
  if(ev.target.id==='pickupSlot'){ state.selectedSlot = ev.target.value; }
  if(ev.target.id==='agreeStock'){ state.agreeStock = ev.target.checked; updateProceedDisabled(); }
});
// クリックでも活性化
document.addEventListener('click',(ev)=>{
  if(ev.target.id==='agreeStock'){ state.agreeStock = ev.target.checked; updateProceedDisabled(); }
});

// メモ
document.addEventListener('input',(ev)=>{
  if(ev.target.id==='pickupMemo'){ state.memo = ev.target.value; }
});

// 注文へ進む
document.getElementById('cartProceed').addEventListener('click',(e)=>{
  e.preventDefault();
  const before = state.minDateISO;
  renderMinDateEverywhere();
  const after = state.minDateISO;
  if(before && after && before!==after){
    alert('最短受取日が更新されました：'+after.replaceAll('-','/'));
    renderCartDrawer();
    return;
  }
  if(!state.agreeStock){ alert('「商品の確保について（必須）」をご確認のうえチェックしてください。'); return; }
  if(state.selectedDateISO && state.selectedDateISO < state.minDateISO){
    state.selectedDateISO = state.minDateISO;
    alert('受取希望日を最短日に更新しました：'+state.minDateISO.replaceAll('-','/'));
    renderCartDrawer();
    return;
  }
  const order = Object.entries(state.cart).map(([id,qty])=>{
    const p=productById.get(id)||{}; const q=Number(qty||0);
    return { id, name:p.name||'', price:Number(p.price||0), qty:q, subtotal:Number(p.price||0)*q, leadDays:Number(p.leadDays||1) };
  }).filter(x=>x.qty>0);
  if(order.length===0){ alert('カートが空です'); return; }
  const t = totals();
  const listText = order.map(o=> `${o.name} × ${o.qty} ＝ ${yen(o.subtotal)}`).join('\n');

  const params = new URLSearchParams();
  params.set('entry.1515941336', state.selectedDateISO);
  params.set('entry.224243122', state.minDateISO);
  params.set('entry.145233294', state.selectedSlot);
  params.set('entry.907378750', state.memo);
  params.set('entry.1286573866', listText);
  params.set('entry.1040973575', JSON.stringify({items:order, totalCount:t.count, totalPrice:t.total}));

  const url = FORM_BASE + '?' + params.toString();
  window.open(url, '_blank');
});

// 追加・あとで・メニュー・ソート
document.addEventListener('click',ev=>{
  const add=ev.target.closest('.ppp-btn.add[data-add]'); if(add){ ev.preventDefault(); const p=productById.get(add.dataset.add); if(p) addToCart(p,1); }
  const later=ev.target.closest('.ppp-btn[data-later]'); if(later){ ev.preventDefault(); const key='later:'+later.dataset.later; const set=(localStorage.getItem(key)==='1'?'0':'1'); localStorage.setItem(key,set); later.textContent=set==='1'?'あとで済':'あとで'; }
  if(ev.target.closest('#menuRightAction')){ ev.preventDefault(); openCartDrawer(); }
  if(ev.target.closest('#checkoutBtn2')){ ev.preventDefault(); openCartDrawer(); }

  if(ev.target.closest('#btnSort')){ ev.preventDefault(); toggleSortbar(); return; }
  const sortBtn = ev.target.closest('.sortbtn[data-sort]');
  if(sortBtn){
    ev.preventDefault();
    filterState.sort = sortBtn.dataset.sort;
    renderSortActive();
    renderProducts();
    toggleSortbar(false);
    return;
  }
  if(sortbar.getAttribute('aria-hidden')==='false' && !ev.target.closest('#sortbar') && !ev.target.closest('#btnSort')){
    toggleSortbar(false);
  }

  const crumb = ev.target.closest('.ppp-crumb-link');
  if(crumb){
    ev.preventDefault();
    const cat=crumb.dataset.cat||null; const sub=crumb.dataset.subcat||null;
    if(cat){ filterState.cat=cat; filterState.subcat=null; }
    if(sub){ filterState.subcat=sub;
      if(!filterState.cat){
        const found=(PRODUCTS||[]).find(p=> norm(p.subcatGroup||'')===norm(sub));
        if(found) filterState.cat=found.catGroup||found.cat||null;
      }
    }
    updateCategoryButtonLabel();
    renderProducts();
    return;
  }

  if(ev.target.closest('#btnAll')){
    ev.preventDefault();
    filterState.cat=null; filterState.subcat=null;
    updateCategoryButtonLabel();
    renderProducts();
    return;
  }

  if(ev.target.closest('#btnCategories') && !ev.target.closest('#btnCategories .x')){
    ev.preventDefault(); openDrawer(); return;
  }

  const clearX = ev.target.closest('#btnCategories .x');
  if(clearX){
    ev.preventDefault();
    filterState.cat=null; filterState.subcat=null;
    updateCategoryButtonLabel();
    renderProducts();
    return;
  }
});

/** ========= カテゴリドロワ ========= **/
const drawer = document.getElementById('catDrawer');
document.querySelector('#catDrawer .ppp-drawer__scrim')?.addEventListener('click', (e)=>{ if(e.target.matches('.ppp-drawer__scrim')) closeDrawer(); });
const titleEl= document.getElementById('catDrawerTitle');
const backBtn= document.getElementById('catDrawerBack');
const grid   = document.getElementById('catDrawerGrid');
let CURRENT = { cat:null, sub:null };

function openDrawer(){ drawer.setAttribute('aria-hidden','false'); lockScroll(true); titleEl.textContent='カテゴリを選ぶ'; backBtn.style.visibility='hidden'; renderCategories(); window.addEventListener('keydown',onKeydown); }
function closeDrawer(){ drawer.setAttribute('aria-hidden','true'); lockScroll(false); window.removeEventListener('keydown',onKeydown); }
function onKeydown(e){ if(e.key==='Escape') closeDrawer(); }
document.getElementById('catDrawerClose')?.addEventListener('click', closeDrawer);
document.getElementById('catDrawerBack')?.addEventListener('click', ()=>{ titleEl.textContent='カテゴリを選ぶ'; backBtn.style.visibility='hidden'; renderCategories(); });
document.getElementById('catDrawerClear')?.addEventListener('click', ()=>{ CURRENT={cat:null,sub:null}; filterState.cat=null; filterState.subcat=null; updateCategoryButtonLabel(); renderProducts(); closeDrawer(); });
document.getElementById('catDrawerApply')?.addEventListener('click', applyCurrentAndClose);

function renderCategories(){
  grid.innerHTML='';
  const list=buildCatTreeCached();
  if(!list.length){ grid.insertAdjacentHTML('beforeend','<div style="color:#9ca3af;font-size:13px;padding:16px">カテゴリが見つかりません</div>'); return; }
  list.forEach(c=>{
    const btn=document.createElement('button'); btn.type='button'; btn.dataset.cat=c.label; btn.innerHTML=`<div class="ttl">${c.label}</div>`;
    btn.addEventListener('click',()=>{ CURRENT.cat={label:c.label}; CURRENT.sub=null; titleEl.textContent='サブカテゴリを選ぶ'; backBtn.style.visibility='visible'; renderSubcats(c.label); });
    grid.appendChild(btn);
  });
}
function renderSubcats(catLabel){
  grid.innerHTML='';
  const any=document.createElement('button'); any.type='button'; any.dataset.cat=catLabel; any.dataset.sub=''; any.innerHTML=`<div class="ttl">すべて（${catLabel}）</div>`;
  any.addEventListener('click',()=>{ CURRENT.sub=null; });
  grid.appendChild(any);
  const tree=buildCatTreeCached();
  const cat=tree.find(x=> norm(x.label)===norm(catLabel));
  const subs=(cat?.subs||[]);
  if(!subs.length){
    grid.insertAdjacentHTML('beforeend','<div style="color:#9ca3af;font-size:13px;padding:16px">サブカテゴリが見つかりません</div>');
  }else{
    subs.forEach(s=>{
      const btn=document.createElement('button'); btn.type='button'; btn.dataset.cat=catLabel; btn.dataset.sub=s; btn.innerHTML=`<div class="ttl">${s}</div>`;
      btn.addEventListener('click',()=>{ CURRENT.sub={label:s}; });
      grid.appendChild(btn);
    });
  }
}
function applyCurrentAndClose(){
  filterState.cat = CURRENT.cat ? CURRENT.cat.label : null;
  filterState.subcat = CURRENT.sub ? CURRENT.sub.label : null;
  updateCategoryButtonLabel(); renderProducts(); closeDrawer();
}

/** ========= 初期化 ========= **/
(function init(){
  try{ state.cart=JSON.parse(localStorage.getItem('cart')||'{}') }catch(_){}
  renderMinDateEverywhere();
  renderCartBar();
  loadProducts();
})();
