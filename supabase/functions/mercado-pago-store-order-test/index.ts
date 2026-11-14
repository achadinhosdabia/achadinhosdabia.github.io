// Achadinhos da BIA — homologação de cobrança vinculada a pedido existente.
// Modo production_pix: PIX real apenas para admin local, usando a função já existente.
// Modo test_checkout: checkout sandbox legado, preservado para compatibilidade.
// Nunca cria pedido, altera estoque nem confirma pagamento.
import { createClient } from 'npm:@supabase/supabase-js@2';

const localOrigins = new Set(['http://localhost:8000','http://127.0.0.1:8000']);
const origins = new Set([...localOrigins,'https://achadinhosdabia.github.io']);
const uuid = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
const emailPattern = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;
type Mode = 'production_pix' | 'test_checkout';

Deno.serve(async (req: Request) => {
  const origin = req.headers.get('origin') || '';
  const headers = {
    'Access-Control-Allow-Origin': origins.has(origin) ? origin : 'https://achadinhosdabia.github.io',
    'Access-Control-Allow-Headers': 'authorization,apikey,content-type,x-client-info',
    'Access-Control-Allow-Methods': 'POST,OPTIONS',
    'Content-Type': 'application/json; charset=utf-8',
    'Cache-Control': 'no-store',
    'Vary': 'Origin',
  };
  const reply = (status: number, data: unknown) => new Response(JSON.stringify(data), { status, headers });
  if (req.method === 'OPTIONS') return new Response(null, { status: 204, headers });
  if (req.method !== 'POST') return reply(405, { error: 'Método não permitido.' });
  if (!origins.has(origin)) return reply(403, { error: 'Origem não autorizada.' });

  let input: { order_id?: unknown; mode?: unknown };
  try { input = await req.json(); } catch { return reply(400, { error: 'JSON inválido.' }); }
  const id = input?.order_id;
  const mode: Mode = input?.mode === 'production_pix' ? 'production_pix' : 'test_checkout';
  if (input?.mode !== undefined && input?.mode !== mode)
    return reply(400, { error: 'Modo de pagamento inválido.' });
  if (typeof id !== 'string' || !uuid.test(id))
    return reply(400, { error: 'Pedido inválido.' });
  if (mode === 'production_pix') {
    if (!localOrigins.has(origin)) return reply(403, { error: 'PIX real em homologação disponível apenas no admin local.' });
    if (Deno.env.get('MP_PIX_REAL_TEST_ENABLED') !== 'true')
      return reply(503, { error: 'PIX real em homologação desabilitado.' });
  } else if (Deno.env.get('MP_STORE_ORDER_TEST_ENABLED') !== 'true') {
    return reply(503, { error: 'Homologação do checkout sandbox desabilitada.' });
  }

  const url = Deno.env.get('SUPABASE_URL');
  const anon = Deno.env.get('SUPABASE_ANON_KEY');
  const service = Deno.env.get('SUPABASE_SERVICE_ROLE_KEY');
  const token = Deno.env.get(mode === 'production_pix'
    ? 'MERCADO_PAGO_ACCESS_TOKEN_PROD' : 'MERCADO_PAGO_ACCESS_TOKEN_TEST');
  if (!url || !anon || !service || !token)
    return reply(503, { error: 'Configuração de pagamentos incompleta.' });

  const jwt = /^Bearer\s+(.+)$/i.exec(req.headers.get('authorization') || '')?.[1];
  if (!jwt) return reply(401, { error: 'Login administrativo obrigatório.' });
  const userDb = createClient(url, anon, {
    global: { headers: { Authorization: 'Bearer ' + jwt } },
    auth: { persistSession: false, autoRefreshToken: false },
  });
  const { data: auth, error: authError } = await userDb.auth.getUser(jwt);
  if (authError || !auth.user) return reply(401, { error: 'Sessão inválida.' });
  const { data: admin, error: adminError } = await userDb.from('admins')
    .select('user_id').eq('user_id', auth.user.id).maybeSingle();
  if (adminError || !admin) return reply(403, { error: 'Somente administradores.' });

  const db = createClient(url, service, { auth: { persistSession: false } });
  const { data: order, error: orderError } = await db.from('orders')
    .select('id,order_number,total,customer_email,payment_method,payment_status,order_status,payment_expires_at')
    .eq('id', id).maybeSingle();
  if (orderError) {
    console.error('MP store order lookup failed', orderError.code);
    return reply(503, { error: 'Falha ao consultar pedido.' });
  }
  if (!order) return reply(404, { error: 'Pedido não encontrado.' });
  if (order.payment_method !== 'mercado_pago' || order.payment_status !== 'pending' ||
      order.order_status !== 'pending_payment' || !order.payment_expires_at ||
      Date.parse(order.payment_expires_at) <= Date.now())
    return reply(409, { error: 'Pedido não está elegível para pagamento.' });
  const amount = Number(order.total);
  if (!Number.isFinite(amount) || amount < 1 || amount > 100000 ||
      Math.round(amount * 100) / 100 !== amount)
    return reply(409, { error: 'Valor do pedido inválido.' });

  const reference = mode === 'production_pix' ? 'bia_order_' + id : 'bia_order_test_' + id;
  const environment = mode === 'production_pix' ? 'production' : 'test';
  const amountCents = Math.round(amount * 100);

  const { data: existing, error: existingError } = await db.from('mp_order_links')
    .select('store_order_id,mp_order_id,external_reference,amount_cents,environment')
    .eq('store_order_id', id).maybeSingle();
  if (existingError) {
    console.error('MP payment link lookup failed', existingError.code);
    return reply(503, { error: 'Não foi possível verificar vínculo do pagamento.' });
  }
  if (existing && (existing.external_reference !== reference ||
      Number(existing.amount_cents) !== amountCents || existing.environment !== environment))
    return reply(409, { error: 'Pedido já possui outro pagamento vinculado. Não gerar nova cobrança.' });

  // A cobrança de produção não pode ser emitida com e-mail de pagador ausente/inválido.
  if (mode === 'production_pix' && (typeof order.customer_email !== 'string' ||
      !emailPattern.test(order.customer_email)))
    return reply(409, { error: 'E-mail do cliente inválido para pagamento PIX.' });

  const providerHeaders = {
    Authorization: 'Bearer ' + token,
    'Content-Type': 'application/json',
    Accept: 'application/json',
    'X-Idempotency-Key': id,
  };
  try {
    let result: Record<string, any>;
    let reused = false;
    if (existing) {
      // Nunca criar segunda cobrança para pedido já vinculado, mesmo após troca de conta.
      const check = await fetch('https://api.mercadopago.com/v1/orders/' +
        encodeURIComponent(existing.mp_order_id), {
          method: 'GET',
          headers: { Authorization: 'Bearer ' + token, Accept: 'application/json' },
          signal: AbortSignal.timeout(15000),
        });
      if (!check.ok) return reply(409, {
        error: 'Já existe cobrança vinculada, mas não foi possível consultá-la. Não gere outra cobrança.',
        provider_status: check.status,
      });
      result = await check.json().catch(() => ({}));
      reused = true;
    } else {
      const { data: items, error: itemsError } = await db.from('order_items')
        .select('product_name,quantity,unit_price').eq('order_id', id);
      if (itemsError || !items?.length)
        return reply(409, { error: 'Itens do pedido indisponíveis.' });
      const payload = mode === 'production_pix' ? {
        type: 'online',
        processing_mode: 'automatic',
        external_reference: reference,
        total_amount: amount.toFixed(2),
        payer: { email: order.customer_email },
        transactions: { payments: [{
          amount: amount.toFixed(2),
          payment_method: { id: 'pix', type: 'bank_transfer' },
          expiration_time: 'PT30M',
        }] },
      } : {
        type: 'online',
        processing_mode: 'manual',
        total_amount: amount.toFixed(2),
        external_reference: reference,
        description: 'Achadinhos da BIA - pedido de homologacao ' + order.order_number,
        items: [{ title: 'Pedido ' + order.order_number + ' (produtos e frete)',
          unit_price: amount.toFixed(2), quantity: 1 }],
      };
      const response = await fetch('https://api.mercadopago.com/v1/orders', {
        method: 'POST', headers: providerHeaders,
        body: JSON.stringify(payload), signal: AbortSignal.timeout(15000),
      });
      const raw = await response.json().catch(() => ({}));
      if (!response.ok) {
        const code = typeof raw?.code === 'string' ? raw.code : 'unknown';
        console.warn('MP store payment rejected', { mode, status: response.status, code });
        return reply(502, { error: 'Mercado Pago recusou a criação do pagamento.',
          provider_status: response.status, provider_code: code });
      }
      result = raw;
    }
    if (typeof result?.id !== 'string' || result?.external_reference !== reference ||
        Math.round(Number(result?.total_amount) * 100) !== amountCents)
      return reply(502, { error: 'Mercado Pago retornou uma Order incompatível com o pedido. Não exibir cobrança.' });

    // Persistir vínculo antes de revelar qualquer QR ou checkout ao navegador.
    const link = {
      store_order_id: id, mp_order_id: result.id,
      external_reference: reference, amount_cents: amountCents, environment,
    };
    if (existing) {
      if (existing.mp_order_id !== link.mp_order_id)
        return reply(409, { error: 'Identificador da cobrança divergente. Não exibir pagamento.' });
    } else {
      const { error: insertError } = await db.from('mp_order_links').insert(link);
      if (insertError) {
        const { data: concurrent, error: concurrentError } = await db.from('mp_order_links')
          .select('mp_order_id,external_reference,amount_cents,environment')
          .eq('store_order_id', id).maybeSingle();
        if (concurrentError || !concurrent ||
            concurrent.mp_order_id !== link.mp_order_id ||
            concurrent.external_reference !== reference ||
            Number(concurrent.amount_cents) !== amountCents ||
            concurrent.environment !== environment) {
          console.error('MP payment link insert conflict', insertError.code);
          return reply(503, { error: 'Cobrança criada, mas vínculo não confirmado. Não gere outra cobrança.' });
        }
      }
    }
    if (mode === 'test_checkout') {
      const checkoutUrl = result?.checkout_url;
      if (typeof checkoutUrl !== 'string' || !/^https:\/\//i.test(checkoutUrl))
        return reply(502, { error: 'Checkout de teste indisponível.' });
      return reply(201, {
        mode: 'test_only', store_order_id: id, mp_order_id: result.id,
        checkout_url: checkoutUrl, amount: amount.toFixed(2), reused,
      });
    }

    let payment = result?.transactions?.payments?.[0];
    // Se MP estiver processando, fazer apenas consultas de leitura da mesma Order.
    for (let attempt = 0; attempt < 2; attempt++) {
      if (payment?.payment_method?.qr_code || payment?.payment_method?.ticket_url) break;
      if (result?.status !== 'processing' && payment?.status !== 'processing') break;
      await new Promise(resolve => setTimeout(resolve, 1200));
      const check = await fetch('https://api.mercadopago.com/v1/orders/' +
        encodeURIComponent(result.id), {
          method: 'GET',
          headers: { Authorization: 'Bearer ' + token, Accept: 'application/json' },
          signal: AbortSignal.timeout(10000),
        });
      if (!check.ok) break;
      const refreshed = await check.json().catch(() => null);
      if (refreshed?.id === result.id && refreshed?.external_reference === reference) {
        result = refreshed;
        payment = result?.transactions?.payments?.[0];
      }
    }
    if (payment?.payment_method?.id !== 'pix')
      return reply(502, { error: 'Order vinculada, mas transação PIX indisponível.',
        store_order_id: id, mp_order_id: result.id });
    const method = payment.payment_method;
    const qrCode = typeof method.qr_code === 'string' && method.qr_code.length < 5000 ? method.qr_code : null;
    const qrBase64 = typeof method.qr_code_base64 === 'string' &&
      method.qr_code_base64.length < 300000 && /^[A-Za-z0-9+/=]+$/.test(method.qr_code_base64)
      ? method.qr_code_base64 : null;
    let ticketUrl: string | null = null;
    if (typeof method.ticket_url === 'string') {
      try {
        const u = new URL(method.ticket_url);
        if (u.protocol === 'https:' && (u.hostname === 'mercadopago.com.br' ||
            u.hostname.endsWith('.mercadopago.com.br') ||
            u.hostname === 'mercadopago.com' || u.hostname.endsWith('.mercadopago.com')))
          ticketUrl = u.toString();
      } catch { /* invalid URL */ }
    }
    return reply(201, {
      mode: 'production_pix_admin_test',
      store_order_id: id, mp_order_id: result.id,
      amount: amount.toFixed(2), reused,
      order_status: result?.status || null,
      payment_status: payment?.status || null,
      qr_code: qrCode, qr_code_base64: qrBase64, ticket_url: ticketUrl,
      has_pix: Boolean(qrCode || qrBase64 || ticketUrl),
      message: 'Cobrança PIX real vinculada ao pedido. Confirmação automática ainda não habilitada.',
    });
  } catch (error) {
    console.error('MP store payment communication failure', error instanceof Error ? error.message : 'unknown');
    return reply(503, { error: 'Falha de comunicação com Mercado Pago. Confira vínculos antes de tentar novamente.' });
  }
});
