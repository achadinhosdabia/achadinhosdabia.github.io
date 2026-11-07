// Achadinhos da BIA — validação final em modo de simulação.
// NÃO cria pedidos, NÃO reserva estoque, NÃO inicia cobranças.
// O servidor consulta novamente catálogo e frete; não confia em valores do browser.
const headers = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type',
  'Access-Control-Allow-Methods': 'POST, OPTIONS',
  'Content-Type': 'application/json; charset=utf-8',
  'Cache-Control': 'no-store',
};
const reply = (status: number, body: unknown) =>
  new Response(JSON.stringify(body), { status, headers });
const digits = (v: unknown) => String(v ?? '').replace(/\D/g, '');
const normalize = (v: unknown) => String(v ?? '').trim().toLocaleLowerCase('pt-BR');
const uuid = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
const validCPF = (value: unknown) => {
  const cpf = digits(value);
  if (!/^\d{11}$/.test(cpf) || /^(\d)\1{10}$/.test(cpf)) return false;
  for (let size = 9; size <= 10; size++) {
    let sum = 0;
    for (let i = 0; i < size; i++) sum += Number(cpf[i]) * (size + 1 - i);
    if ((sum * 10) % 11 % 10 !== Number(cpf[size])) return false;
  }
  return true;
};
Deno.serve(async (req) => {
  if (req.method === 'OPTIONS') return new Response(null, { status: 204, headers });
  if (req.method !== 'POST') return reply(405, { error: 'Método não permitido' });
  try {
    const body = await req.json();
    const items = body?.items;
    const customer = body?.customer;
    const address = body?.address;
    const shipping = body?.shipping;
    if (!Array.isArray(items) || !items.length || items.length > 30 ||
        items.some((x: {product_id?: unknown;quantity?: unknown}) =>
          typeof x?.product_id !== 'string' || !uuid.test(x.product_id) ||
          !Number.isSafeInteger(x.quantity) || Number(x.quantity) < 1 || Number(x.quantity) > 1000))
      return reply(400, { error: 'Itens inválidos.' });
    if (!customer || typeof customer.name !== 'string' || customer.name.trim().length < 3 ||
        typeof customer.email !== 'string' || !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(customer.email) ||
        digits(customer.phone).length < 10 || !validCPF(customer.cpf))
      return reply(400, { error: 'Confira nome, e-mail, telefone e CPF.' });
    if (!address || digits(address.zip).length !== 8 ||
        String(address.street ?? '').trim().length < 2 ||
        String(address.number ?? '').trim().length < 1 ||
        String(address.neighborhood ?? '').trim().length < 2 ||
        String(address.city ?? '').trim().length < 2 ||
        !/^[A-Z]{2}$/.test(String(address.state ?? '')))
      return reply(400, { error: 'Endereço incompleto.' });
    if (!shipping || !String(shipping.company ?? '').trim() || !String(shipping.service ?? '').trim())
      return reply(400, { error: 'Selecione uma transportadora.' });
    if (!['mercado_pago','pix_whatsapp'].includes(body.payment_method))
      return reply(400, { error: 'Forma de pagamento inválida.' });

    const url = Deno.env.get('SUPABASE_URL');
    const key = Deno.env.get('SUPABASE_ANON_KEY');
    if (!url || !key) return reply(503, { error: 'Serviço temporariamente indisponível.' });
    const invoke = async (fn: string, payload: unknown) => {
      const res = await fetch(url + '/functions/v1/' + fn, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', apikey: key, Authorization: 'Bearer ' + key },
        body: JSON.stringify(payload),
      });
      const data = await res.json().catch(() => null);
      if (!res.ok) {
        // Não expor tokens nem o corpo completo da resposta ao cliente.
        const reason = typeof data?.error === 'string' ? data.error.slice(0, 180)
          : typeof data?.message === 'string' ? data.message.slice(0, 180)
          : 'resposta sem detalhes';
        console.error('Falha na função interna', { function: fn, status: res.status, reason });
        throw new Error('Falha ao consultar ' + fn + ' (HTTP ' + res.status + '): ' + reason);
      }
      return data;
    };
    const [catalog, freight] = await Promise.all([
      invoke('checkout-preview', { items }),
      invoke('quote-shipping', { items, destination_zip: digits(address.zip) }),
    ]);
    if (catalog?.mode !== 'preview_only' || !Array.isArray(catalog.items) ||
        !Array.isArray(freight?.quotes))
      return reply(503, { error: 'Resposta de validação incompleta.' });
    const selected = freight.quotes.find((q: {company?: unknown;service?: unknown}) =>
      normalize(q.company) === normalize(shipping.company) &&
      normalize(q.service) === normalize(shipping.service));
    if (!selected || !Number.isFinite(Number(selected.price)) || Number(selected.price) < 0)
      return reply(409, { error: 'Frete selecionado indisponível. Refaça a cotação.' });
    const subtotal = Number(catalog.subtotal);
    const price = Number(selected.price);
    if (!Number.isFinite(subtotal) || subtotal < 0)
      return reply(503, { error: 'Subtotal inválido.' });
    return reply(200, {
      mode: 'dry_run',
      can_create_order: false,
      items: catalog.items,
      subtotal,
      shipping: { company: selected.company, service: selected.service, price },
      total: Math.round((subtotal + price) * 100) / 100,
      message: 'Validação de teste concluída. Nenhum pedido foi criado.',
    });
  } catch (err) {
    return reply(503, { error: err instanceof Error ? err.message : 'Não foi possível validar o checkout.' });
  }
});
