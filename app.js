'use strict';
const $ = id => document.getElementById(id);
const token = document.querySelector('meta[name="radio-token"]').content;
let state = null, pending = false, lastSequence = -1, lastFrequency = 0, audio = null, audioAbort = null, volumeNode = null, worklet = null;
let bookmarkPage = 0, bookmarkPageSize = 3;
let marks = []; try { marks = JSON.parse(localStorage.getItem('nooelec-bookmarks') || '[]').filter(m => Number.isFinite(m.frequency) && ['WFM','NFM','AM'].includes(m.mode)); } catch {}
function importSavedPresets(){
  try {
    const presets=JSON.parse(document.getElementById('presetImports')?.textContent || '[]');
    const imported=new Set(JSON.parse(localStorage.getItem('nooelec-imported-presets') || '[]'));
    for(const p of presets){
      if(imported.has(p.id))continue;
      if(Number.isFinite(p.frequency)&&p.frequency>=24e6&&p.frequency<=1750e6&&['WFM','NFM','AM'].includes(p.mode)){
        if(!marks.some(m=>m.frequency===p.frequency&&m.mode===p.mode))marks.push({frequency:p.frequency,mode:p.mode});
        imported.add(p.id);
      }
    }
    localStorage.setItem('nooelec-bookmarks',JSON.stringify(marks));
    localStorage.setItem('nooelec-imported-presets',JSON.stringify([...imported]));
  } catch {}
}
importSavedPresets();
const tuningBands={fm:{min:88,max:108,step:.1,mode:'WFM'},air:{min:118,max:137,step:.025,mode:'AM'},vhf:{min:30,max:300,step:.0125,mode:'NFM'},uhf:{min:300,max:1750,step:.0125,mode:'NFM'},all:{min:24,max:1750,step:.1}};
let sliderDragging=false, queuedFrequency=null, wheelTimer=null, targetFrequency=null, tunePromise=null;
function setDialBand(name){const band=tuningBands[name];$('tuningBand').value=name;$('tuningSlider').min=band.min;$('tuningSlider').max=band.max;$('tuningSlider').step=band.step;$('dialMin').textContent=band.min+' MHz';$('dialMax').textContent=band.max+' MHz';}
function syncDial(s){if(sliderDragging)return;let band=tuningBands[$('tuningBand').value];const mhz=s.frequency/1e6;if(mhz<band.min||mhz>band.max){const name=mhz>=88&&mhz<=108?'fm':mhz>=118&&mhz<=137?'air':mhz>=30&&mhz<300?'vhf':mhz>=300?'uhf':'all';setDialBand(name);}$('tuningSlider').value=mhz;$('tuningSlider').setAttribute('aria-valuetext',RadioTuning.formatFrequency(s.frequency)+' MHz');}
function tuneFrequency(hz){
  if(!Number.isFinite(hz))return Promise.resolve();
  clearTimeout(wheelTimer);wheelTimer=null;
  queuedFrequency=targetFrequency=RadioTuning.clampFrequency(hz);
  $('frequency').value=RadioTuning.formatFrequency(targetFrequency);
  if(!tunePromise)tunePromise=(async()=>{
    try{
      while(queuedFrequency!==null){
        if(pending){await new Promise(r=>setTimeout(r,60));continue;}
        const next=queuedFrequency;queuedFrequency=null;
        await command('tune',{frequency:next});
      }
    }finally{tunePromise=null;}
  })();
  return tunePromise;
}
const spectrum = $('spectrum'), waterfall = $('waterfall'), sc = spectrum.getContext('2d'), wc = waterfall.getContext('2d');
const color = Array.from({length:256}, (_,v) => {const stops=[[13,24,34],[23,52,73],[39,112,137],[102,207,173],[220,247,160]];let t=v/255*4,i=Math.min(3,Math.floor(t)),f=t-i;return stops[i].map((n,k)=>Math.round(n*(1-f)+stops[i+1][k]*f));});
function error(message) { $('error').textContent=message; $('error').hidden=!message; }
async function command(path, data={}) {
  if(pending) return;
  pending=true; $('power').disabled=true;
  try { const res=await fetch('/api/'+path,{method:'POST',headers:{'Content-Type':'application/json','X-Radio-Token':token},body:JSON.stringify(data)}); const result=await res.json(); if(!res.ok) throw Error(result.error); if(worklet && (path!=='tune' || 'frequency' in data || 'mode' in data || 'gain' in data)) worklet.port.postMessage('clear'); render(result); }
  catch(e) { error(e.message); }
  finally { pending=false; $('power').disabled=false; }
}
function render(s) {
  state=s; const active=['starting','receiving'].includes(s.status);
  $('status').className='status '+(s.status==='error'?'error':s.status==='receiving'?'':'off');
  $('status').lastChild.textContent={receiving:'Receiver live',starting:'Starting…',stopped:'Receiver stopped',error:'Needs attention'}[s.status] || s.status;
  $('power').textContent=active?'◼  Stop receiver':'▶  Start receiver'; $('power').classList.toggle('running',active);
  if(!sliderDragging&&queuedFrequency===null&&wheelTimer===null){
    targetFrequency=s.frequency;
    if(document.activeElement!==$('frequency'))$('frequency').value=RadioTuning.formatFrequency(s.frequency);
  }
  syncDial(s);
  if(document.activeElement!==$('gain')) $('gain').value=s.gain;
  if(document.activeElement!==$('squelch')) $('squelch').value=s.squelch;
  $('gainValue').textContent=s.gain===0?'Auto':s.gain+' dB'; $('squelchValue').textContent=s.squelch+' dBFS';
  document.querySelectorAll('[data-mode]').forEach(b=>b.classList.toggle('selected',b.dataset.mode===s.mode));
  $('modeHelp').textContent={WFM:'Broadcast FM · mono audio',NFM:'Narrow FM · voice channels',AM:'Amplitude modulation · mono audio'}[s.mode];
  $('band').textContent=s.frequency>=88e6&&s.frequency<=108e6?'FM BROADCAST':s.frequency>=118e6&&s.frequency<=137e6?'AIR BAND':s.frequency>=30e6&&s.frequency<300e6?'VHF':'UHF / VHF';
  $('signal').textContent=s.status==='receiving'?s.level.toFixed(1):'—';
  $('logs').textContent=s.logs.join('\n') || 'Receiver is stopped.';
  $('emptySpectrum').hidden=s.status==='receiving'&&!!s.spectrum;
  $('emptySpectrum').textContent=s.status==='error'?'Receiver needs attention':s.status==='stopped'?'Start the receiver to explore':'Waiting for receiver samples';
  $('streamInfo').textContent=s.status==='receiving'?'1.024 MS/s · '+s.mode+' · 32 kHz audio':s.status==='starting'?'Opening USB receiver…':'No live samples';
  error(s.error);
  if(s.frequency!==lastFrequency){lastFrequency=s.frequency;wc.clearRect(0,0,waterfall.width,waterfall.height);$('frequencyAxis').replaceChildren(...[0,.25,.5,.75,1].map(fraction=>{let e=document.createElement('span');e.textContent=RadioTuning.formatFrequency(RadioTuning.frequencyAt(s,fraction));return e;}));}
  if(s.sequence!==lastSequence && s.spectrum && s.status==='receiving'){drawSpectrum(s.spectrum);drawWaterfall(s.spectrum);lastSequence=s.sequence;}
  else if(s.status!=='receiving') drawSpectrum(null);
}
function resize(){for(const canvas of [spectrum,waterfall]){const rect=canvas.getBoundingClientRect();canvas.width=Math.max(1,Math.round(rect.width));canvas.height=Math.max(1,Math.round(rect.height));}drawSpectrum(state?.spectrum);}
function drawSpectrum(values){
  const w=spectrum.width,h=spectrum.height;
  sc.clearRect(0,0,w,h);sc.fillStyle='#121b20';sc.fillRect(0,0,w,h);sc.font='9px monospace';
  for(let db=-20;db>=-100;db-=20){
    const y=(-db-10)/100*(h-20)+10;
    sc.strokeStyle='#263038';sc.beginPath();sc.moveTo(0,y);sc.lineTo(w,y);sc.stroke();
    sc.fillStyle='#677782';sc.fillText(db,8,y-5);
  }
  for(let i=1;i<8;i++){sc.strokeStyle='#202b31';sc.beginPath();sc.moveTo(w*i/8,0);sc.lineTo(w*i/8,h);sc.stroke();}
  const bandwidth=state?.mode==='WFM'?200000:state?.mode==='NFM'?16000:10000;
  const span=state?.sample_rate??1024000;
  const selectedX=state?w*RadioTuning.frequencyFraction(state,state.frequency):w/2;
  sc.fillStyle='#b7f3990a';sc.fillRect(selectedX-w*bandwidth/span/2,0,w*bandwidth/span,h);
  sc.setLineDash([4,4]);sc.strokeStyle='#b7f39955';sc.beginPath();sc.moveTo(selectedX,0);sc.lineTo(selectedX,h);sc.stroke();sc.setLineDash([]);
  if(!values)return;
  const points=[];
  for(let px=0;px<w;px++){
    const start=Math.floor(px/w*values.length),end=Math.max(start+1,Math.floor((px+1)/w*values.length));
    let v=-120;for(let i=start;i<end;i++)v=Math.max(v,values[i]);
    points.push([px,Math.max(4,Math.min(h-2,(-v-10)/100*(h-20)+10))]);
  }
  sc.beginPath();points.forEach(([x,y],i)=>i?sc.lineTo(x,y):sc.moveTo(x,y));
  sc.strokeStyle='#b7f399';sc.lineWidth=1.15;sc.stroke();sc.lineTo(w,h);sc.lineTo(0,h);sc.closePath();
  const gradient=sc.createLinearGradient(0,0,0,h);gradient.addColorStop(0,'#b7f39935');gradient.addColorStop(1,'#b7f39900');sc.fillStyle=gradient;sc.fill();
}
function drawWaterfall(values){const w=waterfall.width,h=waterfall.height;wc.drawImage(waterfall,0,0,w,h-2,0,2,w,h-2);const row=wc.createImageData(w,2);for(let x=0;x<w;x++){let start=Math.floor(x/w*values.length),end=Math.max(start+1,Math.floor((x+1)/w*values.length));let v=-120;for(let i=start;i<end;i++)v=Math.max(v,values[i]);let rgb=color[Math.max(0,Math.min(255,Math.round((v+95)/65*255)))];for(let y=0;y<2;y++){let k=(y*w+x)*4;row.data[k]=rgb[0];row.data[k+1]=rgb[1];row.data[k+2]=rgb[2];row.data[k+3]=255;}}wc.putImageData(row,0,0);}
async function poll(){try{const res=await fetch('/api/state');if(!res.ok)throw Error('Server unavailable');const s=await res.json();if(!pending)render(s);}catch(e){error('Cannot reach the local radio. Reopen Nooelec Radio from your applications menu.');$('status').className='status error';$('status').lastChild.textContent='Disconnected';}setTimeout(poll,180);}
function typedTune(){if($('frequency').checkValidity())tuneFrequency(Number($('frequency').value)*1e6);}
$('tuneForm').onsubmit=e=>{e.preventDefault();typedTune();};
$('frequency').onchange=typedTune;
$('frequency').addEventListener('wheel',e=>{e.preventDefault();if(!state)return;targetFrequency=RadioTuning.stepFrequency(targetFrequency??state.frequency,Number($('step').value),e.deltaY<0?1:-1);$('frequency').value=RadioTuning.formatFrequency(targetFrequency);clearTimeout(wheelTimer);wheelTimer=setTimeout(()=>{wheelTimer=null;tuneFrequency(targetFrequency);},180);},{passive:false});
$('tuningSlider').onpointerdown=()=>{sliderDragging=true;};
$('tuningSlider').oninput=()=>{sliderDragging=true;$('frequency').value=RadioTuning.formatFrequency(Number($('tuningSlider').value)*1e6);$('tuningSlider').setAttribute('aria-valuetext',$('frequency').value+' MHz');};
$('tuningSlider').onchange=()=>{const hz=Number($('tuningSlider').value)*1e6;sliderDragging=false;tuneFrequency(hz);};
$('tuningSlider').onpointercancel=()=>{sliderDragging=false;if(state)syncDial(state);};
$('tuningSlider').onblur=()=>{sliderDragging=false;};
$('tuningBand').onchange=()=>{const name=$('tuningBand').value,band=tuningBands[name];setDialBand(name);const mhz=state?state.frequency/1e6:99.5;const frequency=mhz<band.min||mhz>band.max?Math.round((band.min+band.max)/2/band.step)*band.step*1e6:mhz*1e6;const stepHz=band.step*1e6;let option=[...$('step').options].find(o=>Number(o.value)===stepHz);if(!option){option=new Option((stepHz/1000)+' kHz step',String(stepHz));$('step').add(option);}$('step').value=stepHz;command('tune',{frequency:Math.round(frequency),...(band.mode?{mode:band.mode}:{})});};
$('power').onclick=()=>command(['receiving','starting'].includes(state?.status)?'stop':'start');
document.querySelectorAll('[data-mode]').forEach(b=>b.onclick=()=>command('tune',{mode:b.dataset.mode}));
$('stepDown').onclick=()=>state&&tuneFrequency(RadioTuning.stepFrequency(targetFrequency??state.frequency,Number($('step').value),-1));
$('stepUp').onclick=()=>state&&tuneFrequency(RadioTuning.stepFrequency(targetFrequency??state.frequency,Number($('step').value),1));
$('gain').onchange=()=>command('tune',{gain:Number($('gain').value)});
$('squelch').oninput=()=>{$('squelchValue').textContent=$('squelch').value+' dBFS';};
$('squelch').onchange=()=>command('tune',{squelch:Number($('squelch').value)});
$('volume').oninput=()=>{$('volumeValue').textContent=$('volume').value+'%';if(volumeNode)volumeNode.gain.setTargetAtTime(Number($('volume').value)/100,audio.currentTime,.02);};
$('fmBand').onclick=()=>command('tune',{frequency:99_500_000,mode:'WFM',squelch:-100});
spectrum.onclick=e=>{if(!state)return;const rect=spectrum.getBoundingClientRect();return tuneFrequency(RadioTuning.frequencyAt(state,(e.clientX-rect.left)/rect.width));};
let presetDraft=null, presetToastTimer=null;
function presetNotice(message){
  $('presetToast').textContent=message;$('presetToast').hidden=false;
  clearTimeout(presetToastTimer);presetToastTimer=setTimeout(()=>{$('presetToast').hidden=true;},3500);
}
function renderBookmarks(){
  $('bookmarks').replaceChildren();$('bookmarkEmpty').hidden=marks.length>0;
  const pages=Math.max(1,Math.ceil(marks.length/bookmarkPageSize));bookmarkPage=Math.min(bookmarkPage,pages-1);
  $('bookmarkPager').hidden=pages<=1;$('bookmarkPage').textContent=(bookmarkPage+1)+' / '+pages;
  $('bookmarkPrev').disabled=bookmarkPage===0;$('bookmarkNext').disabled=bookmarkPage===pages-1;
  marks.slice(bookmarkPage*bookmarkPageSize,(bookmarkPage+1)*bookmarkPageSize).forEach((m,offset)=>{
    const index=bookmarkPage*bookmarkPageSize+offset;
    const frequency=RadioTuning.formatFrequency(m.frequency)+' MHz';
    const row=document.createElement('div');row.className='bookmark';
    const b=document.createElement('button');b.type='button';b.title='Tune '+(m.name?m.name+' · ':'')+frequency+' · '+m.mode;
    const name=document.createElement('span');name.className='preset-name';name.textContent=m.name||frequency;
    const small=document.createElement('small');small.textContent=m.name?frequency+' · '+m.mode:m.mode;
    b.append(name,small);b.onclick=()=>command('tune',{frequency:m.frequency,mode:m.mode});
    const edit=document.createElement('button');edit.type='button';edit.className='preset-edit';edit.textContent='✎';edit.title='Rename preset';edit.ariaLabel='Rename '+(m.name||frequency);edit.onclick=()=>openPresetDialog(m);
    const remove=document.createElement('button');remove.type='button';remove.className='remove';remove.textContent='×';remove.title='Remove preset';remove.ariaLabel='Remove '+(m.name||frequency);
    remove.onclick=()=>{const next=marks.filter((_,i)=>i!==index);if(saveMarks(next))presetNotice('Preset removed');};
    row.append(b,edit,remove);$('bookmarks').append(row);
  });
  requestAnimationFrame(fitBookmarks);
}
function saveMarks(next){
  try{localStorage.setItem('nooelec-bookmarks',JSON.stringify(next));}
  catch{presetNotice('Could not save. Allow site storage in your browser and try again.');return false;}
  marks=next;renderBookmarks();return true;
}
function openPresetDialog(channel){
  presetDraft={frequency:channel.frequency,mode:channel.mode};
  const existing=marks.find(m=>m.frequency===channel.frequency&&m.mode===channel.mode);
  $('presetDialogTitle').textContent=existing?'Save or rename preset':'Save channel preset';
  $('presetFrequency').textContent=RadioTuning.formatFrequency(channel.frequency)+' MHz · '+channel.mode;
  $('presetName').value=existing?.name||'';
  $('presetDialog').showModal();$('presetName').focus();$('presetName').select();
}
async function saveCurrentPreset(){
  $('save').disabled=true;$('savePresetQuick').disabled=true;
  try{
    if(wheelTimer!==null){clearTimeout(wheelTimer);wheelTimer=null;await tuneFrequency(targetFrequency);}
    if(tunePromise)await tunePromise;
    while(pending||queuedFrequency!==null)await new Promise(r=>setTimeout(r,60));
    const response=await fetch('/api/state');if(!response.ok)throw Error('Could not read the tuned channel. Try again.');
    const channel=await response.json();openPresetDialog(channel);
  }catch(e){presetNotice(e.message);}
  finally{$('save').disabled=false;$('savePresetQuick').disabled=false;}
}
$('save').onclick=saveCurrentPreset;
$('savePresetQuick').onclick=saveCurrentPreset;
$('presetCancel').onclick=()=>$('presetDialog').close();
$('presetForm').onsubmit=e=>{
  e.preventDefault();if(!presetDraft)return;
  const preset={...presetDraft,name:$('presetName').value.trim()};
  const index=marks.findIndex(m=>m.frequency===preset.frequency&&m.mode===preset.mode);
  const next=marks.slice();if(index<0)next.push(preset);else next[index]=preset;
  bookmarkPage=Math.floor((index<0?next.length-1:index)/bookmarkPageSize);
  if(saveMarks(next)){$('presetDialog').close();presetNotice('Saved '+(preset.name||(RadioTuning.formatFrequency(preset.frequency)+' MHz')));}
};
async function stopAudio(){if(audioAbort)audioAbort.abort();audioAbort=null;if(audio)await audio.close();audio=null;worklet=null;volumeNode=null;$('listen').textContent='♫  Enable audio';$('listen').classList.remove('enabled');$('audioBadge').textContent='MUTED';}
$('listen').onclick=async()=>{if(audio){await stopAudio();return;}$('listen').disabled=true;try{audio=new AudioContext({sampleRate:32000,latencyHint:'interactive'});await audio.resume();await audio.audioWorklet.addModule('/audio-worklet.js');worklet=new AudioWorkletNode(audio,'radio-audio');volumeNode=audio.createGain();volumeNode.gain.value=Number($('volume').value)/100;worklet.connect(volumeNode).connect(audio.destination);audioAbort=new AbortController();const res=await fetch('/api/audio',{headers:{'X-Radio-Token':token},signal:audioAbort.signal});if(!res.ok)throw Error('Audio stream unavailable');$('listen').textContent='Ⅱ  Mute audio';$('listen').classList.add('enabled');$('audioBadge').textContent='AUDIO ON';const reader=res.body.getReader();const currentWorklet=worklet;let carry=new Uint8Array(0);(async()=>{try{while(true){const {value,done}=await reader.read();if(done)break;let bytes=new Uint8Array(carry.length+value.length);bytes.set(carry);bytes.set(value,carry.length);let size=bytes.length-bytes.length%4;let packet=bytes.buffer.slice(0,size);currentWorklet.port.postMessage(new Float32Array(packet),[packet]);carry=bytes.slice(size);}}catch(e){if(e.name!=='AbortError'){error('Audio disconnected. Enable audio to reconnect.');await stopAudio();}}})();}catch(e){error(e.message);await stopAudio();}finally{$('listen').disabled=false;}};
$('bookmarkPrev').onclick=()=>{bookmarkPage=Math.max(0,bookmarkPage-1);renderBookmarks();};
$('bookmarkNext').onclick=()=>{bookmarkPage++;renderBookmarks();};
function fitBookmarks(){
  const panel=document.querySelector('.bookmarks-panel');
  const compact=matchMedia('(min-width: 761px) and (min-height: 560px)').matches;
  const heading=panel.querySelector('.panel-heading').getBoundingClientRect().height;
  const available=panel.clientHeight-heading;
  const unpaged=Math.max(1,Math.floor(available/34));
  const size=compact?Math.max(1,Math.floor((available-(marks.length>unpaged?27:0))/34)):4;
  if(size!==bookmarkPageSize){bookmarkPageSize=size;renderBookmarks();}
}
new ResizeObserver(()=>{resize();fitBookmarks();}).observe(document.querySelector('.workspace'));
new ResizeObserver(fitBookmarks).observe(document.querySelector('.bookmarks-panel'));
window.addEventListener('resize',resize);renderBookmarks();resize();poll();
