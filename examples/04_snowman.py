import cadquery as cq

# Snowman - three stacked balls (half-disks revolved into spheres), a carrot
# nose, a top hat (brim + crown) and two stick arms. Eight bodies.

sketch_1 = cq.Workplane(cq.Plane(origin=(0, 0, 0), normal=(0, -1, 0), xDir=(1, 0, 0)))
loop_1 = sketch_1.moveTo(0, -1.0).threePointArc((19.0, 18.0), (0, 37.0)).close()
sketch_1 = sketch_1.add(loop_1)
solid_1 = sketch_1.revolve(360, (0, 0, 0), (0, 1, 0))

sketch_2 = cq.Workplane(cq.Plane(origin=(0, 0, 0), normal=(0, -1, 0), xDir=(1, 0, 0)))
loop_1 = sketch_2.moveTo(0, 31.0).threePointArc((13.0, 44.0), (0, 57.0)).close()
sketch_2 = sketch_2.add(loop_1)
solid_2 = sketch_2.revolve(360, (0, 0, 0), (0, 1, 0))

sketch_3 = cq.Workplane(cq.Plane(origin=(0, 0, 0), normal=(0, -1, 0), xDir=(1, 0, 0)))
loop_1 = sketch_3.moveTo(0, 54.0).threePointArc((9.0, 63.0), (0, 72.0)).close()
sketch_3 = sketch_3.add(loop_1)
solid_3 = sketch_3.revolve(360, (0, 0, 0), (0, 1, 0))

sketch_4 = cq.Workplane(cq.Plane(origin=(0, -9.0, 0), normal=(0, -1, 0), xDir=(1, 0, 0)))
loop_1 = sketch_4.moveTo(-1.5, 61.5).lineTo(1.5, 61.5).lineTo(1.5, 64.5).lineTo(-1.5, 64.5).close()
sketch_4 = sketch_4.add(loop_1)
solid_4 = sketch_4.extrude(6.0)

sketch_5 = cq.Workplane(cq.Plane(origin=(0, 0, 70.0), normal=(0, 0, 1), xDir=(1, 0, 0)))
loop_1 = sketch_5.moveTo(0,0).circle(12)
sketch_5 = sketch_5.add(loop_1)
solid_5 = sketch_5.extrude(2.0)

sketch_6 = cq.Workplane(cq.Plane(origin=(0, 0, 72.0), normal=(0, 0, 1), xDir=(1, 0, 0)))
loop_1 = sketch_6.moveTo(0,0).circle(7)
sketch_6 = sketch_6.add(loop_1)
solid_6 = sketch_6.extrude(13.0)

sketch_7 = cq.Workplane(cq.Plane(origin=(-1.25, 0, 0), normal=(1, 0, 0), xDir=(0, 1, 0)))
loop_1 = sketch_7.moveTo(-1.25, 42.75).lineTo(1.25, 42.75).lineTo(1.25, 45.25).lineTo(-1.25, 45.25).close()
sketch_7 = sketch_7.add(loop_1)
solid_7 = sketch_7.extrude(20.0)

sketch_8 = cq.Workplane(cq.Plane(origin=(-1.25, 0, 0), normal=(1, 0, 0), xDir=(0, 1, 0)))
loop_1 = sketch_8.moveTo(-1.25, 42.75).lineTo(1.25, 42.75).lineTo(1.25, 45.25).lineTo(-1.25, 45.25).close()
sketch_8 = sketch_8.add(loop_1)
solid_8 = sketch_8.extrude(-20.0)

result = solid_1
result = result.add(solid_2)
result = result.add(solid_3)
result = result.add(solid_4)
result = result.add(solid_5)
result = result.add(solid_6)
result = result.add(solid_7)
result = result.add(solid_8)
