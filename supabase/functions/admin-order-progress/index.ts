// Ações de expedição, restritas a administradores autenticados.
import { createClient } from 'npm:@supabase/supabase-js@2';
const origins=new Set(['https://achadinhosdabia.github.io','http://localhost:8000','http://127.0.0.1:8000']);
const uuid=/^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
Deno.serve(async req=>{
 const origin=req.headers.get('origin')||'';
 const headers={'Access-Control-Allow-Origin':origins.has(origin)?origin:'https://achadinhosdabia.github.io','Vary':'Origin','Access-Control-Allow-Headers':'authorization,apikey,x-client-info,content-type','Access-Control-Allow-Methods':'POST, OPTIONS','Content-Type':'application/json','Cache-Control':'no-store'};
 const reply=(status:number,body:unknown)=>new Response(JSON.stringify(body),{status,headers});
 if(req.method==='OPTIONS')return new Response(null,{status:204,headers});
 if(req.method!=='POST')return reply(405,{error:'Método não permitido.'});
 if(!origins.has(origin))return reply(403,{error:'Origem não autorizada.'});
 const url=Deno.env.get('SUPABASE_URL'),anon=Deno.env.get('SUPABASE_ANON_KEY'),service=Deno.env.get('SUPABASE_SERVICE_ROLE_KEY');
 if(!url||!anon||!service)return reply(503,{error:'Configuração indisponível.'});
 try{
  const token=/^Bearer\s+(.+)$/i.exec(req.headers.get('authorization')||'')?.[1];
  if(!token)return reply(401,{error:'Login necessário.'});
  const userDb=createClient(url,anon,{global:{headers:{Authorization:'Bearer '+token}},auth:{persistSession:false,autoRefreshToken:false}});
  const {data:auth,error:authError}=await userDb.auth.getUser(token);
  if(authError||!auth.user)return reply(401,{error:'Sessão inválida.'});
  const {data:admin,error:adminError}=await userDb.from('admins').select('user_id').eq('user_id',auth.user.id).maybeSingle();
  if(adminError||!admin)return reply(403,{error:'Somente administradores.'});
  const body=await req.json();
  if(!uuid.test(body?.order_id||'')||!['prepare','ship','deliver','confirm_pix'].includes(body?.action)||body?.confirm!==true)
   return reply(400,{error:'Ação inválida.'});
  if(body.action==='ship'&&(typeof body.tracking_code!=='string'||body.tracking_code.trim().length<5||body.tracking_code.trim().length>100))
   return reply(400,{error:'Informe um rastreamento válido.'});
  if(body.action==='confirm_pix' && (typeof body.payment_reference!=='string'||body.payment_reference.trim().length<6||body.payment_reference.trim().length>200))return reply(400,{error:'Informe a referência do PIX recebido.'});
  const db=createClient(url,service,{auth:{persistSession:false}});
  const {data,error}=body.action==='confirm_pix' ? await db.rpc('confirm_direct_pix_order_admin',{p_order_id:body.order_id,p_reference:body.payment_reference.trim()}) : await db.rpc('advance_store_order_admin',{p_order_id:body.order_id,p_action:body.action,p_tracking_code:body.action==='ship'?body.tracking_code.trim():null});
  if(error){console.error('advance_store_order_admin',error.code,error.message);return reply(409,{error:'Transição não permitida para o status atual.',diagnostic_code:error.code});}
  return reply(200,{result:data});
 }catch(e){console.error('admin-order-progress',e instanceof Error?e.message:'erro');return reply(500,{error:'Não foi possível atualizar o pedido.'});}
});
