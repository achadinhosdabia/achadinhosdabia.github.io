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

  // Diagnóstico somente-leitura; visível apenas no painel autenticado.
  const accessTest = document.createElement('div');
  accessTest.style.cssText = 'margin:16px 0;padding:16px;border:1px solid #e6d7e6;border-radius:14px';
  const accessTitle = document.createElement('strong');
  accessTitle.textContent = 'Verificação de acesso administrativo';
  const accessInfo = document.createElement('p');
  accessInfo.textContent = 'Confira se este login tem acesso de administrador, sem alterar pedidos ou estoque.';
  const accessButton = document.createElement('button');
  accessButton.type = 'button';
  accessButton.className = 'btn btn-ghost';
  accessButton.textContent = 'Verificar meu acesso';
  const accessResult = document.createElement('p');
  accessResult.setAttribute('role', 'status');
  accessResult.setAttribute('aria-live', 'polite');
  accessTest.append(accessTitle, accessInfo, accessButton, accessResult);
  document.getElementById('admin-overview')?.append(accessTest);
  accessButton.addEventListener('click', async () => {
    accessButton.disabled = true;
    accessResult.textContent = 'Verificando…';
    try {
      const client = window.getAdminSupabaseClient?.();
      if (!client) throw new Error('Cliente Supabase não inicializado.');
      const { data: { session }, error: sessionError } = await client.auth.getSession();
      if (sessionError || !session?.access_token)
        throw new Error('Faça login novamente no painel.');
      const { data, error } = await client.functions.invoke('check-admin-access', { body: {} });
      if (error) {
        const response = error.context;
        const payload = response && typeof response.json === 'function'
          ? await response.json().catch(() => null) : null;
        throw new Error(payload?.error || error.message || 'Verificação indisponível.');
      }
      accessResult.textContent = data?.admin === true
        ? '✓ Acesso administrativo confirmado para esta conta.'
        : 'Acesso administrativo não confirmado.';
    } catch (error) {
      accessResult.textContent = 'Não foi possível verificar: ' + (error?.message || 'tente novamente.');
    } finally {
      accessButton.disabled = false;
    }
  });
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
