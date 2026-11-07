// Carrinho local: não cria pedidos nem processa pagamentos.
(() => {
  const KEY = 'achadinhos_bia_cart_v1';
  let cart = [];
  try { const saved = JSON.parse(localStorage.getItem(KEY) || '[]'); if (Array.isArray(saved)) cart = saved.filter(x => x && typeof x.id === 'string' && Number.isInteger(x.qty) && x.qty > 0); } catch {}
  const getProduct = id => typeof product === 'function' ? product(id) : null;
  const persist = () => { try { localStorage.setItem(KEY, JSON.stringify(cart)); } catch {} };
  const escapeText = value => String(value ?? '').replace(/[&<>"']/g, c => ({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c]));
  const format = value => Number(value).toLocaleString('pt-BR',{style:'currency',currency:'BRL'});
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
    list.innerHTML = valid.length ? valid.map(item => {
      const p = getProduct(item.id);
      return `<div class="cart-line"><div class="cart-line-info"><strong>${escapeText(p.name)}</strong><small>${format(p.price)} cada · ${Math.floor(Number(p.stock))} em estoque</small></div><div class="cart-line-actions"><button type="button" data-cart-minus="${escapeText(item.id)}" aria-label="Diminuir quantidade">−</button><span>${item.qty}</span><button type="button" data-cart-plus="${escapeText(item.id)}" aria-label="Aumentar quantidade">+</button><button type="button" data-cart-remove="${escapeText(item.id)}" aria-label="Remover produto">Remover</button></div></div>`;
    }).join('') : '<p>Seu carrinho está vazio. Escolha seus achadinhos! 🌼</p>';
    document.getElementById('cart-next').disabled = !valid.length;
  }
  window.addToCart = id => {
    const p = getProduct(id);
    if (!p || p.active === false || Number(p.stock) <= 0) { toast('Produto indisponível.'); return; }
    const item = cart.find(x => x.id === String(id));
    if (item) {
      if (item.qty >= Math.floor(Number(p.stock))) { toast('Quantidade máxima disponível no estoque.'); return; }
      item.qty++;
    } else cart.push({id:String(id),qty:1});
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
      renderCart();
    }
  });
  document.getElementById('open-cart').addEventListener('click', () => { renderCart(); document.getElementById('cart-dialog').showModal(); });
  document.getElementById('close-cart').addEventListener('click', () => document.getElementById('cart-dialog').close());
  document.getElementById('cart-next').addEventListener('click', () => toast('Estamos preparando o cálculo do frete e as formas de pagamento. Nenhum pedido foi realizado.'));
  document.addEventListener('DOMContentLoaded', renderCart);
  window.addEventListener('pageshow', renderCart);
  window.refreshCart = renderCart;
})();
