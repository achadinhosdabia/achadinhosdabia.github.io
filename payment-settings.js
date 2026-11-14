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
 // Teste controlado de PIX REAL, sem usar a simulação APRO nem alterar pedidos.
 if (['localhost','127.0.0.1'].includes(location.hostname)) {
   const pixButton=document.createElement('button');
   pixButton.type='button';pixButton.className='btn btn-ghost';
   pixButton.textContent='Gerar PIX real de R$ 1,00 — Teste controlado';
   pixButton.style.margin='12px 0 0 8px';section.appendChild(pixButton);
   const pixResult=document.createElement('div');
   pixResult.setAttribute('role','status');pixResult.style.marginTop='12px';
   section.appendChild(pixResult);
   let requestKey=null;
   pixButton.addEventListener('click',async()=>{
     if(!window.confirm('ATENÇÃO: será criada uma cobrança PIX REAL de R$ 1,00 na conta da loja. Não pague ainda. Não altera pedidos nem estoque. Deseja continuar?'))return;
     if(!requestKey)requestKey=crypto.randomUUID();
     pixButton.disabled=true;
     pixResult.replaceChildren();
     pixResult.textContent='Solicitando PIX real ao Mercado Pago…';
     try{
       const client=window.getAdminSupabaseClient?.();
       if(!client)throw new Error('Cliente administrativo indisponível.');
       const {data,error}=await client.functions.invoke('mercado-pago-pix-real-test',{
         body:{request_key:requestKey}
       });
       if(error){
         let details=null;try{details=await error.context?.json?.()}catch(_){}
         throw new Error((details?.error||error.message||'Falha na criação do PIX')+
           (details?.provider_code?' · '+details.provider_code:'')+
           (details?.provider_status?' (HTTP '+details.provider_status+')':''));
       }
       if(data?.mode!=='pix_real_admin_test'||data?.amount!=='1.00')
         throw new Error('Resposta inesperada do serviço PIX.');
       statusInput.value=data.order_id;
       try{sessionStorage.setItem('bia_pix_real_last_order_id',data.order_id);}catch(_){}
       pixResult.replaceChildren();
       const summary=document.createElement('p');
       summary.textContent='Order: '+data.order_id+
         ' | status: '+(data.order_status||'não informado')+
         ' | detalhe: '+(data.order_status_detail||data.payment_status_detail||'não informado');
       pixResult.appendChild(summary);
       if(!data.has_pix){
         const pending=document.createElement('p');
         pending.textContent='O Mercado Pago ainda não disponibilizou QR Code ou link PIX. Não crie outra cobrança: envie esta mensagem para análise.';
         pixResult.appendChild(pending);
         return;
       }
       const note=document.createElement('p');
       note.textContent='PIX gerado! Teste real de R$ 1,00. Não pague até validarmos a integração.';
       pixResult.appendChild(note);
       if(data.qr_code_base64){
         const img=document.createElement('img');
         img.alt='QR Code PIX de R$ 1,00';
         img.src='data:image/png;base64,'+data.qr_code_base64;
         img.style.cssText='display:block;width:220px;max-width:100%;margin:12px 0';
         pixResult.appendChild(img);
       }
       if(data.qr_code){
         const label=document.createElement('label');
         label.textContent='PIX Copia e Cola';
         const code=document.createElement('textarea');
         code.readOnly=true;code.rows=3;code.value=data.qr_code;
         code.style.cssText='display:block;width:100%;max-width:560px;margin:8px 0';
         label.appendChild(code);pixResult.appendChild(label);
         const copy=document.createElement('button');
         copy.type='button';copy.className='btn btn-ghost';copy.textContent='Copiar código PIX';
         copy.addEventListener('click',async()=>{
           try{await navigator.clipboard.writeText(data.qr_code);copy.textContent='Copiado!';}
           catch(_){code.select();copy.textContent='Selecione e copie o código acima';}
         });
         pixResult.appendChild(copy);
       }
       if(data.ticket_url){
         const link=document.createElement('a');
         link.href=data.ticket_url;link.target='_blank';link.rel='noopener noreferrer';
         link.textContent='Abrir instruções do PIX no Mercado Pago';
         link.style.cssText='display:block;margin:12px 0';
         pixResult.appendChild(link);
       }
     }catch(e){pixResult.textContent='PIX não concluído: '+(e?.message||'erro desconhecido');}
     finally{pixButton.disabled=false;}
   });
   // Consultar a mesma cobrança real, sem gerar uma nova.
   const statusBox=document.createElement('div');
   statusBox.style.cssText='margin-top:18px;padding-top:12px;border-top:1px solid #e6d7e6';
   const statusLabel=document.createElement('label');
   statusLabel.textContent='Order do PIX de R$ 1,00 (já criado)';
   const statusInput=document.createElement('input');
   statusInput.type='text';statusInput.maxLength=50;
   statusInput.placeholder='ORD...';
   statusInput.style.cssText='display:block;width:100%;max-width:480px;margin:8px 0';
   try{statusInput.value=sessionStorage.getItem('bia_pix_real_last_order_id')||'';}catch(_){}
   statusLabel.appendChild(statusInput);statusBox.appendChild(statusLabel);
   const statusButton=document.createElement('button');
   statusButton.type='button';statusButton.className='btn btn-ghost';
   statusButton.textContent='Consultar status do PIX existente';
   statusBox.appendChild(statusButton);
   const statusResult=document.createElement('p');
   statusResult.setAttribute('role','status');statusBox.appendChild(statusResult);
   section.appendChild(statusBox);
   statusButton.addEventListener('click',async()=>{
     const id=statusInput.value.trim().toUpperCase();
     if(!/^ORD[A-Z0-9]{20,40}$/.test(id)){
       statusResult.textContent='Informe a Order do PIX de R$ 1,00.';return;
     }
     statusButton.disabled=true;statusResult.textContent='Consultando Mercado Pago (sem gerar cobrança)…';
     try{
       const client=window.getAdminSupabaseClient?.();
       if(!client)throw new Error('Cliente administrativo indisponível.');
       const {data,error}=await client.functions.invoke('mercado-pago-pix-status-test',{
         body:{order_id:id}
       });
       if(error){
         let detail=null;try{detail=await error.context?.json?.()}catch(_){}
         throw new Error((detail?.error||error.message||'Falha ao consultar o PIX')+
           (detail?.possible_order_id?' ID encontrado: '+detail.possible_order_id+'.':'')+
           (detail?.provider_status?' (HTTP '+detail.provider_status+')':'')+
           (detail?.search_status?' | Busca HTTP '+detail.search_status:''));
       }
       if(data?.mode!=='pix_real_status_read_only'||data?.order_id!==id)
         throw new Error('Resposta de consulta inválida.');
       try{sessionStorage.setItem('bia_pix_real_last_order_id',id);}catch(_){}
       const detail=data.payment_status_detail||data.order_status_detail||'sem detalhe';
       statusResult.textContent=(data.is_paid?'✓ PIX pago e confirmado pelo Mercado Pago.':
         data.is_waiting?'PIX ainda aguardando pagamento.':
         !data.payment_details_available?'Order encontrada, mas sem detalhes da transação. Pagamento não confirmado.':
         'PIX sem confirmação de pagamento.')+
         ' Order: '+data.order_status+' | pagamento: '+(data.payment_status||'não informado')+
         ' | detalhe: '+detail+
         '. Esta consulta não atualiza pedidos nem estoque.';
     }catch(e){statusResult.textContent='Consulta não concluída: '+(e?.message||'erro desconhecido');}
     finally{statusButton.disabled=false;}
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
