(function(root,factory){
  const api=factory();
  if(typeof module==='object' && module.exports)module.exports=api;
  else root.LipaCategories=api;
})(typeof globalThis==='object'?globalThis:this,function(){
  const groups=Object.freeze({
    primera:['primera'],segunda:['segunda'],tercera:['tercera'],
    primera_segunda:['primera','segunda'],segunda_tercera:['segunda','tercera']
  });
  const valid=value=>typeof value==='string' && Object.prototype.hasOwnProperty.call(groups,value);
  const includes=(value,category)=>valid(value) && groups[value].includes(category);
  const valuesFor=category=>Object.keys(groups).filter(value=>includes(value,category));
  const matches=(value,filter)=>value===filter || includes(value,filter);
  return {valid,includes,valuesFor,matches};
});
