// Carrinho local: não cria pedidos nem processa pagamentos.
(() => {
  const KEY = 'achadinhos_bia_cart_v1';
  let cart = [];
  try { const saved = JSON.parse(localStorage.getItem(KEY) || '[]'); if (Array.isArray(saved)) cart = saved.filter(x => x && typeof x.id === 'string' && Number.isInteger(x.qty) && x.qty > 0); } catch {}
  const getProduct = id => typeof product === 'function' ? product(id) : null;
  const persist = () => { try { localStorage.setItem(KEY, JSON.stringify(cart)); } catch {} };
  const escapeText = value => String(value ?? '').replace(/[&<>"']/g, c => ({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c]));
  const format = value => Number(value).toLocaleString('pt-BR',{style:'currency',currency:'BRL'});
  let shippingChoice = null;
  const shippingMoney = n => Number(n).toLocaleString('pt-BR',{style:'currency',currency:'BRL'});
  function resetShipping() {
    shippingChoice = null;
    const results = document.getElementById('cart-shipping-results');
    if (results) results.replaceChildren();
  }
  function renderCart() {
    const dialog = document.getElementById('cart-dialog');
    if (!dialog) return;
    const list = document.getElementById('cart-items');
    const count = document.getElementById('cart-count');
    const subtotal = document.getElementById('cart-subtotal');
    const valid = [];
    let total = 0, quantity = 0;
    for (const item of cart) {
      const p = getProduct(item.id);
      if (!p || p.active === false || Number(p.stock) <= 0) continue;
      const qty = Math.min(item.qty, Math.max(0, Math.floor(Number(p.stock))));
      if (!qty) continue;
      valid.push({id:String(p.id),qty});
      quantity += qty;
      total += Number(p.price) * qty;
    }
    cart = valid;
    persist();
    count.textContent = String(quantity);
    subtotal.textContent = format(total);
    const shippingTotal = document.getElementById('cart-shipping-total');
    const grandTotal = document.getElementById('cart-grand-total');
    if (shippingTotal) shippingTotal.textContent = shippingChoice ? format(shippingChoice.price) : 'A calcular';
    if (grandTotal) grandTotal.textContent = shippingChoice ? format(total + shippingChoice.price) : 'A calcular';
    list.innerHTML = valid.length ? valid.map(item => {
      const p = getProduct(item.id);
      return `<div class="cart-line"><div class="cart-line-info"><strong>${escapeText(p.name)}</strong><small>${format(p.price)} cada · ${Math.floor(Number(p.stock))} em estoque</small></div><div class="cart-line-actions"><button type="button" data-cart-minus="${escapeText(item.id)}" aria-label="Diminuir quantidade">−</button><span>${item.qty}</span><button type="button" data-cart-plus="${escapeText(item.id)}" aria-label="Aumentar quantidade">+</button><button type="button" data-cart-remove="${escapeText(item.id)}" aria-label="Remover produto">Remover</button></div></div>`;
    }).join('') : '<p>Seu carrinho está vazio. Escolha seus achadinhos! 🌼</p>';
    document.getElementById('cart-next').disabled = !valid.length || !shippingChoice;
  }
  window.addToCart = id => {
    const p = getProduct(id);
    if (!p || p.active === false || Number(p.stock) <= 0) { toast('Produto indisponível.'); return; }
    const item = cart.find(x => x.id === String(id));
    if (item) {
      if (item.qty >= Math.floor(Number(p.stock))) { toast('Quantidade máxima disponível no estoque.'); return; }
      item.qty++;
    } else cart.push({id:String(id),qty:1});
    resetShipping();
    renderCart();
    toast('Produto adicionado ao carrinho!');
  };
  document.addEventListener('click', event => {
    const add = event.target.closest('[data-cart-add]');
    if (add) { window.addToCart(add.dataset.cartAdd); return; }
    const plus = event.target.closest('[data-cart-plus]');
    const minus = event.target.closest('[data-cart-minus]');
    const remove = event.target.closest('[data-cart-remove]');
    if (plus || minus || remove) {
      const id = (plus || minus || remove).dataset[plus?'cartPlus':minus?'cartMinus':'cartRemove'];
      const item = cart.find(x => x.id === id);
      if (!item) return;
      if (remove) cart = cart.filter(x => x.id !== id);
      else if (minus) { item.qty--; if (!item.qty) cart = cart.filter(x => x.id !== id); }
      else { const p = getProduct(id); if (p && item.qty < Math.floor(Number(p.stock))) item.qty++; else toast('Quantidade máxima disponível.'); }
      resetShipping();
      renderCart();
    }
  });
  document.getElementById('cart-shipping-form').addEventListener('submit', async event => {
    event.preventDefault();
    resetShipping();
    const result = document.getElementById('cart-shipping-results');
    const zip = document.getElementById('cart-destination-zip').value.replace(/\D/g,'');
    if (!/^\d{8}$/.test(zip)) { result.textContent = 'Informe um CEP de 8 números.'; return; }
    renderCart();
    if (!cart.length) { result.textContent = 'Adicione produtos ao carrinho.'; return; }
    if (!db) { result.textContent = 'Conexão com o Supabase indisponível.'; return; }
    if (cart.some(item => !getProduct(item.id)?.shipping_enabled)) { result.textContent = 'Há produtos sem frete automático. Combine a entrega com a loja.'; return; }
    const requestedCart = cart.map(item => ({product_id:item.id,quantity:item.qty}));
    const cartSnapshot = JSON.stringify(requestedCart);
    result.textContent = 'Consultando transportadoras…';
    try {
      const {data,error} = await db.functions.invoke('quote-shipping',{body:{items:requestedCart,destination_zip:zip}});
      if (error) {
        console.error('[Carrinho] Falha ao consultar quote-shipping:', error);
        const context = error.context;
        const status = context?.status;
        throw new Error(status ? 'Falha HTTP ' + status + ' ao consultar o frete.' : 'Falha de comunicação com o serviço de frete.');
      }
      if (!Array.isArray(data?.quotes)) {
        console.error('[Carrinho] Resposta inesperada de quote-shipping:', data);
        throw new Error(data?.error || data?.message || 'O serviço retornou uma resposta sem opções de frete.');
      }
      if (JSON.stringify(cart.map(item => ({product_id:item.id,quantity:item.qty}))) !== cartSnapshot || document.getElementById('cart-destination-zip').value.replace(/\D/g,'') !== zip) return;
      result.replaceChildren();
      if (!data.quotes.length) { result.textContent = data.message || 'Nenhuma opção de frete disponível para este CEP.'; return; }
      for (const quote of data.quotes) {
        const price = Number(quote.price);
        if (!Number.isFinite(price) || price < 0) continue;
        const button = document.createElement('button');
        button.type = 'button';
        button.className = 'cart-shipping-option';
        button.textContent = String(quote.company || 'Transportadora') + ' · ' + String(quote.service || 'Entrega') + ' — ' + shippingMoney(price) + ' · ' + String(quote.days ?? '?') + ' dias úteis';
        button.onclick = () => {
          result.querySelectorAll('button').forEach(b => b.setAttribute('aria-pressed', String(b === button)));
          shippingChoice = {price,company:String(quote.company||''),service:String(quote.service||''),days:quote.days};
          renderCart();
        };
        result.appendChild(button);
      }
    } catch (err) { result.textContent = err?.message || 'Não foi possível consultar o frete. Tente novamente.'; }
  });
  document.getElementById('open-cart').addEventListener('click', () => { renderCart(); document.getElementById('cart-dialog').showModal(); });
  document.getElementById('close-cart').addEventListener('click', () => document.getElementById('cart-dialog').close());
  document.getElementById('cart-destination-zip').addEventListener('input', resetShipping);
  document.getElementById('cart-next').addEventListener('click', () => { if (!cart.length || !shippingChoice) return; window.openCheckoutPreview?.({items:cart.map(x=>({...x})),shipping:{...shippingChoice},destinationZip:document.getElementById('cart-destination-zip').value.replace(/\D/g,'')}); });
  document.addEventListener('DOMContentLoaded', renderCart);
  window.addEventListener('pageshow', renderCart);
  window.refreshCart = renderCart;
})();
