export const ids=[1,3,4,7,101,103,104,107];
export const roles={1:'重装',3:'步兵',4:'步兵',6:'空中',7:'哨兵'};
export function freshState(){return {game:{},units:{},logistics:{},robots:Object.fromEntries(ids.map(id=>[id,{id,position:null,positionAt:0,hp:null,maxHp:null,level:null}])),events:[],lastAt:0,packets:0};}
export function reduce(s,topic,d,{selfId=1,team='red',now=Date.now()}={}){
 s.lastAt=now;s.packets++;
 if(topic==='GameStatus')Object.assign(s.game,d);
 if(topic==='GlobalLogisticsStatus')Object.assign(s.logistics,d);
 if(topic==='GlobalUnitStatus'){
  Object.assign(s.units,d);
  const own=team==='red'?0:100,enemy=team==='red'?100:0;
  const order=[1,3,4,7].map(x=>x+own).concat([1,3,4,7].map(x=>x+enemy));
  (d.robot_health||[]).slice(0,8).forEach((hp,i)=>{s.robots[order[i]].hp=hp;});
 }
 if(topic==='RobotPosition'){
  const id=Object.hasOwn(d,'robot_id')?d.robot_id:selfId;
  if(s.robots[id]&&['x','y','z','yaw'].every(k=>d[k]===undefined||Number.isFinite(d[k]))){
   const old=s.robots[id].position||{};
   const p={...old,...d};
   if(Number.isFinite(p.x)&&Number.isFinite(p.y)){s.robots[id].position=p;s.robots[id].positionAt=now;}
  }
 }
 if(topic==='RobotStaticStatus'){
  // This message describes the connected robot only; dynamic status has no ID.
  const r=s.robots[selfId];if(r){if(d.max_health!==undefined)r.maxHp=d.max_health;if(d.level!==undefined)r.level=d.level;r.static=d;}
 }
 if(topic==='RobotDynamicStatus'){
  const r=s.robots[selfId];if(r){r.dynamic={...r.dynamic,...d};if(d.current_health!==undefined)r.hp=d.current_health;}
 }
 if(topic==='RobotModuleStatus')s.robots[selfId].modules=d;
 if(topic==='Buff'&&s.robots[d.robot_id])s.robots[d.robot_id].buff=d;
 if(topic==='Event'||topic==='PenaltyInfo'||topic==='MapClickInfo'){
  s.events.unshift({topic,data:d,at:now});s.events.length=Math.min(80,s.events.length);
 }
 return s;
}
export function transformPosition(p,c){
 const a=c.rotation*Math.PI/180,x=p.x*c.scale,y=p.y*c.scale;
 return {x:x*Math.cos(a)-y*Math.sin(a)+c.offsetX,y:x*Math.sin(a)+y*Math.cos(a)+c.offsetY,z:p.z??0,yaw:(p.yaw??0)+c.rotation};
}
export function stale(r,now=Date.now()){return !r.positionAt||now-r.positionAt>3000;}
