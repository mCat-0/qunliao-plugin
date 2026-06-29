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
  isGroupAllowed
} = await import('../components/ModuleHelper.js')

const { fetchImage } = await import('../components/ImageFetcher.js')

const _MODULE_KEY = 'cosImage'

const FALLBACK_APIS = {
  cosImage: ['https://v2.xxapi.cn/api/yscos'],
  jkImage: ['https://api.ruseo.cn/api/jk'],
  heisiImage: [
    'http://api.yujn.cn/api/heisi.php',
    'https://api.ruseo.cn/api/heisi',
    'https://api.suyanw.cn/api/hs.php'
  ],
  baisiImage: ['https://api.ruseo.cn/api/baisi']
}

export class CosImage extends plugin {
  constructor () {
    super({
      name: 'COS图',
      dsc: '随机 COS 图片',
      event: 'message',
      priority: 50,
      rule: [
        { reg: '^#?cos(图)?$', fnc: 'getCosImage' },
        { reg: '^#?(我要看[jJ][kK]|[jJ][kK])$', fnc: 'getJkImage' },
        { reg: '^#?我要看黑丝$', fnc: 'getHeisiImage' },
        { reg: '^#?我要看白丝$', fnc: 'getBaisiImage' }
      ]
    })
  }

  async sendImage (moduleKey, disabledMsg, notAllowedMsg) {
    if (!isModuleEnabled(moduleKey)) return this.reply(disabledMsg)
    if (!isGroupAllowed(this.e, moduleKey)) return this.reply(notAllowedMsg)
    try {
      const r = await fetchImage(moduleKey, FALLBACK_APIS[moduleKey] || [])
      if (!r.ok) {
        logger.error(`[${moduleKey}] ${r.error || '获取失败'}`)
        return this.reply('获取图片失败：' + (r.error || '未知错误'))
      }
      return this.reply(r.segment)
    } catch (err) {
      logger.error(`[${moduleKey}] request error: ${err.message || err}`)
      return this.reply(`获取图片异常：${err.message || err}`)
    }
  }

  async getCosImage () {
    return this.sendImage(
      _MODULE_KEY,
      '「COS 图片」功能已在配置中禁用',
      '当前群未在白名单内，无法使用 COS 图片'
    )
  }

  async getJkImage () {
    return this.sendImage(
      'jkImage',
      '「JK 图片」功能已在配置中禁用',
      '当前群未在白名单内，无法使用 JK 图片'
    )
  }

  async getHeisiImage () {
    return this.sendImage(
      'heisiImage',
      '「黑丝图片」功能已在配置中禁用',
      '当前群未在白名单内，无法使用黑丝图片'
    )
  }

  async getBaisiImage () {
    return this.sendImage(
      'baisiImage',
      '「白丝图片」功能已在配置中禁用',
      '当前群未在白名单内，无法使用白丝图片'
    )
  }
}
