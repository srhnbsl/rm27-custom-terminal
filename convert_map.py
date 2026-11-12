"""Local CAD-derived PLY to browser GLB; display LOD, never a collision/precision map."""
from pathlib import Path
import numpy as np
import json,struct,shutil
root=Path(__file__).parent
source=Path(r'D:\自定义终端\RMUC_2027map_unity-main')
with (source/'Project/Assets/Field/field_geometry_m.ply').open('rb') as f:
    lines=[]
    while True:
        line=f.readline().decode('ascii').strip();lines.append(line)
        if line=='end_header':break
    nv=int(next(x.split()[-1] for x in lines if x.startswith('element vertex')))
    nf=int(next(x.split()[-1] for x in lines if x.startswith('element face')))
    vertices=np.fromfile(f,dtype='<f4',count=nv*3).reshape(-1,3)
    faces=np.fromfile(f,dtype=np.dtype([('n','u1'),('i','<i4',(3,)),('c','u1',(3,))]),count=nf)
assert np.all(faces['n']==3)
quant=np.round(vertices/0.012).astype(np.int32)
_,idx,inverse=np.unique(quant,axis=0,return_index=True,return_inverse=True)
v=vertices[idx].copy(); v[:,[1,2]]=v[:,[2,1]];v[:,2]*=-1
indices=inverse[faces['i']]
valid=(indices[:,0]!=indices[:,1])&(indices[:,1]!=indices[:,2])&(indices[:,0]!=indices[:,2])
indices=indices[valid];colors=faces['c'][valid]
palette,groups=np.unique(colors,axis=0,return_inverse=True)
blob=bytearray();views=[];accessors=[]
def add(data,component,kind,**extra):
    while len(blob)%4:blob.append(0)
    start=len(blob);blob.extend(data.tobytes());views.append({'buffer':0,'byteOffset':start,'byteLength':data.nbytes})
    accessors.append(dict(bufferView=len(views)-1,componentType=component,count=len(data),type=kind,**extra));return len(accessors)-1
pos=add(v.astype('<f4'),5126,'VEC3',min=v.min(axis=0).tolist(),max=v.max(axis=0).tolist())
primitives=[];materials=[]
for i,c in enumerate(palette):
    ii=indices[groups==i].astype('<u4')
    primitives.append({'attributes':{'POSITION':pos},'indices':add(ii.reshape(-1),5125,'SCALAR'),'material':i})
    materials.append({'pbrMetallicRoughness':{'baseColorFactor':[*((c/255).tolist()),1],'metallicFactor':0,'roughnessFactor':0.85},'doubleSided':True})
g={'asset':{'version':'2.0','generator':'RM27 display LOD 12mm vertex clustering'},'scene':0,'scenes':[{'nodes':[0]}],'nodes':[{'mesh':0}],'meshes':[{'primitives':primitives}],'materials':materials,'accessors':accessors,'bufferViews':views,'buffers':[{'byteLength':len(blob)}]}
j=json.dumps(g,separators=(',',':')).encode();j+=b' '*((-len(j))%4);blob+=b'\0'*((-len(blob))%4)
data=struct.pack('<III',0x46546c67,2,12+8+len(j)+8+len(blob))+struct.pack('<II',len(j),0x4e4f534a)+j+struct.pack('<II',len(blob),0x004e4942)+blob
(root/'public/field.glb').write_bytes(data)
shutil.copy(source/'map/rm2027-map.png',root/'public/map.png')
(root/'public/map-info.json').write_text(json.dumps({'sourceTriangles':nf,'displayTriangles':len(indices),'displayVertices':len(v),'clusterMeters':0.012,'mapReady':False,'basis':'Three(x,y,z) = CAD(x,z,-y)'},indent=2))
print(f'{nf} -> {len(indices)} triangles; {len(data)/1e6:.1f}MB')
