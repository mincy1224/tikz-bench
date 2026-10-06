# Large-document selection regression

The refactored format panel rebuilt every editable object on each store update.
Each ordinary object reparsed the full source twice, and repeatedly scanned the
scene for its text. A 400-object query therefore parsed the document about 801
times. Clicking also eagerly prepared a drag, including snapping and semantic
evaluation, even when the pointer never moved.

The fix resolves only selected objects, parses once for standalone queries,
reuses matching canvas parse results, indexes nodes and text, and memoizes panel
queries. Format painter queries use the same selected-object path. Drag
preparation starts after the existing four-pixel pointer movement threshold;
the gesture retains its original start position.

Validation on Windows with Edge and the production web build:

- 17 targeted unit tests passed. The regression verifies one parse for a full
  400-object query and zero additional parses when reusing the canvas AST.
- Typecheck and production lint passed.
- Nine focused browser tests passed: selection, group drag/undo, continuous
  keyboard input, project validation, format painter, compiled Forest mapping
  (mock compiler), partition/formula editing, arrows, and narrow dark layout.
- 400 nodes: five real click-to-panel measurements, 167–203 ms.
- 1000 nodes: five real click-to-panel measurements, 294–317 ms. Before delaying
  drag preparation, the 1000-node test stalled and exceeded its 60-second timeout.

The measurements include Playwright click overhead and panel assertions. They
are local results, not guarantees for all document contents or target machines.
Continuous keyboard input in this regression run used a one-second gesture;
the earlier 30-second acceptance test is recorded separately. Real TeX and
Ubuntu/systemd compilation performance was not measured here.

After pushing the commit, reinstall from the source checkout using:

```bash
cd ~/tikz-bench && git pull --ff-only && nvm use 22 && bash install.sh
```

No new database path is needed for this performance fix. The installer preserves
the configured database and existing TeX Live.
