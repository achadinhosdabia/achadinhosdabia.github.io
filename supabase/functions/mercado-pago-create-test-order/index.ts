// Cria somente uma Order de TESTE isolada no Mercado Pago.
// Não acessa produtos, estoque nem pedidos da loja. Acesso administrativo obrigatório.
import { createClient } from 'npm:@supabase/supabase-js@2';
const origins=new Set(['https://achadinhosdabia.github.io','http://localhost:8000','http://127.0.0.1:8000']);
Deno.serve(async(req:Request)=>{
 const origin=req.headers.get('origin')||'';
 const headers={'Access-Control-Allow-Origin':origins.has(origin)?origin:'https://achadinhosdabia.github.io','Access-Control-Allow-Headers':'authorization,apikey,content-type,x-client-info','Access-Control-Allow-Methods':'POST,OPTIONS','Content-Type':'application/json','Cache-Control':'no-store','Vary':'Origin'};
 const reply=(status:number,data:unknown)=>new Response(JSON.stringify(data),{status,headers});
 if(req.method==='OPTIONS')return new Response(null,{status:204,headers});
 if(req.method!=='POST')return reply(405,{error:'Método não permitido.'});
 if(!origins.has(origin))return reply(403,{error:'Origem não autorizada.'});
 const url=Deno.env.get('SUPABASE_URL'),anon=Deno.env.get('SUPABASE_ANON_KEY'),accessToken=Deno.env.get('MERCADO_PAGO_ACCESS_TOKEN_TEST');
 if(!url||!anon||!accessToken)return reply(503,{error:'Credenciais de teste não configuradas.'});
 const jwt=/^Bearer\s+(.+)$/i.exec(req.headers.get('authorization')||'')?.[1];
 if(!jwt)return reply(401,{error:'Login administrativo obrigatório.'});
 const client=createClient(url,anon,{global:{headers:{Authorization:'Bearer '+jwt}},auth:{persistSession:false,autoRefreshToken:false}});
 const {data:auth,error:authError}=await client.auth.getUser(jwt);
 if(authError||!auth.user)return reply(401,{error:'Sessão inválida.'});
 const {data:admin,error:adminError}=await client.from('admins').select('user_id').eq('user_id',auth.user.id).maybeSingle();
 if(adminError||!admin)return reply(403,{error:'Somente administradores.'});
 let input:unknown;
 try{input=await req.json();}catch{return reply(400,{error:'Corpo inválido.'});}
 const key=(input as {request_key?:unknown})?.request_key;
 if(typeof key!=='string'||!/^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i.test(key))return reply(400,{error:'Identificador idempotente inválido.'});
 const payload={
  type:'online',processing_mode:'manual',total_amount:'1.00',
  external_reference:'bia_test_'+key.replaceAll('-','').slice(0,24),
  description:'Teste isolado de integracao Achadinhos da BIA',
  items:[{title:'Teste tecnico - nao e produto da loja',unit_price:'1.00',quantity:1}]
 };
 try{
  const response=await fetch('https://api.mercadopago.com/v1/orders',{
   method:'POST',
   headers:{Authorization:'Bearer '+accessToken,'Content-Type':'application/json',Accept:'application/json','X-Idempotency-Key':key},
   body:JSON.stringify(payload),signal:AbortSignal.timeout(15000)
  });
  const result=await response.json().catch(()=>({}));
  if(!response.ok){
   console.error('Mercado Pago sandbox create order',response.status,JSON.stringify(result).slice(0,1500));
   return reply(502,{error:'Mercado Pago recusou a criação da Order de teste.',provider_status:response.status,provider_code:typeof result?.code==='string'?result.code:null});
  }
  if(typeof result.id!=='string'||typeof result.checkout_url!=='string')return reply(502,{error:'Resposta do Mercado Pago sem ID ou checkout_url.'});
  return reply(201,{mode:'test_only',order_id:result.id,checkout_url:result.checkout_url,status:result.status||'created',amount:'1.00',message:'Order criada no ambiente de teste. Não existe pedido correspondente na loja.'});
 }catch(error){console.error('Mercado Pago sandbox network error',error instanceof Error?error.message:'unknown');return reply(503,{error:'Falha de comunicação com Mercado Pago.'});}
});
