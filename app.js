/* =====================================================================
   app.js — 修正版（データ取得 / スケルトン / 200msバー / ドロワーSP行割り）
   ===================================================================== */

/* ====== 設定 ====== */
const PRODUCTS_URL = 'https://script.google.com/macros/s/AKfycbzaMJ8p9_Fj9pr7dgFBzl0cApTQn0llr6-I1b9YhyKPGwbD461NBA6_U6WEzPqOpf4b/exec?endpoint=products';
const FORM_BASE = 'https://docs.google.com/forms/d/e/1FAIpQLScWyIhn4F9iS-ZFhHQlQerLu7noGWSu4xauMPgISh1DmNFD_w/viewform';

/* ====== 状態 ====== */
const state = {
  products: [],
  cart: new Map(), // id -> {id, name, price, qty, img}
  agreeStock: false,
  selectedSlot: '14時〜17時',
  memo: '',
  minDateISO: null,
  selectedDateISO: null,
};

/* ====== ユーティリティ ====== */
const yen = (n)=>`¥${(n||0).toLocaleString('ja-JP')}`;
const esc = (s)=>String(s??'').replace(/[&<>"']/g, m => ({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[m]));
const isoDate = (d)=>d.toISOString().slice(0,10);
const toJst = (d)=>new Date(d.getTime()+9*3600*1000);
const fmtJP = (d)=>{const w=['日','月','火','水','木','金','土'][d.getDay()];return `${d.getFullYear()}/${String(d.getMonth()+1).padStart(2,'0')}/${String(d.getDate()).padStart(2,'0')}(${w})`;};
function calcMinDate(){ const now = new Date(); const dd = new Date(now.getFullYear(),now.getMonth(),now.getDate()+1); return dd; }
function totals(){
  const items = [...state.cart.values()].map(x=>({...x, total:x.price*x.qty}));
  return { items, count: items.reduce((a,c)=>a+c.qty,0), total: items.reduce((a,c)=>a+c.total,0) };
}

/* ====== スケルトン＆プログレス ====== */
let progressTimer = null;
function showProgress(){
  const bar = document.getElementById('topProgress');
  if(!bar) return;
  bar.hidden = false;
  progressTimer = setTimeout(()=> bar.setAttribute('active',''), 200);
}
function doneProgress(){
  const bar = document.getElementById('topProgress');
  if(!bar) return;
  if(progressTimer){ clearTimeout(progressTimer); progressTimer = null; }
  bar.setAttribute('done','');
  setTimeout(()=>{ bar.hidden = true; bar.removeAttribute('active'); bar.removeAttribute('done'); }, 300);
}
function showSkeleton(n=8){
  const wrap = document.getElementById('skeletonWrap'); if(!wrap) return;
  wrap.hidden = false;
  wrap.innerHTML = Array.from({length:n}).map(()=>`
    <div class="skeleton">
      <div class="img"></div>
      <div class="t1"></div>
      <div class="t2"></div>
    </div>`).join('');
}
function hideSkeleton(){
  const wrap = document.getElementById('skeletonWrap'); if(!wrap) return;
  wrap.hidden = true; wrap.innerHTML = '';
}

/* ====== データ取得・描画 ====== */
async function loadProducts(){
  showProgress();
  showSkeleton(8);
  try{
    const res = await fetch(PRODUCTS_URL, { cache:'no-store' });
    const data = await res.json();
    state.products = Array.isArray(data) ? data : (data.products || []);
  }catch(err){
    console.warn('Products fetch error, fallback to demo:', err);
    state.products = [
      { id:'demo-1', name:'ディナーロール 36個入り', price:598, img:'' },
      { id:'demo-2', name:'プルコギビーフ', price:2580, img:'' }
    ];
  }finally{
    hideSkeleton(); doneProgress();
    renderProducts();
    state.minDateISO = isoDate(calcMinDate());
    document.getElementById('inlineMinDate')?.replaceChildren(document.createTextNode(`最短受取 ${fmtJP(toJst(new Date(state.minDateISO)))}`));
    document.getElementById('cartMinDateInline')?.replaceChildren(document.createTextNode(`最短受取 ${fmtJP(toJst(new Date(state.minDateISO)))}`));
  }
}

function renderProducts(){
  const root = document.getElementById('productList'); if(!root) return;
  root.innerHTML = state.products.map(p=>{
    const img = esc(p.img||'');
    return `
      <article class="card" data-id="${esc(p.id)}">
        <img class="ph" src="${img||'data:image/gif;base64,R0lGODlhAQABAIAAAAAAAP///ywAAAAAAQABAAACAUwAOw=='}" alt="${esc(p.name)}">
        <div class="pad">
          <div class="name">${esc(p.name)}</div>
          <div class="price">${yen(p.price||0)}</div>
        </div>
        <div class="act">
          <button class="btn primary" data-add="${esc(p.id)}">カート追加</button>
        </div>
      </article>`;
  }).join('');
}

/* ====== カート操作 ====== */
function addToCart(id){
  const p = state.products.find(x=>String(x.id)===String(id)); if(!p) return;
  const cur = state.cart.get(id) || { id, name:p.name, price:+p.price||0, qty:0, img:p.img||'' };
  cur.qty += 1;
  state.cart.set(id, cur);
  renderCartBar();
}
function renderCartBar(){
  const t = totals();
  document.getElementById('inlineMinDate')?.replaceChildren(document.createTextNode(`最短受取 ${fmtJP(toJst(new Date(state.minDateISO||isoDate(calcMinDate()))))}`));
  // 下部バー表示はシンプル（数値はドロワーで表示）
}
document.addEventListener('click', (e)=>{
  const add = e.target.closest('[data-add]'); if(add){ addToCart(add.getAttribute('data-add')); }
});

/* ====== カートドロワー ====== */
const drawer = document.getElementById('cartDrawer');
function openCart(){ drawer?.setAttribute('aria-hidden','false'); renderCartDrawer(); }
function closeCart(){ drawer?.setAttribute('aria-hidden','true'); }
document.getElementById('openCartBtn')?.addEventListener('click', (e)=>{ e.preventDefault(); openCart(); });
document.getElementById('cartDrawerClose')?.addEventListener('click', closeCart);
document.getElementById('cartDrawerCancel')?.addEventListener('click', closeCart);
document.querySelector('#cartDrawer .ppp-drawer__scrim')?.addEventListener('click',(e)=>{ if(e.target.matches('.ppp-drawer__scrim')) closeCart(); });

function renderCartFooterTotals(){
  const t = totals();
  document.getElementById('cartCountFooterPC')?.replaceChildren(document.createTextNode(`${t.count}点`));
  document.getElementById('cartTotalFooterPC')?.replaceChildren(document.createTextNode(yen(t.total)));
  document.getElementById('cartCountFooterSP')?.replaceChildren(document.createTextNode(`${t.count}点`));
  document.getElementById('cartTotalFooterSP')?.replaceChildren(document.createTextNode(yen(t.total)));
}

function updateProceedDisabled(){
  const on = !!state.agreeStock && totals().count>0;
  const btns = Array.from(document.querySelectorAll('#cartProceed,[data-act="proceed"]'));
  btns.forEach(b=>{ b.disabled=!on; b.setAttribute('aria-disabled',String(!on)); b.classList.toggle('is-disabled',!on); });
}

function renderCartDrawer(){
  const d = state.minDateISO || isoDate(calcMinDate());
  document.getElementById('cartMinDateDrawer')?.replaceChildren(document.createTextNode(fmtJP(toJst(new Date(d)))));

  const list = document.getElementById('cartList');
  const t = totals();
  if(!list) return;
  if(t.count===0){
    list.innerHTML = '<div class="muted">カートは空です</div>';
  }else{
    list.innerHTML = t.items.map(it=>{
      const name = esc(it.name);
      const img = esc(it.img||'');
      return `
        <div class="cartrow" data-id="${esc(it.id)}">
          <div class="rowline">
            <div class="ttl">${name}</div>
            <div class="prc">${yen(it.price)} × ${it.qty} = ${yen(it.price*it.qty)}</div>
          </div>
          <div class="g2">
            <div class="thumb"><img src="${img||'https://dummyimage.com/160x120/ffffff/e5e7eb&text=No+Image'}" alt="${name}"></div>
            <div class="qtybar">
              <div class="group">
                <button class="btn" data-cart="dec">−</button>
                <input class="cartqty" type="number" min="0" step="1" value="${it.qty}">
                <button class="btn" data-cart="inc">＋</button>
              </div>
              <button class="btn" data-cart="rm">削除</button>
            </div>
          </div>
          <div class="totalline">${yen(it.price*it.qty)}</div>
        </div>`;
    }).join('');
  }

  // date/slot/memo
  const dateEl = document.getElementById('pickupDate');
  if(dateEl){
    const start = new Date(d);
    const opts = [0,1,2,3].map(n=>{ const x=new Date(start); x.setDate(x.getDate()+n); return { iso: isoDate(x), label: fmtJP(toJst(x)) }; });
    dateEl.innerHTML = opts.map(o=>`<option value="${o.iso}" ${o.iso===state.selectedDateISO?'selected':''}>${o.label}</option>`).join('');
  }
  document.getElementById('pickupSlot')?.addEventListener('change',(e)=> state.selectedSlot = e.target.value );
  document.getElementById('pickupMemo')?.addEventListener('input',(e)=> state.memo = e.target.value );
  document.getElementById('agreeStock')?.addEventListener('change',(e)=>{ state.agreeStock = !!e.target.checked; updateProceedDisabled(); });

  renderCartFooterTotals();
  updateProceedDisabled();
}

document.addEventListener('click',(e)=>{
  const btn = e.target.closest('[data-cart]'); if(!btn) return;
  const row = btn.closest('.cartrow'); if(!row) return;
  const id = row.getAttribute('data-id');
  const it = state.cart.get(id); if(!it) return;

  if(btn.dataset.cart==='inc'){ it.qty += 1; }
  if(btn.dataset.cart==='dec'){ it.qty = Math.max(0, it.qty-1); }
  if(btn.dataset.cart==='rm'){ state.cart.delete(id); }

  renderCartDrawer();
});

document.querySelectorAll('[data-act="cancel"]').forEach(b=>b.addEventListener('click',(e)=>{ e.preventDefault(); closeCart(); }));
document.querySelectorAll('[data-act="proceed"]').forEach(b=>b.addEventListener('click',(e)=>{ e.preventDefault(); document.getElementById('cartProceed')?.click(); }));

document.getElementById('cartProceed')?.addEventListener('click',(e)=>{
  e.preventDefault();
  const t = totals(); if(t.count===0) return;
  const before = state.minDateISO || isoDate(calcMinDate());
  const chosen = document.getElementById('pickupDate')?.value || before;
  const slot   = document.getElementById('pickupSlot')?.value || '';
  const memo   = document.getElementById('pickupMemo')?.value || '';
  const json = encodeURIComponent(JSON.stringify(t.items));
  const text = encodeURIComponent(t.items.map(x=>`${x.name} x${x.qty} = ${x.total}`).join('\n'));
  const url = new URL(FORM_BASE);
  url.searchParams.set('entry.1000001', before);
  url.searchParams.set('entry.1000002', chosen);
  url.searchParams.set('entry.1000003', slot);
  url.searchParams.set('entry.1000004', memo);
  url.searchParams.set('entry.1000005', json);
  url.searchParams.set('entry.1000006', text);
  window.location.href = url.toString();
});

/* ====== 初期化 ====== */
(function init(){
  state.minDateISO = isoDate(calcMinDate());
  document.getElementById('inlineMinDate')?.replaceChildren(document.createTextNode(`最短受取 ${fmtJP(toJst(new Date(state.minDateISO)))}`));
  document.getElementById('cartMinDateInline')?.replaceChildren(document.createTextNode(`最短受取 ${fmtJP(toJst(new Date(state.minDateISO)))}`));

  loadProducts();
})();
