// Consulta SOMENTE LEITURA de Order PIX de homologação já criada.
// Não gera cobrança, não altera pedido/estoque e não aprova pagamentos.
import { createClient } from 'npm:@supabase/supabase-js@2';
const origins = new Set(['http://localhost:8000','http://127.0.0.1:8000']);
Deno.serve(async (req: Request) => {
 const origin=req.headers.get('origin')||'';
 const headers={'Access-Control-Allow-Origin':origins.has(origin)?origin:'http://localhost:8000',
  'Access-Control-Allow-Headers':'authorization,apikey,content-type,x-client-info',
  'Access-Control-Allow-Methods':'POST,OPTIONS','Content-Type':'application/json','Cache-Control':'no-store','Vary':'Origin'};
 const reply=(status:number,data:unknown)=>new Response(JSON.stringify(data),{status,headers});
 if(req.method==='OPTIONS')return new Response(null,{status:204,headers});
 if(req.method!=='POST')return reply(405,{error:'Método não permitido.'});
 if(!origins.has(origin))return reply(403,{error:'Somente ambiente local.'});
 if(Deno.env.get('MP_PIX_SANDBOX_TEST_ENABLED')!=='true')return reply(503,{error:'Diagnóstico PIX desabilitado.'});
 const url=Deno.env.get('SUPABASE_URL'),anon=Deno.env.get('SUPABASE_ANON_KEY'),token=Deno.env.get('MERCADO_PAGO_ACCESS_TOKEN_TEST');
 if(!url||!anon||!token)return reply(503,{error:'Configuração incompleta.'});
 const jwt=/^Bearer\s+(.+)$/i.exec(req.headers.get('authorization')||'')?.[1];
 if(!jwt)return reply(401,{error:'Login obrigatório.'});
 const db=createClient(url,anon,{global:{headers:{Authorization:'Bearer '+jwt}},auth:{persistSession:false,autoRefreshToken:false}});
 const {data:auth,error:authError}=await db.auth.getUser(jwt);
 if(authError||!auth.user)return reply(401,{error:'Sessão inválida.'});
 const {data:admin,error:adminError}=await db.from('admins').select('user_id').eq('user_id',auth.user.id).maybeSingle();
 if(adminError||!admin)return reply(403,{error:'Somente administradores.'});
 let body:{order_id?:unknown};
 try{body=await req.json()}catch{return reply(400,{error:'JSON inválido.'})}
 const id=body?.order_id;
 if(typeof id!=='string'||!/^ORDTST[A-Z0-9]{8,60}$/.test(id))return reply(400,{error:'Identificador de Order de teste inválido.'});
 try{
  const response=await fetch('https://api.mercadopago.com/v1/orders/'+encodeURIComponent(id),{
   headers:{Authorization:'Bearer '+token,Accept:'application/json'},signal:AbortSignal.timeout(12000)});
  if(!response.ok){
   // Retorna apenas campos de diagnóstico não sensíveis, nunca o corpo integral do provedor.
   const raw=await response.text();
   let parsed:unknown=null;
   try{parsed=JSON.parse(raw)}catch(_){}
   const record=parsed&&typeof parsed==='object'&&!Array.isArray(parsed)
     ?parsed as Record<string,unknown>:{};
   // Erros da Orders API podem estar em errors[] (não apenas code/message na raiz).
   const safeCode=(v:unknown)=>typeof v==='string'||typeof v==='number'
     ?String(v).replace(/[^a-zA-Z0-9_.-]/g,'').slice(0,80):null;
   const safeMessage=(v:unknown)=>typeof v==='string'
     ?v.replace(/[\\r\\n]/g,' ').slice(0,180):null;
   const nested=Array.isArray(record.errors)?record.errors:
     Array.isArray(record.cause)?record.cause:[];
   const nestedDetails=nested.slice(0,3).map((item:unknown)=>{
     const obj=item&&typeof item==='object'&&!Array.isArray(item)
       ?item as Record<string,unknown>:{};
     return {code:safeCode(obj.code),message:safeMessage(obj.message||obj.description)};
   });
   const diagnostic={
     provider_status:response.status,
     provider_code:safeCode(record.code||record.error),
     provider_message:safeMessage(record.message||record.description),
     provider_errors:nestedDetails,
     provider_response_fields:Object.keys(record).slice(0,12),
     provider_content_type:(response.headers.get('content-type')||'').split(';')[0].slice(0,60),
     provider_body_kind:!raw.trim()?'empty':parsed===null?'non_json':
       Array.isArray(parsed)?'json_array':typeof parsed==='object'?'json_object':typeof parsed,
     provider_body_length:raw.length,
   };
   if(response.status===400&&nestedDetails.some(x=>x.code==='invalid_path_param')){
     return reply(422,{error:'O Mercado Pago não aceitou o identificador de teste ORDTST na consulta por ID. Não altere o identificador; consulte os dados da resposta original de criação.',order_id:id,provider_status:400,provider_code:'invalid_path_param'});
   }
   console.warn('MP PIX inspection rejected',diagnostic);
   return reply(502,{error:'Não foi possível consultar a Order no Mercado Pago.',...diagnostic});
  }
  const order=await response.json();
  if(order?.id!==id||typeof order?.external_reference!=='string'||!order.external_reference.startsWith('bia_pix_sandbox_'))
   return reply(403,{error:'Esta Order não pertence ao diagnóstico PIX isolado.'});
  const payment=order?.transactions?.payments?.[0];
  if(!payment||payment?.payment_method?.id!=='pix')return reply(409,{error:'A Order consultada não é PIX.'});
  const pm=payment.payment_method||{};
  const tx=payment.transaction_details||{};
  const qrCode=typeof pm.qr_code==='string'?pm.qr_code:typeof tx.qr_code==='string'?tx.qr_code:null;
  const qrBase64=typeof pm.qr_code_base64==='string'?pm.qr_code_base64:typeof tx.qr_code_base64==='string'?tx.qr_code_base64:null;
  const ticketUrl=typeof pm.ticket_url==='string'?pm.ticket_url:typeof tx.external_resource_url==='string'?tx.external_resource_url:null;
  return reply(200,{mode:'pix_sandbox_read_only',order_id:id,order_status:order.status||null,
   payment_status:payment.status||null,payment_id:payment.id||null,
   has_qr_code:!!qrCode,has_qr_image:!!qrBase64,has_ticket_url:!!ticketUrl,
   // Não retornar códigos pagáveis nesta ferramenta de diagnóstico.
   message:'Consulta concluída sem criar cobranças ou modificar a loja.'});
 }catch(e){console.error('PIX sandbox lookup failed',e instanceof Error?e.message:'unknown');return reply(503,{error:'Falha ao consultar Mercado Pago.'})}
});
