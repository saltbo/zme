import { createTagLib, type TagLib, type WasmModule } from 'taglib-wasm'
import tagLibWasm from 'taglib-wasm/taglib-web.wasm'
import createTagLibModule from 'taglib-wasm/wrapper'

export async function initializeWorkerTagLib(): Promise<TagLib> {
  const module = (await createTagLibModule({ wasmModule: tagLibWasm })) as WasmModule
  return createTagLib(module)
}
