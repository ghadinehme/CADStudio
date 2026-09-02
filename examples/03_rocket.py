import cadquery as cq

# Rocket - a flared tail, body tube and nose cone (three revolves on the axis)
# plus four fins (extruded triangles on the vertical planes). Seven bodies.

sketch_1 = cq.Workplane(cq.Plane(origin=(0, 0, 0), normal=(0, -1, 0), xDir=(1, 0, 0)))
loop_1 = sketch_1.moveTo(0.0, 0.0).lineTo(14.0, 0.0).lineTo(10.0, 15.0).lineTo(0.0, 15.0).close()
sketch_1 = sketch_1.add(loop_1)
solid_1 = sketch_1.revolve(360, (0, 0, 0), (0, 1, 0))

sketch_2 = cq.Workplane(cq.Plane(origin=(0, 0, 0), normal=(0, -1, 0), xDir=(1, 0, 0)))
loop_1 = sketch_2.moveTo(0.0, 15.0).lineTo(10.0, 15.0).lineTo(10.0, 70.0).lineTo(0.0, 70.0).close()
sketch_2 = sketch_2.add(loop_1)
solid_2 = sketch_2.revolve(360, (0, 0, 0), (0, 1, 0))

sketch_3 = cq.Workplane(cq.Plane(origin=(0, 0, 0), normal=(0, -1, 0), xDir=(1, 0, 0)))
loop_1 = sketch_3.moveTo(0.0, 70.0).lineTo(10.0, 70.0).lineTo(0.0, 96.0).close()
sketch_3 = sketch_3.add(loop_1)
solid_3 = sketch_3.revolve(360, (0, 0, 0), (0, 1, 0))

sketch_4 = cq.Workplane(cq.Plane(origin=(0, 1.5, 0), normal=(0, -1, 0), xDir=(1, 0, 0)))
loop_1 = sketch_4.moveTo(10.0, 2.0).lineTo(24.0, 2.0).lineTo(10.0, 22.0).close()
sketch_4 = sketch_4.add(loop_1)
solid_4 = sketch_4.extrude(3.0)

sketch_5 = cq.Workplane(cq.Plane(origin=(0, 1.5, 0), normal=(0, -1, 0), xDir=(1, 0, 0)))
loop_1 = sketch_5.moveTo(-10.0, 2.0).lineTo(-24.0, 2.0).lineTo(-10.0, 22.0).close()
sketch_5 = sketch_5.add(loop_1)
solid_5 = sketch_5.extrude(3.0)

sketch_6 = cq.Workplane(cq.Plane(origin=(-1.5, 0, 0), normal=(1, 0, 0), xDir=(0, 1, 0)))
loop_1 = sketch_6.moveTo(10.0, 2.0).lineTo(24.0, 2.0).lineTo(10.0, 22.0).close()
sketch_6 = sketch_6.add(loop_1)
solid_6 = sketch_6.extrude(3.0)

sketch_7 = cq.Workplane(cq.Plane(origin=(-1.5, 0, 0), normal=(1, 0, 0), xDir=(0, 1, 0)))
loop_1 = sketch_7.moveTo(-10.0, 2.0).lineTo(-24.0, 2.0).lineTo(-10.0, 22.0).close()
sketch_7 = sketch_7.add(loop_1)
solid_7 = sketch_7.extrude(3.0)

result = solid_1
result = result.add(solid_2)
result = result.add(solid_3)
result = result.add(solid_4)
result = result.add(solid_5)
result = result.add(solid_6)
result = result.add(solid_7)
