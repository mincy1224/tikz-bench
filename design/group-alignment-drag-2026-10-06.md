# Group alignment and drag verification

Group alignment uses the union of descendant world bounds. Each target displacement is planned against the same source snapshot and written atomically. A group's world displacement is transformed through the inverse parent linear transform before adding its scope translation; its own rotation, scale and styles remain intact. Parent/child selections move only the outermost selected object.

Dragging prepares source writers once per gesture and coalesces pointer events through requestAnimationFrame. Independent geometry and fully following connections use temporary SVG translations, including selection overlays, while the source remains unchanged. Release writes the final source once through the existing transaction; Escape restores the original display and source. The inspector remains stable during movement. Clipped, opaque or partially dependent geometry retains semantic previews for correctness; the fast path is not claimed for arbitrary macros or all advanced geometry.

Validation on Windows with headless Microsoft Edge:

- 86 related unit tests passed, including all six alignment modes with plain, nested and transformed-picture frames, anchored selection and immutable prepared previews.
- Six capability checks passed. The corpus test was skipped by its environment prerequisite.
- Browser checks passed for panel/menu group alignment, multi-selection with anchored arrows, keyboard movement, one-step undo and Escape cancellation.
- With six moving shapes and 200 additional shapes, the group and multi-selection tests recorded a 4ms p95 animation-frame interval over 1.2-second gestures (maximum 54ms in the final run). These are local headless measurements, not a display frame-rate guarantee.
- Type checking, production lint, core build and production web build passed. Existing bundler chunk warnings remain.

Ubuntu/WSL2, systemd and real TeX Live were not tested in this environment. Installation should reuse the configured database and existing TeX installation.
