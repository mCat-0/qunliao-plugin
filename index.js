import fs from 'node:fs'
import path from 'node:path'
import Config from './components/Config.js'
import { pluginRoot, pluginName, _path } from './model/path.js'

if (!global.segment) {
  global.segment = (await import('oicq')).segment
}

// ============================================================
// 启动初始化：读取配置并输出模块启用状态
// ============================================================
const loadedConfig = Config.getConfig('config') || {}
const moduleKeys = Object.keys(loadedConfig).filter((k) => {
  return loadedConfig[k] && typeof loadedConfig[k] === 'object' && 'enabled' in loadedConfig[k]
})
const enabledCount = moduleKeys.filter((k) => loadedConfig[k].enabled !== false).length

console.log(
  `[${pluginName}] 正在加载 qunliao-plugin`
)
console.log(`[${pluginName}] 插件根目录: ${pluginRoot}`)
console.log(
  `[${pluginName}] 已读取配置，共发现 ${moduleKeys.length} 个可配置模块，其中 ${enabledCount} 个已启用`
)
if (moduleKeys.length > 0) {
  moduleKeys.forEach((k) => {
    const enabled = loadedConfig[k].enabled !== false
    console.log(
      `  ${enabled ? '✅' : '⛔'}  ${k}  -> ${enabled ? '启用' : '禁用'}`
    )
  })
}

// ============================================================
// 动态加载 apps 目录下的所有模块
// ============================================================
// apps 目录的绝对路径（从 pluginRoot 计算）
const appsDir = path.join(pluginRoot, 'apps')

let ret = []
let files = []
try {
  files = fs
    .readdirSync(appsDir)
    .filter((file) => file.endsWith('.js'))
} catch (err) {
  // 如果 apps 目录不存在则降级为空
  console.warn(`[${pluginName}] apps 目录不存在: ${appsDir}`)
  files = []
}

files.forEach((file) => {
  ret.push(import(`./apps/${file}`))
})

ret = await Promise.allSettled(ret)

const apps = {}
for (let i = 0; i < files.length; i++) {
  const name = files[i].replace('.js', '')
  if (ret[i].status !== 'fulfilled') {
    console.error(`[${pluginName}] 模块加载失败: ${name}`)
    console.error(ret[i].reason)
    continue
  }
  apps[name] = ret[i].value[Object.keys(ret[i].value)[0]]
}

console.log(
  `[${pluginName}] 加载完成（共 ${Object.keys(apps).length} 个模块）`
)

export { apps, Config }
