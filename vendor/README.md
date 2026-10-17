# Vendored physics engine

- Project: [Planck.js](https://github.com/piqnt/planck.js)
- Version: **1.5.0** (core UMD bundle; no testbed or Stage.js required)
- License: MIT, retained in `planck-LICENSE.txt` and the bundle header.
- Source: `https://unpkg.com/planck@1.5.0/dist/planck.js`
- License source: `https://unpkg.com/planck@1.5.0/LICENSE.txt`
- Local change: removed the trailing `sourceMappingURL` comment because the optional source map is not shipped.
- SHA-256 of the local bundle: `39862658b6ec015808df9d804efc4b25b8094813fad380b8f4e2ec6f5350dc46`

`index.html` loads this file before `src/physics.js`. Node tests require the same bundle. There are no CDN or package-install requirements at runtime. Keep the engine, license, and provenance together when distributing the project. Updates should be deliberate and followed by the full physics and control test suites.
