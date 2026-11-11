// Diagnóstico seguro da credencial de TESTE do Mercado Pago.
// Não cria Orders, pagamentos, pedidos ou reservas de estoque.
import { createClient } from 'npm:@supabase/supabase-js@2';
const origins = new Set(['https://achadinhosdabia.github.io','http://localhost:8000','http://127.0.0.1:8000']);
Deno.serve(async (req: Request) => {
  const origin=req.headers.get('origin')||'';
  const headers={
    'Access-Control-Allow-Origin':origins.has(origin)?origin:'https://achadinhosdabia.github.io',
    'Access-Control-Allow-Headers':'authorization,apikey,content-type,x-client-info',
    'Access-Control-Allow-Methods':'POST,OPTIONS',
    'Content-Type':'application/json',
    'Cache-Control':'no-store',
    'Vary':'Origin'
  };
  const reply=(status:number,body:unknown)=>new Response(JSON.stringify(body),{status,headers});
  if(req.method==='OPTIONS')return new Response(null,{status:204,headers});
  if(req.method!=='POST')return reply(405,{error:'Método não permitido.'});
  if(!origins.has(origin))return reply(403,{error:'Origem não autorizada.'});
  const url=Deno.env.get('SUPABASE_URL');
  const anon=Deno.env.get('SUPABASE_ANON_KEY');
  const token=Deno.env.get('MERCADO_PAGO_ACCESS_TOKEN_TEST');
  if(!url||!anon)return reply(503,{error:'Supabase não configurado.'});
  const jwt=/^Bearer\s+(.+)$/i.exec(req.headers.get('authorization')||'')?.[1];
  if(!jwt)return reply(401,{error:'Entre como administrador.'});
  const client=createClient(url,anon,{global:{headers:{Authorization:'Bearer '+jwt}},auth:{persistSession:false,autoRefreshToken:false}});
  const {data:auth,error:authError}=await client.auth.getUser(jwt);
  if(authError||!auth.user)return reply(401,{error:'Sessão inválida.'});
  const {data:admin,error:adminError}=await client.from('admins').select('user_id').eq('user_id',auth.user.id).maybeSingle();
  if(adminError||!admin)return reply(403,{error:'Acesso restrito a administradores.'});
  if(!token)return reply(503,{error:'Secret MERCADO_PAGO_ACCESS_TOKEN_TEST não encontrado.'});
  try{
    const response=await fetch('https://api.mercadopago.com/users/me',{
      method:'GET',headers:{Authorization:'Bearer '+token,Accept:'application/json'},
      signal:AbortSignal.timeout(12000)
    });
    if(!response.ok)return reply(502,{connected:false,error:'Mercado Pago não validou a credencial de teste.',provider_status:response.status});
    return reply(200,{connected:true,environment:'test',message:'Credencial aceita pelo Mercado Pago. Nenhuma cobrança foi criada.'});
  }catch{return reply(503,{connected:false,error:'Não foi possível consultar o Mercado Pago.'});}
});
