// Geração controlada de PIX REAL para homologação, independente de pedidos e estoque.
// Somente admin autenticado no localhost. Cobrança real de R$ 1,00, NÃO pagar nesta etapa.
// Exige MP_PIX_REAL_TEST_ENABLED=true e MERCADO_PAGO_ACCESS_TOKEN_PROD no Supabase Secrets.
import { createClient } from 'npm:@supabase/supabase-js@2';

const origins = new Set(['http://localhost:8000', 'http://127.0.0.1:8000']);
const uuid = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
const amount = '1.00';

Deno.serve(async (req: Request) => {
  const origin = req.headers.get('origin') || '';
  const headers = {
    'Access-Control-Allow-Origin': origins.has(origin) ? origin : 'http://localhost:8000',
    'Access-Control-Allow-Headers': 'authorization,apikey,content-type,x-client-info',
    'Access-Control-Allow-Methods': 'POST,OPTIONS',
    'Content-Type': 'application/json; charset=utf-8',
    'Cache-Control': 'no-store',
    'Vary': 'Origin',
  };
  const reply = (status: number, body: unknown) => new Response(JSON.stringify(body), { status, headers });
  if (req.method === 'OPTIONS') return new Response(null, { status: 204, headers });
  if (req.method !== 'POST') return reply(405, { error: 'Método não permitido.' });
  if (!origins.has(origin)) return reply(403, { error: 'Disponível somente no admin local.' });
  if (Deno.env.get('MP_PIX_REAL_TEST_ENABLED') !== 'true')
    return reply(503, { error: 'Teste de PIX real desabilitado. Ative MP_PIX_REAL_TEST_ENABLED no Supabase.' });

  const url = Deno.env.get('SUPABASE_URL');
  const anon = Deno.env.get('SUPABASE_ANON_KEY');
  const token = Deno.env.get('MERCADO_PAGO_ACCESS_TOKEN_PROD');
  if (!url || !anon) return reply(503, { error: 'Supabase não configurado.' });
  if (!token) return reply(503, { error: 'Configure MERCADO_PAGO_ACCESS_TOKEN_PROD nos Secrets do Supabase.' });

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
  const payerEmail = auth.user.email;
  if (!payerEmail || !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(payerEmail))
    return reply(409, { error: 'O usuário administrador precisa ter um e-mail válido.' });

  let input: { request_key?: unknown };
  try { input = await req.json(); } catch { return reply(400, { error: 'JSON inválido.' }); }
  const key = input?.request_key;
  if (typeof key !== 'string' || !uuid.test(key))
    return reply(400, { error: 'Identificador de cobrança inválido.' });

  // Não usar APRO: é um simulador do sandbox, não um PIX pagável.
  const payload = {
    type: 'online',
    processing_mode: 'automatic',
    external_reference: 'bia_pix_real_test_' + key.replaceAll('-', ''),
    total_amount: amount,
    payer: { email: payerEmail },
    transactions: {
      payments: [{
        amount,
        payment_method: { id: 'pix', type: 'bank_transfer' },
        expiration_time: 'PT30M',
      }],
    },
  };

  try {
    const requestHeaders = {
      Authorization: 'Bearer ' + token,
      'Content-Type': 'application/json',
      Accept: 'application/json',
      'X-Idempotency-Key': key,
    };
    const response = await fetch('https://api.mercadopago.com/v1/orders', {
      method: 'POST',
      headers: requestHeaders,
      body: JSON.stringify(payload),
      signal: AbortSignal.timeout(15000),
    });
    const result = await response.json().catch(() => ({}));
    if (!response.ok) {
      const errors = Array.isArray(result?.errors) ? result.errors : [];
      const providerCode = typeof result?.code === 'string' ? result.code
        : typeof errors[0]?.code === 'string' ? errors[0].code : null;
      console.warn('MP PIX real test rejected', { status: response.status, code: providerCode });
      return reply(502, {
        error: 'Mercado Pago recusou a criação do PIX.',
        provider_status: response.status,
        provider_code: providerCode,
      });
    }
    if (typeof result?.id !== 'string' || !result?.id.startsWith('ORD'))
      return reply(502, { error: 'Mercado Pago não retornou o identificador da Order.' });

    let order = result;
    // A API pode processar a Order de forma assíncrona. Consultas são SOMENTE LEITURA.
    for (let attempt = 0; attempt < 2; attempt++) {
      const payment = order?.transactions?.payments?.[0];
      if (payment?.payment_method?.qr_code || payment?.payment_method?.ticket_url) break;
      if (order?.status !== 'processing' && payment?.status !== 'processing') break;
      await new Promise((resolve) => setTimeout(resolve, 1200));
      const check = await fetch('https://api.mercadopago.com/v1/orders/' + encodeURIComponent(result.id), {
        headers: { Authorization: 'Bearer ' + token, Accept: 'application/json' },
        signal: AbortSignal.timeout(10000),
      });
      if (!check.ok) break;
      order = await check.json().catch(() => order);
    }

    const payment = order?.transactions?.payments?.[0];
    if (!payment || payment?.payment_method?.id !== 'pix')
      return reply(502, { error: 'A Order foi criada, mas não retornou uma transação PIX.', order_id: result.id });
    const pm = payment.payment_method;
    const qrCode = typeof pm.qr_code === 'string' && pm.qr_code.length < 5000 ? pm.qr_code : null;
    const qrBase64 = typeof pm.qr_code_base64 === 'string' &&
      pm.qr_code_base64.length < 300000 && /^[a-zA-Z0-9+/=]+$/.test(pm.qr_code_base64)
      ? pm.qr_code_base64 : null;
    const ticket = typeof pm.ticket_url === 'string' ? pm.ticket_url : null;
    let ticketUrl: string | null = null;
    if (ticket) {
      try {
        const u = new URL(ticket);
        if (u.protocol === 'https:' &&
          (u.hostname === 'mercadopago.com.br' || u.hostname.endsWith('.mercadopago.com.br') ||
           u.hostname === 'mercadopago.com' || u.hostname.endsWith('.mercadopago.com')))
          ticketUrl = u.toString();
      } catch { /* URL inválida não é exibida */ }
    }
    return reply(200, {
      mode: 'pix_real_admin_test',
      order_id: result.id,
      order_status: order?.status || null,
      order_status_detail: order?.status_detail || null,
      payment_status: payment?.status || null,
      payment_status_detail: payment?.status_detail || null,
      amount,
      qr_code: qrCode,
      qr_code_base64: qrBase64,
      ticket_url: ticketUrl,
      has_pix: Boolean(qrCode || qrBase64 || ticketUrl),
      message: 'PIX real isolado. Não foi associado a pedidos nem ao estoque da loja.',
    });
  } catch (e) {
    console.error('MP PIX real test communication failed', e instanceof Error ? e.message : 'unknown');
    return reply(503, { error: 'Falha na comunicação com o Mercado Pago.' });
  }
});
