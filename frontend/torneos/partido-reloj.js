(function(root){
 function duration(seconds){if(seconds==null)return 'Sin tiempo registrado';const n=Math.max(0,Math.floor(seconds)),h=Math.floor(n/3600),m=Math.floor(n%3600/60),s=n%60;return (h?h+':':'')+String(m).padStart(2,'0')+':'+String(s).padStart(2,'0');}
 function paint(node,entry,offset){node.classList.remove('match-playing','match-finished');let clock=node.querySelector('.match-clock');if(clock)clock.remove();
 if(!entry)return;
 const done=entry.status==='finished',playing=entry.status==='playing';
 if(done||playing)node.classList.add(done?'match-finished':'match-playing');
 if(!done&&!playing)return;
 clock=document.createElement('div');clock.className='match-clock';clock.dataset.start=entry.startedAt||'';clock.dataset.seconds=entry.durationSeconds==null?'':entry.durationSeconds;clock.dataset.playing=playing?'1':'0';clock.dataset.offset=offset||0;node.append(clock);tick(clock);
 }
 function tick(clock){const seconds=clock.dataset.playing==='1'&&clock.dataset.start?(Date.now()+Number(clock.dataset.offset)-Date.parse(clock.dataset.start))/1000:clock.dataset.seconds===''?null:Number(clock.dataset.seconds);clock.textContent=duration(seconds);}
 root.LipaMatchClock={paint,duration};setInterval(()=>document.querySelectorAll('.match-clock').forEach(tick),1000);
})(window);
