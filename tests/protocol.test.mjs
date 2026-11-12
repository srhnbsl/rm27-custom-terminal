import test from 'node:test';
import assert from 'node:assert/strict';
import protobuf from 'protobufjs';
import {readFileSync} from 'node:fs';
import {freshState,reduce,transformPosition,stale} from '../src/state.js';
const root=protobuf.parse(readFileSync(new URL('../protocol.proto',import.meta.url),'utf8'),{keepCase:true}).root;
test('official field-number wire fixture preserves position zeroes and robot ID',()=>{
 // float x=0, float y=1.5, robot_id=107; wire independent of encoder.
 const bytes=Buffer.from('0d00000000150000c03f286b','hex');
 const d=root.lookupType('RobotPosition').toObject(root.lookupType('RobotPosition').decode(bytes));
 assert.deepEqual(d,{x:0,y:1.5,robot_id:107});
 const s=reduce(freshState(),'RobotPosition',d,{now:1000,selfId:1});assert.equal(s.robots[107].position.x,0);assert.equal(s.robots[1].position,null);
});
test('absent fields preserve known state; explicit zero HP is death',()=>{
 const s=freshState();reduce(s,'GlobalUnitStatus',{base_health:10000,robot_health:[400]},{team:'blue'});
 assert.equal(s.robots[101].hp,400);assert.equal(s.robots[1].hp,null);
 reduce(s,'GlobalUnitStatus',{base_health:0},{team:'blue'});assert.equal(s.units.base_health,0);assert.equal(s.robots[101].hp,400);
 const T=root.lookupType('GameStatus'),d=T.toObject(T.decode(T.encode({red_score:0}).finish()),{defaults:false});assert.deepEqual(d,{red_score:0});
});
test('telemetry freshness and field transform use explicit units',()=>{
 const s=freshState();reduce(s,'RobotPosition',{x:2,y:3},{selfId:4,now:1000});assert.equal(stale(s.robots[4],4001),true);assert.equal(stale(s.robots[4],3000),false);
 const p=transformPosition({x:200,y:300},{scale:.01,rotation:90,offsetX:10,offsetY:5});assert.ok(Math.abs(p.x-7)<1e-8);assert.ok(Math.abs(p.y-7)<1e-8);
 reduce(s,'RobotPosition',{x:NaN,y:5},{selfId:4,now:5000});assert.equal(s.robots[4].positionAt,1000);
});
test('dynamic robot health never contaminates a different selected robot',()=>{
 const s=freshState();reduce(s,'RobotDynamicStatus',{current_health:0,current_heat:12},{selfId:103});assert.equal(s.robots[103].hp,0);assert.equal(s.robots[3].hp,null);
});
test('2027 eight-robot order and control points match official field tags 15/16',()=>{
 const d=root.lookupType('GlobalUnitStatus').toObject(root.lookupType('GlobalUnitStatus').decode(Buffer.from('780a800114','hex')));
 assert.deepEqual(d,{total_CP_ally:10,total_CP_enemy:20});
 const s=freshState();reduce(s,'GlobalUnitStatus',{robot_health:[1,3,4,7,101,103,104,107],...d},{team:'red'});
 for(const id of [1,3,4,7,101,103,104,107])assert.equal(s.robots[id].hp,id);
 assert.equal(s.robots[2],undefined);assert.equal(s.units.total_CP_enemy,20);
});
