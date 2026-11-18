# vendor/three

Third-party code. three.js is © the three.js authors and licensed MIT (see [LICENSE](LICENSE)).
Files are copied unmodified from the npm package; only what `pi-crystal/` uses is kept.

| | |
|---|---|
| Package | `three@0.170.0` (npm) |
| Tarball integrity | `sha512-FQK+LEpYc0fBD+J8g6oSEyyNzjp+Q7Ks1C568WWaoMRLW+TkNNWmenWeGgJjV105Gd+p/2ql1ZcjYvNiPZBhuQ==` (matches `npm view three@0.170.0 dist.integrity`) |
| `build/` | `build/three.module.min.js` |
| `addons/` | from `examples/jsm/`: `controls/OrbitControls.js`; `environments/RoomEnvironment.js`; `postprocessing/{EffectComposer,RenderPass,UnrealBloomPass,OutputPass,Pass,ShaderPass,MaskPass}.js`; `shaders/{CopyShader,LuminosityHighPassShader,OutputShader}.js` |

Pages load it through an import map: `"three"` → `build/three.module.min.js`,
`"three/addons/"` → `addons/`. To upgrade, `npm pack three@<exact version>` in an empty directory,
check the integrity against `npm view`, copy the same files, and update this table.
