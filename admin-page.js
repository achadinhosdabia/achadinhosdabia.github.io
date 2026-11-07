// Navegação exclusiva da página administrativa. Mantém os scripts da loja compatíveis.
(() => {
  if (!document.body.classList.contains('admin-page')) return;
  const panel = document.getElementById('admin-panel');
  const dialog = document.getElementById('admin-dialog');
  dialog.setAttribute('open','');
  document.querySelectorAll('a[href="#admin"]').forEach(a => a.href = 'admin.html');
  const tabs = [...document.querySelectorAll('[data-admin-tab]')];
  const sections = {
    overview: () => [document.getElementById('admin-overview')],
    orders: () => [document.querySelector('.orders-admin')],
    products: () => [document.querySelector('.admin-toolbar'),document.getElementById('admin-products'),document.getElementById('product-form'),document.getElementById('gallery-admin'),document.querySelector('.shipping-connection')],
    settings: () => [document.querySelector('.store-settings')]
  };
  let selected = 'overview';
  function show(tab) {
    selected = sections[tab] ? tab : 'overview';
    tabs.forEach(b => { b.classList.toggle('active',b.dataset.adminTab===selected);b.setAttribute('aria-current',b.dataset.adminTab===selected?'page':'false'); });
    for (const [name,get] of Object.entries(sections)) get().forEach(el => {
      if (!el) return;
      if (name === 'products' && el.id === 'product-form') {
        if (selected !== 'products') { el.dataset.wasHidden = String(el.hidden);el.hidden = true; }
        else if (el.dataset.wasHidden === 'false') el.hidden = false;
      } else el.hidden = name !== selected;
    });
    const shipping = document.getElementById('connect-melhor-envio')?.parentElement;
    if (shipping) shipping.hidden = selected !== 'settings';
    if (selected === 'orders' && !panel.hidden) window.refreshOrders?.();
  }
  tabs.forEach(b => b.addEventListener('click',() => show(b.dataset.adminTab)));
  const originalShowModal = dialog.showModal.bind(dialog);
  dialog.showModal = () => { if (!dialog.open) dialog.setAttribute('open',''); };
  dialog.close = () => {};
  const newProduct = document.getElementById('new-product');
  newProduct.addEventListener('click',() => {show('products');});
  const observer = new MutationObserver(() => { if (!panel.hidden && selected === 'orders') window.refreshOrders?.(); });
  observer.observe(panel,{attributes:true,attributeFilter:['hidden']});
  window.addEventListener('load',() => { show('overview'); });
  show('overview');
})();
