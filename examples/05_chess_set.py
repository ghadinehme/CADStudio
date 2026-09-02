import cadquery as cq

# Chess set - a back row of eight pieces (rook, knight, bishop, queen, king,
# bishop, knight, rook) with a pawn standing in front of each. Sixteen bodies:
# every piece is an extruded silhouette and imports as its own editable body.

sketch_1 = cq.Workplane(cq.Plane(origin=(0, 0.0, 0), normal=(0, -1, 0), xDir=(1, 0, 0)))
loop_1 = sketch_1.moveTo(-130.0, 0.0).lineTo(-108.0, 0.0).lineTo(-108.0, 3.0).lineTo(-112.0, 7.0).lineTo(-113.0, 11.0).lineTo(-113.0, 40.0).lineTo(-110.5, 43.0).lineTo(-110.5, 46.0).lineTo(-110.5, 54.0).lineTo(-114.5, 54.0).lineTo(-114.5, 48.0).lineTo(-117.4, 48.0).lineTo(-117.4, 54.0).lineTo(-120.6, 54.0).lineTo(-120.6, 48.0).lineTo(-123.5, 48.0).lineTo(-123.5, 54.0).lineTo(-127.5, 54.0).lineTo(-127.5, 46.0).lineTo(-127.5, 43.0).lineTo(-125.0, 40.0).lineTo(-125.0, 11.0).lineTo(-126.0, 7.0).lineTo(-130.0, 3.0).close()
sketch_1 = sketch_1.add(loop_1)
solid_1 = sketch_1.extrude(14)

sketch_2 = cq.Workplane(cq.Plane(origin=(0, 0.0, 0), normal=(0, -1, 0), xDir=(1, 0, 0)))
loop_1 = sketch_2.moveTo(-97.0, 0.0).lineTo(-73.0, 0.0).lineTo(-73.0, 3.0).lineTo(-77.0, 7.0).lineTo(-78.5, 13.0).lineTo(-78.5, 30.0).lineTo(-76.0, 40.0).lineTo(-76.0, 48.0).lineTo(-80.0, 52.0).lineTo(-83.0, 49.0).lineTo(-87.0, 54.0).lineTo(-92.0, 51.0).lineTo(-97.0, 45.0).lineTo(-100.0, 40.0).lineTo(-98.0, 37.0).lineTo(-101.0, 33.0).lineTo(-97.0, 31.0).lineTo(-93.0, 33.0).lineTo(-90.0, 31.0).lineTo(-89.0, 22.0).lineTo(-91.0, 14.0).lineTo(-93.5, 9.0).lineTo(-96.0, 5.0).close()
sketch_2 = sketch_2.add(loop_1)
solid_2 = sketch_2.extrude(14)

sketch_3 = cq.Workplane(cq.Plane(origin=(0, 0.0, 0), normal=(0, -1, 0), xDir=(1, 0, 0)))
loop_1 = sketch_3.moveTo(-61.0, 0.0).lineTo(-41.0, 0.0).lineTo(-41.0, 3.0).lineTo(-44.5, 7.0).lineTo(-46.8, 12.0).lineTo(-47.4, 28.0).lineTo(-44.8, 32.0).lineTo(-44.8, 35.0).lineTo(-48.0, 38.0).lineTo(-48.0, 41.0).lineTo(-46.0, 46.0).lineTo(-51.0, 55.0).lineTo(-56.0, 46.0).lineTo(-54.0, 41.0).lineTo(-54.0, 38.0).lineTo(-57.2, 35.0).lineTo(-57.2, 32.0).lineTo(-54.6, 28.0).lineTo(-55.2, 12.0).lineTo(-57.5, 7.0).lineTo(-61.0, 3.0).close()
sketch_3 = sketch_3.add(loop_1)
solid_3 = sketch_3.extrude(14)

sketch_4 = cq.Workplane(cq.Plane(origin=(0, 0.0, 0), normal=(0, -1, 0), xDir=(1, 0, 0)))
loop_1 = sketch_4.moveTo(-28.0, 0.0).lineTo(-6.0, 0.0).lineTo(-6.0, 3.0).lineTo(-10.0, 7.0).lineTo(-11.4, 13.0).lineTo(-12.0, 38.0).lineTo(-9.0, 42.0).lineTo(-9.0, 45.0).lineTo(-11.0, 56.0).lineTo(-13.0, 45.0).lineTo(-15.0, 56.0).lineTo(-17.0, 45.0).lineTo(-19.0, 56.0).lineTo(-21.0, 45.0).lineTo(-23.0, 56.0).lineTo(-25.0, 45.0).lineTo(-25.0, 42.0).lineTo(-22.0, 38.0).lineTo(-22.6, 13.0).lineTo(-24.0, 7.0).lineTo(-28.0, 3.0).close()
sketch_4 = sketch_4.add(loop_1)
solid_4 = sketch_4.extrude(14)

sketch_5 = cq.Workplane(cq.Plane(origin=(0, 0.0, 0), normal=(0, -1, 0), xDir=(1, 0, 0)))
loop_1 = sketch_5.moveTo(6.0, 0.0).lineTo(28.0, 0.0).lineTo(28.0, 3.0).lineTo(24.0, 7.0).lineTo(22.5, 13.0).lineTo(22.0, 40.0).lineTo(25.0, 44.0).lineTo(25.0, 47.0).lineTo(19.5, 47.0).lineTo(19.5, 53.0).lineTo(17.0, 53.0).lineTo(14.5, 53.0).lineTo(14.5, 47.0).lineTo(9.0, 47.0).lineTo(9.0, 44.0).lineTo(12.0, 40.0).lineTo(11.5, 13.0).lineTo(10.0, 7.0).lineTo(6.0, 3.0).close()
sketch_5 = sketch_5.add(loop_1)
solid_5 = sketch_5.extrude(14)

sketch_6 = cq.Workplane(cq.Plane(origin=(0, 0.0, 0), normal=(0, -1, 0), xDir=(1, 0, 0)))
loop_1 = sketch_6.moveTo(41.0, 0.0).lineTo(61.0, 0.0).lineTo(61.0, 3.0).lineTo(57.5, 7.0).lineTo(55.2, 12.0).lineTo(54.6, 28.0).lineTo(57.2, 32.0).lineTo(57.2, 35.0).lineTo(54.0, 38.0).lineTo(54.0, 41.0).lineTo(56.0, 46.0).lineTo(51.0, 55.0).lineTo(46.0, 46.0).lineTo(48.0, 41.0).lineTo(48.0, 38.0).lineTo(44.8, 35.0).lineTo(44.8, 32.0).lineTo(47.4, 28.0).lineTo(46.8, 12.0).lineTo(44.5, 7.0).lineTo(41.0, 3.0).close()
sketch_6 = sketch_6.add(loop_1)
solid_6 = sketch_6.extrude(14)

sketch_7 = cq.Workplane(cq.Plane(origin=(0, 0.0, 0), normal=(0, -1, 0), xDir=(1, 0, 0)))
loop_1 = sketch_7.moveTo(97.0, 0.0).lineTo(73.0, 0.0).lineTo(73.0, 3.0).lineTo(77.0, 7.0).lineTo(78.5, 13.0).lineTo(78.5, 30.0).lineTo(76.0, 40.0).lineTo(76.0, 48.0).lineTo(80.0, 52.0).lineTo(83.0, 49.0).lineTo(87.0, 54.0).lineTo(92.0, 51.0).lineTo(97.0, 45.0).lineTo(100.0, 40.0).lineTo(98.0, 37.0).lineTo(101.0, 33.0).lineTo(97.0, 31.0).lineTo(93.0, 33.0).lineTo(90.0, 31.0).lineTo(89.0, 22.0).lineTo(91.0, 14.0).lineTo(93.5, 9.0).lineTo(96.0, 5.0).close()
sketch_7 = sketch_7.add(loop_1)
solid_7 = sketch_7.extrude(14)

sketch_8 = cq.Workplane(cq.Plane(origin=(0, 0.0, 0), normal=(0, -1, 0), xDir=(1, 0, 0)))
loop_1 = sketch_8.moveTo(108.0, 0.0).lineTo(130.0, 0.0).lineTo(130.0, 3.0).lineTo(126.0, 7.0).lineTo(125.0, 11.0).lineTo(125.0, 40.0).lineTo(127.5, 43.0).lineTo(127.5, 46.0).lineTo(127.5, 54.0).lineTo(123.5, 54.0).lineTo(123.5, 48.0).lineTo(120.6, 48.0).lineTo(120.6, 54.0).lineTo(117.4, 54.0).lineTo(117.4, 48.0).lineTo(114.5, 48.0).lineTo(114.5, 54.0).lineTo(110.5, 54.0).lineTo(110.5, 46.0).lineTo(110.5, 43.0).lineTo(113.0, 40.0).lineTo(113.0, 11.0).lineTo(112.0, 7.0).lineTo(108.0, 3.0).close()
sketch_8 = sketch_8.add(loop_1)
solid_8 = sketch_8.extrude(14)

sketch_9 = cq.Workplane(cq.Plane(origin=(0, 18.0, 0), normal=(0, -1, 0), xDir=(1, 0, 0)))
loop_1 = sketch_9.moveTo(-128.0, 0.0).lineTo(-110.0, 0.0).lineTo(-110.0, 3.0).lineTo(-113.0, 6.0).lineTo(-114.8, 10.0).lineTo(-115.4, 20.0).lineTo(-113.4, 23.0).lineTo(-113.4, 25.5).lineTo(-116.0, 28.5).lineTo(-116.0, 30.5).lineTo(-114.0, 33.0).lineTo(-113.4, 36.0).lineTo(-115.4, 38.5).lineTo(-119.0, 41.0).lineTo(-122.6, 38.5).lineTo(-124.6, 36.0).lineTo(-124.0, 33.0).lineTo(-122.0, 30.5).lineTo(-122.0, 28.5).lineTo(-124.6, 25.5).lineTo(-124.6, 23.0).lineTo(-122.6, 20.0).lineTo(-123.2, 10.0).lineTo(-125.0, 6.0).lineTo(-128.0, 3.0).close()
sketch_9 = sketch_9.add(loop_1)
solid_9 = sketch_9.extrude(14)

sketch_10 = cq.Workplane(cq.Plane(origin=(0, 18.0, 0), normal=(0, -1, 0), xDir=(1, 0, 0)))
loop_1 = sketch_10.moveTo(-94.0, 0.0).lineTo(-76.0, 0.0).lineTo(-76.0, 3.0).lineTo(-79.0, 6.0).lineTo(-80.8, 10.0).lineTo(-81.4, 20.0).lineTo(-79.4, 23.0).lineTo(-79.4, 25.5).lineTo(-82.0, 28.5).lineTo(-82.0, 30.5).lineTo(-80.0, 33.0).lineTo(-79.4, 36.0).lineTo(-81.4, 38.5).lineTo(-85.0, 41.0).lineTo(-88.6, 38.5).lineTo(-90.6, 36.0).lineTo(-90.0, 33.0).lineTo(-88.0, 30.5).lineTo(-88.0, 28.5).lineTo(-90.6, 25.5).lineTo(-90.6, 23.0).lineTo(-88.6, 20.0).lineTo(-89.2, 10.0).lineTo(-91.0, 6.0).lineTo(-94.0, 3.0).close()
sketch_10 = sketch_10.add(loop_1)
solid_10 = sketch_10.extrude(14)

sketch_11 = cq.Workplane(cq.Plane(origin=(0, 18.0, 0), normal=(0, -1, 0), xDir=(1, 0, 0)))
loop_1 = sketch_11.moveTo(-60.0, 0.0).lineTo(-42.0, 0.0).lineTo(-42.0, 3.0).lineTo(-45.0, 6.0).lineTo(-46.8, 10.0).lineTo(-47.4, 20.0).lineTo(-45.4, 23.0).lineTo(-45.4, 25.5).lineTo(-48.0, 28.5).lineTo(-48.0, 30.5).lineTo(-46.0, 33.0).lineTo(-45.4, 36.0).lineTo(-47.4, 38.5).lineTo(-51.0, 41.0).lineTo(-54.6, 38.5).lineTo(-56.6, 36.0).lineTo(-56.0, 33.0).lineTo(-54.0, 30.5).lineTo(-54.0, 28.5).lineTo(-56.6, 25.5).lineTo(-56.6, 23.0).lineTo(-54.6, 20.0).lineTo(-55.2, 10.0).lineTo(-57.0, 6.0).lineTo(-60.0, 3.0).close()
sketch_11 = sketch_11.add(loop_1)
solid_11 = sketch_11.extrude(14)

sketch_12 = cq.Workplane(cq.Plane(origin=(0, 18.0, 0), normal=(0, -1, 0), xDir=(1, 0, 0)))
loop_1 = sketch_12.moveTo(-26.0, 0.0).lineTo(-8.0, 0.0).lineTo(-8.0, 3.0).lineTo(-11.0, 6.0).lineTo(-12.8, 10.0).lineTo(-13.4, 20.0).lineTo(-11.4, 23.0).lineTo(-11.4, 25.5).lineTo(-14.0, 28.5).lineTo(-14.0, 30.5).lineTo(-12.0, 33.0).lineTo(-11.4, 36.0).lineTo(-13.4, 38.5).lineTo(-17.0, 41.0).lineTo(-20.6, 38.5).lineTo(-22.6, 36.0).lineTo(-22.0, 33.0).lineTo(-20.0, 30.5).lineTo(-20.0, 28.5).lineTo(-22.6, 25.5).lineTo(-22.6, 23.0).lineTo(-20.6, 20.0).lineTo(-21.2, 10.0).lineTo(-23.0, 6.0).lineTo(-26.0, 3.0).close()
sketch_12 = sketch_12.add(loop_1)
solid_12 = sketch_12.extrude(14)

sketch_13 = cq.Workplane(cq.Plane(origin=(0, 18.0, 0), normal=(0, -1, 0), xDir=(1, 0, 0)))
loop_1 = sketch_13.moveTo(8.0, 0.0).lineTo(26.0, 0.0).lineTo(26.0, 3.0).lineTo(23.0, 6.0).lineTo(21.2, 10.0).lineTo(20.6, 20.0).lineTo(22.6, 23.0).lineTo(22.6, 25.5).lineTo(20.0, 28.5).lineTo(20.0, 30.5).lineTo(22.0, 33.0).lineTo(22.6, 36.0).lineTo(20.6, 38.5).lineTo(17.0, 41.0).lineTo(13.4, 38.5).lineTo(11.4, 36.0).lineTo(12.0, 33.0).lineTo(14.0, 30.5).lineTo(14.0, 28.5).lineTo(11.4, 25.5).lineTo(11.4, 23.0).lineTo(13.4, 20.0).lineTo(12.8, 10.0).lineTo(11.0, 6.0).lineTo(8.0, 3.0).close()
sketch_13 = sketch_13.add(loop_1)
solid_13 = sketch_13.extrude(14)

sketch_14 = cq.Workplane(cq.Plane(origin=(0, 18.0, 0), normal=(0, -1, 0), xDir=(1, 0, 0)))
loop_1 = sketch_14.moveTo(42.0, 0.0).lineTo(60.0, 0.0).lineTo(60.0, 3.0).lineTo(57.0, 6.0).lineTo(55.2, 10.0).lineTo(54.6, 20.0).lineTo(56.6, 23.0).lineTo(56.6, 25.5).lineTo(54.0, 28.5).lineTo(54.0, 30.5).lineTo(56.0, 33.0).lineTo(56.6, 36.0).lineTo(54.6, 38.5).lineTo(51.0, 41.0).lineTo(47.4, 38.5).lineTo(45.4, 36.0).lineTo(46.0, 33.0).lineTo(48.0, 30.5).lineTo(48.0, 28.5).lineTo(45.4, 25.5).lineTo(45.4, 23.0).lineTo(47.4, 20.0).lineTo(46.8, 10.0).lineTo(45.0, 6.0).lineTo(42.0, 3.0).close()
sketch_14 = sketch_14.add(loop_1)
solid_14 = sketch_14.extrude(14)

sketch_15 = cq.Workplane(cq.Plane(origin=(0, 18.0, 0), normal=(0, -1, 0), xDir=(1, 0, 0)))
loop_1 = sketch_15.moveTo(76.0, 0.0).lineTo(94.0, 0.0).lineTo(94.0, 3.0).lineTo(91.0, 6.0).lineTo(89.2, 10.0).lineTo(88.6, 20.0).lineTo(90.6, 23.0).lineTo(90.6, 25.5).lineTo(88.0, 28.5).lineTo(88.0, 30.5).lineTo(90.0, 33.0).lineTo(90.6, 36.0).lineTo(88.6, 38.5).lineTo(85.0, 41.0).lineTo(81.4, 38.5).lineTo(79.4, 36.0).lineTo(80.0, 33.0).lineTo(82.0, 30.5).lineTo(82.0, 28.5).lineTo(79.4, 25.5).lineTo(79.4, 23.0).lineTo(81.4, 20.0).lineTo(80.8, 10.0).lineTo(79.0, 6.0).lineTo(76.0, 3.0).close()
sketch_15 = sketch_15.add(loop_1)
solid_15 = sketch_15.extrude(14)

sketch_16 = cq.Workplane(cq.Plane(origin=(0, 18.0, 0), normal=(0, -1, 0), xDir=(1, 0, 0)))
loop_1 = sketch_16.moveTo(110.0, 0.0).lineTo(128.0, 0.0).lineTo(128.0, 3.0).lineTo(125.0, 6.0).lineTo(123.2, 10.0).lineTo(122.6, 20.0).lineTo(124.6, 23.0).lineTo(124.6, 25.5).lineTo(122.0, 28.5).lineTo(122.0, 30.5).lineTo(124.0, 33.0).lineTo(124.6, 36.0).lineTo(122.6, 38.5).lineTo(119.0, 41.0).lineTo(115.4, 38.5).lineTo(113.4, 36.0).lineTo(114.0, 33.0).lineTo(116.0, 30.5).lineTo(116.0, 28.5).lineTo(113.4, 25.5).lineTo(113.4, 23.0).lineTo(115.4, 20.0).lineTo(114.8, 10.0).lineTo(113.0, 6.0).lineTo(110.0, 3.0).close()
sketch_16 = sketch_16.add(loop_1)
solid_16 = sketch_16.extrude(14)

result = solid_1
try:
    result = result.union(solid_2)
except Exception:
    result = result.add(solid_2)
try:
    result = result.union(solid_3)
except Exception:
    result = result.add(solid_3)
try:
    result = result.union(solid_4)
except Exception:
    result = result.add(solid_4)
try:
    result = result.union(solid_5)
except Exception:
    result = result.add(solid_5)
try:
    result = result.union(solid_6)
except Exception:
    result = result.add(solid_6)
try:
    result = result.union(solid_7)
except Exception:
    result = result.add(solid_7)
try:
    result = result.union(solid_8)
except Exception:
    result = result.add(solid_8)
try:
    result = result.union(solid_9)
except Exception:
    result = result.add(solid_9)
try:
    result = result.union(solid_10)
except Exception:
    result = result.add(solid_10)
try:
    result = result.union(solid_11)
except Exception:
    result = result.add(solid_11)
try:
    result = result.union(solid_12)
except Exception:
    result = result.add(solid_12)
try:
    result = result.union(solid_13)
except Exception:
    result = result.add(solid_13)
try:
    result = result.union(solid_14)
except Exception:
    result = result.add(solid_14)
try:
    result = result.union(solid_15)
except Exception:
    result = result.add(solid_15)
try:
    result = result.union(solid_16)
except Exception:
    result = result.add(solid_16)
cq.exporters.export(result, "model.step")
# show_object(result)
