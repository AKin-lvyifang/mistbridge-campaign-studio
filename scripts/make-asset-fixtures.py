"""Generate original, redistributable decoder fixtures, never game artwork."""
from pathlib import Path
import hashlib
import json
import struct
import sys
import zlib
from PIL import Image
ROOT=Path(__file__).resolve().parent.parent
sys.path.insert(0,str(ROOT/'tests'))
sys.path.insert(0,str(ROOT))
from test_asset_dat import synthetic_dat
from test_sld_preview import sld, frame, main_layer, bc1
DEST=ROOT/'fixtures/synthetic-assets'
graphics=DEST/'resources/_common/drs/graphics'
textures=DEST/'resources/_common/terrain/textures'
dat_dir=DEST/'resources/_common/dat'
for p in (graphics,textures,dat_dir):p.mkdir(parents=True,exist_ok=True)
# A purposely blocky cyan/orange survey marker. It has never been game artwork.
blocks=[]
for by in range(48):
 for bx in range(48):
  x,y=bx*4+2,by*4+2
  if 88<=x<104 and 72<=y<168: blocks.append(bc1(0xA514,0))
  elif abs(x-96)+abs(y-68)<50: blocks.append(bc1(0x06BF if x<96 else 0x0494,0))
  elif abs(x-96)+2*abs(y-166)<44: blocks.append(bc1(0xFD20,0))
  else: blocks.append(bc1(0,0,[3]*16))
commands=[];left=len(blocks)
while left: n=min(255,left);commands.append((0,n));left-=n
raw=sld(frame(canvas=(192,192),hotspot=(96,168),layers=[(1,main_layer(bounds=(0,0,192,192),commands=commands,blocks=b''.join(blocks)))]))
(graphics/'fixture_acorn_marker.sld').write_bytes(raw)
image=Image.new('RGBA',(64,64));pixels=image.load()
for y in range(64):
 for x in range(64):
  shade=25 if (x//16+y//16)%2 else 0
  pixels[x,y]=(66+shade,108+shade,71+shade,255)
image.save(textures/'fixture_texture_0.dds')
dat=synthetic_dat();unit=dat.civs[1].units[7];unit.id=109;dat.civs[1].units=[None]*109+[unit]
(dat_dir/'empires2_x2_p1.dat').write_bytes(zlib.compress(dat.to_bytes(),wbits=-15))
manifest={str(p.relative_to(DEST)):hashlib.sha256(p.read_bytes()).hexdigest() for p in sorted(DEST.rglob('*')) if p.is_file() and p.suffix in {'.sld','.dds','.dat'}}
(DEST/'SHA256SUMS.json').write_text(json.dumps(manifest,indent=2)+'\n')
print(json.dumps(manifest,indent=2))
