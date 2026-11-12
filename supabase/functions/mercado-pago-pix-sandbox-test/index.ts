// Diagnóstico PIX isolado conforme Mercado Pago Orders API.
// Nunca associa a pedidos/estoque da loja; requer administrador e habilitação explícita.
// O cenário APRO simula aprovação em ambiente de teste. Não usa dinheiro real.
import { createClient } from 'npm:@supabase/supabase-js@2';

const origins = new Set(['http://localhost:8000','http://127.0.0.1:8000']);
const replyHeaders = (origin: string) => ({
  'Access-Control-Allow-Origin': origins.has(origin) ? origin : 'http://localhost:8000',
  'Access-Control-Allow-Headers': 'authorization,apikey,content-type,x-client-info',
  'Access-Control-Allow-Methods': 'POST,OPTIONS',
  'Content-Type': 'application/json',
  'Cache-Control': 'no-store',
  'Vary': 'Origin',
});
Deno.serve(async (req: Request) => {
  const origin = req.headers.get('origin') || '';
  const headers = replyHeaders(origin);
  const reply = (status: number, body: unknown) => new Response(JSON.stringify(body), { status, headers });
  if (req.method === 'OPTIONS') return new Response(null, { status: 204, headers });
  if (req.method !== 'POST') return reply(405, { error: 'Método não permitido.' });
  if (!origins.has(origin)) return reply(403, { error: 'Somente ambiente local.' });
  if (Deno.env.get('MP_PIX_SANDBOX_TEST_ENABLED') !== 'true')
    return reply(503, { error: 'Diagnóstico PIX desabilitado.' });
  const url = Deno.env.get('SUPABASE_URL');
  const anon = Deno.env.get('SUPABASE_ANON_KEY');
  const token = Deno.env.get('MERCADO_PAGO_ACCESS_TOKEN_TEST');
  if (!url || !anon || !token) return reply(503, { error: 'Configuração de teste incompleta.' });
  const jwt = /^Bearer\s+(.+)$/i.exec(req.headers.get('authorization') || '')?.[1];
  if (!jwt) return reply(401, { error: 'Autenticação obrigatória.' });
  const userDb = createClient(url, anon, {
    global: { headers: { Authorization: 'Bearer ' + jwt } },
    auth: { persistSession: false, autoRefreshToken: false },
  });
  const { data: auth, error: authError } = await userDb.auth.getUser(jwt);
  if (authError || !auth.user) return reply(401, { error: 'Sessão inválida.' });
  const { data: admin, error: adminError } = await userDb.from('admins')
    .select('user_id').eq('user_id', auth.user.id).maybeSingle();
  if (adminError || !admin) return reply(403, { error: 'Somente administradores.' });
  let input: { request_key?: unknown };
  try { input = await req.json(); } catch { return reply(400, { error: 'JSON inválido.' }); }
  const key = input?.request_key;
  if (typeof key !== 'string' || !/^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(key))
    return reply(400, { error: 'Identificador de teste inválido.' });
  const payload = {
    type: 'online',
    processing_mode: 'automatic',
    external_reference: 'bia_pix_sandbox_' + key.replaceAll('-', ''),
    total_amount: '50.00',
    payer: { email: 'test_payer@example.com', first_name: 'APRO' },
    transactions: {
      payments: [{
        amount: '50.00',
        payment_method: { id: 'pix', type: 'bank_transfer' },
      }],
    },
  };
  try {
    const response = await fetch('https://api.mercadopago.com/v1/orders', {
      method: 'POST',
      headers: {
        Authorization: 'Bearer ' + token,
        'Content-Type': 'application/json',
        Accept: 'application/json',
        'X-Idempotency-Key': key,
      },
      body: JSON.stringify(payload),
      signal: AbortSignal.timeout(15000),
    });
    const result = await response.json().catch(() => ({}));
    if (!response.ok) {
      console.error('MP PIX sandbox rejected', response.status, result?.code || 'unknown');
      return reply(502, {
        error: 'Mercado Pago recusou a simulação PIX.',
        provider_status: response.status,
        provider_code: typeof result?.code === 'string' ? result.code : null,
      });
    }
    const payment = result?.transactions?.payments?.[0];
    if (typeof result?.id !== 'string' || !payment ||
        payment?.payment_method?.id !== 'pix') {
      return reply(502, { error: 'Resposta PIX incompleta.' });
    }
    return reply(201, {
      mode: 'pix_sandbox_only',
      order_id: result.id,
      order_status: result.status || null,
      payment_status: payment.status || null,
      payment_id: payment.id || null,
      amount: '50.00',
      message: 'Simulação PIX isolada: não alterou pedidos nem estoque da loja.',
    });
  } catch (error) {
    console.error('MP PIX sandbox request error', error instanceof Error ? error.message : 'unknown');
    return reply(503, { error: 'Falha na comunicação com Mercado Pago.' });
  }
});
