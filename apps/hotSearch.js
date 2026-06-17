// 用 import.meta.url 向上回溯找到 Yunzai 根目录，再动态 import lib 资源 ——
// 这样插件放在 plugins/xxx、plugins/example/xxx 等任意层级下都能正确加载。
import path from 'node:path'
import fs from 'node:fs'
import { fileURLToPath, pathToFileURL } from 'node:url'
import { segment } from 'oicq'

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
const pluginRoot = path.resolve(__dirname, '..').replace(/\\/g, '/')
const pluResPath = `${pluginRoot}/resources/`

function libUrl (rel) {
  const parts = rel.split('/').filter(Boolean)
  const abs = path.join(yunzaiRoot, 'lib', ...parts)
  return pathToFileURL(abs).href
}

const [pluginMod, puppeteerMod, helperMod] = await Promise.all([
  import(libUrl('plugins/plugin.js')),
  import(libUrl('puppeteer/puppeteer.js')),
  import('../components/ModuleHelper.js')
])

const plugin = pluginMod.default
const puppeteer = puppeteerMod.default
const {
  isModuleEnabled,
  isGroupAllowed,
  getString,
  getNumber,
  getBoolean,
  httpFetch
} = helperMod

const _MODULE_KEY = 'hotSearch'

function clamp (v, min, max, def) {
  const n = Number(v)
  if (!isFinite(n)) return def
  return Math.min(max, Math.max(min, n))
}

function safeColor (v, def) {
  const s = (v == null) ? '' : String(v).trim()
  if (!s) return def
  if (/^#([0-9a-fA-F]{3}|[0-9a-fA-F]{6})$/.test(s)) return s
  if (/^rgba?\s*\(/.test(s)) return s
  return def
}

function buildGlassStyle (moduleKey) {
  const enabled = getBoolean(moduleKey, 'glassEnabled', true)
  const blur = clamp(getNumber(moduleKey, 'glassBlur', 14), 0, 60, 14)
  const sat = clamp(getNumber(moduleKey, 'glassSaturate', 140), 0, 300, 140)
  const opacity = clamp(getNumber(moduleKey, 'glassOpacity', 0.35), 0, 1, 0.35)
  const border = safeColor(getString(moduleKey, 'glassBorder', ''), 'rgba(255,255,255,0.18)')
  const radius = clamp(getNumber(moduleKey, 'glassRadius', 16), 0, 48, 16)
  if (!enabled) {
    return `:root{--glass-bg:rgba(0,0,0,${opacity.toFixed(3)});--glass-border:${border};--glass-radius:${radius}px;--glass-filter:none;}`
  }
  return `:root{--glass-bg:rgba(0,0,0,${opacity.toFixed(3)});--glass-border:${border};--glass-radius:${radius}px;--glass-filter:blur(${blur}px) saturate(${sat}%);}`
}

function buildBgUrl () {
  const custom = (getString(_MODULE_KEY, 'bgCustomUrl', '') || '').trim()
  if (custom) return custom

  const base = (getString(_MODULE_KEY, 'bgBaseUrl', 'https://uapis.cn/api/v1/random/image') || 'https://uapis.cn/api/v1/random/image').trim()
  if (!base) return 'https://uapis.cn/api/v1/random/image'

  const category = (getString(_MODULE_KEY, 'bgCategory', 'mobile_wallpaper') || '').trim()
  if (!category) return base

  let url = base.includes('?')
    ? `${base}&category=${encodeURIComponent(category)}`
    : `${base}?category=${encodeURIComponent(category)}`

  if (['acg', 'bq', 'furry'].includes(category)) {
    const type = (getString(_MODULE_KEY, 'bgType', '') || '').trim()
    if (type) url += `&type=${encodeURIComponent(type)}`
  }
  return url
}

function formatHot (v) {
  const n = Number(v)
  if (!isFinite(n)) return ''
  if (n >= 100000000) return (n / 100000000).toFixed(1) + '亿'
  if (n >= 10000) return (n / 10000).toFixed(1) + '万'
  return String(n)
}

async function renderImage (data) {
  const tplFile = `${pluResPath}html/hotSearch/hotSearch.html`
  if (!fs.existsSync(tplFile)) {
    logger.error(`[hotSearch] 模板不存在: ${tplFile}`)
    return false
  }
  const screenData = {
    saveId: 'hotSearch',
    tplFile: tplFile,
    pluResPath: pluResPath,
    data: data,
    imgType: 'jpeg',
    quality: 92
  }
  const img = await puppeteer.screenshot('hotSearch', screenData)
  return img
}

const PLATFORM_MAP = {
  '抖音': 'douyin',
  '微博': 'weibo',
  'B站': 'bilibili',
  'b站': 'bilibili',
  '哔哩哔哩': 'bilibili',
  '百度': 'baidu',
  '头条': 'toutiao',
  '今日头条': 'toutiao',
  '新浪': 'sina',
  '原神': 'genshin',
  '快手': 'kuaishou',
  '小红书': 'xiaohongshu',
  '知乎': 'zhihu',
  '星铁': 'starrail',
  '崩坏星穹铁道': 'starrail'
}

const PLATFORM_NAME = {
  douyin: '抖音', weibo: '微博', bilibili: 'B站', baidu: '百度',
  toutiao: '头条', sina: '新浪', genshin: '原神', kuaishou: '快手',
  xiaohongshu: '小红书', zhihu: '知乎', starrail: '星铁'
}

export class HotSearch extends plugin {
  constructor () {
    super({
      name: '热搜',
      dsc: '查询各大平台热搜（图片版）',
      event: 'message',
      priority: 50,
      rule: [
        { reg: '^#热搜$', fnc: 'getHotSearchDefault' },
        { reg: '^#(.{1,8})热搜$', fnc: 'getHotSearchByPlatform' }
      ]
    })
  }

  async getHotSearchDefault () {
    const defaultPlatform = getString(_MODULE_KEY, 'defaultPlatform', 'douyin')
    return this.getHotSearch(defaultPlatform)
  }

  async getHotSearchByPlatform () {
    const match = this.e.msg && this.e.msg.match(/^#(.{1,8})热搜$/)
    if (!match) return this.reply('请发送：#平台热搜（如 #微博热搜）')
    const type = PLATFORM_MAP[match[1].trim()]
    if (!type) {
      const supported = Object.keys(PLATFORM_MAP)
        .filter((_, idx) => idx % 2 === 0)
        .slice(0, 8)
        .join('/')
      return this.reply(`暂不支持「${match[1]}」，支持：${supported} 等`)
    }
    return this.getHotSearch(type)
  }

  async getHotSearch (type) {
    if (!isModuleEnabled(_MODULE_KEY)) {
      return this.reply('「热搜」功能已在配置中禁用')
    }
    if (!isGroupAllowed(this.e, _MODULE_KEY)) {
      return this.reply('当前群未在白名单内，无法使用热搜')
    }
    try {
      const apiUrl = getString(_MODULE_KEY, 'apiUrl', 'https://uapis.cn/api/v1/misc/hotboard')
      const finalUrl = apiUrl.includes('?')
        ? `${apiUrl}&type=${encodeURIComponent(type)}`
        : `${apiUrl}?type=${encodeURIComponent(type)}`

      const resp = await httpFetch(finalUrl)
      if (!resp.ok) return this.reply(`请求失败：HTTP ${resp.status}`)
      const json = await resp.json()
      if (!json || !Array.isArray(json.list) || json.list.length === 0) {
        return this.reply('获取热搜失败，接口未返回数据')
      }

      const list = json.list.slice(0, 10).map((item, idx) => ({
        index: item.index || (idx + 1),
        title: item.title || '(无标题)',
        hotValue: item.hot_value ? formatHot(item.hot_value) : ''
      }))

      const viewData = {
        platformName: PLATFORM_NAME[type] || type,
        updateTime: json.update_time ? String(json.update_time).trim() : '实时',
        cover: buildBgUrl(),
        list: list,
        glassStyle: buildGlassStyle(_MODULE_KEY)
      }

      const img = await renderImage(viewData)
      if (!img) return this.reply('图片渲染失败，请稍后再试')
      return this.reply(img)
    } catch (err) {
      logger.error(`[hotSearch] request error: ${err.message || err}`)
      return this.reply('获取热搜异常，请稍后再试')
    }
  }
}
