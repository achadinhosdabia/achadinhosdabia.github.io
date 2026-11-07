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
        '<li>' + esc(i.product_name) + ' · ' + Number(i.quantity) + ' × ' + money(i.unit_price) + '</li>').join('');
      const address = [o.shipping_street, o.shipping_number, o.shipping_complement, o.shipping_neighborhood, o.shipping_city, o.shipping_state, o.shipping_zip].filter(Boolean).join(', ');
      return '<details class="order-card"><summary><strong>Pedido #' + esc(o.order_number) + '</strong><span>' + esc(o.customer_name) + '</span><span>' + money(o.total) + '</span><span>' + esc(statuses[o.order_status] || o.order_status) + '</span></summary><div class="order-card-body"><p><b>Data:</b> ' + esc(new Date(o.created_at).toLocaleString('pt-BR')) + '</p><p><b>Pagamento:</b> ' + esc(paymentStatuses[o.payment_status] || o.payment_status) + '</p><p><b>E-mail:</b> ' + esc(o.customer_email) + '</p><p><b>Telefone:</b> ' + esc(o.customer_phone) + '</p><p><b>Endereço:</b> ' + esc(address) + '</p><p><b>Frete:</b> ' + esc([o.shipping_company,o.shipping_service].filter(Boolean).join(' · ')) + ' — ' + money(o.shipping_price) + '</p><p><b>Rastreamento:</b> ' + esc(o.tracking_code || 'Ainda não informado') + '</p><p><b>Subtotal:</b> ' + money(o.subtotal) + '</p><b>Produtos:</b><ul>' + items + '</ul><p class="orders-note">Atualização de envio será habilitada na próxima etapa.</p></div></details>';
    }).join('');
  }
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
