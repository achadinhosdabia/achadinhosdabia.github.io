// Prévia do checkout: consulta CEP sem criar pedidos ou iniciar pagamentos.
(() => {
  const dialog=document.getElementById('checkout-dialog');
  const form=document.getElementById('checkout-form');
  if(!dialog||!form)return;
  const field=name=>form.elements.namedItem(name);
  const message=document.getElementById('checkout-message');
  const zip=field('shipping_zip');
  let lastZip='',requestId=0,checkoutSnapshot=null;
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
    zip.value=destinationZip.slice(0,5)+'-'+destinationZip.slice(5);
    lastZip='';
    clearAddress();
    document.getElementById('cart-dialog').close();
    dialog.showModal();
    lookupZip();
    renderReview();
  };
  const money=value=>Number(value).toLocaleString('pt-BR',{style:'currency',currency:'BRL'});
  const cpfValid=value=>{
    const cpf=digits(value);
    if(!/^\\d{11}$/.test(cpf)||/^(\\d)\\1{10}$/.test(cpf))return false;
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
  form.addEventListener('submit',event=>event.preventDefault());
})();
