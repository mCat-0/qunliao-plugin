import path from 'node:path'
import fs from 'node:fs'
import { fileURLToPath, pathToFileURL } from 'node:url'

const __filename = fileURLToPath(import.meta.url)
const __dirname = path.dirname(__filename)

const _pluginRoot = path.resolve(__dirname, '..')
const pluginName = path.basename(_pluginRoot)

let yunzaiRoot = _pluginRoot
for (let i = 0; i < 10; i++) {
  const parent = path.dirname(yunzaiRoot)
  if (parent === yunzaiRoot) break
  const pluginsDir = path.join(parent, 'plugins')
  try {
    if (fs.existsSync(pluginsDir) && fs.statSync(pluginsDir).isDirectory()) {
      yunzaiRoot = parent
      break
    }
  } catch (_) { /* ignore */ }
  yunzaiRoot = parent
}

const _path = yunzaiRoot.replace(/\\/g, '/')
const pluginRoot = _pluginRoot.replace(/\\/g, '/')
const pluginResources = path.join(pluginRoot, 'resources').replace(/\\/g, '/')
const pluginConfigDir = path.join(pluginRoot, 'config').replace(/\\/g, '/')
const yunzaiPath = _path

function yunzaiLib (rel) {
  const parts = String(rel || '').split('/').filter(Boolean)
  const abs = path.join(yunzaiRoot, 'lib', ...parts)
  return pathToFileURL(abs).href
}

function yunzaiFromRoot (rel) {
  const abs = path.join(yunzaiRoot, rel)
  return pathToFileURL(abs).href
}

export {
  _path,
  pluginName,
  pluginRoot,
  pluginResources,
  pluginConfigDir,
  yunzaiPath,
  yunzaiLib,
  yunzaiFromRoot
}
