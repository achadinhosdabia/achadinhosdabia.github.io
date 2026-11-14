// Consulta somente leitura do PIX real de homologação. Não cria cobrança e não altera pedidos.
// Protegida por login administrativo e pelo mesmo sinalizador do teste PIX real.
import { createClient } from 'npm:@supabase/supabase-js@2';

const origins = new Set(['http://localhost:8000', 'http://127.0.0.1:8000']);
const orderIdPattern = /^ORD[A-Z0-9]{20,40}$/;

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
    return reply(503, { error: 'Consulta de PIX real desabilitada.' });

  const url = Deno.env.get('SUPABASE_URL');
  const anon = Deno.env.get('SUPABASE_ANON_KEY');
  const token = Deno.env.get('MERCADO_PAGO_ACCESS_TOKEN_PROD');
  if (!url || !anon || !token) return reply(503, { error: 'Configuração de pagamento incompleta.' });

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

  let input: { order_id?: unknown };
  try { input = await req.json(); } catch { return reply(400, { error: 'JSON inválido.' }); }
  const orderId = input?.order_id;
  if (typeof orderId !== 'string' || !orderIdPattern.test(orderId))
    return reply(400, { error: 'Identificador da Order inválido.' });

  try {
    const response = await fetch(
      'https://api.mercadopago.com/v1/orders/' + encodeURIComponent(orderId), {
        method: 'GET',
        headers: { Authorization: 'Bearer ' + token, Accept: 'application/json' },
        signal: AbortSignal.timeout(15000),
      },
    );
    if (!response.ok) {
      console.warn('MP PIX status lookup failed', response.status);
      return reply(502, {
        error: 'Não foi possível consultar a Order no Mercado Pago.',
        provider_status: response.status,
      });
    }
    const result = await response.json().catch(() => ({}));
    const reference = result?.external_reference;
    const amount = Number(result?.total_amount);
    const payment = result?.transactions?.payments?.[0];
    if (result?.id !== orderId ||
        typeof reference !== 'string' ||
        !/^bia_pix_real_test_[0-9a-f]{32}$/.test(reference) ||
        !Number.isFinite(amount) || Math.round(amount * 100) !== 100 ||
        payment?.payment_method?.id !== 'pix') {
      return reply(409, { error: 'A Order não corresponde ao teste PIX isolado de R$ 1,00.' });
    }
    const orderStatus = typeof result.status === 'string' ? result.status : null;
    const paymentStatus = typeof payment.status === 'string' ? payment.status : null;
    return reply(200, {
      mode: 'pix_real_status_read_only',
      order_id: orderId,
      amount: '1.00',
      order_status: orderStatus,
      order_status_detail: typeof result.status_detail === 'string' ? result.status_detail : null,
      payment_status: paymentStatus,
      payment_status_detail: typeof payment.status_detail === 'string' ? payment.status_detail : null,
      is_paid: orderStatus === 'processed' && paymentStatus === 'approved',
      is_waiting: orderStatus === 'action_required' || paymentStatus === 'pending',
      message: 'Consulta somente leitura. Nenhum pedido ou estoque foi alterado.',
    });
  } catch (e) {
    console.error('MP PIX status lookup communication failed', e instanceof Error ? e.message : 'unknown');
    return reply(503, { error: 'Falha na comunicação com o Mercado Pago.' });
  }
});
