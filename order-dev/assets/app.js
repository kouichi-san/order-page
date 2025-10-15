
/** ========= 設定 ========= **/
const PRODUCTS_URL="https://script.google.com/macros/s/AKfycbx-yCsl4gt8OvsP52llzlBmiWEW1JFyXAp3rmMRkKIll4r7IHO8hOiKO4dXoKgWAQJMTA/exec?endpoint=products";
const CUTOVER_HOUR = 2; // ← 26時（=2:00）までは前日扱い
const FORM_BASE = "https://docs.google.com/forms/d/e/1FAIpQLScWyIhn4F9iS-ZFhHQlQerLu7noGWSu4xauMPgISh1DmNFD_w/viewform";   // ← GoogleフォームURL
let PRODUCTS=[]; let productById=new Map();
const state={cart:{}, minDateISO:null, selectedDateISO:null, selectedSlot:"14時〜17時", memo:"", agreeStock:false};

/** ========= フィルタ状態 ========= **/
const filterState = { cat:null, subcat:null, sort:'default' };
const norm = (s)=> String(s||'').replace(/\s+/g,' ').trim().toLowerCase();

/** ========= SP判定（〜420px） ========= **/
const mqSP = window.matchMedia('(max-width: 420px)');
const isSP = () => mqSP.matches;

/** ========= カテゴリボタンのラベル更新（SPは常に固定） ========= **/
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

/** ========= カテゴリツリー ========= **/
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
  arr.sort((a,b)=>a.label.localeCompare(b.label,'ja')); arr.forEach(x=>x.subs.sort((a,b)=>a.localeCompare(b,'ja')));
  return arr;
}

/** ========= ユーティリティ ========= **/
function yen(n){ try{ return Number(n||0).toLocaleString('ja-JP',{style:'currency',currency:'JPY',maximumFractionDigits:0}); }catch(e){ return '¥'+(n||0); } }
function toJst(d=new Date()){ return new Date(new Intl.DateTimeFormat('en-US',{timeZone:'Asia/Tokyo'}).format(d)+' '+d.toTimeString().split(' ')[0]); }
function fmtJP(d){ const y=d.getFullYear(), m=d.getMonth()+1, day=d.getDate(); const w='日月火水木金土'[d.getDay()]; return `${y}/${String(m).padStart(2,'0')}/${String(day).padStart(2,'0')}(${w})`; }
function isoDate(d){ return d.toISOString().slice(0,10); }

/** ========= 並べ替えロジック ========= **/
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

/** ========= 最短受取・カート ========= **/
function calcMinDate(){
  const now=toJst();               // JST
  const base=new Date(now);
  if(now.getHours()<CUTOVER_HOUR){ // 2:00までは前日扱い
    base.setDate(base.getDate()-1);
  }
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

/** ========= 受取日候補の生成（最短+20・年末年始除外） ========= **/
function buildPickupDateOptions(){
  const min = calcMinDate();
  const opts = [];
  for(let i=0;i<=20;i++){
    const d = new Date(min); d.setDate(d.getDate()+i);
    const mm = String(d.getMonth()+1).padStart(2,'0');
    const dd = String(d.getDate()).padStart(2,'0');
    const md = `${mm}-${dd}`;
    if(md==='12-31' || md==='01-01' || md==='01-02') continue; // 休業日
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
    
    // ← まずカード要素を作る
    const el=document.createElement('article');
    el.className='ppp-card';
    el.dataset.id=p.id;
    if(soldout) el.classList.add('soldout');
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
    const res=await fetch(PRODUCTS_URL,{cache:'no-store'}); const data=await res.json();
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
    renderProducts(); updateCategoryButtonLabel(); renderSortActive();
  }catch(e){ console.error(e); }
}

/** ========= 並べ替えUI制御 ========= **/
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

/** ========= カートドロワ 制御 ========= **/
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
  // 最短受取の最新を反映
  const d=calcMinDate();
  state.minDateISO=isoDate(d);
  document.getElementById('cartMinDateDrawer').textContent=fmtJP(d);

  // 合計・点数
  const t=totals();
  document.getElementById('cartCountDrawer').textContent=`${t.count}点`;
  document.getElementById('cartTotalDrawer').textContent=yen(t.total);
  document.getElementById('cartTotalFooter').textContent=yen(t.total);

  // 明細（PC 3行2カラム / SP 折返し）
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

  // 受取日候補の表示
  const opts = buildPickupDateOptions();
  const sel = document.getElementById('pickupDate');
  if(sel){ sel.innerHTML = opts.map(o=>`<option value="${o.iso}">${o.label}</option>`).join(''); }
  const initial = (state.selectedDateISO && opts.some(o=>o.iso===state.selectedDateISO)) ? state.selectedDateISO : (opts[0]?opts[0].iso:state.minDateISO);
  state.selectedDateISO = initial; if(sel) sel.value = initial;

  // 既存の入力値反映
  document.getElementById('pickupSlot').value = state.selectedSlot;
  document.getElementById('pickupMemo').value = state.memo;
  document.getElementById('agreeStock').checked = !!state.agreeStock;

  updateProceedDisabled();
}

// カート行の操作（数量増減／削除）
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
  // qty
  const input=ev.target.closest('#cartList .cartqty');
  if(input){
    const row=input.closest('.cartrow'); const id=row?.dataset.id; if(!id) return;
    const v=Math.max(0, Number(input.value||0)|0);
    if(v===0) delete state.cart[id]; else state.cart[id]=v;
    localStorage.setItem('cart',JSON.stringify(state.cart));
    renderCartBar(); renderCartDrawer();
    return;
  }
  // form controls
  if(ev.target.id==='pickupDate'){ state.selectedDateISO = ev.target.value; }
  if(ev.target.id==='pickupSlot'){ state.selectedSlot = ev.target.value; }
  if(ev.target.id==='agreeStock'){ state.agreeStock = ev.target.checked; updateProceedDisabled(); }
});
// クリックでも活性化を拾う（環境差対策）
document.addEventListener('click',(ev)=>{
  if(ev.target.id==='agreeStock'){ state.agreeStock = ev.target.checked; updateProceedDisabled(); }
});

// メモ
document.addEventListener('input',(ev)=>{
  if(ev.target.id==='pickupMemo'){ state.memo = ev.target.value; }
});

// 注文へ進む（最終チェック：2:00跨ぎ検知→更新なら停止）
document.getElementById('cartProceed').addEventListener('click',(e)=>{
  e.preventDefault();
  const before = state.minDateISO;
  renderMinDateEverywhere(); // 最新化（2:00跨ぎ検知）
  const after = state.minDateISO;
  if(before && after && before!==after){
    alert('最短受取日が更新されました：'+after.replaceAll('-','/'));
    renderCartDrawer();
    return; // 止める
  }
  // 同意チェック
  if(!state.agreeStock){ alert('「商品の確保について（必須）」をご確認のうえチェックしてください。'); return; }

  // 受取日が最短より過去なら置換
  if(state.selectedDateISO && state.selectedDateISO < state.minDateISO){
    state.selectedDateISO = state.minDateISO;
    alert('受取希望日を最短日に更新しました：'+state.minDateISO.replaceAll('-','/'));
    renderCartDrawer();
    return;
  }

  // 注文データ作成
  const order = Object.entries(state.cart).map(([id,qty])=>{
    const p=productById.get(id)||{}; const q=Number(qty||0);
    return { id, name:p.name||'', price:Number(p.price||0), qty:q, subtotal:Number(p.price||0)*q, leadDays:Number(p.leadDays||1) };
  }).filter(x=>x.qty>0);
  if(order.length===0){ alert('カートが空です'); return; }
  const t = totals();
  const listText = order.map(o=> `${o.name} × ${o.qty} ＝ ${yen(o.subtotal)}`).join('\n');

  const params = new URLSearchParams();
  params.set('entry.1515941336', state.selectedDateISO); // 受取希望日(ISO)
  params.set('entry.224243122', state.minDateISO);        // システム最短受取日(ISO)
  params.set('entry.145233294', state.selectedSlot);      // 受け取り時間帯（日本語ラベル）
  params.set('entry.907378750', state.memo);              // 備考
  params.set('entry.1286573866', listText);               // 注文商品一覧（人間可読）
  params.set('entry.1040973575', JSON.stringify({items:order, totalCount:t.count, totalPrice:t.total})); // 取り込み用JSON

  const url = FORM_BASE + '?' + params.toString();
  window.open(url, '_blank');
});

/** ========= クリック系 ========= **/
document.addEventListener('click',ev=>{
  const add=ev.target.closest('.ppp-btn.add[data-add]'); if(add){ ev.preventDefault(); const p=productById.get(add.dataset.add); if(p) addToCart(p,1); }
  const later=ev.target.closest('.ppp-btn[data-later]'); if(later){ ev.preventDefault(); const key='later:'+later.dataset.later; const set=(localStorage.getItem(key)==='1'?'0':'1'); localStorage.setItem(key,set); later.textContent=set==='1'?'あとで済':'あとで'; }
  if(ev.target.closest('#menuRightAction')){ ev.preventDefault(); openCartDrawer(); }
  if(ev.target.closest('#checkoutBtn2')){ ev.preventDefault(); openCartDrawer(); }

  // 並べ替えトグル
  if(ev.target.closest('#btnSort')){ ev.preventDefault(); toggleSortbar(); return; }
  // 並べ替え選択
  const sortBtn = ev.target.closest('.sortbtn[data-sort]');
  if(sortBtn){
    ev.preventDefault();
    filterState.sort = sortBtn.dataset.sort;
    renderSortActive();
    renderProducts();
    toggleSortbar(false);
    return;
  }
  // sortbar外クリックで閉じる
  if(sortbar.getAttribute('aria-hidden')==='false' && !ev.target.closest('#sortbar') && !ev.target.closest('#btnSort')){
    toggleSortbar(false);
  }

  // パンくずリンク（カード内）→ フィルタ
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

  // すべて
  if(ev.target.closest('#btnAll')){
    ev.preventDefault();
    filterState.cat=null; filterState.subcat=null;
    updateCategoryButtonLabel();
    renderProducts();
    return;
  }

  // カテゴリボタン → ドロワーOPEN（×を除く）
  if(ev.target.closest('#btnCategories') && !ev.target.closest('#btnCategories .x')){
    ev.preventDefault(); openDrawer(); return;
  }

  // カテゴリボタン内の × で条件クリア
  const clearX = ev.target.closest('#btnCategories .x');
  if(clearX){
    ev.preventDefault();
    filterState.cat=null; filterState.subcat=null;
    updateCategoryButtonLabel();
    renderProducts();
    return;
  }
});

/** ========= カテゴリドロワ 制御 ========= **/
const drawer = document.getElementById('catDrawer');
document.querySelector('#catDrawer .ppp-drawer__scrim')?.addEventListener('click', (e)=>{ if(e.target.matches('.ppp-drawer__scrim')) closeDrawer(); });
const titleEl= document.getElementById('catDrawerTitle');
const backBtn= document.getElementById('catDrawerBack');
const grid   = document.getElementById('catDrawerGrid');
function openDrawer(){ drawer.setAttribute('aria-hidden','false'); lockScroll(true); titleEl.textContent='カテゴリを選ぶ'; backBtn.style.visibility='hidden'; renderCategories(); window.addEventListener('keydown',onKeydown); }
function closeDrawer(){ drawer.setAttribute('aria-hidden','true'); lockScroll(false); window.removeEventListener('keydown',onKeydown); }
function onKeydown(e){ if(e.key==='Escape') closeDrawer(); }
document.getElementById('catDrawerClose')?.addEventListener('click', closeDrawer);
document.getElementById('catDrawerBack')?.addEventListener('click', ()=>{ titleEl.textContent='カテゴリを選ぶ'; backBtn.style.visibility='hidden'; renderCategories(); });
document.getElementById('catDrawerClear')?.addEventListener('click', ()=>{ CURRENT={cat:null,sub:null}; filterState.cat=null; filterState.subcat=null; updateCategoryButtonLabel(); renderProducts(); closeDrawer(); });
document.getElementById('catDrawerApply')?.addEventListener('click', applyCurrentAndClose);
let CURRENT = { cat:null, sub:null };
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
function buildCatTreeCached(){ if(!buildCatTree._cache){ buildCatTree._cache=buildCatTree(); } return buildCatTree._cache; }

/** ========= 初期化 ========= **/
(function init(){
  try{ state.cart=JSON.parse(localStorage.getItem('cart')||'{}') }catch(_){}
  renderMinDateEverywhere();
  renderCartBar();
  loadProducts();
})();

// 全体説明エリアのクリック（将来の詳細ドロワー用フック）
document.addEventListener('click', (ev)=>{
  const wrap = ev.target.closest('.ppp-descwrap');
  if(wrap){
    ev.preventDefault();
    const id = wrap.getAttribute('data-detail');
    console.log('[detail] card id:', id);
    // TODO: 詳細ドロワーを実装したらここから開く
  }
});
