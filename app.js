/* =====================================================================
   app.js — 完全版（Stage A）
   - カートSP行：行1=タイトルぶち抜き、行2=小計、行3=数量、行4=削除、行5は廃止
   - ドロワー上部チップの点数/合計は非表示（DOMは保持）
   - フッターはPC/SP別の2行構成（ボタン右寄せ、現行幅を踏襲）
   ===================================================================== */

/* ---- シンプルな状態とユーティリティ（最小構成。既存プロジェクトに合わせて差し替え可） ---- */
const state = {
  cart: new Map(),   // id -> { id, name, price, qty }
  agreeStock: false,
  selectedSlot: '14時〜17時',
  memo: '',
  minDateISO: null,
  selectedDateISO: null,
};

const productById = new Map();
const FORM_BASE = 'https://docs.google.com/forms/d/e/1FAIpQLScWyIhn4F9iS-ZFhHQlQerLu7noGWSu4xauMPgISh1DmNFD_w/viewform';

const yen = (n)=>`¥${(n||0).toLocaleString('ja-JP')}`;
const escapeHtml = (s)=>String(s??'').replace(/[&<>"']/g,m=>({ '&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;' }[m]));

function totals(){
  const items = [...state.cart.values()].map(x=>({ ...x, total:x.price*x.qty }));
  return {
    count: items.reduce((a,c)=>a + c.qty, 0),
    total: items.reduce((a,c)=>a + c.total, 0),
    items
  };
}

function isoDate(d){ return d.toISOString().slice(0,10); }
function toJst(d){
  // naive JST convert for display
  const u = d.getTime() + (9*60*60*1000);
  return new Date(u);
}
function fmtJP(d){
  const w = ['日','月','火','水','木','金','土'][d.getDay()];
  return `${d.getFullYear()}/${String(d.getMonth()+1).padStart(2,'0')}/${String(d.getDate()).padStart(2,'0')}(${w})`;
}
function calcMinDate(){
  const now = new Date();
  // とりあえず「翌日」を最短受取日に
  const dd = new Date(now.getFullYear(), now.getMonth(), now.getDate()+1);
  return dd;
}

/* ---- カートBar ---- */
function renderCartBar(){
  const t = totals();
  const cnt = document.getElementById('cartCount'); if(cnt) cnt.textContent = `${t.count||0}点`;
  const sum = document.getElementById('cartTotal'); if(sum) sum.textContent = yen(t.total||0);
  const md  = document.getElementById('cartMinDate'); if(md) md.textContent = fmtJP(toJst(new Date(state.minDateISO||isoDate(calcMinDate()))));
  const mdi = document.getElementById('cartMinDateInline'); if(mdi) mdi.textContent = `最短受取 ${fmtJP(toJst(new Date(state.minDateISO||isoDate(calcMinDate()))))}`;
}

/* ---- フッター合計（PC/SP両対応） ---- */
function renderCartFooterTotals(){
  const t = totals();
  // legacy single target (if still present)
  document.getElementById('cartTotalFooter')?.replaceChildren(document.createTextNode(yen(t.total||0)));
  // PC
  document.getElementById('cartCountFooterPC')?.replaceChildren(document.createTextNode(`${t.count||0}点`));
  document.getElementById('cartTotalFooterPC')?.replaceChildren(document.createTextNode(yen(t.total||0)));
  // SP
  document.getElementById('cartCountFooterSP')?.replaceChildren(document.createTextNode(`${t.count||0}点`));
  document.getElementById('cartTotalFooterSP')?.replaceChildren(document.createTextNode(yen(t.total||0)));
}

/* ---- ドロワー開閉 ---- */
const cartDrawer = document.getElementById('cartDrawer');
function openCartDrawer(){ cartDrawer?.setAttribute('aria-hidden','false'); renderCartDrawer(); window.addEventListener('keydown',onCartKeydown); }
function closeCartDrawer(){ cartDrawer?.setAttribute('aria-hidden','true'); window.removeEventListener('keydown',onCartKeydown); }
function onCartKeydown(e){ if(e.key==='Escape') closeCartDrawer(); }
document.querySelector('#cartDrawer .ppp-drawer__scrim')?.addEventListener('click',(e)=>{ if(e.target.matches('.ppp-drawer__scrim')) closeCartDrawer(); });
document.getElementById('cartDrawerClose')?.addEventListener('click', closeCartDrawer);
document.getElementById('cartDrawerCancel')?.addEventListener('click', closeCartDrawer);
document.getElementById('checkoutBtn2')?.addEventListener('click',(e)=>{ e.preventDefault(); openCartDrawer(); });

/* ---- 進むボタン活性制御 ---- */
function updateProceedDisabled(){
  const on = !!state.agreeStock;
  const btns = Array.from(document.querySelectorAll('#cartProceed, [data-act="proceed"]'));
  for(const btn of btns){
    btn.disabled = !on;
    btn.setAttribute('aria-disabled', String(!on));
    btn.classList.toggle('is-disabled', !on);
  }
}

/* ---- カート描画 ---- */
function renderCartDrawer(){
  const d=calcMinDate();
  state.minDateISO=isoDate(d);
  if(!state.selectedDateISO) state.selectedDateISO = state.minDateISO;

  // 上部チップ（点数/合計はCSSで非表示だが互換で更新）
  document.getElementById('cartMinDateDrawer')?.replaceChildren(document.createTextNode(fmtJP(toJst(new Date(state.minDateISO)))));
  const t = totals();
  document.getElementById('cartCountDrawer')?.replaceChildren(document.createTextNode(`${t.count||0}点`));
  document.getElementById('cartTotalDrawer')?.replaceChildren(document.createTextNode(yen(t.total||0)));

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
          <div class="cartrow" data-id="\${it.id}">
            <div class="rowline">
              <div class="ttl">\${name}</div>
              <div class="prc">\${yen(it.price)} × \${it.qty} = \${yen(it.price*it.qty)}</div>
            </div>
            <div class="g2">
              <div class="thumb"><img src="\${img}" alt="\${name}" onerror="this.src='https://dummyimage.com/160x120/ffffff/e5e7eb&text=No+Image'"></div>
              <div class="qtybar">
                <div class="group">
                  <button class="btn" data-cart="dec">−</button>
                  <input class="cartqty" type="number" min="0" step="1" value="\${it.qty}">
                  <button class="btn" data-cart="inc">＋</button>
                </div>
                <button class="btn warn" data-cart="rm">削除</button>
              </div>
            </div>
            <div class="totalline">\${yen(it.price*it.qty)}</div>
          </div>`;
      }).join('');
    }
  }

  // 受取日/時間帯/メモ
  const dateEl = document.getElementById('pickupDate');
  if(dateEl){
    const d0 = new Date(state.minDateISO);
    const opts = [0,1,2,3].map(n=>{ const dd=new Date(d0); dd.setDate(dd.getDate()+n); return { iso: isoDate(dd), label: fmtJP(toJst(dd)) }; });
    dateEl.innerHTML = opts.map(o=>`<option value="${o.iso}" ${o.iso===state.selectedDateISO?'selected':''}>${o.label}</option>`).join('');
  }
  const slotEl = document.getElementById('pickupSlot');
  if(slotEl){
    const slots = ['14時〜17時','17時〜20時'];
    if(!state.selectedSlot) state.selectedSlot = slots[0];
    slotEl.innerHTML = slots.map(s=>`<option ${s===state.selectedSlot?'selected':''}>${s}</option>`).join('');
  }
  const memoEl = document.getElementById('pickupMemo'); if(memoEl){ memoEl.value = state.memo||''; }

  const agree = document.getElementById('agreeStock');
  if(agree){
    agree.removeEventListener('change', agree._h || (()=>{}));
    agree._h = (e)=>{ state.agreeStock = !!e.target.checked; updateProceedDisabled(); };
    agree.addEventListener('change', agree._h);
    agree.checked = !!state.agreeStock;
  }

  renderCartFooterTotals();
  updateProceedDisabled();
}

/* ---- イベント（数量/削除） ---- */
document.addEventListener('click',(ev)=>{
  const btn = ev.target.closest('[data-cart]');
  if(!btn) return;
  const row = btn.closest('.cartrow'); if(!row) return;
  const id = row.getAttribute('data-id');
  const item = state.cart.get(id); if(!item) return;

  if(btn.dataset.cart==='inc'){ item.qty+=1; }
  if(btn.dataset.cart==='dec'){ item.qty=Math.max(0, item.qty-1); }
  if(btn.dataset.cart==='rm'){ state.cart.delete(id); }

  renderCartDrawer(); renderCartBar();
});
document.addEventListener('input',(ev)=>{
  const input = ev.target.closest('.cartqty'); if(!input) return;
  const row = input.closest('.cartrow'); if(!row) return;
  const id = row.getAttribute('data-id');
  const item = state.cart.get(id); if(!item) return;
  const v = Math.max(0, parseInt(input.value||'0', 10)||0);
  item.qty = v;
  renderCartDrawer(); renderCartBar();
});

/* ---- 進む（GoogleフォームへURL連携） ---- */
document.getElementById('cartProceed')?.addEventListener('click',(e)=>{
  e.preventDefault();
  const t = totals(); if(t.items.length===0) return;
  const before = state.minDateISO;
  const chosen = document.getElementById('pickupDate')?.value || before;
  const slot   = document.getElementById('pickupSlot')?.value || '';
  const memo   = document.getElementById('pickupMemo')?.value || '';
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

// Stage A: duplicate footer buttons (data-act) handlers
document.querySelectorAll('[data-act="cancel"]').forEach(btn=>btn.addEventListener('click', (e)=>{
  e.preventDefault();
  document.getElementById('cartDrawerCancel')?.click();
}));
document.querySelectorAll('[data-act="proceed"]').forEach(btn=>btn.addEventListener('click', (e)=>{
  e.preventDefault();
  document.getElementById('cartProceed')?.click();
}));

/* ---- デモ用：商品を1つだけ用意（実環境では既存の一覧レンダを利用） ---- */
(function demoSeed(){
  const demo = { id:'demo-1', name:'テスト商品', price:598, img:'' };
  productById.set(demo.id, demo);
  state.cart.set(demo.id, { id:demo.id, name:demo.name, price:demo.price, qty:2 });
})();

/* ---- 初期化 ---- */
(function init(){
  state.minDateISO = isoDate(calcMinDate());
  renderCartBar();
})();
