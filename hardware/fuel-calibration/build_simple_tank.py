from pathlib import Path
import cadquery as cq
ROOT=Path(__file__).resolve().parent
HEIGHT=70.0
WIDTH=80.0
LENGTH=100.0
WALL=3.0
FLOOR=4.0
PROBE_OD=23.22
BORE=23.10
GAP=30.0

def block(x,y,z,at=(0,0,0)):
 return cq.Workplane("XY").box(x,y,z,centered=(True,True,False)).translate(at)

def make():
 tank=block(LENGTH+2*WALL,WIDTH+2*WALL,HEIGHT+FLOOR).cut(block(LENGTH,WIDTH,HEIGHT+1,(0,0,FLOOR)))
 # Exterior 500 mL MAX line: inner area 8000 mm2 -> 62.5 mm water depth.
 tank=tank.cut(block(55,.5,.65,(0,-42.8,FLOOR+62.5)))
 # Removable holder: U clip fits the 3 mm rear rim with 0.3 mm total clearance.
 # Z=0 here is tank outer floor, Y=40 is inner rear wall.
 ztop=FLOOR+HEIGHT
 clip=block(24,11.3,8,(0,41.5,ztop-6)).cut(block(26,3.3,6.1,(0,41.5,ztop-6.1)))
 # Outside upright and short bridge carry a round, slightly undersized bore.
 ringz=ztop+GAP
 post=block(18,5,ringz-(ztop-4)+5,(0,47,ztop-4))
 arm=block(18,28,5,(0,35.5,ringz))
 ring=cq.Workplane("XY").center(0,20).circle(17).circle(BORE/2).extrude(5).translate((0,0,ringz))
 holder=clip.union(post).union(arm).union(ring)
 # Clear the bore through the arm too; split relieves the tight press-fit ring.
 holder=holder.cut(cq.Workplane("XY").center(0,20).circle(BORE/2).extrude(9).translate((0,0,ringz-2)))
 holder=holder.cut(block(1,10,9,(0,6,ringz-2)))
 return tank,holder

if __name__ == "__main__":
 out=ROOT/"print"
 out.mkdir(exist_ok=True)
 tank,holder=make()
 coupon=cq.Workplane("XY").circle(17).circle(BORE/2).extrude(5).cut(block(1,10,9,(0,-14,-2)))
 parts={"Open_Tank_500mL_MAX":tank,"23.22mm_Probe_Clip_Holder":holder.rotate((0,0,0),(1,0,0),90),"Optional_Pressfit_Test":coupon}
 for name,shape in parts.items():
  b=shape.val().BoundingBox()
  shape=shape.translate((-b.xmin,-b.ymin,-b.zmin))
  cq.exporters.export(shape,str(out/(name+".stl")),tolerance=.035,angularTolerance=.1)
 print("Exported three STL files in",out)
