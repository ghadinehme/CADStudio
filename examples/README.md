# Examples

Complex, multi-step CadQuery models that import into a fully editable Studio CAD feature tree — each is
an assembly of several bodies built across multiple sketches, planes and revolves. Drag any onto the app,
or use **Import CadQuery .py**. Each is also a valid standalone CadQuery script.

| File | Bodies | Built from |
|------|:------:|------------|
| `01_chair.py`   | 6 | Four legs (sketch + extrude), a seat on a raised datum plane, and a backrest. |
| `02_house.py`   | 5 | Walls (a box), a gable roof (triangle extruded into a prism on the end plane), a chimney, a door and a window. |
| `03_rocket.py`  | 7 | A flared tail, body tube and nose cone (three revolves stacked on the axis) plus four fins (extruded triangles on the vertical planes). |
| `04_snowman.py` | 8 | Three stacked balls (half-disks revolved into spheres), a carrot nose, a top hat (brim + crown) and two stick arms. |
| `05_chess_set.py` | 16 | A back row of eight pieces (rook, knight, bishop, queen, king, bishop, knight, rook) with a pawn in front of each - every piece an extruded silhouette. |

Double-click any feature in the tree to edit it and the model rebuilds. See [`../samples/`](../samples/)
for larger machine-generated models, and [`../docs/API.md`](../docs/API.md) for the full script grammar.

> **Revolve tip:** the revolve axis is given in the sketch plane's *local* frame. For a profile in the
> XZ plane (`normal=(0,-1,0)`, `xDir=(1,0,0)`), axis `(0,1,0)` is the world Z (vertical) axis — this is
> how the pieces of the rocket and snowman stand upright.
