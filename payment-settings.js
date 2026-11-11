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
 window.refreshPaymentSettings=load;
})();
