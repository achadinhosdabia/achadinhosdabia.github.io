// Achadinhos da BIA — criação de pedidos (desativada por padrão).
// Ativar somente após testes controlados: CHECKOUT_ORDER_CREATION_ENABLED=true.
// Não cria cobrança no Mercado Pago nem etiqueta no Melhor Envio.
import { createClient } from 'npm:@supabase/supabase-js@2';

const allowedOrigins = new Set([
  'https://achadinhosdabia.github.io',
  'http://localhost:8000',
  'http://127.0.0.1:8000',
]);
const headersFor = (req: Request) => ({
  'Access-Control-Allow-Origin': allowedOrigins.has(req.headers.get('origin') || '')
    ? req.headers.get('origin')! : 'https://achadinhosdabia.github.io',
  'Vary': 'Origin',
  'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type',
  'Access-Control-Allow-Methods': 'POST, OPTIONS',
  'Content-Type': 'application/json; charset=utf-8',
  'Cache-Control': 'no-store',
});
const respond = (req: Request, status: number, body: unknown) => new Response(JSON.stringify(body), { status, headers: headersFor(req) });
const digits = (v: unknown) => String(v ?? '').replace(/\D/g, '');
const normalize = (v: unknown) => String(v ?? '').trim().toLocaleLowerCase('pt-BR');
const uuid = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
const cpfValid = (value: unknown) => {
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
  if (req.method === 'OPTIONS') return new Response(null, { status: 204, headers: headersFor(req) });
  if (req.method !== 'POST') return respond(req, 405, { error: 'Método não permitido.' });
  // Proteção contra ativação acidental, mesmo se a função for publicada.
  if (Deno.env.get('CHECKOUT_ORDER_CREATION_ENABLED') !== 'true')
    return respond(req, 503, { error: 'Criação de pedidos ainda desabilitada para testes.' });
  const origin = req.headers.get('origin');
  if (origin !== 'https://achadinhosdabia.github.io' &&
      origin !== 'http://localhost:8000' && origin !== 'http://127.0.0.1:8000')
    return respond(req, 403, { error: 'Origem não autorizada.' });
  try {
    const body = await req.json();
    const requestKey = body?.request_key;
    if (typeof requestKey !== 'string' || !uuid.test(requestKey))
      return respond(req, 400, { error: 'Identificador único da compra obrigatório.' });
    const items = body?.items;
    const customer = body?.customer;
    const address = body?.address;
    const shipping = body?.shipping;
    if (!Array.isArray(items) || items.length < 1 || items.length > 30 ||
        items.some((x: { product_id?: unknown; quantity?: unknown }) =>
          typeof x?.product_id !== 'string' || !uuid.test(x.product_id) ||
          !Number.isSafeInteger(x.quantity) || Number(x.quantity) < 1 || Number(x.quantity) > 100))
      return respond(req, 400, { error: 'Itens inválidos.' });
    const grouped = new Map<string, number>();
    for (const x of items) {
      const id = x.product_id.toLowerCase();
      grouped.set(id, (grouped.get(id) || 0) + x.quantity);
    }
    if ([...grouped.values()].some((qty) => qty > 100) ||
        [...grouped.values()].reduce((a, b) => a + b, 0) > 100)
      return respond(req, 400, { error: 'Quantidade excedida.' });
    if (!customer || typeof customer.name !== 'string' || customer.name.trim().length < 3 ||
        typeof customer.email !== 'string' || !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(customer.email) ||
        digits(customer.phone).length < 10 || !cpfValid(customer.cpf))
      return respond(req, 400, { error: 'Dados do cliente inválidos.' });
    if (!address || digits(address.zip).length !== 8 ||
        String(address.street ?? '').trim().length < 2 ||
        String(address.number ?? '').trim().length < 1 ||
        String(address.neighborhood ?? '').trim().length < 2 ||
        String(address.city ?? '').trim().length < 2 ||
        !/^[A-Z]{2}$/.test(String(address.state ?? '').toUpperCase()))
      return respond(req, 400, { error: 'Endereço incompleto.' });
    if (!shipping || !String(shipping.company ?? '').trim() || !String(shipping.service ?? '').trim())
      return respond(req, 400, { error: 'Frete não selecionado.' });
    if (!['mercado_pago', 'pix_whatsapp'].includes(body.payment_method))
      return respond(req, 400, { error: 'Pagamento inválido.' });

    const url = Deno.env.get('SUPABASE_URL');
    const anon = Deno.env.get('SUPABASE_ANON_KEY');
    const service = Deno.env.get('SUPABASE_SERVICE_ROLE_KEY');
    const secret = Deno.env.get('CHECKOUT_INTERNAL_SECRET') || '';
    if (!url || !anon || !service || secret.length < 32)
      return respond(req, 503, { error: 'Checkout não configurado.' });
    const invoke = async (name: string, payload: unknown) => {
      const res = await fetch(url + '/functions/v1/' + name, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          apikey: anon,
          Authorization: 'Bearer ' + anon,
          ...(name === 'quote-shipping' ? { 'x-checkout-internal-secret': secret } : {}),
        },
        body: JSON.stringify(payload),
        signal: AbortSignal.timeout(15000),
      });
      if (!res.ok) throw new Error('Falha na validação interna: ' + name);
      return res.json();
    };
    const normalizedItems = [...grouped].map(([product_id, quantity]) => ({ product_id, quantity }));
    const [catalog, freight] = await Promise.all([
      invoke('checkout-preview', { items: normalizedItems }),
      invoke('quote-shipping', { items: normalizedItems, destination_zip: digits(address.zip) }),
    ]);
    if (catalog?.mode !== 'preview_only' || !Array.isArray(catalog.items) ||
        catalog.items.length !== normalizedItems.length || !Array.isArray(freight?.quotes))
      return respond(req, 409, { error: 'Produtos ou frete indisponíveis.' });
    const selected = freight.quotes.find((q: { company?: unknown; service?: unknown }) =>
      normalize(q.company) === normalize(shipping.company) &&
      normalize(q.service) === normalize(shipping.service));
    const price = Number(selected?.price);
    if (!selected || !Number.isFinite(price) || price < 0)
      return respond(req, 409, { error: 'Frete alterado ou indisponível. Refaça a cotação.' });

    // O RPC relê preços, trava produtos e reserva estoque atomicamente.
    // Não aceitar preços ou total fornecidos pelo navegador.
    const db = createClient(url, service, { auth: { persistSession: false } });
    const { data, error } = await db.rpc('create_store_order_idempotent', {
      p_request_key: requestKey,
      p_customer: {
        name: customer.name.trim(), email: customer.email.trim(),
        phone: digits(customer.phone), cpf: digits(customer.cpf),
      },
      p_items: normalizedItems,
      p_shipping: {
        zip: digits(address.zip), street: String(address.street).trim(),
        number: String(address.number).trim(),
        complement: String(address.complement ?? '').trim(),
        neighborhood: String(address.neighborhood).trim(),
        city: String(address.city).trim(), state: String(address.state).toUpperCase(),
        company: selected.company, service: selected.service,
        validated_price: Math.round(price * 100) / 100,
      },
      p_payment_method: body.payment_method,
    });
    if (error) {
      console.error('Falha no RPC create_store_order', error.code);
      return respond(req, 409, { error: 'Não foi possível reservar o estoque e criar o pedido. Confira o carrinho.' });
    }
    return respond(req, 201, { mode: 'sandbox_order', order: data,
      message: 'Pedido registrado sem iniciar cobrança ou compra de frete.' });
  } catch (err) {
    console.error('Falha de checkout', err instanceof Error ? err.message : 'erro desconhecido');
    return respond(req, 503, { error: 'Não foi possível finalizar o pedido neste momento.' });
  }
});
