// Store settings are public to read; only verified admins can change them.
async function loadStoreSettings(){
  if(!db)return;
  const {data,error}=await db.from('store_settings').select('whatsapp,origin_zip,pickup_enabled').eq('id',1).maybeSingle();
  if(!error&&data){cfg.whatsapp=data.whatsapp||'';cfg.originZip=data.origin_zip||'18076070';}
  const field=document.getElementById('store-whatsapp');
  if(field)field.value=cfg.whatsapp||'';
  document.getElementById('origin-zip').value=cfg.originZip||'18076070';
}
window.addEventListener('load',()=>{
  const pane=document.getElementById('admin-panel');
  pane.insertAdjacentHTML('beforeend',`<section class="store-settings"><h3>Configurações da loja</h3><p>Defina o WhatsApp e o CEP de onde os produtos serão enviados.</p><form id="store-settings-form"><label>WhatsApp comercial (com DDD e código do país)<input type="tel" id="store-whatsapp" placeholder="5515999999999" inputmode="tel" required></label><label>CEP de origem dos envios<input type="text" id="origin-zip" inputmode="numeric" maxlength="9" value="18076-070" required></label><button class="btn btn-primary" type="submit">Salvar configurações</button></form></section>`);
  document.getElementById('store-settings-form').addEventListener('submit',async e=>{
    e.preventDefault();
    if(!session||!db){toast('Entre como administrador primeiro.');return;}
    const number=document.getElementById('store-whatsapp').value.replace(/\D/g,'');
    if(!/^\d{12,15}$/.test(number)){toast('Digite o número com código do país e DDD. Ex.: 5515999999999');return;}
    const origin=document.getElementById('origin-zip').value.replace(/\D/g,'');
    if(!/^\d{8}$/.test(origin)){toast('Informe um CEP de origem válido.');return;}
    const {error}=await db.from('store_settings').upsert({id:1,whatsapp:number,origin_zip:origin},{onConflict:'id'});
    if(error){toast('Não foi possível salvar. Verifique as permissões do banco.');return;}
    cfg.whatsapp=number;
    cfg.originZip=origin;
    toast('Configurações atualizadas com sucesso!');
  });
  loadStoreSettings();
});
