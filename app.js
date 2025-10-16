/** ========= 設定 ========= **/
const PRODUCTS_URL = "https://script.google.com/macros/s/AKfycbx-yCsl4gt8OvsP52llzlBmiWEW1JFyXAp3rmMRkKIll4r7IHO8hOiKO4dXoKgWAQJMTA/exec?endpoint=products";
const FORM_BASE    = "https://docs.google.com/forms/d/e/1FAIpQLScWyIhn4F9iS-ZFhHQlQerLu7noGWSu4xauMPgISh1DmNFD_w/viewform";
const CUTOVER_HOUR = 2; // 26時 (=午前2:00) までは前日扱い

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
  // Variant Mode
  variantGroup: null,     // 代表ID（Union-Find root）
  variantSelected: null,  // 先頭に出すid
  variantBackup: null,    // 元のcat/sub/sort退避
};

/** ========= ユーティリティ ========= **/
const qs  = (sel,el=document)=>el.querySelector(sel);
const qsa = (sel,el=document)=>Array.from(el.querySelectorAll(sel));
const clamp = (n,min,max)=>Math.max(min,Math.min(max,n));

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
function isoDate(d){ const z=new Date(d); z.setHours(0,0,0,0); return z.toISOString().slice(0,10); }
function fmtJP(d){
  const y=d.getFullYear(), m=d.getMonth()+1, da=d.getDate();
  const w='日月火水木金土'[d.getDay()];
  return `${y}/${String(m).padStart(2,'0')}/${String(da).padStart(2,'0')} (${w})`;
}
function yen(n){ n=Number(n||0); return n.toLocaleString('ja-JP',{style:'currency',currency:'JPY',maximumFractionDigits:0}); }
function norm(s){ return String(s||'').trim().toLowerCase(); }
function el(html){
  const t=document.createElement('template'); t.innerHTML=html.trim(); return t.content.firstElementChild;
}
function escapeHtml(str){
  return String(str||'').replace(/[&<>"]/g, s => ({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;'}[s]));
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
  qsa('.sortbtn').forEach(b=>{
    b.classList.toggle('active', b.dataset.sort===String(filterState.sort||'default'));
  });
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
  // フッター左のpillは「最短受取 YYYY/MM/DD (曜)」
  const pill=document.getElementById('cartMinDateInline');
  if(pill) pill.textContent=`最短受取 ${fmtJP(d)}`;
  // フッター中央の値（PC）
  const val=document.getElementById('cartMinDate');
  if(val) val.textContent=fmtJP(d);
  // ドロワ内
  const dwr=document.getElementById('cartMinDateDrawer');
  if(dwr) dwr.textContent=fmtJP(d);
}

/** ========= 「最終更新」ピル（任意） ========= **/
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
    // 正規化
    PRODUCTS = (data.items||[]).map((x,i)=>({
      id:String(x.id||x.code||''), name:x.name, price:Number(x.price||0),
      img:x.img||x.imageUrl||'', desc:x.desc||'',
      prenote:x.prenote||'', unitNote:x.unitNote||'',
      catGroup:x.catGroup||x.cat||'', subcatGroup:x.subcatGroup||'',
      var1Id:x.var1Id||'', var1Label:x.var1Label||'',
      var2Id:x.var2Id||'', var2Label:x.var2Label||'',
      group: String(x.group||''),        // バリアントグループ（空は後で補完）
      variant: String(x.variant||''),    // 任意の表示用メタ
      stock:(x.stock!==undefined?Number(x.stock):undefined),
      active:(x.active===undefined?true:Boolean(x.active)),
      leadDays:Number(x.leadDays||1),
      _idx:i, _pop:Number(x.popularity||x.pop||x.rank||0),
      _newTS: Date.parse(x.newAt||x.createdAt||x.updatedAt||x.date||'') || 0
    }));
    productById = new Map(PRODUCTS.map(p=>[p.id,p]));
    buildVariantGroups(); // Union-Findでgroup補完
    renderProducts(); updateCategoryButtonLabel(); renderSortActive();
    renderLastUpdated(data.updated);
  }catch(e){
    console.error(e);
    renderLastUpdated();
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
  // 初期化・エッジ追加
  PRODUCTS.forEach(p=>{ if(!parent.has(p.id)) parent.set(p.id,p.id); });
  PRODUCTS.forEach(p=>{
    const v1=String(p.var1Id||''); const v2=String(p.var2Id||'');
    if(v1) unite(p.id, v1);
    if(v2) unite(p.id, v2);
    if(p.group) unite(p.id, String(p.group));
  });
  // 代表IDをgroupに
  PRODUCTS.forEach(p=>{ p.group = find(p.id); });
}


/** ========= Variant bar helpers ========= **/
function showVariantbar(title){
  const bar = document.getElementById('variantbar');
  if(!bar) return;
  bar.setAttribute('aria-hidden','false');
  const t = document.getElementById('variantTitle');
  if(t) t.textContent = title || 'バリエーション';
}
function hideVariantbar(){
  const bar = document.getElementById('variantbar');
  if(!bar) return;
  bar.setAttribute('aria-hidden','true');
  const t = document.getElementById('variantTitle');
  if(t) t.textContent = '';
}
// 戻る/× は直接配線
document.getElementById('variantBack')?.addEventListener('click', (e)=>{ e.preventDefault(); clearVariantMode(); });
document.getElementById('variantClose')?.addEventListener('click', (e)=>{ e.preventDefault(); clearVariantMode(); });
/** ========= Variant Mode ========= **/
function inVariantMode(){ return !!filterState.variantGroup; }
function enterVariantMode(group, selectedId){
  filterState.variantBackup = { cat:filterState.cat, subcat:filterState.subcat, sort:filterState.sort };
  filterState.variantGroup = group || '';
  filterState.variantSelected = selectedId || null;
  // バータイトル（選択商品名 or 同グループ先頭）
  let title = '';
  try{
    const chosen = productById.get(selectedId);
    if(chosen) title = chosen.name || '';
    if(!title){
      const m = (PRODUCTS||[]).find(x => (x.group||x.id) === (group||''));
      if(m) title = m.name || '';
    }
  }catch(_){}
  showVariantbar(title || 'バリエーション');
  renderProducts();
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
}

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
function updateCategoryButtonLabel(){
  const btn = document.getElementById('btnCategories');
  if(!btn) return;
  const s1 = filterState.cat ? filterState.cat : 'すべて';
  const s2 = filterState.subcat ? ` / ${filterState.subcat}` : '';
  btn.querySelector('.label')?.replaceChildren(document.createTextNode(`${s1}${s2}`));
}

/** ========= 商品描画 ========= **/
function renderProducts(){
  const grid=document.getElementById('productGrid');
  if(!grid) return;
  grid.className='ppp-grid';
  grid.innerHTML='';

  // --- Variant Mode（選択を先頭、最大3枚） ---
  if(inVariantMode()){
    let list=(PRODUCTS||[]).filter(x => (x.group||x.id) === filterState.variantGroup);
    const selId = filterState.variantSelected;
    list.sort((a,b)=>{
      if(a.id===selId) return -1;
      if(b.id===selId) return 1;
      return (a._idx||0) - (b._idx||0);
    });
    list = list.slice(0,3);
    list.forEach((p, idx)=>appendProductCard(grid,p,idx, selId));
    return; // 通常描画をスキップ
  }

  // --- 通常描画 ---
  const nCat=norm(filterState.cat), nSub=norm(filterState.subcat);
  const filtered=(PRODUCTS||[]).filter(p=>{
    if(p.active===false) return false;
    const pc=norm(p.catGroup||p.cat||''); const ps=norm(p.subcatGroup||'');
    if(nCat && pc!==nCat) return false; if(nSub && ps!==nSub) return false; return true;
  });
  const list = sortProducts(filtered);
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
  if(selectedId && p.id===selectedId){ el.classList.add('is-selected'); }

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
    <div class="ppp-descwrap" data-detail="${p.id}">
      <div class="ppp-desc">${p.desc||''}</div>
      <a class="ppp-more more--chev" href="#" data-detail="${p.id}" aria-label="詳しく"></a>
    </div>`;
  grid.appendChild(el);
}

/** ========= カート計算・表示 ========= **/
function totals(){
  const items=[];
  let total=0, count=0;
  for(const id in state.cart){
    const qty = Number(state.cart[id]||0)|0;
    if(qty<=0) continue;
    const p = productById.get(id);
    if(!p) continue;
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
function openCartDrawer(){ cartDrawer?.setAttribute('aria-hidden','false'); lockScroll(true); renderCartDrawer(); window.addEventListener('keydown',onCartKeydown); }
function closeCartDrawer(){ cartDrawer?.setAttribute('aria-hidden','true');  lockScroll(false); window.removeEventListener('keydown',onCartKeydown); }
function onCartKeydown(e){ if(e.key==='Escape') closeCartDrawer(); }
document.querySelector('#cartDrawer .ppp-drawer__scrim')?.addEventListener('click',(e)=>{ if(e.target.matches('.ppp-drawer__scrim')) closeCartDrawer(); });
document.getElementById('cartDrawerClose')?.addEventListener('click', closeCartDrawer);
document.getElementById('cartDrawerCancel')?.addEventListener('click', closeCartDrawer);

// フッターのカートボタン（id: checkoutBtn2）から開く
document.getElementById('checkoutBtn2')?.addEventListener('click',(e)=>{ e.preventDefault(); openCartDrawer(); });

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
  if(!state.selectedDateISO) state.selectedDateISO = state.minDateISO;

  // ヘッダー: 最短受取・点数・合計
  document.getElementById('cartMinDateDrawer')?.replaceChildren(document.createTextNode(fmtJP(toJst(new Date(state.minDateISO)))));
  const t = totals();
  document.getElementById('cartCountDrawer')?.replaceChildren(document.createTextNode(`${t.count||0}点`));
  document.getElementById('cartTotalDrawer')?.replaceChildren(document.createTextNode(yen(t.total||0)));

  // 明細
  const list = document.getElementById('cartList');
  if(list){
    if(t.items.length===0){
      list.innerHTML = '<div class="muted">カートは空です</div>';
    }else{
      list.innerHTML = t.items.map(it=>`
        <div class="cartrow" data-id="${it.id}">
          <div class="rowline">
            <div class="ttl">${escapeHtml(it.name)}</div>
            <div>${yen(it.price)} × ${it.qty} = ${yen(it.price*it.qty)}</div>
          </div>
          <div class="qtybar" style="margin:6px 0 4px; float:right">
            <button class="btn" data-cart="dec">−</button>
            <input class="cartqty" type="number" min="0" step="1" value="${it.qty}">
            <button class="btn" data-cart="inc">＋</button>
            <button class="btn warn" data-cart="del">削除</button>
          </div>
        </div>`).join('');
    }
  }

  // 受取日
  const dateEl = document.getElementById('pickupDate');
  if(dateEl){
    const d0 = new Date(state.minDateISO);
    const opts = [0,1,2,3].map(n=>{ const dd=new Date(d0); dd.setDate(dd.getDate()+n); return { iso: isoDate(dd), label: fmtJP(dd) }; });
    dateEl.innerHTML = opts.map(o=>`<option value="${o.iso}" ${o.iso===state.selectedDateISO?'selected':''}>${o.label}</option>`).join('');
  }
  // 時間帯
  const slotEl = document.getElementById('pickupSlot');
  if(slotEl){
    const slots = ['14時〜17時','17時〜20時'];
    slotEl.innerHTML = slots.map(s=>`<option ${s===state.selectedSlot?'selected':''}>${s}</option>`).join('');
  }
  // 連絡欄
  const memo = document.getElementById('pickupMemo');
  if(memo){ memo.value = state.memo||''; }

  // 同意
  const agree = document.getElementById('agreeStock');
  if(agree){ agree.checked = !!state.agreeStock; }
  updateProceedDisabled();

  // フッター合計
  renderCartFooterTotals();
}

// 数量ボタン
document.addEventListener('click',(ev)=>{
  const btn=ev.target.closest('[data-cart]');
  if(!btn) return;
  const row=btn.closest('.cartrow'); const id=row?.dataset.id; if(!id) return;
  const cur = Number(state.cart[id]||0)|0;
  const kind = btn.dataset.cart;
  if(kind==='inc'){ state.cart[id]=clamp(cur+1,0,999); }
  if(kind==='dec'){ state.cart[id]=clamp(cur-1,0,999); if(state.cart[id]===0) delete state.cart[id]; }
  if(kind==='del'){ delete state.cart[id]; }
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

// 連絡欄
document.addEventListener('input',(ev)=>{
  if(ev.target.id==='pickupMemo'){ state.memo = ev.target.value; }
});

// 注文へ進む（Googleフォームへ）
document.getElementById('cartProceed')?.addEventListener('click',(e)=>{
  e.preventDefault();
  const before = state.minDateISO;
  const chosen = state.selectedDateISO || before;
  const slot   = state.selectedSlot || '';
  const memo   = state.memo || '';

  const t = totals();
  if(t.items.length===0) return;

  // 明細（JSON＋テキスト）
  const json = encodeURIComponent(JSON.stringify(t.items));
  const text = encodeURIComponent(t.items.map(x=>`${x.name} x${x.qty} = ${x.total}`).join('\n'));

  const url = new URL(FORM_BASE);
  url.searchParams.set('usp','pp_url');
  url.searchParams.set('entry.1000001', before); // 最短受取
  url.searchParams.set('entry.1000002', chosen); // 受取日
  url.searchParams.set('entry.1000003', slot);   // 時間帯
  url.searchParams.set('entry.1000004', memo);   // 連絡欄
  url.searchParams.set('entry.1000005', json);   // JSON
  url.searchParams.set('entry.1000006', text);   // TEXT

  window.location.href = url.toString();
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

  // カート追加
  const addBtn = ev.target.closest('.ppp-btn.add[data-add]');
  if(addBtn){
    ev.preventDefault();
    const id = addBtn.dataset.add;
    state.cart[id] = clamp((state.cart[id]||0)+1, 0, 999);
    localStorage.setItem('cart',JSON.stringify(state.cart));
    renderCartBar(); openCartDrawer(); return;
  }

  // あとで
  const later = ev.target.closest('.ppp-btn[data-later]');
  if(later){
    ev.preventDefault();
    const id = later.dataset.later;
    const k = 'later:'+id; const on = localStorage.getItem(k)==='1';
    if(on) localStorage.removeItem(k); else localStorage.setItem(k,'1');
    later.textContent = (localStorage.getItem(k)==='1') ? 'あとで済' : 'あとで';
    return;
  }

  // バリエーションPill -> Variant Mode
  const pill = ev.target.closest('.ppp-vars .ppp-pill');
  if(pill){
    ev.preventDefault();
    const card = pill.closest('.ppp-card'); if(!card) return;
    const p = productById.get(card.dataset.id); if(!p) return;
    const group = p.group || p.id;
    let targetId = pill.dataset.var || p.id;
    let cand = productById.get(targetId);
    if(!cand || (cand.group||cand.id)!==group){
      // ラベル一致で保険探索
      const label = pill.textContent.trim();
      cand = (PRODUCTS||[]).find(x => (x.group||x.id)===group && (
        (x.variant && x.variant.includes(label)) || (x.name && x.name.includes(label))
      ));
      targetId = cand ? cand.id : p.id;
    }
    enterVariantMode(group, targetId);
    return;
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
  // 並べ替えバー初期状態
  document.getElementById('sortbar')?.setAttribute('aria-hidden','true');
  // 読み込み
  loadProducts();
})();


// ブラウザ戻るでVariant解除
window.addEventListener('popstate', ()=>{
  if(inVariantMode()) clearVariantMode();
});
