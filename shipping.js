const zipDigits = value => String(value || '').replace(/\D/g, '');
const shipMoney = n => Number(n).toLocaleString('pt-BR', {style:'currency',currency:'BRL'});

function arrangeDelivery(p, mode, destination='') {
  const number=zipDigits(cfg.whatsapp);
  if(!/^\d{10,15}$/.test(number)){toast('O WhatsApp da loja ainda não foi configurado.');return;}
  const text=`Olá! Tenho interesse no produto *${p.name}* (${shipMoney(p.price)}).\nGostaria de ${mode}${destination?' para o CEP '+destination:''}.\nPodemos combinar os detalhes?`;
  window.open(`https://wa.me/${number}?text=${encodeURIComponent(text)}`,'_blank','noopener');
}

function renderShippingWidget(){
  const p=window.currentShippingProduct;
  const details=document.querySelector('#details-body .detail-copy');
  if(!p||!details||details.querySelector('.shipping-widget'))return;
  const widget=document.createElement('section');
  widget.className='shipping-widget';
  widget.innerHTML=`<h3>Entrega e frete</h3><p>Origem: CEP configurado pela loja</p><form class="freight-form"><label for="destination-zip">Calcule o frete para seu CEP</label><div class="freight-row"><input id="destination-zip" inputmode="numeric" placeholder="00000-000" maxlength="9" aria-label="CEP de destino" required><button class="btn btn-primary" type="submit">Calcular</button></div></form><div class="freight-result" role="status" aria-live="polite"></div><div class="freight-alternatives"><button type="button" data-delivery="arrange">Conversar sobre o frete ↗</button><button type="button" data-delivery="pickup">Combinar retirada em mãos ↗</button></div>`;
  details.insertBefore(widget,details.querySelector('#detail-buy'));
  const form=widget.querySelector('.freight-form');
  const result=widget.querySelector('.freight-result');
  form.addEventListener('submit',async e=>{
    e.preventDefault();
    const destination=zipDigits(widget.querySelector('#destination-zip').value);
    if(!/^\d{8}$/.test(destination)){result.textContent='Informe um CEP válido com 8 números.';return;}
    if(!db||!configured()){result.textContent='Cotação automática ainda não ativada. Use a opção de combinar com o vendedor.';return;}
    if(!p.shipping_enabled){result.textContent='Cotação automática indisponível para este item. Combine a entrega com o vendedor.';return;}
    result.textContent='Consultando transportadoras…';
    const{data,error}=await db.functions.invoke('quote-shipping',{body:{product_id:p.id,destination_zip:destination}});
    if(error||!data?.quotes){result.textContent='Não foi possível calcular agora. Combine o frete com o vendedor.';return;}
    if(!data.quotes.length){result.textContent='Nenhuma transportadora disponível para este pacote ou CEP. Combine o frete com o vendedor.';return;}
    result.innerHTML='<p>Opções estimadas de envio:</p>';
    for(const quote of data.quotes){
      const option=document.createElement('button');
      option.type='button';option.className='freight-option';
      option.textContent=`${quote.company} · ${quote.service} — ${shipMoney(quote.price)} · ${quote.days} dias úteis`;
      option.addEventListener('click',()=>arrangeDelivery(p,`solicitar o envio por ${quote.company} (${quote.service}), cotado em ${shipMoney(quote.price)}`,destination));
      result.appendChild(option);
    }
    const note=document.createElement('small');note.textContent='Valores e prazos estimados, sujeitos à confirmação antes da postagem.';result.appendChild(note);
  });
  widget.querySelector('[data-delivery="arrange"]').onclick=()=>arrangeDelivery(p,'combinar o frete',zipDigits(widget.querySelector('#destination-zip').value));
  widget.querySelector('[data-delivery="pickup"]').onclick=()=>arrangeDelivery(p,'combinar retirada em mãos');
}

window.addEventListener('load',()=>{
  const detailBody=document.getElementById('details-body');
  new MutationObserver(renderShippingWidget).observe(detailBody,{childList:true,subtree:false});
  const form=document.getElementById('product-form');
  form.insertAdjacentHTML('beforeend',`<fieldset class="shipping-fields"><legend>Frete do produto</legend><label class="checkbox-label"><input type="checkbox" id="shipping-enabled"> Permitir cotação automática</label><p>Informe as medidas do produto já embalado.</p><div class="shipping-fields-grid"><label>Peso (kg)<input id="shipping-weight" type="number" step="0.001" min="0.001" placeholder="0.500"></label><label>Altura (cm)<input id="shipping-height" type="number" step="0.1" min="0.1"></label><label>Largura (cm)<input id="shipping-width" type="number" step="0.1" min="0.1"></label><label>Comprimento (cm)<input id="shipping-length" type="number" step="0.1" min="0.1"></label></div><small>Se o item for grande demais, desative a cotação e deixe o frete a combinar.</small></fieldset>`);
  new MutationObserver(()=>{
    if(form.hidden)return;
    const p=editing?product(editing):null;
    document.getElementById('shipping-enabled').checked=!!p?.shipping_enabled;
    for(const[k,id]of[['weight_kg','shipping-weight'],['height_cm','shipping-height'],['width_cm','shipping-width'],['length_cm','shipping-length']])document.getElementById(id).value=p?.[k]??'';
  }).observe(form,{attributes:true,attributeFilter:['hidden']});
  form.addEventListener('submit',e=>{
    if(!document.getElementById('shipping-enabled').checked)return;
    if(['shipping-weight','shipping-height','shipping-width','shipping-length'].some(id=>!(Number(document.getElementById(id).value)>0))){
      e.preventDefault();e.stopImmediatePropagation();notifyAdmin('Para calcular frete, informe peso e todas as dimensões do produto embalado.');
    }
  },true);
});
