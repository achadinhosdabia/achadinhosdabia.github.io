// Webhook Mercado Pago Orders — somente ambiente de teste.
// Verifica assinatura HMAC e consulta a Order. Não atualiza pedidos nem estoque.
const encoder = new TextEncoder();
function json(status:number, body:unknown){return new Response(JSON.stringify(body),{status,headers:{"content-type":"application/json","cache-control":"no-store"}});}
function safeEqual(a:string,b:string){if(a.length!==b.length)return false;let mismatch=0;for(let i=0;i<a.length;i++)mismatch|=a.charCodeAt(i)^b.charCodeAt(i);return mismatch===0;}
function validId(value:string){return /^[a-zA-Z0-9_-]{1,100}$/.test(value);}
Deno.serve(async(request:Request)=>{
 if(request.method!=="POST")return json(405,{error:"Method not allowed"});
 const secret=Deno.env.get("MERCADO_PAGO_WEBHOOK_SECRET_TEST");
 const token=Deno.env.get("MERCADO_PAGO_ACCESS_TOKEN_TEST");
 if(!secret||!token)return json(503,{error:"Webhook not configured"});
 const signature=request.headers.get("x-signature")||"";
 const requestId=request.headers.get("x-request-id")||"";
 const ts=/\bts=([0-9]+)\b/.exec(signature)?.[1];
 const received=/\bv1=([a-f0-9]{64})\b/i.exec(signature)?.[1]?.toLowerCase();
 if(!ts||!received||!requestId||requestId.length>256){console.warn("MP webhook rejected: missing or malformed signature headers",{hasTimestamp:!!ts,hasDigest:!!received,hasRequestId:!!requestId,requestIdTooLong:requestId.length>256});return json(401,{error:"Invalid signature"});}
 const timestamp=Number(ts);
 if(!Number.isSafeInteger(timestamp)||Math.abs(Date.now()-timestamp*1000)>10*60*1000){console.warn("MP webhook rejected: invalid or expired timestamp",{timestampIsInteger:Number.isSafeInteger(timestamp),ageSeconds:Number.isSafeInteger(timestamp)?Math.round((Date.now()-timestamp*1000)/1000):null});return json(401,{error:"Expired signature"});}
 const url=new URL(request.url);
 const queryId=url.searchParams.get("data.id");
 let payload:Record<string,unknown>;
 try{const raw=await request.text();if(raw.length>65536)return json(413,{error:"Payload too large"});const parsed=JSON.parse(raw);if(!parsed||typeof parsed!=="object"||Array.isArray(parsed))return json(400,{error:"Invalid payload"});payload=parsed;}catch{return json(400,{error:"Invalid JSON"});}
 const bodyData=payload.data && typeof payload.data==="object" ? payload.data as Record<string,unknown> : {};
 const bodyId=typeof bodyData.id==="string"?bodyData.id:typeof bodyData.id==="number"?String(bodyData.id):"";
 if(queryId&&bodyId&&queryId!==bodyId)return json(400,{error:"Mismatched notification ID"});
 const orderId=queryId||bodyId;
 if(!orderId||!validId(orderId))return json(400,{error:"Invalid Order ID"});
 // O Mercado Pago assina o data.id recebido na query; quando não enviado, usa o id do corpo.
 // Para IDs alfanuméricos, preserva a capitalização original na assinatura HMAC.
 const manifest=`id:${orderId};request-id:${requestId};ts:${ts};`;
 const key=await crypto.subtle.importKey("raw",encoder.encode(secret),{name:"HMAC",hash:"SHA-256"},false,["sign"]);
 const mac=await crypto.subtle.sign("HMAC",key,encoder.encode(manifest));
 const expected=Array.from(new Uint8Array(mac),x=>x.toString(16).padStart(2,"0")).join("");
 if(!safeEqual(received,expected)){
  // Diagnóstico seguro: compara variantes de canonicalização sem aceitá-las.
  // Nunca registra segredos, assinaturas, IDs de requisição ou conteúdo da Order.
  async function matchesManifest(id:string, normalized:boolean){
   const candidate=`id:${normalized?id.toLowerCase():id};request-id:${requestId};ts:${ts};`;
   const signed=await crypto.subtle.sign("HMAC",key,encoder.encode(candidate));
   const hex=Array.from(new Uint8Array(signed),x=>x.toString(16).padStart(2,"0")).join("");
   return safeEqual(received,hex);
  }
  console.warn("MP webhook rejected: HMAC mismatch",{
   eventType:String(payload.type||payload.topic||"").slice(0,40),
   hasQueryId:!!queryId,hasBodyId:!!bodyId,
   matchesOriginalCase:await matchesManifest(orderId,false),
   matchesBodyLowercase:bodyId?await matchesManifest(bodyId,true):false,
   matchesBodyOriginalCase:bodyId?await matchesManifest(bodyId,false):false,
  });
  return json(401,{error:"Invalid signature"});
 }
 const topic=String(payload.type||payload.topic||"").toLowerCase();
 if(topic&&topic!=="order"&&topic!=="orders")return json(200,{received:true,ignored:true});
 try{
  const response=await fetch("https://api.mercadopago.com/v1/orders/"+encodeURIComponent(orderId),{headers:{Authorization:"Bearer "+token,Accept:"application/json"},signal:AbortSignal.timeout(10000)});
  if(!response.ok){console.error("MP test webhook: provider lookup status",response.status);return json(503,{error:"Provider verification unavailable"});}
  const order=await response.json();
  if(String(order?.id)!==orderId)return json(502,{error:"Provider Order mismatch"});
  // Apenas sinaliza o recebimento seguro. Nenhum pedido da loja é modificado.
  console.info("MP test webhook verified Order",orderId,"status",String(order?.status||"unknown"));
  return json(200,{received:true,verified:true,mode:"test_only"});
 }catch(error){console.error("MP test webhook provider request failed",error instanceof Error?error.message:"unknown");return json(503,{error:"Provider verification unavailable"});}
});
