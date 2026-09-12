// One name for "whatever does the work". The static site sets
// window.ZC_BACKEND = 'local' before this module loads (see tools/build-site.mjs);
// the Node server serves the untouched index.html, so there it is undefined.
import { remote } from './backend-remote.js';
import { local } from './backend-local.js';

export const api = globalThis.ZC_BACKEND === 'local' ? local : remote;
