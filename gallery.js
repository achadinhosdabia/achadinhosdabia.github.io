// Galeria de fotos administrada no Supabase Storage.
(() => {
  const style=document.createElement('link');style.rel='stylesheet';style.href='gallery.css';document.head.append(style);
  const MAX_PHOTOS=5, MAX_BYTES=5*1024*1024;
  let selected=[];
  const allowed=new Set(['image/jpeg','image/png','image/webp']);
  const input=document.getElementById('product-image');
  input.required=false;
  const wrapper=input.closest('label');
  wrapper.style.display='none'; // Retém o campo legado para produtos cadastrados anteriormente.

  const section=document.createElement('section');
  section.className='product-gallery-editor';
  section.innerHTML=`<label for="gallery-picker" class="gallery-label">Fotos do produto (1 a 5) *</label><input type="file" id="gallery-picker" accept="image/jpeg,image/png,image/webp" multiple><small>Escolha fotos da galeria ou do computador. JPG, PNG ou WebP, até 5 MB por foto.</small><div id="gallery-preview" class="gallery-preview" aria-live="polite"></div>`;
  wrapper.insertAdjacentElement('afterend',section);
  const picker=document.getElementById('gallery-picker');
  const preview=document.getElementById('gallery-preview');

  function render(){
    preview.replaceChildren();
    selected.forEach((entry,index)=>{
      const card=document.createElement('div');card.className='gallery-edit-item';
      const img=document.createElement('img');img.alt=`Foto ${index+1}`;
      img.src=entry.url||(entry.preview||(entry.preview=URL.createObjectURL(entry.file)));
      const remove=document.createElement('button');remove.type='button';remove.textContent='×';remove.setAttribute('aria-label',`Remover foto ${index+1}`);
      remove.onclick=()=>{if(entry.preview)URL.revokeObjectURL(entry.preview);selected.splice(index,1);render()};
      card.append(img,remove);preview.append(card);
    });
  }

  picker.addEventListener('change',()=>{
    const files=Array.from(picker.files||[]);
    if(selected.length+files.length>MAX_PHOTOS){notifyAdmin(`Você pode cadastrar no máximo ${MAX_PHOTOS} fotos.`);picker.value='';return}
    if(files.some(f=>!allowed.has(f.type)||f.size>MAX_BYTES||f.size===0)){
      notifyAdmin('Use apenas fotos JPG, PNG ou WebP de até 5 MB cada.');picker.value='';return;
    }
    selected.push(...files.map(file=>({file})));
    picker.value='';render();
  });

  window.loadProductImages=(p)=>{
    selected.forEach(e=>{if(e.preview)URL.revokeObjectURL(e.preview)});
    const saved=Array.isArray(p?.images)&&p.images.length?p.images:(p?.image_url?[p.image_url]:[]);
    selected=saved.slice(0,MAX_PHOTOS).map(url=>({url}));
    picker.value='';render();
  };

  window.uploadProductImages=async(client)=>{
    if(!selected.length||selected.length>MAX_PHOTOS)throw Error('Escolha de 1 a 5 fotos.');
    const urls=[];
    for(const entry of selected){
      if(entry.url){urls.push(entry.url);continue}
      const ext=entry.file.type==='image/png'?'png':entry.file.type==='image/webp'?'webp':'jpg';
      const path=`produtos/${crypto.randomUUID()}.${ext}`;
      const {error}=await client.storage.from('product-images').upload(path,entry.file,{contentType:entry.file.type,upsert:false});
      if(error)throw Error(error.message);
      const {data}=client.storage.from('product-images').getPublicUrl(path);
      if(!data?.publicUrl)throw Error('Falha ao obter URL da imagem');
      entry.url=data.publicUrl;urls.push(entry.url);
    }
    return urls;
  };
})();
