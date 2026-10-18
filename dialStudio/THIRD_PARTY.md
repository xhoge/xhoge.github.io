# GIF processing dependencies

- gifenc 1.0.3 — MIT — https://github.com/mattdesl/gifenc — npm archive https://registry.npmjs.org/gifenc/-/gifenc-1.0.3.tgz
- omggif 1.0.10 — MIT — https://github.com/deanm/omggif — npm archive https://registry.npmjs.org/omggif/-/omggif-1.0.10.tgz

License texts are included in vendor/. gifenc's distributed ES module is used. omggif has a small local ES-module export adapter appended; its decoder/writer code is otherwise unchanged. The resize/compositing/limits/worker/UI integration is in gif-tools.mjs, gif-worker.mjs and studio.mjs.

The application does not require a package-manager install or a CDN import at runtime. Keep the complete vendor/ directory alongside the Web modules.
