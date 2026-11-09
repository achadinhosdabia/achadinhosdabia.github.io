// Cancelamento administrativo: não expor service_role ao navegador.
import { createClient } from 'npm:@supabase/supabase-js@2';
const origins = new Set(['https://achadinhosdabia.github.io','http://localhost:8000','http://127.0.0.1:8000']);
const uuid = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
Deno.serve(async req => {
  const origin = req.headers.get('origin') || '';
  const headers = {'Access-Control-Allow-Origin':origins.has(origin)?origin:'https://achadinhosdabia.github.io','Vary':'Origin','Access-Control-Allow-Headers':'authorization, apikey, x-client-info, content-type','Access-Control-Allow-Methods':'POST, OPTIONS','Content-Type':'application/json','Cache-Control':'no-store'};
  const reply=(status:number,data:unknown)=>new Response(JSON.stringify(data),{status,headers});
  if(req.method==='OPTIONS') return new Response(null,{status:204,headers});
  if(req.method!=='POST') return reply(405,{error:'Método não permitido.'});
  if(!origins.has(origin)) return reply(403,{error:'Origem não autorizada.'});
  const url=Deno.env.get('SUPABASE_URL'),anon=Deno.env.get('SUPABASE_ANON_KEY'),service=Deno.env.get('SUPABASE_SERVICE_ROLE_KEY');
  if(!url||!anon||!service) return reply(503,{error:'Serviço indisponível.'});
  try {
    const token=/^Bearer\s+(.+)$/i.exec(req.headers.get('authorization')||'')?.[1];
    if(!token) return reply(401,{error:'Entre como administrador.'});
    const userDb=createClient(url,anon,{global:{headers:{Authorization:'Bearer '+token}},auth:{persistSession:false,autoRefreshToken:false}});
    const {data:auth,error:authError}=await userDb.auth.getUser(token);
    if(authError||!auth.user) return reply(401,{error:'Sessão inválida.'});
    const {data:admin,error:adminError}=await userDb.from('admins').select('user_id').eq('user_id',auth.user.id).maybeSingle();
    if(adminError||!admin) return reply(403,{error:'Acesso restrito a administradores.'});
    const body=await req.json();
    if(typeof body?.order_id!=='string'||!uuid.test(body.order_id)) return reply(400,{error:'Pedido inválido.'});
    if(body?.confirm!==true) return reply(400,{error:'Confirmação obrigatória.'});
    const db=createClient(url,service,{auth:{persistSession:false}});
    const {data,error}=await db.rpc('cancel_store_order_admin',{p_order_id:body.order_id,p_reason:'Cancelamento manual pelo painel'});
    if(error){console.error('cancel_store_order_admin',{code:error.code,message:error.message,details:error.details,hint:error.hint});return reply(409,{error:'O servidor recusou o cancelamento. Consulte os logs da função.',diagnostic_code:error.code||'RPC_UNKNOWN'});}
    return reply(200,{result:data});
  }catch(err){console.error('Falha no cancelamento',err instanceof Error?err.message:'erro');return reply(500,{error:'Falha ao processar cancelamento.'});}
});
