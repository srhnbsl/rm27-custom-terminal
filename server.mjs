import http from 'node:http';
import {readFileSync} from 'node:fs';
import {fileURLToPath} from 'node:url';
import {WebSocketServer} from 'ws';
import mqtt from 'mqtt';
import protobuf from 'protobufjs';
import {createServer as createViteServer} from 'vite';
const root=protobuf.parse(readFileSync(fileURLToPath(new URL('./protocol.proto',import.meta.url)),'utf8'),{keepCase:true}).root;
const topics=Object.keys(root.nested);
const vite=await createViteServer({server:{middlewareMode:true},appType:'spa'});
const server=http.createServer((req,res)=>vite.middlewares(req,res));
const wss=new WebSocketServer({noServer:true,maxPayload:65536});
const port=Number(process.env.PORT||5173);
server.on('upgrade',(req,socket,head)=>{
 if(req.url!=='/telemetry'){return;}
 if(req.headers.origin&&req.headers.origin!==`http://127.0.0.1:${port}`&&req.headers.origin!==`http://localhost:${port}`){socket.destroy();return;}
 wss.handleUpgrade(req,socket,head,ws=>wss.emit('connection',ws,req));
});
wss.on('connection',ws=>{
 let client=null;
 const send=m=>{if(ws.readyState===1)ws.send(JSON.stringify(m));};
 ws.on('message',raw=>{
  try {
   const msg=JSON.parse(raw);
   if(msg.action==='disconnect'){client?.end(true);client=null;send({kind:'status',status:'disconnected'});return;}
   if(msg.action!=='connect')return; // Receive-only. No robot control/publish endpoint.
   const {host,port:brokerPort,clientId}=msg;
   if(typeof host!=='string'||!/^([a-zA-Z0-9.-]|:)+$/.test(host)||!Number.isInteger(brokerPort)||brokerPort<1||brokerPort>65535||!/^([1-9]|10[1-9])$/.test(String(clientId)))throw Error('请检查服务器、端口及机器人 ID。');
   client?.end(true);
   const current=mqtt.connect(`mqtt://${host}:${brokerPort}`,{clientId:String(clientId),protocolVersion:4,clean:true,reconnectPeriod:2000,connectTimeout:5000});
   client=current;send({kind:'status',status:'connecting'});
   current.on('connect',()=>{if(client!==current)return;current.subscribe([...topics,'RadarInfoToClient'],{qos:1},err=>{if(client===current)send({kind:'status',status:err?'error':'connected',error:err?.message});});});
   current.on('message',(topic,payload)=>{
    if(client!==current)return;
    try {
     if(!topics.includes(topic)){send({kind:'unsupported',topic,bytes:payload.length});return;}
     const type=root.lookupType(topic),data=type.toObject(type.decode(payload),{longs:String,bytes:String,defaults:false});
     send({kind:'data',topic,data,at:Date.now()});
    }catch(e){send({kind:'decode-error',topic,error:e.message});}
   });
   for(const event of ['offline','reconnect','close'])current.on(event,()=>{if(client===current)send({kind:'status',status:event==='reconnect'?'connecting':'disconnected'});});
   current.on('error',e=>{if(client===current)send({kind:'status',status:'error',error:e.message});});
  } catch(e){send({kind:'status',status:'error',error:e.message});}
 });
 ws.on('close',()=>client?.end(true));
 send({kind:'status',status:'ready'});
});
server.listen(port,'127.0.0.1',()=>console.log(`RM27 terminal: http://127.0.0.1:${port}`));
for(const signal of ['SIGINT','SIGTERM'])process.on(signal,async()=>{for(const ws of wss.clients)ws.terminate();await vite.close();server.close(()=>process.exit(0));});
