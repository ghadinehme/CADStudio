import cadquery as cq

# House - walls (a box), a gable roof (a triangle extruded into a prism), a
# chimney, a door and a window. Five bodies across several planes.

sketch_1 = cq.Workplane(cq.Plane(origin=(0, 0, 0.0), normal=(0, 0, 1), xDir=(1, 0, 0)))
loop_1 = sketch_1.moveTo(-32.0, -22.0).lineTo(32.0, -22.0).lineTo(32.0, 22.0).lineTo(-32.0, 22.0).close()
sketch_1 = sketch_1.add(loop_1)
solid_1 = sketch_1.extrude(38.0)

sketch_2 = cq.Workplane(cq.Plane(origin=(-32.0, 0, 0), normal=(1, 0, 0), xDir=(0, 1, 0)))
loop_1 = sketch_2.moveTo(-22.0, 38.0).lineTo(22.0, 38.0).lineTo(0.0, 60.0).close()
sketch_2 = sketch_2.add(loop_1)
solid_2 = sketch_2.extrude(64.0)

sketch_3 = cq.Workplane(cq.Plane(origin=(0, 0, 38.0), normal=(0, 0, 1), xDir=(1, 0, 0)))
loop_1 = sketch_3.moveTo(12.5, 6.5).lineTo(19.5, 6.5).lineTo(19.5, 13.5).lineTo(12.5, 13.5).close()
sketch_3 = sketch_3.add(loop_1)
solid_3 = sketch_3.extrude(24.0)

sketch_4 = cq.Workplane(cq.Plane(origin=(0, -22.0, 0), normal=(0, -1, 0), xDir=(1, 0, 0)))
loop_1 = sketch_4.moveTo(-7.0, 0.0).lineTo(7.0, 0.0).lineTo(7.0, 24.0).lineTo(-7.0, 24.0).close()
sketch_4 = sketch_4.add(loop_1)
solid_4 = sketch_4.extrude(3.0)

sketch_5 = cq.Workplane(cq.Plane(origin=(0, -22.0, 0), normal=(0, -1, 0), xDir=(1, 0, 0)))
loop_1 = sketch_5.moveTo(-22.5, 21.5).lineTo(-13.5, 21.5).lineTo(-13.5, 30.5).lineTo(-22.5, 30.5).close()
sketch_5 = sketch_5.add(loop_1)
solid_5 = sketch_5.extrude(2.0)

result = solid_1
result = result.add(solid_2)
result = result.add(solid_3)
result = result.add(solid_4)
result = result.add(solid_5)
