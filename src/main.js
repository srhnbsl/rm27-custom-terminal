import './style.css';
import * as THREE from 'three';
import {OrbitControls} from 'three/addons/controls/OrbitControls.js';
import {GLTFLoader} from 'three/addons/loaders/GLTFLoader.js';
import {CSS2DRenderer,CSS2DObject} from 'three/addons/renderers/CSS2DRenderer.js';
import {freshState,reduce,ids,roles,transformPosition,stale} from './state.js';
const $=id=>document.getElementById(id), form=$('settings-form');
let config={mode:'demo',team:'red',selfId:1,host:'192.168.12.1',port:3333,offsetX:0,offsetY:0,rotation:0,scale:1,calibrated:false};
try{config={...config,...JSON.parse(localStorage.getItem('rm27-config')||'{}')};}catch{}
let state=freshState(),selected=null,paused=false,marking=false,model=null,ws=null,bridgeState='ready',demoTick=0,toastTimer;
const eventNames={1:'机器人击毁',2:'前哨站被摧毁',11:'基地遭到攻击',12:'对方前哨站停转',13:'对方基地护甲展开',15:'装配结果'};
function notify(text){$('toast').textContent=text;$('toast').style.display='block';clearTimeout(toastTimer);toastTimer=setTimeout(()=>$('toast').style.display='none',4500);}
const scene=new THREE.Scene();
const camera=new THREE.PerspectiveCamera(42,1,.1,180);
let renderer;
try{renderer=new THREE.WebGLRenderer({antialias:true,alpha:true,powerPreference:'high-performance'});}catch(e){$('load-state').textContent='无法启动 WebGL。请启用浏览器硬件加速后刷新。';throw e;}
renderer.setPixelRatio(Math.min(devicePixelRatio,1.6));renderer.outputColorSpace=THREE.SRGBColorSpace;renderer.setClearColor(0x090c10,0);
$('viewport').append(renderer.domElement);
const labelRenderer=new CSS2DRenderer();labelRenderer.domElement.style.pointerEvents='none';$('labels').append(labelRenderer.domElement);
const controls=new OrbitControls(camera,renderer.domElement);controls.enableDamping=true;controls.dampingFactor=.09;controls.minDistance=4;controls.maxDistance=72;controls.maxPolarAngle=Math.PI*.47;controls.target.set(14,0,-7.5);
function resetView(){camera.position.set(37,25,14);controls.target.set(14,0,-7.5);camera.up.set(0,1,0);controls.update();$('view-heading').textContent='三维全场';}
function topView(){camera.position.set(14,43,-7.49);controls.target.set(14,0,-7.5);controls.update();$('view-heading').textContent='俯视全场';}
resetView();scene.add(new THREE.HemisphereLight(0xe2edff,0x4d4c4a,2.4));const sun=new THREE.DirectionalLight(0xffffff,2);sun.position.set(8,25,10);scene.add(sun);
const grid=new THREE.GridHelper(70,70,0x28333f,0x18212a);grid.material.transparent=true;grid.material.opacity=.3;grid.position.set(14,-.42,-7.5);scene.add(grid);
const ground=new THREE.Mesh(new THREE.PlaneGeometry(70,70),new THREE.MeshBasicMaterial({color:0x0b1016,transparent:true,opacity:.5}));ground.rotation.x=-Math.PI/2;ground.position.set(14,-.44,-7.5);scene.add(ground);
new GLTFLoader().load('/field.glb',g=>{
 model=g.scene;model.traverse(o=>{if(o.isMesh){o.geometry.computeVertexNormals();o.material.flatShading=true;o.material.needsUpdate=true;}});scene.add(model);$('load-state').hidden=true;
 fetch('/map-info.json').then(r=>r.json()).then(d=>{$('render-stats').textContent=`显示模型 · ${new Intl.NumberFormat('zh-CN').format(d.displayTriangles)} 面`;});
},p=>{if(p.total)$('load-state').textContent=`正在载入三维场地… ${Math.round(100*p.loaded/p.total)}%`;},()=>{$('load-state').textContent='场地加载失败。请确认 public/field.glb 存在后刷新。';});
const raycaster=new THREE.Raycaster(),meshById=new Map(), reducedMotion=matchMedia('(prefers-reduced-motion: reduce)');
for(const id of ids){
 const color=id<100?0xef5c65:0x54aaff;
 const group=new THREE.Group(),body=new THREE.Mesh(new THREE.SphereGeometry(.19,14,10),new THREE.MeshStandardMaterial({color,roughness:.4,metalness:.15}));body.position.y=.23;group.add(body);
 const ring=new THREE.Mesh(new THREE.RingGeometry(.29,.31,32),new THREE.MeshBasicMaterial({color,side:THREE.DoubleSide}));ring.rotation.x=-Math.PI/2;ring.position.y=.02;group.add(ring);
 const arrow=new THREE.Mesh(new THREE.ConeGeometry(.065,.2,3),new THREE.MeshBasicMaterial({color}));arrow.rotation.x=Math.PI/2;arrow.position.set(0,.1,-.4);group.add(arrow);
 const el=document.createElement('button');el.className='robot-label';el.style.setProperty('--team-color',`#${new THREE.Color(color).getHexString()}`);el.addEventListener('click',()=>selectRobot(id));
 const label=new CSS2DObject(el);label.position.y=.92;group.add(label);scene.add(group);group.visible=false;meshById.set(id,{group,el,label,ring,target:new THREE.Vector3(),lastPositionAt:0});
}
let viewportWidth=1,viewportHeight=1;
function resize(){const {width,height}=$('viewport').getBoundingClientRect();viewportWidth=width;viewportHeight=height;renderer.setSize(width,height);labelRenderer.setSize(width,height);camera.aspect=width/height;camera.updateProjectionMatrix();}
new ResizeObserver(resize).observe($('viewport'));resize();
function own(id){return config.team==='red'?id<100:id>100;}
function robotName(id){return `${own(id)?'我':'敌'}${id%100} · ${roles[id%100]||'机器人'}`;}
function ingest(topic,data,at=Date.now()){reduce(state,topic,data,{selfId:config.selfId,team:config.team,now:at});}
function demo(){
 if(config.mode!=='demo'||paused)return;
 demoTick++;const t=demoTick;
 ingest('GameStatus',{current_round:1,total_rounds:3,red_score:0,blue_score:0,current_stage:4,stage_countdown_sec:Math.max(0,420-t),is_paused:false});
 ingest('GlobalUnitStatus',{base_health:10000,enemy_base_health:10000,outpost_R_health:1000,outpost_B_health:1000,total_CP_ally:0,total_CP_enemy:0,robot_health:[440,330,355,600,405,280,320,580]});
 ingest('GlobalLogisticsStatus',{remaining_economy:420,tech_level:2});
 ids.forEach((id,i)=>{
  const r=state.robots[id],base=id%100,red=id<100;
  r.maxHp=base===7?600:base===1?500:400;r.level=base===2?null:2;
  const x=(red?22:6)+Math.sin(t*.065+i*.9)*2.8;
  const y=3+(i%4)*2.6+Math.cos(t*.08+i)*.6;
  ingest('RobotPosition',{robot_id:id,x,y,z:base===6?2.5:0,yaw:(t*7+i*47)%360});
 });
 ingest('RobotDynamicStatus',{current_health:state.robots[config.selfId].hp??400,current_heat:28+Math.round(15*Math.sin(t/10)),remaining_ammo:180,reserved:0});
 if(t===1)ingest('Event',{event_id:0,param:'模拟场景已启动；所有机器人轨迹与状态均为演示数据'});
}
setInterval(demo,1000);
function openBridge(){
 const current=new WebSocket(`ws://${location.host}/telemetry`);ws=current;
 current.onopen=()=>{bridgeState='ready';if(config.mode==='live')connectLive();};
 current.onmessage=ev=>{if(ws!==current)return;const m=JSON.parse(ev.data);if(config.mode!=='live')return;
  if(m.kind==='data')ingest(m.topic,m.data,m.at);
  if(m.kind==='status'){bridgeState=m.status;if(m.error)notify('连接失败：'+m.error);}
  if(m.kind==='decode-error')localEvent(`消息解码失败 ${m.topic}：${m.error}`);
  if(m.kind==='unsupported'&&!state.events.some(e=>e.data.param?.startsWith('雷达协议'))){localEvent('雷达协议定义不完整，已保留接收提示，未推测解码。');}
 };
 current.onclose=()=>{if(ws!==current)return;bridgeState='disconnected';setTimeout(openBridge,2500);};
 current.onerror=()=>{bridgeState='error';};
}
function connectLive(){if(ws?.readyState===1){bridgeState='connecting';ws.send(JSON.stringify({action:'connect',host:config.host,port:config.port,clientId:config.selfId}));}}
openBridge();
function localEvent(text){state.events.unshift({topic:'local',data:{param:text},at:Date.now()});state.events.length=Math.min(80,state.events.length);}
function clearSource(){state=freshState();selected=null;demoTick=0;for(const m of meshById.values()){m.lastPositionAt=0;m.group.visible=false;}if(config.mode==='demo')demo();}
clearSource();
const txt=(id,v)=>{$(id).textContent=v??'—';};
const number=v=>v===undefined||v===null?'—':new Intl.NumberFormat('zh-CN').format(v);
function selectRobot(id){selected=id;notify(`已选择 ${robotName(id)}`);renderUI();}
function renderUI(){
 const now=Date.now(),g=state.game,u=state.units,secs=g.stage_countdown_sec;
 txt('red-score',config.team==='red'?u.total_CP_ally:u.total_CP_enemy);txt('blue-score',config.team==='blue'?u.total_CP_ally:u.total_CP_enemy);txt('countdown',secs===undefined?'—:—':`${Math.floor(Math.max(0,secs)/60).toString().padStart(2,'0')}:${(Math.max(0,secs)%60).toString().padStart(2,'0')}`);
 txt('stage',g.current_stage===undefined?'等待比赛信息':`${['未开始','准备阶段','裁判系统自检','倒计时','比赛中','比赛结算'][g.current_stage]??'未知阶段'} · 第 ${g.current_round??'—'} 局${g.is_paused?' · 暂停':''}`);
 for(const [el,key] of [['base','base_health'],['enemy-base','enemy_base_health'],['outpost','outpost_R_health'],['enemy-outpost','outpost_B_health']])txt(el,number(u[key]));
 txt('economy',number(state.logistics.remaining_economy));txt('side-badge',config.team==='red'?'红方视角':'蓝方视角');$('side-badge').style.borderColor=config.team==='red'?'var(--red)':'var(--blue)';
 txt('calibration-badge',config.calibrated?'坐标映射已核对':'坐标未标定');txt('mode-label',config.mode==='demo'?'本机模拟 · 数据仅作演示':config.calibrated?'赛事接入 · 已核对坐标映射':'赛事接入 · 坐标尚未标定');
 const age=state.lastAt?now-state.lastAt:Infinity,liveFresh=bridgeState==='connected'&&age<3000;
 txt('connection-text',config.mode==='demo'?(paused?'模拟已暂停':'模拟演示'):liveFresh?'数据接收正常':bridgeState==='connected'?'已连接 · 等待新数据':bridgeState==='connecting'?'正在连接…':'赛事连接断开');
 txt('packet-age',config.mode==='demo'?'未接入赛事服务器':`${state.packets} 条消息 / ${Number.isFinite(age)?(age/1000).toFixed(1)+'s 前':'未收到数据'}`);
 $('connection-dot').className='dot '+(config.mode==='live'?(liveFresh?'live':'error'):'');
 $('pause-demo').disabled=config.mode!=='demo';txt('pause-demo',paused?'继续演示':'暂停演示');
 // Stable roster elements keep keyboard focus through telemetry updates.
 for(const id of ids.filter(own)){
  const r=state.robots[id];let row=$('robot-row-'+id);
  if(!row){row=document.createElement('button');row.id='robot-row-'+id;row.className='robot-row';row.innerHTML='<span class="robot-num"></span><span><b></b><small></small></span><span></span>';row.onclick=()=>selectRobot(id);$('roster').append(row);}
  row.classList.toggle('selected',selected===id);row.setAttribute('aria-pressed',String(selected===id));row.children[0].textContent=id%100;row.querySelector('b').textContent=roles[id%100];row.querySelector('small').textContent=!r.position?'位置未知':stale(r)?'位置已过期':'位置已更新';row.querySelector('small').classList.toggle('stale',!!r.position&&stale(r));row.lastElementChild.textContent=number(r.hp);
 }
 const svg=$('mini-markers');svg.replaceChildren();
 for(const id of ids){
  const r=state.robots[id],m=meshById.get(id),old=stale(r,now),age=now-r.positionAt;
  m.group.visible=!!r.position&&age<10000;
  if(!r.position)continue;
  const p=transformPosition(r.position,config),inBounds=p.x>=-.5&&p.x<=28.5&&p.y>=-1&&p.y<=16;
  m.group.visible&&=inBounds;
  if(r.positionAt!==m.lastPositionAt){
   let height=p.z;
   if(id%100!==6&&model){raycaster.set(new THREE.Vector3(p.x,1.1,-p.y),new THREE.Vector3(0,-1,0));const hit=raycaster.intersectObject(model,true)[0];if(hit)height=hit.point.y;}
   m.target.set(p.x,height+.04,-p.y);if(!m.lastPositionAt)m.group.position.copy(m.target);m.lastPositionAt=r.positionAt;
  }
  m.group.rotation.y=-p.yaw*Math.PI/180;
  m.el.classList.toggle('old',old);m.el.classList.toggle('selected',selected===id);m.el.setAttribute('aria-label',`${robotName(id)}，血量 ${r.hp??'未知'}，${old?'位置过期':'位置已更新'}`);
  m.el.replaceChildren();const title=document.createElement('strong');title.textContent=robotName(id);m.el.append(title);const level=document.createElement('span');level.className='level';level.textContent=r.level?'Lv.'+r.level:'—';m.el.append(level);
  const bar=document.createElement('span');bar.className='hp-bar';const fill=document.createElement('i');fill.style.width=r.maxHp&&r.hp!==null?`${Math.max(0,Math.min(100,100*r.hp/r.maxHp))}%`:'0';bar.append(fill);m.el.append(bar);
  m.ring.scale.setScalar(selected===id?1.5:1);
  if(age>10000||!inBounds)continue;
  const group=document.createElementNS('http://www.w3.org/2000/svg','g');group.setAttribute('transform',`translate(${(1-p.x/28)*280},${(1-p.y/15)*150})`);
  const shape=document.createElementNS('http://www.w3.org/2000/svg',own(id)?'circle':'rect');if(own(id)){shape.setAttribute('r','5');}else{shape.setAttribute('x','-4');shape.setAttribute('y','-4');shape.setAttribute('width','8');shape.setAttribute('height','8');shape.setAttribute('transform','rotate(45)');}
  shape.setAttribute('fill','#10151b');shape.setAttribute('stroke',own(id)?'#62d6ad':'#ef5c65');shape.setAttribute('stroke-width',selected===id?'2':'1.2');if(old)shape.setAttribute('stroke-dasharray','2 2');group.append(shape);
  const t=document.createElementNS('http://www.w3.org/2000/svg','text');t.setAttribute('text-anchor','middle');t.setAttribute('y','2.4');t.setAttribute('fill','white');t.setAttribute('font-size','6.5');t.textContent=id%100;group.append(t);svg.append(group);
 }
 $('selection').hidden=!selected;
 if(selected){const r=state.robots[selected],p=r.position,d=r.dynamic||{};$('selection').replaceChildren();const h=document.createElement('h2');h.textContent=robotName(selected);$('selection').append(h);const dl=document.createElement('dl');
  for(const [key,val] of [['血量',`${number(r.hp)} / ${number(r.maxHp)}`],['协议坐标',p?`${p.x.toFixed(2)}, ${p.y.toFixed(2)} m`:'未知'],['位置状态',!p?'未知':stale(r)?'已过期':'已更新'],['朝向',p?.yaw===undefined?'未知':`${p.yaw.toFixed(1)}°`],['剩余弹量',number(d.remaining_ammo)],['当前热量',number(d.current_heat)]]){const dt=document.createElement('dt'),dd=document.createElement('dd');dt.textContent=key;dd.textContent=val;dl.append(dt,dd);}$('selection').append(dl);const b=document.createElement('button');b.textContent='定位此机器人';b.disabled=!p||stale(r);b.onclick=()=>{const m=meshById.get(selected);const shift=new THREE.Vector3().subVectors(camera.position,controls.target);controls.target.copy(m.group.position);camera.position.copy(m.group.position).add(shift);controls.update();};$('selection').append(b);}
 const list=$('event-list');list.replaceChildren();if(!state.events.length){const e=document.createElement('p');e.className='empty';e.textContent='暂无事件，接收后将在这里显示。';list.append(e);}
 for(const e of state.events.slice(0,30)){const row=document.createElement('div');row.className='event-item';const time=document.createElement('time');time.textContent=new Intl.DateTimeFormat('zh-CN',{hour:'2-digit',minute:'2-digit',second:'2-digit',hour12:false}).format(e.at);row.append(time);const text=e.topic==='Event'?`${eventNames[e.data.event_id]??('事件 '+e.data.event_id)} ${e.data.param??''}`:e.topic==='local'?e.data.param:e.topic==='MapClickInfo'?'收到地图标记':`判罚类型 ${e.data.penalty_type} · ${e.data.penalty_effect_sec??0}s`;row.append(document.createTextNode(text));list.append(row);}
}
setInterval(renderUI,400);renderUI();
let previous=performance.now();
const projected=new THREE.Vector3();
function animate(now){
 requestAnimationFrame(animate);const dt=Math.min((now-previous)/1000,.1);previous=now;
 for(const m of meshById.values())if(m.group.visible)m.group.position.lerp(m.target,reducedMotion.matches?1:1-Math.exp(-dt*6));
 controls.update();scene.updateMatrixWorld(true);camera.updateMatrixWorld(true);
 // Separate colliding labels without reading layout in the render loop.
 const occupied=[],width=viewportWidth<720?84:110,height=viewportWidth<720?33:40;
 for(const id of [...ids].sort((a,b)=>(b===selected)-(a===selected))){
  const m=meshById.get(id);if(!m.group.visible)continue;
  m.label.getWorldPosition(projected);projected.project(camera);
  const x=(projected.x+1)*viewportWidth/2,y=(1-projected.y)*viewportHeight/2;
  m.label.visible=false;
  for(let n=0;n<5;n++){
   const rect={x:x-width/2,y:y-height/2-n*(height+3),w:width,h:height};
   if(rect.y<0||rect.x+width<0||rect.x>viewportWidth)continue;
   if(!occupied.some(r=>rect.x<r.x+r.w&&rect.x+rect.w>r.x&&rect.y<r.y+r.h&&rect.y+rect.h>r.y)){
    m.label.center.y=.5+n*(height+3)/height;m.label.visible=true;occupied.push(rect);break;
   }
  }
 }
 renderer.render(scene,camera);labelRenderer.render(scene,camera);
}
requestAnimationFrame(animate);
function toggleRoster(){const hidden=!$('robot-panel').hidden;$('robot-panel').hidden=hidden;$('toggle-roster').setAttribute('aria-pressed',String(!hidden));}
function toggleEvents(){const hidden=!$('events').hidden;$('events').hidden=hidden;$('toggle-events').setAttribute('aria-pressed',String(!hidden));}
function toggleMark(){marking=!marking;$('mark-mode').setAttribute('aria-pressed',String(marking));renderer.domElement.style.cursor=marking?'crosshair':'grab';notify(marking?'点击场地放置本地标记；不会发送到机器人。':'已退出标记模式');}
$('toggle-roster').onclick=toggleRoster;$('toggle-events').onclick=toggleEvents;$('mark-mode').onclick=toggleMark;
$('reset-view').onclick=resetView;$('top-view').onclick=topView;
function zoom(scale){camera.position.sub(controls.target).multiplyScalar(scale).add(controls.target);controls.update();}
$('zoom-in').onclick=()=>zoom(.8);$('zoom-out').onclick=()=>zoom(1.25);
$('expand-map').onclick=()=>$('minimap').classList.toggle('expanded');
$('pause-demo').onclick=()=>{paused=!paused;renderUI();};$('clear-events').onclick=()=>{state.events=[];renderUI();};
$('fullscreen').onclick=async()=>{try{if(document.fullscreenElement)await document.exitFullscreen();else await document.documentElement.requestFullscreen();}catch{notify('浏览器未允许全屏，请使用 F11。');}};
function showSettings(){for(const [k,v] of Object.entries(config)){const el=form.elements.namedItem(k);if(el){if(el.type==='checkbox')el.checked=v;else el.value=v;}}$('settings-error').textContent='';$('settings').showModal();}
for(const id of ids){const o=document.createElement('option');o.value=id;o.textContent=`${id} · ${id<100?'红':'蓝'}方${roles[id%100]}`;form.elements.selfId.append(o);}
$('settings-open').onclick=showSettings;$('help-open').onclick=()=>$('help').showModal();
document.querySelectorAll('[data-close]').forEach(b=>b.onclick=()=>b.closest('dialog').close());
form.onsubmit=e=>{e.preventDefault();const next={...config};for(const key of Object.keys(next)){const el=form.elements.namedItem(key);next[key]=el.type==='checkbox'?el.checked:['selfId','port','offsetX','offsetY','rotation','scale'].includes(key)?Number(el.value):el.value;}
 if((next.team==='red')!==(next.selfId<100)){$('settings-error').textContent='机器人 ID 必须与己方阵营一致。';form.elements.selfId.focus();return;}
 if(![next.port,next.offsetX,next.offsetY,next.rotation,next.scale].every(Number.isFinite)||next.scale<=0){$('settings-error').textContent='请输入有效数值，尺度必须大于零。';return;}
 if(ws?.readyState===1)ws.send(JSON.stringify({action:'disconnect'}));config=next;paused=false;clearSource();$('roster').replaceChildren();try{localStorage.setItem('rm27-config',JSON.stringify(config));}catch{}if(config.mode==='live')connectLive();$('settings').close();renderUI();notify(config.mode==='live'?'已切换赛事数据，等待服务器消息。':'已切换为模拟演示。');
};
let down=null;renderer.domElement.addEventListener('pointerdown',e=>down={x:e.clientX,y:e.clientY});
renderer.domElement.addEventListener('pointerup',e=>{if(!marking||e.button!==0||!down||Math.hypot(e.clientX-down.x,e.clientY-down.y)>5)return;const b=renderer.domElement.getBoundingClientRect();raycaster.setFromCamera(new THREE.Vector2((e.clientX-b.left)/b.width*2-1,-(e.clientY-b.top)/b.height*2+1),camera);const hit=model&&raycaster.intersectObject(model,true)[0];if(hit){const el=document.createElement('span');el.className='local-mark';el.textContent='⌖';const obj=new CSS2DObject(el);obj.position.copy(hit.point);obj.position.y+=.15;scene.add(obj);setTimeout(()=>{scene.remove(obj);el.remove();},15000);notify(`本地标记 · 场地 ${hit.point.x.toFixed(2)}, ${(-hit.point.z).toFixed(2)} m`);}});
document.addEventListener('keydown',e=>{
 if(e.target.matches('input,select,textarea')||document.querySelector('dialog[open]')||e.ctrlKey||e.metaKey||e.altKey)return;
 const k=e.key.toLowerCase();if(k==='g')resetView();if(k==='v')topView();if(k==='b')$('expand-map').click();if(k==='j')toggleEvents();if(k==='n')toggleMark();if(k==='escape'){if(marking)toggleMark();$('minimap').classList.remove('expanded');}
 if(e.key==='Tab'&&e.target===$('scene')){e.preventDefault();toggleRoster();}
 if('wasd'.includes(k)&&k.length===1){e.preventDefault();const v=new THREE.Vector3(k==='a'?-1:k==='d'?1:0,0,k==='w'?-1:k==='s'?1:0);controls.target.add(v);camera.position.add(v);controls.update();}
});
// Read-only diagnostics for automated verification; no control commands.
window.rm27={getState:()=>state,getConfig:()=>({...config}),getScene:()=>({modelLoaded:!!model,visibleRobots:[...meshById.values()].filter(m=>m.group.visible).length})};
