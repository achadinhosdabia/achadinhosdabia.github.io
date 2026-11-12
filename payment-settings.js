// Preferências administrativas; não ativa pagamentos nem armazena credenciais.
(() => {
 const panel=document.getElementById('admin-panel');
 if(!panel)return;
 const section=document.createElement('section');
 section.className='payment-settings';
 section.style.cssText='margin:20px 0;padding:20px;border:1px solid #e6d7e6;border-radius:14px';
 section.innerHTML='<h3>Pagamentos · Mercado Pago</h3><p>Preferências da loja. A integração ainda não está conectada: salvar estas opções não habilita cobranças.</p><form id="payment-settings-form"><label>Nome exibido da loja <input name="display_name" maxlength="100" required></label><label><input type="checkbox" name="pix_enabled"> Aceitar PIX (quando a integração estiver ativa)</label><label><input type="checkbox" name="card_enabled"> Aceitar cartão (quando a integração estiver ativa)</label><label>Prazo desejado para PIX (minutos) <input type="number" name="pix_expiration_minutes" min="15" max="1440" required></label><p id="payment-connection-status">Conta recebedora: ainda não conectada</p><p>O titular real e a conta de recebimento são definidos pelo Mercado Pago. Tokens devem ficar exclusivamente nos segredos do Supabase.</p><button type="submit" class="btn btn-primary">Salvar preferências</button><button type="button" class="btn btn-ghost" id="payment-settings-reload">Recarregar</button></form><p id="payment-settings-message" role="status"></p>';
 panel.appendChild(section);
 const testButton=document.createElement('button');
 testButton.type='button';testButton.className='btn btn-ghost';
 testButton.textContent='Testar conexão Mercado Pago';
 testButton.style.marginTop='12px';section.appendChild(testButton);
 const orderTestButton=document.createElement('button');
 orderTestButton.type='button';orderTestButton.className='btn btn-ghost';
 orderTestButton.textContent='Criar Order de teste (R$ 1,00)';
 orderTestButton.style.margin='12px 0 0 8px';section.appendChild(orderTestButton);
 const orderResult=document.createElement('div');orderResult.setAttribute('role','status');orderResult.style.marginTop='12px';section.appendChild(orderResult);
 // PIX pela Orders API: teste técnico isolado (R$ 50 fictícios), sem pedidos da loja.
 if (['localhost','127.0.0.1'].includes(location.hostname)) {
   const pixButton=document.createElement('button');
   pixButton.type='button';pixButton.className='btn btn-ghost';
   pixButton.textContent='Simular PIX pela API — Teste';
   pixButton.style.margin='12px 0 0 8px';
   section.appendChild(pixButton);
   const inspectButton=document.createElement('button');
   inspectButton.type='button';inspectButton.className='btn btn-ghost';
   inspectButton.textContent='Inspecionar PIX já criado (sem cobrar)';
   inspectButton.style.margin='12px 0 0 8px';section.appendChild(inspectButton);
   const inspectResult=document.createElement('p');
   inspectResult.setAttribute('role','status');section.appendChild(inspectResult);
   inspectButton.addEventListener('click',async()=>{
     inspectButton.disabled=true;
     inspectResult.textContent='Consultando a Order PIX anterior…';
     try{
       const client=window.getAdminSupabaseClient?.();
       if(!client)throw new Error('Cliente administrativo indisponível.');
       const {data,error}=await client.functions.invoke('mercado-pago-pix-inspect-test',{
         body:{order_id:'ORDTST01M78KKXDD6K9Q2EY2K5J872S'}
       });
       if(error){
         let detail=null;try{detail=await error.context?.json?.()}catch(_){}
         throw new Error(detail?.error||error.message||'Falha ao consultar PIX.');
       }
       if(data?.mode!=='pix_sandbox_read_only')throw new Error('Resposta inesperada.');
       inspectResult.textContent='Order: '+data.order_id+
         ' | consulta: '+(data.lookup_method==='date_search'?'busca por data':'por ID')+
         ' | status: '+data.order_status+' ('+(data.order_status_detail||'sem detalhe')+')'+
         ' | pagamento: '+data.payment_status+' ('+(data.payment_status_detail||'sem detalhe')+')'+
         ' | QR Code disponível: '+(data.has_qr_code?'sim':'não')+
         ' | imagem QR: '+(data.has_qr_image?'sim':'não')+
         ' | link de pagamento: '+(data.has_ticket_url?'sim':'não')+
         '. Nenhuma cobrança nova foi criada.';
     }catch(e){inspectResult.textContent='Inspeção não concluída: '+(e?.message||'erro desconhecido');}
     finally{inspectButton.disabled=false;}
   });
   const pixResult=document.createElement('p');
   pixResult.setAttribute('role','status');
   section.appendChild(pixResult);
   pixButton.addEventListener('click',async()=>{
     if(!window.confirm('Executar simulação PIX isolada de R$ 50,00 fictícios na API do Mercado Pago? Não altera pedidos nem estoque.'))return;
     pixButton.disabled=true;pixResult.textContent='Simulando PIX no ambiente de teste…';
     try {
       const client=window.getAdminSupabaseClient?.();
       if(!client)throw new Error('Cliente administrativo indisponível.');
       const {data:auth,error:authError}=await client.auth.getSession();
       if(authError||!auth?.session?.access_token)throw new Error('Faça login novamente.');
       const {data,error}=await client.functions.invoke('mercado-pago-pix-sandbox-test',{
         body:{request_key:crypto.randomUUID()}
       });
       if(error){
         let details=null;
         try{details=await error.context?.json?.();}catch(_){}
         throw new Error((details?.error||error.message||'Falha no teste')+
           (details?.provider_code?' · '+details.provider_code:'')+
           (details?.provider_status?' (HTTP '+details.provider_status+')':''));
       }
       if(data?.mode!=='pix_sandbox_only'||data?.amount!=='50.00')
         throw new Error('Resposta de homologação inválida.');
       pixResult.textContent='✓ Simulação PIX criada. Order: '+data.order_id+
         ' · status: '+(data.order_status||'não informado')+
         ' · pagamento: '+(data.payment_status||'não informado')+
         '. Nenhum pedido ou estoque da loja foi alterado.';
     }catch(error){pixResult.textContent='Teste PIX não concluído: '+(error?.message||'erro desconhecido');}
     finally{pixButton.disabled=false;}
   });
 }

 const form=section.querySelector('form'),msg=section.querySelector('#payment-settings-message');
 const client=()=>window.getAdminSupabaseClient?.();
 async function load(){
   if(!client())return;
   msg.textContent='Carregando preferências…';
   const {data,error}=await client().from('store_payment_settings').select('*').eq('id',1).single();
   if(error){msg.textContent='Configurações indisponíveis. Execute primeiro o SQL de instalação. '+error.message;return;}
   form.elements.display_name.value=data.display_name;
   form.elements.pix_enabled.checked=data.pix_enabled;
   form.elements.card_enabled.checked=data.card_enabled;
   form.elements.pix_expiration_minutes.value=data.pix_expiration_minutes;
   section.querySelector('#payment-connection-status').textContent='Estado da integração: '+({not_connected:'Não conectada',configured:'Configuração pendente de validação',active:'Ativa'}[data.integration_status]||'Desconhecido');
   msg.textContent='';
 }
 form.addEventListener('submit',async event=>{
   event.preventDefault();
   const minutes=Number(form.elements.pix_expiration_minutes.value);
   const name=form.elements.display_name.value.trim();
   if(!name||!Number.isInteger(minutes)||minutes<15||minutes>1440){msg.textContent='Confira nome e prazo (15 a 1440 minutos).';return;}
   const button=form.querySelector('[type=submit]');button.disabled=true;
   try{
     const {data,error}=await client().from('store_payment_settings').update({
       display_name:name,pix_enabled:form.elements.pix_enabled.checked,
       card_enabled:form.elements.card_enabled.checked,pix_expiration_minutes:minutes,
       updated_at:new Date().toISOString()
     }).eq('id',1).select('id').single();
     if(error||!data)throw Error(error?.message||'Alteração não autorizada.');
     msg.textContent='Preferências salvas. Pagamentos continuam desativados até concluir a integração.';
   }catch(e){msg.textContent='Não foi possível salvar: '+e.message;}
   finally{button.disabled=false;}
 });
 section.querySelector('#payment-settings-reload').addEventListener('click',load);
 testButton.addEventListener('click',async()=>{
   testButton.disabled=true;msg.textContent='Consultando Mercado Pago (ambiente de teste)…';
   try{
     const {data,error}=await client().functions.invoke('mercado-pago-test-connection',{body:{}});
     if(error){let detail='';try{detail=(await error.context?.json?.())?.error||'';}catch(_){}throw new Error(detail||error.message||'Falha na conexão.');}
     msg.textContent=data?.connected===true?'✓ Conexão de teste validada! Nenhuma cobrança criada.':(data?.error||'Não foi possível validar a credencial.');
   }catch(e){msg.textContent='Teste não concluído: '+(e?.message||'erro desconhecido');}
   finally{testButton.disabled=false;}
 });
 orderTestButton.addEventListener('click',async()=>{
   if(!confirm('Criar uma Order isolada de R$ 1,00 no ambiente de teste do Mercado Pago? Isso não altera pedidos nem estoque da loja.'))return;
   orderTestButton.disabled=true;orderResult.replaceChildren();orderResult.textContent='Solicitando Order de teste ao Mercado Pago…';
   try{
     const {data,error}=await client().functions.invoke('mercado-pago-create-test-order',{body:{request_key:crypto.randomUUID()}});
     if(error){let detail='';let status='';try{const response=await error.context?.json?.();detail=response?.error||'';status=response?.provider_status?' (HTTP '+response.provider_status+')':'';}catch(_){}throw new Error((detail||error.message||'Falha na requisição.')+status);}
     if(data?.mode!=='test_only'||!data?.order_id||!data?.checkout_url)throw new Error(data?.error||'Resposta incompleta da API.');
     orderResult.textContent='✓ Order de teste criada: '+data.order_id+' · ';
     const link=document.createElement('a');link.href=data.checkout_url;link.target='_blank';link.rel='noopener noreferrer';link.textContent='Abrir checkout de teste';
     if(!/^https:\/\//i.test(link.href))throw new Error('URL de checkout inválida.');
     orderResult.append(link);
   }catch(e){orderResult.textContent='Teste não concluído: '+(e?.message||'erro desconhecido');}
   finally{orderTestButton.disabled=false;}
 });
 window.refreshPaymentSettings=load;
})();
