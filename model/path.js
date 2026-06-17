import path from 'node:path'
import fs from 'node:fs'
import { fileURLToPath } from 'node:url'

// 从当前文件路径向上回溯，找到插件根目录（包含 model/、config/ 等子目录）
// 这样插件放在 plugins/xxx、plugins/example/xxx 等任何位置都能正确解析
const __filename = fileURLToPath(import.meta.url)
const __dirname = path.dirname(__filename)

// 向上一级：model/ -> qunliao-plugin/
const _pluginRoot = path.resolve(__dirname, '..')
const pluginName = path.basename(_pluginRoot)

// Yunzai 根目录：从 _pluginRoot 向上查找，直到找到包含 plugins/ 子目录的目录
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

export { _path, pluginName, pluginRoot, pluginResources, pluginConfigDir }
