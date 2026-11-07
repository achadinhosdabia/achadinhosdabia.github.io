// Prévia do formulário: deliberadamente não grava pedidos nem inicia pagamentos.
(() => {
  const dialog=document.getElementById('checkout-dialog');
  const form=document.getElementById('checkout-form');
  if(!dialog||!form)return;
  const close=()=>dialog.close();
  document.getElementById('checkout-close').addEventListener('click',close);
  window.openCheckoutPreview=({items,shipping,destinationZip})=>{
    if(!items?.length||!shipping||!/^\\d{8}$/.test(destinationZip))return;
    form.elements.shipping_zip.value=destinationZip;
    document.getElementById('cart-dialog').close();
    dialog.showModal();
  };
  form.addEventListener('submit',event=>event.preventDefault());
})();
