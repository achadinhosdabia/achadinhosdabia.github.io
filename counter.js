// A lightweight session counter. No visitor identity, IP address or cookie is stored.
window.addEventListener('load',async()=>{
  const el=document.getElementById('visitor-count');
  if(!el||!db)return;
  try{
    if(!sessionStorage.getItem('bia-view-counted')){
      const {error}=await db.rpc('register_site_visit');
      if(!error)sessionStorage.setItem('bia-view-counted','1');
    }
    const {data,error}=await db.from('site_stats').select('visits').eq('id',1).maybeSingle();
    if(!error&&data){el.textContent=Number(data.visits).toLocaleString('pt-BR');el.closest('.visitor-widget').hidden=false;}
  }catch(err){/* Counter is optional; keep the rest of the store usable. */}
});
