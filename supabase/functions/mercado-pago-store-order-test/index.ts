// Homologação: cria uma Order Mercado Pago TESTE para um pedido já existente.
// Somente administrador; não altera estoque nem confirma pagamento.
// Requer MP_STORE_ORDER_TEST_ENABLED=true para habilitar explicitamente.
import { createClient } from 'npm:@supabase/supabase-js@2';

const origins = new Set(['https://achadinhosdabia.github.io','http://localhost:8000','http://127.0.0.1:8000']);
const uuid = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
Deno.serve(async (req: Request) => {
  const origin = req.headers.get('origin') || '';
  const headers = {
    'Access-Control-Allow-Origin': origins.has(origin) ? origin : 'https://achadinhosdabia.github.io',
    'Access-Control-Allow-Headers': 'authorization,apikey,content-type,x-client-info',
    'Access-Control-Allow-Methods': 'POST,OPTIONS',
    'Content-Type': 'application/json',
    'Cache-Control': 'no-store',
    'Vary': 'Origin',
  };
  const reply = (status: number, data: unknown) => new Response(JSON.stringify(data), {status, headers});
  if (req.method === 'OPTIONS') return new Response(null, {status: 204, headers});
  if (req.method !== 'POST') return reply(405, {error:'Método não permitido.'});
  if (!origins.has(origin)) return reply(403, {error:'Origem não autorizada.'});
  if (Deno.env.get('MP_STORE_ORDER_TEST_ENABLED') !== 'true')
    return reply(503, {error:'Homologação de pagamento de pedidos desabilitada.'});
  const url = Deno.env.get('SUPABASE_URL');
  const anon = Deno.env.get('SUPABASE_ANON_KEY');
  const service = Deno.env.get('SUPABASE_SERVICE_ROLE_KEY');
  const token = Deno.env.get('MERCADO_PAGO_ACCESS_TOKEN_TEST');
  if (!url || !anon || !service || !token) return reply(503, {error:'Configuração incompleta.'});
  const jwt = /^Bearer\s+(.+)$/i.exec(req.headers.get('authorization') || '')?.[1];
  if (!jwt) return reply(401, {error:'Login administrativo obrigatório.'});
  const userDb = createClient(url, anon, {
    global:{headers:{Authorization:'Bearer '+jwt}},
    auth:{persistSession:false,autoRefreshToken:false},
  });
  const {data:auth,error:authError} = await userDb.auth.getUser(jwt);
  if (authError || !auth.user) return reply(401, {error:'Sessão inválida.'});
  const {data:admin,error:adminError} = await userDb.from('admins').select('user_id').eq('user_id',auth.user.id).maybeSingle();
  if (adminError || !admin) return reply(403, {error:'Somente administradores.'});
  let input: {order_id?:unknown};
  try {input = await req.json();} catch {return reply(400, {error:'JSON inválido.'});}
  const id = input?.order_id;
  if (typeof id !== 'string' || !uuid.test(id)) return reply(400, {error:'Pedido inválido.'});
  const db = createClient(url, service, {auth:{persistSession:false,autoRefreshToken:false}});
  const {data:order,error:orderError} = await db.from('orders')
    .select('id,order_number,total,payment_method,payment_status,order_status,payment_expires_at')
    .eq('id',id).maybeSingle();
  if (orderError) {
    console.error('MP store order lookup failed', {code:orderError.code, message:orderError.message});
    return reply(503, {error:'Falha ao consultar pedido.', diagnostic_code:orderError.code || 'UNKNOWN'});
  }
  if (!order) return reply(404, {error:'Pedido não encontrado.'});
  if (order.payment_method !== 'mercado_pago' || order.payment_status !== 'pending' ||
      order.order_status !== 'pending_payment' ||
      !order.payment_expires_at || Date.parse(order.payment_expires_at) <= Date.now())
    return reply(409, {error:'Pedido não está elegível para pagamento de teste.'});
  const amount = Number(order.total);
  if (!Number.isFinite(amount) || amount < 1 || amount > 100000)
    return reply(409, {error:'Valor do pedido fora dos limites de homologação.'});
  const {data:items,error:itemsError} = await db.from('order_items')
    .select('product_name,quantity,unit_price').eq('order_id',id);
  if (itemsError || !items?.length) return reply(409, {error:'Itens do pedido indisponíveis.'});
  // O total cobrado vem exclusivamente do pedido persistido, nunca do navegador.
  // Uma linha de cobrança evita diferenças de arredondamento com frete.
  const payload = {
    type:'online',
    processing_mode:'manual',
    total_amount:amount.toFixed(2),
    external_reference:'bia_order_test_'+id,
    description:'Achadinhos da BIA - pedido de homologacao '+order.order_number,
    items:[{title:'Pedido '+order.order_number+' (produtos e frete)',unit_price:amount.toFixed(2),quantity:1}],
  };
  try {
    const response = await fetch('https://api.mercadopago.com/v1/orders',{
      method:'POST',
      headers:{
        Authorization:'Bearer '+token,
        'Content-Type':'application/json',
        Accept:'application/json',
        'X-Idempotency-Key':id,
      },
      body:JSON.stringify(payload),
      signal:AbortSignal.timeout(15000),
    });
    const result = await response.json().catch(()=>({}));
    if (!response.ok) {
      console.error('MP store sandbox order failed',response.status,typeof result?.code==='string'?result.code:'unknown');
      return reply(502,{error:'Mercado Pago recusou a Order de teste.',provider_status:response.status});
    }
    if (typeof result.id !== 'string' || typeof result.checkout_url !== 'string' ||
        !/^https:\/\//i.test(result.checkout_url))
      return reply(502,{error:'Resposta do Mercado Pago incompleta.'});
    return reply(201,{
      mode:'test_only',store_order_id:id,mp_order_id:result.id,
      checkout_url:result.checkout_url,amount:amount.toFixed(2),
      message:'Order de teste criada. Pedido e estoque não foram alterados por esta função.',
    });
  } catch (error) {
    console.error('MP store sandbox network failure',error instanceof Error?error.message:'unknown');
    return reply(503,{error:'Falha de comunicação com Mercado Pago.'});
  }
});
