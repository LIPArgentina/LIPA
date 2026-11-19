window.LipaColumnSearch=(()=>{
  const searches=new Map();
  const normalize=value=>value.normalize('NFD').replace(/[\u0300-\u036f]/g,'').toLocaleLowerCase('es').trim();
  return function columnSearch(cards,title,key){
    const form=document.createElement('form');form.className='column-search';form.setAttribute('role','search');
    const input=document.createElement('input');input.type='search';input.placeholder='Buscar jugador';input.autocomplete='off';
    input.setAttribute('aria-label','Buscar jugador en '+title);
    const next=document.createElement('button');next.type='submit';next.textContent='↓';next.title='Ir a la siguiente coincidencia';
    next.setAttribute('aria-label',next.title);
    const count=document.createElement('output');count.setAttribute('aria-live','polite');
    form.append(input,next,count);
    const names=cards.flatMap(card=>Array.from(card.querySelectorAll('.player:not(.placeholder) .name'),node=>({node,name:normalize(node.textContent)})));
    let hits=[],index=0;
    function update(){
      const words=normalize(input.value).split(/\s+/).filter(Boolean);
      hits=[];index=0;
      for(const item of names){
        const found=words.length>0 && words.every(word=>item.name.includes(word));
        item.node.closest('.player').classList.toggle('search-hit',found);
        if(found)hits.push(item.node);
      }
      next.disabled=!hits.length;
      count.textContent=words.length?(hits.length?hits.length+(hits.length===1?' coincidencia':' coincidencias'):'Sin coincidencias'):'';
      if(words.length)searches.set(key,input.value);else searches.delete(key);
    }
    input.value=searches.get(key)||'';update();
    input.addEventListener('input',update);
    form.addEventListener('submit',event=>{
      event.preventDefault();if(!hits.length)return;
      const hit=hits[index];hit.scrollIntoView({block:'center',inline:'nearest'});
      count.textContent=(index+1)+' de '+hits.length;index=(index+1)%hits.length;
    });
    return form;
  };
})();
