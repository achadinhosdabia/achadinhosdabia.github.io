// Prévia do checkout: consulta CEP sem criar pedidos ou iniciar pagamentos.
(() => {
  const dialog=document.getElementById('checkout-dialog');
  const form=document.getElementById('checkout-form');
  if(!dialog||!form)return;
  const field=name=>form.elements.namedItem(name);
  const message=document.getElementById('checkout-message');
  const zip=field('shipping_zip');
  let lastZip='',requestId=0,checkoutSnapshot=null,validationRequest=0;
  // Uma chave por tentativa lógica de compra; não muda em reenvios do mesmo checkout.
  let checkoutRequestKey=null;
  const setMessage=(text)=>{message.textContent=text;};
  const digits=value=>String(value||'').replace(/\D/g,'');
  const clearAddress=()=>{
    for(const name of ['shipping_street','shipping_neighborhood','shipping_city','shipping_state'])field(name).value='';
  };
  async function lookupZip(){
    const cep=digits(zip.value);
    const current=++requestId;
    if(cep.length!==8){
      lastZip='';
      if(cep.length) setMessage('Digite um CEP válido com 8 números.');
      return;
    }
    if(cep===lastZip)return;
    lastZip=cep;
    setMessage('Consultando endereço pelo CEP…');
    try{
      const response=await fetch('https://viacep.com.br/ws/'+encodeURIComponent(cep)+'/json/',{headers:{Accept:'application/json'}});
      if(!response.ok)throw new Error('Consulta indisponível');
      const data=await response.json();
      if(current!==requestId||digits(zip.value)!==cep)return;
      if(data.erro){clearAddress();setMessage('CEP não encontrado. Confira o número ou preencha o endereço manualmente.');return;}
      field('shipping_street').value=data.logradouro||'';
      field('shipping_neighborhood').value=data.bairro||'';
      field('shipping_city').value=data.localidade||'';
      field('shipping_state').value=data.uf||'';
      setMessage('Endereço localizado. Confira os dados e informe o número e o complemento, se houver.');
      field('shipping_number').focus();
    }catch(error){
      if(current!==requestId)return;
      setMessage('Não foi possível consultar o CEP agora. Você pode preencher o endereço manualmente.');
    }
  }
  zip.addEventListener('input',()=>{
    const clean=digits(zip.value).slice(0,8);
    zip.value=clean.length>5?clean.slice(0,5)+'-'+clean.slice(5):clean;
    ++requestId;
    lastZip='';
    clearAddress();
    if(clean.length===8)lookupZip();
  });
  zip.addEventListener('blur',lookupZip);
  document.getElementById('checkout-close').addEventListener('click',()=>dialog.close());
  window.openCheckoutPreview=({items,shipping,destinationZip})=>{
    if(!items?.length||!shipping||!/^\d{8}$/.test(destinationZip))return;
    checkoutSnapshot={items:items.map(item=>({...item})),shipping:{...shipping},destinationZip};
    checkoutRequestKey=crypto.randomUUID();
    zip.value=destinationZip.slice(0,5)+'-'+destinationZip.slice(5);
    lastZip='';
    clearAddress();
    document.getElementById('cart-dialog').close();
    dialog.showModal();
    lookupZip();
    renderReview();
    validateServerPreview();
  };
  async function validateServerPreview(){
    const current=++validationRequest;
    const box=document.getElementById('checkout-review');
    if(!checkoutSnapshot||!box)return;
    const items=checkoutSnapshot.items.map(x=>({product_id:x.id,quantity:x.qty}));
    if(typeof db==='undefined'||!db||items.some(x=>!/^[-0-9a-f]{36}$/i.test(x.product_id))){
      box.dataset.validation='unavailable';
      setMessage('Não foi possível validar os produtos no servidor. Nenhum pedido será criado.');
      return;
    }
    box.dataset.validation='checking';
    setMessage('Conferindo produtos e preços no Supabase…');
    try{
      const {data,error}=await db.functions.invoke('checkout-preview',{body:{items}});
      if(current!==validationRequest)return;
      if(error||data?.mode!=='preview_only'||!Array.isArray(data.items)||data.items.length!==items.length){
        throw new Error(data?.error||'Falha na validação do catálogo');
      }
      const shipping=Number(checkoutSnapshot.shipping.price);
      if(!Number.isFinite(shipping)||shipping<0)throw new Error('Frete inválido');
      const list=box.querySelector('ul');
      if(list){
        list.replaceChildren();
        for(const item of data.items){
          const li=document.createElement('li');
          li.textContent=item.quantity+' × '+item.name+' — '+money(item.line_total);
          list.appendChild(li);
        }
      }
      const total=box.querySelector('p');
      if(total)total.textContent='Subtotal conferido: '+money(data.subtotal)+' | Frete estimado: '+money(shipping)+' | Total estimado: '+money(Number(data.subtotal)+shipping);
      const note=box.querySelector('small');
      if(note)note.textContent='Produtos e preços conferidos no Supabase. O frete ainda será validado pelo servidor antes do pedido.';
      box.dataset.validation='products-ok';
      setMessage('Produtos e preços conferidos. Revalidando o frete…');
      const {data:freightData,error:freightError}=await db.functions.invoke('quote-shipping',{
        body:{items,destination_zip:checkoutSnapshot.destinationZip}
      });
      if(current!==validationRequest)return;
      if(freightError||!Array.isArray(freightData?.quotes))throw new Error('Não foi possível revalidar o frete.');
      const normalize=x=>String(x??'').trim().toLocaleLowerCase('pt-BR');
      const choice=checkoutSnapshot.shipping;
      const matching=freightData.quotes.find(q=>
        normalize(q.company)===normalize(choice.company)&&
        normalize(q.service)===normalize(choice.service));
      if(!matching||!Number.isFinite(Number(matching.price))||Number(matching.price)<0)
        throw new Error('A opção de frete selecionada não está mais disponível.');
      const newPrice=Number(matching.price);
      const oldPrice=Number(choice.price);
      const totalPrice=Number(data.subtotal)+newPrice;
      if(total)total.textContent='Subtotal conferido: '+money(data.subtotal)+' | Frete recotado: '+money(newPrice)+' | Total estimado: '+money(totalPrice);
      if(note)note.textContent='Produtos e frete consultados novamente no Supabase. O valor final será confirmado pelo servidor ao criar o pedido.';
      box.dataset.validation='ok';
      if(Math.abs(newPrice-oldPrice)>0.009){
        setMessage('O frete mudou de '+money(oldPrice)+' para '+money(newPrice)+'. Volte ao carrinho e selecione novamente o frete antes de continuar.');
        box.dataset.validation='shipping-changed';
      }else{
        setMessage('Produtos, preços e frete conferidos! A finalização da compra ainda está em desenvolvimento.');
      }
    }catch(error){
      if(current!==validationRequest)return;
      box.dataset.validation='failed';
      const note=box.querySelector('small');
      if(note)note.textContent='Não foi possível confirmar os produtos no servidor. Os valores acima são apenas estimativas.';
      setMessage(error?.message || 'Não foi possível validar o carrinho e o frete no Supabase. Tente novamente mais tarde.');
    }
  }
  const money=value=>Number(value).toLocaleString('pt-BR',{style:'currency',currency:'BRL'});
  const cpfValid=value=>{
    const cpf=digits(value);
    if(!/^\d{11}$/.test(cpf)||/^(\d)\1{10}$/.test(cpf))return false;
    for(let size=9;size<11;size++){
      let sum=0;
      for(let i=0;i<size;i++)sum+=Number(cpf[i])*(size+1-i);
      const digit=(sum*10)%11%10;
      if(digit!==Number(cpf[size]))return false;
    }
    return true;
  };
  function renderReview(){
    const box=document.getElementById('checkout-review');
    if(!box||!checkoutSnapshot)return;
    const lines=[];
    let subtotal=0;
    for(const item of checkoutSnapshot.items){
      const p=typeof product==='function'?product(item.id):null;
      if(!p||p.active===false||Number(p.stock)<item.qty){box.textContent='Um produto ficou indisponível. Volte ao carrinho e confira.';return;}
      subtotal+=Number(p.price)*item.qty;
      lines.push(item.qty+' × '+p.name+' — '+money(Number(p.price)*item.qty));
    }
    const shipping=Number(checkoutSnapshot.shipping.price);
    box.replaceChildren();
    const heading=document.createElement('strong');heading.textContent='Resumo do pedido (prévia)';
    const list=document.createElement('ul');
    for(const line of lines){const li=document.createElement('li');li.textContent=line;list.appendChild(li);}
    const total=document.createElement('p');total.textContent='Subtotal: '+money(subtotal)+' | Frete: '+money(shipping)+' | Total estimado: '+money(subtotal+shipping);
    const note=document.createElement('small');note.textContent='Valores serão recalculados e validados no servidor antes de criar o pedido.';
    box.append(heading,list,total,note);
  }
  field('customer_cpf').addEventListener('blur',()=>{
    const cpf=field('customer_cpf');
    if(!cpf.value)return;
    cpf.setCustomValidity(cpfValid(cpf.value)?'':'Informe um CPF válido.');
    if(!cpf.validity.valid)cpf.reportValidity();
  });
  field('customer_cpf').addEventListener('input',()=>field('customer_cpf').setCustomValidity(''));
  // A chave é preparada para o fluxo futuro, mas não é enviada à função de simulação.
  // Teste explícito: valida no servidor, mas nunca cria pedido ou cobra.
  const testButton=document.createElement('button');
  testButton.type='button';
  testButton.className='btn btn-ghost';
  testButton.textContent='Testar dados da compra (sem criar pedido)';
  testButton.style.marginBottom='12px';
  const testNote=document.createElement('small');
  testNote.textContent='Teste opcional: envia os dados preenchidos ao Supabase apenas para validação. Não cria pedido, não reserva estoque e não cobra.';
  testNote.style.display='block';
  testNote.style.marginBottom='12px';
  const submit=form.querySelector('button[type="submit"]');
  if(submit){submit.before(testButton);testButton.before(testNote);}
  testButton.addEventListener('click',async()=>{
    if(!checkoutSnapshot){setMessage('Volte ao carrinho e selecione o frete.');return;}
    if(!form.reportValidity())return;
    if(!cpfValid(field('customer_cpf').value)){
      field('customer_cpf').setCustomValidity('Informe um CPF válido.');
      field('customer_cpf').reportValidity();
      return;
    }
    if(document.getElementById('checkout-review')?.dataset.validation!=='ok'){
      setMessage('Aguarde a conferência dos produtos e do frete antes de testar.');
      return;
    }
    const payment=form.querySelector('input[name="payment_method"]:checked')?.value;
    if(!payment){setMessage('Selecione uma forma de pagamento.');return;}
    const items=checkoutSnapshot.items.map(x=>({product_id:x.id,quantity:x.qty}));
    const customer={
      name:field('customer_name').value.trim(),
      cpf:digits(field('customer_cpf').value),
      email:field('customer_email').value.trim(),
      phone:digits(field('customer_phone').value)
    };
    const address={
      zip:digits(field('shipping_zip').value),
      street:field('shipping_street').value.trim(),
      number:field('shipping_number').value.trim(),
      complement:field('shipping_complement').value.trim(),
      neighborhood:field('shipping_neighborhood').value.trim(),
      city:field('shipping_city').value.trim(),
      state:field('shipping_state').value.trim().toUpperCase()
    };
    const shipping={company:checkoutSnapshot.shipping.company,service:checkoutSnapshot.shipping.service};
    testButton.disabled=true;
    setMessage('Executando simulação segura no servidor…');
    try{
      const {data,error}=await db.functions.invoke('checkout-validate',{
        body:{items,customer,address,shipping,payment_method:payment}
      });
      if(error){
        let detail=data?.error||data?.message||'';
        try{
          if(error.context && typeof error.context.json==='function'){
            const response=await error.context.json();
            detail=response?.error||response?.message||detail;
          }
        }catch(_){}
        throw new Error(detail||error.message||'Falha de comunicação com checkout-validate.');
      }
      if(data?.mode!=='dry_run'||data.can_create_order!==false){
        throw new Error(data?.error||data?.message||
          'Resposta inesperada da função checkout-validate. Verifique se a versão correta foi publicada.');
      }
      const box=document.getElementById('checkout-review');
      const total=box?.querySelector('p');
      if(total)total.textContent='Simulação: produtos '+money(data.subtotal)+
        ' | Frete '+money(data.shipping.price)+' | Total '+money(data.total);
      setMessage('Simulação aprovada! Total: '+money(data.total)+
        '. Nenhum pedido foi criado. A finalização continua desabilitada.');
    }catch(err){
      setMessage('Simulação não concluída: '+(err?.message||'verifique os dados e tente novamente.'));
    }finally{testButton.disabled=false;}
  });
  // Pré-integração segura: prepara o pedido, mas não chama a função de criação.
  // A ativação exige uma etapa posterior e autorização explícita.
  const createNote=document.createElement('small');
  createNote.style.display='block';
  createNote.style.marginTop='8px';
  createNote.textContent='Criação de pedidos ainda bloqueada. A simulação acima não altera o estoque.';
  if(submit){
    submit.disabled=true;
    submit.setAttribute('aria-disabled','true');
    submit.after(createNote);
  }
  function buildOrderPayload(){
    if(!checkoutSnapshot||!checkoutRequestKey)return null;
    const payment=form.querySelector('input[name="payment_method"]:checked')?.value;
    return {
      request_key:checkoutRequestKey,
      items:checkoutSnapshot.items.map(x=>({product_id:x.id,quantity:x.qty})),
      customer:{
        name:field('customer_name').value.trim(),
        cpf:digits(field('customer_cpf').value),
        email:field('customer_email').value.trim(),
        phone:digits(field('customer_phone').value)
      },
      address:{
        zip:digits(field('shipping_zip').value),
        street:field('shipping_street').value.trim(),
        number:field('shipping_number').value.trim(),
        complement:field('shipping_complement').value.trim(),
        neighborhood:field('shipping_neighborhood').value.trim(),
        city:field('shipping_city').value.trim(),
        state:field('shipping_state').value.trim().toUpperCase()
      },
      shipping:{
        company:checkoutSnapshot.shipping.company,
        service:checkoutSnapshot.shipping.service
      },
      payment_method:payment
    };
  }
  // Estrutura pronta para a futura integração; não expõe chamada de criação.
  void buildOrderPayload;
  form.addEventListener('submit',event=>event.preventDefault());
})();
