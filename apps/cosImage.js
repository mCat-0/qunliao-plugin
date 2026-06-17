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

const _MODULE_KEY = 'cosImage'

// 从 API 响应中提取图片地址。兼容 {code:0/200, data:{image_url|url|image:"..."}} 等常见格式
function extractImageUrl (json) {
  if (!json) return null
  // {code:0, data:{image_url:"..."}} / {code:200, data:{url:"..."}} / {code:200, data:{image:"..."}}
  if (json.code === 200 || json.code === 0 || json.code === '200' || json.code === '0') {
    if (json.data && typeof json.data === 'object') {
      if (typeof json.data.image_url === 'string') return json.data.image_url
      if (typeof json.data.url === 'string') return json.data.url
      if (typeof json.data.image === 'string') return json.data.image
      if (typeof json.data.img === 'string') return json.data.img
    }
    if (typeof json.data === 'string') return json.data
  }
  // 其他常见顶层字段
  if (typeof json.image_url === 'string') return json.image_url
  if (typeof json.url === 'string') return json.url
  if (typeof json.image === 'string') return json.image
  if (typeof json.img === 'string') return json.img
  if (typeof json.data === 'string') return json.data
  // 顶层字符串（某些 API 直接返回字符串）
  if (typeof json === 'string') return json
  return null
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

  // 通用发送图片方法
  async sendImage (moduleKey, apiUrlDefault, disabledMsg, notAllowedMsg) {
    if (!isModuleEnabled(moduleKey)) {
      return this.reply(disabledMsg)
    }
    if (!isGroupAllowed(this.e, moduleKey)) {
      return this.reply(notAllowedMsg)
    }
    try {
      const apiUrl = getString(moduleKey, 'apiUrl', apiUrlDefault)
      const resp = await httpFetch(apiUrl)
      if (!resp || !resp.ok) {
        return this.reply(`接口请求失败：HTTP ${resp ? resp.status : '无响应'}`)
      }
      const json = await resp.json()
      const imgUrl = extractImageUrl(json)
      if (imgUrl) {
        return this.reply(segment.image(imgUrl))
      }
      return this.reply('接口返回数据异常，未能获取图片地址')
    } catch (err) {
      logger.error(`[${moduleKey}] request error: ${err.message || err}`)
      return this.reply(`获取图片异常：${err.message || err}`)
    }
  }

  async getCosImage () {
    return this.sendImage(
      _MODULE_KEY,
      'https://v2.xxapi.cn/api/yscos',
      '「COS 图片」功能已在配置中禁用',
      '当前群未在白名单内，无法使用 COS 图片'
    )
  }

  async getJkImage () {
    return this.sendImage(
      'jkImage',
      'https://api.ruseo.cn/api/jk',
      '「JK 图片」功能已在配置中禁用',
      '当前群未在白名单内，无法使用 JK 图片'
    )
  }

  async getHeisiImage () {
    return this.sendImage(
      'heisiImage',
      'https://api.ruseo.cn/api/heisi',
      '「黑丝图片」功能已在配置中禁用',
      '当前群未在白名单内，无法使用黑丝图片'
    )
  }

  async getBaisiImage () {
    return this.sendImage(
      'baisiImage',
      'https://api.ruseo.cn/api/baisi',
      '「白丝图片」功能已在配置中禁用',
      '当前群未在白名单内，无法使用白丝图片'
    )
  }
}
