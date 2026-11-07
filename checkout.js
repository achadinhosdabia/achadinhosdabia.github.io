// Prévia do checkout: consulta CEP sem criar pedidos ou iniciar pagamentos.
(() => {
  const dialog=document.getElementById('checkout-dialog');
  const form=document.getElementById('checkout-form');
  if(!dialog||!form)return;
  const field=name=>form.elements.namedItem(name);
  const message=document.getElementById('checkout-message');
  const zip=field('shipping_zip');
  let lastZip='',requestId=0;
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
    zip.value=destinationZip.slice(0,5)+'-'+destinationZip.slice(5);
    lastZip='';
    clearAddress();
    document.getElementById('cart-dialog').close();
    dialog.showModal();
    lookupZip();
  };
  form.addEventListener('submit',event=>event.preventDefault());
})();
