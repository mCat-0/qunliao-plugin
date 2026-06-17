import path from 'node:path'
import fs from 'node:fs'
import { fileURLToPath, pathToFileURL } from 'node:url'

const __filename = fileURLToPath(import.meta.url)
const __dirname = path.dirname(__filename)

function findYunzaiRoot (from) {
  let cur = path.resolve(from)
  for (let i = 0; i < 15; i++) {
    const pluginsDir = path.join(cur, 'plugins')
    try {
      if (fs.existsSync(pluginsDir) && fs.statSync(pluginsDir).isDirectory()) {
        return cur
      }
    } catch (_) { /* ignore */ }
    const parent = path.dirname(cur)
    if (parent === cur) break
    cur = parent
  }
  return process.cwd()
}

const yunzaiRoot = findYunzaiRoot(__dirname).replace(/\\/g, '/')

function libUrl (rel) {
  const parts = rel.split('/').filter(Boolean)
  const abs = path.join(yunzaiRoot, 'lib', ...parts)
  return pathToFileURL(abs).href
}

const plugin = (await import(libUrl('plugins/plugin.js'))).default

const {
  isModuleEnabled,
  isGroupAllowed,
  getString,
  httpFetch
} = await import('../components/ModuleHelper.js')

const _MODULE_KEY = 'dogDiary'

export class DogDiary extends plugin {
  constructor () {
    super({
      name: '舔狗日记',
      dsc: '发送今日舔狗日记',
      event: 'message',
      priority: 50,
      rule: [
        { reg: '^#舔狗日记$', fnc: 'getDogDiary' }
      ]
    })
  }

  async getDogDiary () {
    if (!isModuleEnabled(_MODULE_KEY)) {
      return this.reply('「舔狗日记」功能已在配置中禁用')
    }
    if (!isGroupAllowed(this.e, _MODULE_KEY)) {
      return this.reply('当前群未在白名单内，无法使用舔狗日记')
    }
    try {
      const apiUrl = getString(_MODULE_KEY, 'apiUrl', 'https://v2.xxapi.cn/api/dog')
      const resp = await httpFetch(apiUrl)
      if (!resp.ok) return this.reply(`请求失败：HTTP ${resp.status}`)
      const json = await resp.json()
      if (json && json.code === 200 && json.data) return this.reply(json.data)
      return this.reply('舔狗日记暂时写不出来了，主人再等等')
    } catch (err) {
      logger.error(`[dogDiary] request error: ${err.message || err}`)
      return this.reply('舔狗日记暂时写不出来了，主人再等等')
    }
  }
}
