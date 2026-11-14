import { defineConfig } from 'vite';
import { fileURLToPath } from 'node:url';
import { cpSync, mkdirSync } from 'node:fs';
import { join } from 'node:path';
const here=fileURLToPath(new URL('.',import.meta.url));
const cesiumRoot=join(here,'node_modules/cesium/Build/Cesium');
function copyRuntime() {
  const dest=join(here,'public/cesium');mkdirSync(dest,{recursive:true});
  for(const folder of ['Assets','Widgets','Workers','ThirdParty']) cpSync(join(cesiumRoot,folder),join(dest,folder),{recursive:true});
}
export default defineConfig({
  base:'./',
  define:{CESIUM_BASE_URL:JSON.stringify('./cesium/')},
  plugins:[{name:'cesium-runtime',buildStart:copyRuntime}],
  server:{fs:{allow:[fileURLToPath(new URL('../../',import.meta.url))]}},
});
