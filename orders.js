// Histórico de pedidos: somente leitura. Acesso protegido por RLS no Supabase.
(() => {
  const panel = document.getElementById('admin-panel');
  if (!panel) return;
  const section = document.createElement('section');
  section.className = 'orders-admin';
  section.innerHTML = '<div class="orders-admin-head"><h3>Pedidos recebidos</h3><button type="button" id="orders-refresh">Atualizar</button></div><div class="orders-filters"><input id="orders-search" placeholder="Buscar número ou cliente" aria-label="Buscar pedidos"><select id="orders-status"><option value="">Todos os status</option><option value="pending_payment">Aguardando pagamento</option><option value="paid">Pago</option><option value="preparing">Preparando</option><option value="shipped">Enviado</option><option value="delivered">Entregue</option><option value="cancelled">Cancelado</option></select></div><p id="orders-message" role="status">Entre como administrador para consultar os pedidos.</p><div id="orders-list"></div>';
  panel.appendChild(section);
  const $ = id => document.getElementById(id);
  const money = n => Number(n || 0).toLocaleString('pt-BR', {style:'currency',currency:'BRL'});
  const esc = v => String(v ?? '').replace(/[&<>"']/g, c => ({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c]));
  const statuses = {pending_payment:'Aguardando pagamento',paid:'Pago',preparing:'Preparando envio',shipped:'Enviado',delivered:'Entregue',cancelled:'Cancelado'};
  const paymentStatuses = {pending:'Pendente',approved:'Aprovado',rejected:'Recusado',refunded:'Reembolsado',cancelled:'Cancelado'};
  // Homologação restrita ao ambiente local: nunca exibir o checkout de teste na loja publicada.
  const localPaymentTest = ['localhost', '127.0.0.1'].includes(location.hostname);
  const paymentTestResults = new Map();
  let orders = [];
  let request = 0;
  function render() {
    const term = $('orders-search').value.trim().toLowerCase();
    const status = $('orders-status').value;
    const filtered = orders.filter(o =>
      (!status || o.order_status === status) &&
      (!term || String(o.order_number).includes(term) ||
       String(o.customer_name || '').toLowerCase().includes(term) ||
       String(o.customer_email || '').toLowerCase().includes(term)));
    $('orders-message').textContent = filtered.length
      ? filtered.length + ' pedido(s) encontrado(s).'
      : 'Nenhum pedido encontrado.';
    $('orders-list').innerHTML = filtered.map(o => {
      const items = (o.order_items || []).map(i =>
        '<li>' + esc(i.product_name) + ' · ' + Number(i.quantity) + ' × ' + money(i.unit_price) + ' = ' + money(i.line_total) + '</li>').join('');
      const address = [o.shipping_street, o.shipping_number, o.shipping_complement, o.shipping_neighborhood, o.shipping_city, o.shipping_state, o.shipping_zip].filter(Boolean).join(', ');
      return '<details class="order-card"><summary title="Clique para visualizar todos os dados do pedido"><strong>Pedido #' + esc(o.order_number) + '</strong><span>' + esc(o.customer_name) + '</span><span>' + money(o.total) + '</span><span>' + esc(statuses[o.order_status] || o.order_status) + '</span></summary><div class="order-card-body"><p><b>Data:</b> ' + esc(new Date(o.created_at).toLocaleString('pt-BR')) + '</p><p><b>Pagamento:</b> ' + esc(paymentStatuses[o.payment_status] || o.payment_status) + '</p><p><b>Forma de pagamento:</b> ' + esc(o.payment_method === 'pix_whatsapp' ? 'PIX direto com a loja' : o.payment_method === 'mercado_pago' ? 'Mercado Pago' : o.payment_method || 'Não informado') + '</p><p><b>E-mail:</b> ' + esc(o.customer_email) + '</p><p><b>Telefone:</b> ' + esc(o.customer_phone) + '</p><p><b>Endereço:</b> ' + esc(address) + '</p><p><b>Frete:</b> ' + esc([o.shipping_company,o.shipping_service].filter(Boolean).join(' · ')) + ' — ' + money(o.shipping_price) + '</p><p><b>Rastreamento:</b> ' + esc(o.tracking_code || 'Ainda não informado') + '</p><p><b>Subtotal:</b> ' + money(o.subtotal) + '</p><p><b>Total:</b> ' + money(o.total) + '</p><b>Produtos:</b><ul>' + items + '</ul><button type="button" class="btn btn-ghost" data-copy-order="' + esc(o.id) + '">Copiar resumo do pedido</button>' + (o.order_status === 'pending_payment' && o.payment_status === 'pending' ? '<button type="button" class="btn btn-ghost" data-cancel-order="' + esc(o.id) + '">Cancelar pedido e devolver estoque</button>' : '') + (o.payment_method === 'pix_whatsapp' && o.payment_status === 'pending' && o.order_status === 'pending_payment' && new Date(o.payment_expires_at).getTime() > Date.now() ? '<button type="button" class="btn btn-ghost" data-confirm-pix="' + esc(o.id) + '">Confirmar PIX recebido</button>' : '') + (o.payment_status === 'approved' && ['paid','preparing','shipped'].includes(o.order_status) ? '<button type="button" class="btn btn-ghost" data-progress-order="' + esc(o.id) + '">' + (o.order_status === 'paid' ? 'Iniciar preparação' : o.order_status === 'preparing' ? 'Registrar envio' : 'Marcar como entregue') + '</button>' : '') + (localPaymentTest && o.payment_method === 'mercado_pago' && o.payment_status === 'pending' && o.order_status === 'pending_payment' && Date.parse(o.payment_expires_at || '') > Date.now() ? '<button type="button" class="btn btn-ghost" data-mp-order-test="' + esc(o.id) + '">Gerar checkout Mercado Pago — Teste</button><div class="mp-order-test-result" data-mp-order-result="' + esc(o.id) + '" role="status"></div>' : '') + '<p class="orders-note">Alterações exigem autorização no servidor.</p></div></details>';
    }).join('');
  }
  // A cobrança é criada somente por Edge Function autenticada, nunca no navegador.
  $('orders-list').addEventListener('click', async event => {
    const button = event.target.closest('[data-mp-order-test]');
    if (!button || !localPaymentTest) return;
    const order = orders.find(o => o.id === button.dataset.mpOrderTest);
    if (!order || order.payment_method !== 'mercado_pago' || order.payment_status !== 'pending' ||
        order.order_status !== 'pending_payment' || Date.parse(order.payment_expires_at || '') <= Date.now()) {
      $('orders-message').textContent = 'Pedido não está elegível para homologação.';
      return;
    }
    const resultNode = button.parentElement.querySelector('[data-mp-order-result]');
    const previous = paymentTestResults.get(order.id);
    if (previous) {
      resultNode.replaceChildren();
      const link = document.createElement('a');
      link.href = previous; link.target = '_blank'; link.rel = 'noopener noreferrer';
      link.textContent = 'Abrir checkout de teste já gerado';
      resultNode.append(link);
      return;
    }
    if (!window.confirm('Gerar uma Order de HOMOLOGAÇÃO no Mercado Pago para o pedido #' +
      order.order_number + ' (' + money(order.total) + ')? Não confirma pagamento nem altera estoque.')) return;
    button.disabled = true;
    resultNode.textContent = 'Gerando checkout de homologação…';
    try {
      const client = window.getAdminSupabaseClient?.();
      if (!client) throw new Error('Cliente administrativo indisponível.');
      const { data: auth, error: authError } = await client.auth.getSession();
      if (authError || !auth?.session?.access_token) throw new Error('Faça login novamente.');
      const { data, error } = await client.functions.invoke('mercado-pago-store-order-test', {
        body: { order_id: order.id }
      });
      if (error) {
        let detail = '';
        try { detail = (await error.context?.json?.())?.error || ''; } catch (_) {}
        throw new Error(detail || error.message || 'Falha ao criar checkout.');
      }
      if (data?.mode !== 'test_only' || data?.store_order_id !== order.id ||
          Number(data?.amount) !== Number(order.total) || typeof data?.checkout_url !== 'string')
        throw new Error('Resposta do checkout não corresponde ao pedido.');
      const checkoutUrl = new URL(data.checkout_url);
      if (checkoutUrl.protocol !== 'https:' || !['mercadopago.com.br', 'www.mercadopago.com.br'].includes(checkoutUrl.hostname))
        throw new Error('Domínio de checkout não autorizado.');
      paymentTestResults.set(order.id, checkoutUrl.href);
      resultNode.replaceChildren();
      const description = document.createElement('p');
      description.textContent = '✓ Order de homologação: ' + data.mp_order_id + ' · ' + money(order.total) + '. Nenhum pagamento confirmado.';
      const link = document.createElement('a');
      link.href = checkoutUrl.href; link.target = '_blank'; link.rel = 'noopener noreferrer';
      link.textContent = 'Abrir checkout de teste';
      resultNode.append(description, link);
      button.textContent = 'Checkout de teste gerado';
    } catch (error) {
      resultNode.textContent = 'Não foi possível gerar checkout: ' + (error?.message || 'erro desconhecido');
      button.disabled = false;
    }
  });
  $('orders-list').addEventListener('click', async event => {
    const button = event.target.closest('[data-confirm-pix]');
    if (!button) return;
    const order = orders.find(o => o.id === button.dataset.confirmPix);
    if (!order || order.payment_method !== 'pix_whatsapp' || order.payment_status !== 'pending' || order.order_status !== 'pending_payment') return;
    const reference = window.prompt('Após conferir o crédito na conta, informe a referência/identificador da transação PIX:');
    if (reference === null) return;
    if (reference.trim().length < 6 || reference.trim().length > 200) {
      $('orders-message').textContent = 'Referência inválida (6 a 200 caracteres).'; return;
    }
    if (!window.confirm('Você conferiu o recebimento de ' + money(order.total) + ' na conta da loja? Confirmar pagamento do pedido #' + order.order_number + '?')) return;
    button.disabled = true;
    try {
      const client = window.getAdminSupabaseClient?.();
      if (!client) throw new Error('Faça login como administrador.');
      const {data:auth} = await client.auth.getSession();
      if (!auth?.session?.access_token) throw new Error('Sessão expirada.');
      const endpoint = String(window.STORE_CONFIG?.supabaseUrl || '').replace(/\/$/, '');
      const response = await fetch(endpoint + '/functions/v1/admin-order-progress', {
        method:'POST',
        headers:{'Content-Type':'application/json','Authorization':'Bearer '+auth.session.access_token,'apikey':window.STORE_CONFIG?.supabaseAnonKey || ''},
        body:JSON.stringify({order_id:order.id,action:'confirm_pix',payment_reference:reference.trim(),confirm:true})
      });
      const result = await response.json();
      if (!response.ok) throw new Error(result.error || 'Falha na confirmação.');
      await load();
    } catch(error) {
      button.disabled = false;
      $('orders-message').textContent = error.message || 'Erro ao confirmar PIX.';
    }
  });
  $('orders-list').addEventListener('click', async event => {
    const button = event.target.closest('[data-progress-order]');
    if (!button) return;
    const order = orders.find(o => o.id === button.dataset.progressOrder);
    if (!order || order.payment_status !== 'approved') return;
    const action = {paid:'prepare',preparing:'ship',shipped:'deliver'}[order.order_status];
    if (!action) return;
    let tracking_code = null;
    if (action === 'ship') {
      tracking_code = window.prompt('Informe o código de rastreamento do envio:');
      if (tracking_code === null) return;
      tracking_code = tracking_code.trim();
      if (tracking_code.length < 5 || tracking_code.length > 100) {
        $('orders-message').textContent = 'Informe um código de rastreamento válido (5 a 100 caracteres).';
        return;
      }
    }
    if (!window.confirm('Atualizar o pedido #' + order.order_number + ' para ' + ({prepare:'Preparando',ship:'Enviado',deliver:'Entregue'}[action]) + '?')) return;
    button.disabled = true;
    button.textContent = 'Atualizando…';
    try {
      const client = window.getAdminSupabaseClient?.();
      const { data: auth } = await client.auth.getSession();
      if (!auth?.session?.access_token) throw new Error('Sessão expirada.');
      const endpoint = String(window.STORE_CONFIG?.supabaseUrl || '').replace(/\/$/, '');
      const response = await fetch(endpoint + '/functions/v1/admin-order-progress', {
        method: 'POST',
        headers: { 'Content-Type':'application/json', 'Authorization':'Bearer ' + auth.session.access_token,
          'apikey':window.STORE_CONFIG?.supabaseAnonKey || '' },
        body:JSON.stringify({order_id:order.id,action,tracking_code,confirm:true})
      });
      const result = await response.json();
      if (!response.ok) throw new Error(result.error || 'Falha ao atualizar pedido.');
      await load();
    } catch (error) {
      button.disabled = false;
      button.textContent = 'Tentar novamente';
      $('orders-message').textContent = error.message || 'Erro ao atualizar pedido.';
    }
  });
  $('orders-list').addEventListener('click', async event => {
    const button = event.target.closest('[data-cancel-order]');
    if (!button) return;
    const order = orders.find(o => o.id === button.dataset.cancelOrder);
    if (!order || order.order_status !== 'pending_payment' || order.payment_status !== 'pending') return;
    if (!window.confirm('Cancelar o pedido #' + order.order_number + ' e devolver o estoque reservado? Esta ação não pode ser desfeita.')) return;
    button.disabled = true;
    button.textContent = 'Cancelando…';
    try {
      const client = window.getAdminSupabaseClient?.();
      if (!client) throw new Error('Faça login como administrador.');
      const { data: auth } = await client.auth.getSession();
      if (!auth?.session?.access_token) throw new Error('Sessão expirada. Entre novamente.');
      const endpoint = String(window.STORE_CONFIG?.supabaseUrl || '').replace(/\/$/, '');
      if (!endpoint) throw new Error('Endereço do Supabase não configurado.');
      const response = await fetch(endpoint + '/functions/v1/admin-cancel-order', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', 'Authorization': 'Bearer ' + auth.session.access_token,
          'apikey': window.STORE_CONFIG?.supabaseAnonKey || '' },
        body: JSON.stringify({order_id: order.id, confirm: true}),
      });
      const result = await response.json();
      if (!response.ok) throw new Error(result.error || 'Não foi possível cancelar.');
      $('orders-message').textContent = 'Pedido #' + order.order_number + ' cancelado. Estoque liberado.';
      await load();
    } catch (error) {
      button.disabled = false;
      button.textContent = 'Cancelar pedido e devolver estoque';
      $('orders-message').textContent = error.message || 'Erro ao cancelar.';
    }
  });
  $('orders-list').addEventListener('click', async event => {
    const button = event.target.closest('[data-copy-order]');
    if (!button) return;
    const order = orders.find(o => o.id === button.dataset.copyOrder);
    if (!order) return;
    const address = [order.shipping_street,order.shipping_number,order.shipping_complement,order.shipping_neighborhood,order.shipping_city,order.shipping_state,order.shipping_zip].filter(Boolean).join(', ');
    const lines = ['Pedido #' + order.order_number, 'Cliente: ' + order.customer_name, 'Status: ' + (statuses[order.order_status] || order.order_status), 'Pagamento: ' + (paymentStatuses[order.payment_status] || order.payment_status), ...((order.order_items || []).map(i => i.quantity + ' × ' + i.product_name + ' — ' + money(i.line_total))), 'Subtotal: ' + money(order.subtotal), 'Frete: ' + money(order.shipping_price), 'Total: ' + money(order.total), 'Endereço: ' + address];
    try { await navigator.clipboard.writeText(lines.join('\n')); button.textContent = 'Resumo copiado!'; }
    catch (_) { button.textContent = 'Não foi possível copiar'; }
  });
  async function load() {
    const current = ++request;
    if (!panel || panel.hidden || !db || !session) return;
    $('orders-message').textContent = 'Carregando pedidos…';
    const {data,error} = await db.from('orders').select('*,order_items(product_name,quantity,unit_price,line_total)').order('created_at',{ascending:false}).limit(100);
    if (current !== request || panel.hidden) return;
    if (error) {
      $('orders-message').textContent = 'Não foi possível carregar pedidos: ' + error.message;
      return;
    }
    orders = data || [];
    render();
  }
  window.refreshOrders = load;
  window.clearOrders = () => {
    ++request;
    orders = [];
    $('orders-list').replaceChildren();
    $('orders-message').textContent = 'Entre como administrador para consultar os pedidos.';
  };
  $('orders-refresh').addEventListener('click', load);
  $('orders-search').addEventListener('input', render);
  $('orders-status').addEventListener('change', render);
})();
