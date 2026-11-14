// Consulta SOMENTE LEITURA de PIX real de homologação. Não cria cobrança nem altera pedidos.
import { createClient } from 'npm:@supabase/supabase-js@2';
const origins = new Set(['http://localhost:8000', 'http://127.0.0.1:8000']);
const orderIdPattern = /^ORD[A-Z0-9]{20,40}$/;
const referencePattern = /^bia_pix_real_test_[0-9a-f]{32}$/;

Deno.serve(async (req: Request) => {
  const origin = req.headers.get('origin') || '';
  const headers = {
    'Access-Control-Allow-Origin': origins.has(origin) ? origin : 'http://localhost:8000',
    'Access-Control-Allow-Headers': 'authorization,apikey,content-type,x-client-info',
    'Access-Control-Allow-Methods': 'POST,OPTIONS',
    'Content-Type': 'application/json; charset=utf-8',
    'Cache-Control': 'no-store', 'Vary': 'Origin',
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
    const providerHeaders = { Authorization: 'Bearer ' + token, Accept: 'application/json' };
    const direct = await fetch('https://api.mercadopago.com/v1/orders/' + encodeURIComponent(orderId), {
      method: 'GET', headers: providerHeaders, signal: AbortSignal.timeout(15000),
    });
    let result: Record<string, any> | null = null;
    let lookupMethod = 'by_id';
    let searchStatus: number | null = null;
    if (direct.ok) {
      result = await direct.json().catch(() => null);
    } else if (direct.status === 404) {
      // Busca oficial por data para diferenciar Order não encontrada de falha no GET por ID.
      lookupMethod = 'date_search';
      const now = Date.now();
      const begin = new Date(now - 48 * 60 * 60 * 1000).toISOString();
      const end = new Date(now).toISOString();
      let candidate: Record<string, any> | null = null;
      const nearMatches: string[] = [];
      for (let page = 1; page <= 3; page++) {
        const params = new URLSearchParams({
          begin_date: begin, end_date: end, type: 'online',
          page: String(page), page_size: '100',
          sort_by: 'created_date', sort_order: 'desc',
        });
        const response = await fetch('https://api.mercadopago.com/v1/orders?' + params.toString(), {
          method: 'GET', headers: providerHeaders, signal: AbortSignal.timeout(15000),
        });
        searchStatus = response.status;
        if (!response.ok) {
          const providerError = await response.json().catch(() => ({}));
          console.warn('MP PIX search unavailable', response.status, String(providerError?.code || 'unknown').slice(0, 80));
          break;
        }
        const list = await response.json().catch(() => ({}));
        const orders = Array.isArray(list?.data) ? list.data : [];
        for (const order of orders) {
          if (typeof order?.id !== 'string') continue;
          if (order.id === orderId) { candidate = order; break; }
          if (referencePattern.test(String(order?.external_reference || '')) &&
              Math.round(Number(order?.total_amount) * 100) === 100)
            nearMatches.push(order.id);
        }
        if (candidate || orders.length < 100) break;
      }
      if (candidate) result = candidate;
      else {
        const unique = [...new Set(nearMatches)];
        return reply(404, {
          error: unique.length === 1
            ? 'A Order informada não foi encontrada, mas existe um PIX de teste de R$ 1,00 com outro ID. Confira o identificador.'
            : 'A Order não foi encontrada nem por ID nem na busca recente. Confira a conta e o token de produção utilizados na criação.',
          provider_status: direct.status,
          search_status: searchStatus,
          possible_order_id: unique.length === 1 ? unique[0] : null,
          no_new_charge: true,
        });
      }
    } else {
      const providerError = await direct.json().catch(() => ({}));
      const code = typeof providerError?.code === 'string' ? providerError.code : null;
      console.warn('MP PIX lookup rejected', direct.status, code);
      return reply(502, {
        error: 'Mercado Pago recusou a consulta da Order.',
        provider_status: direct.status, provider_code: code,
      });
    }
    const reference = result?.external_reference;
    const amount = Number(result?.total_amount);
    const payment = result?.transactions?.payments?.[0];
    if (result?.id !== orderId || typeof reference !== 'string' ||
        !referencePattern.test(reference) ||
        !Number.isFinite(amount) || Math.round(amount * 100) !== 100)
      return reply(409, { error: 'A Order encontrada não corresponde ao PIX isolado de R$ 1,00.' });
    // A busca por data pode omitir transactions. Sem a transação não confirmar pagamento.
    if (payment && payment?.payment_method?.id !== 'pix')
      return reply(409, { error: 'A transação encontrada não é PIX.' });
    const orderStatus = typeof result?.status === 'string' ? result.status : null;
    const paymentStatus = typeof payment?.status === 'string' ? payment.status : null;
    const paidAmount = Number(result?.total_paid_amount);
    const isPaid = orderStatus === 'processed' &&
      (paymentStatus === 'processed' || paymentStatus === 'approved') &&
      Number.isFinite(paidAmount) && Math.round(paidAmount * 100) === 100;
    return reply(200, {
      mode: 'pix_real_status_read_only',
      order_id: orderId, lookup_method: lookupMethod, amount: '1.00',
      order_status: orderStatus,
      order_status_detail: typeof result?.status_detail === 'string' ? result.status_detail : null,
      payment_status: paymentStatus,
      payment_status_detail: typeof payment?.status_detail === 'string' ? payment.status_detail : null,
      is_paid: isPaid,
      is_waiting: orderStatus === 'action_required' || paymentStatus === 'action_required' || paymentStatus === 'pending',
      payment_details_available: Boolean(payment),
      message: 'Consulta somente leitura. Nenhum pedido ou estoque foi alterado.',
    });
  } catch (e) {
    console.error('MP PIX status lookup communication failed', e instanceof Error ? e.message : 'unknown');
    return reply(503, { error: 'Falha na comunicação com o Mercado Pago.' });
  }
});
