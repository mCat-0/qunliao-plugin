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

const _MODULE_KEY = 'weather'

// --- 毛玻璃卡片：读取配置，生成一段内联 <style> ---
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

/**
 * 背景图 URL 拼装
 *  - 默认 API 基址：https://uapis.cn/api/v1/random/image
 *  - 当 bgCategory ∈ {acg, bq, furry} 且 bgType 非空：再追加 &type=xxx；
 *  - 若用户直接填了 bgCustomUrl，则优先生效（跳过 category/type 拼装）。
 */
function buildBgUrl () {
  const custom = (getString(_MODULE_KEY, 'bgCustomUrl', '') || '').trim()
  if (custom) return custom

  const base = (getString(_MODULE_KEY, 'bgBaseUrl', 'https://uapis.cn/api/v1/random/image') || 'https://uapis.cn/api/v1/random/image').trim()
  if (!base) return 'https://uapis.cn/api/v1/random/image'

  const category = (getString(_MODULE_KEY, 'bgCategory', 'acg') || '').trim()
  if (!category) return base

  let url = base.includes('?')
    ? `${base}&category=${encodeURIComponent(category)}`
    : `${base}?category=${encodeURIComponent(category)}`

  const typeAllowed = ['acg', 'bq', 'furry']
  if (typeAllowed.includes(category)) {
    const type = (getString(_MODULE_KEY, 'bgType', 'mb') || '').trim()
    if (type) url += `&type=${encodeURIComponent(type)}`
  }
  return url
}

async function renderImage (data) {
  const tplFile = `${pluResPath}html/weather/weather.html`

  if (!fs.existsSync(tplFile)) {
    logger.error(`[weather] 模板不存在: ${tplFile}`)
    return false
  }

  const screenData = {
    saveId: 'weather',
    tplFile: tplFile,
    pluResPath: pluResPath,
    data: data,
    imgType: 'jpeg',
    quality: 92
  }
  const img = await puppeteer.screenshot('weather', screenData)
  return img
}

export class Weather extends plugin {
  constructor () {
    super({
      name: '天气查询',
      dsc: '查询城市天气（图片版）',
      event: 'message',
      priority: 50,
      rule: [
        { reg: '^#天气$', fnc: 'getDefaultWeather' },
        { reg: '^#(.+)天气$', fnc: 'getWeather' }
      ]
    })
  }

  async getDefaultWeather () {
    const defaultCity = getString(_MODULE_KEY, 'defaultCity', '').trim()
    if (!defaultCity) {
      return this.reply('请在指令中添加城市名，如「#广州天气」，也可在配置中设置默认城市')
    }
    return this.queryWeather(defaultCity)
  }

  async getWeather () {
    const match = this.e.msg && this.e.msg.match(/^#(.+)天气$/)
    if (!match) return this.reply('请发送：#城市名天气')
    const city = match[1].trim()
    if (!city) return this.reply('请告诉我城市名，例如：#广州天气')
    return this.queryWeather(city)
  }

  async queryWeather (city) {
    if (!isModuleEnabled(_MODULE_KEY)) {
      return this.reply('「天气查询」功能已在配置中禁用')
    }
    if (!isGroupAllowed(this.e, _MODULE_KEY)) {
      return this.reply('当前群未在白名单内，无法使用天气查询')
    }
    try {
      const apiUrl = getString(_MODULE_KEY, 'apiUrl', 'https://api.suyanw.cn/api/weather.php')
      const finalUrl = apiUrl.includes('?')
        ? `${apiUrl}&type=json&city=${encodeURIComponent(city)}`
        : `${apiUrl}?type=json&city=${encodeURIComponent(city)}`

      const resp = await httpFetch(finalUrl)
      if (!resp.ok) return this.reply(`请求失败：HTTP ${resp.status}`)
      const json = await resp.json()
      if (!json || json.code !== 1 || !json.data) {
        return this.reply(json && json.msg ? json.msg : '查询天气失败，请检查城市名')
      }
      const d = json.data
      const c = d.current || {}
      const picked = (Array.isArray(d.living) ? d.living : [])
        .filter((x) => x && x.name && ['雨伞指数', '感冒指数', '穿衣指数', '紫外线强度指数', '心情指数'].includes(x.name))
        .slice(0, 3)
        .map((x) => ({ name: x.name, index: x.index, tips: x.tips }))

      // 过滤 API 异常值（如 "999" 是接口的错误码/占位符）
      function isReasonableTemp (v) {
        if (v === null || v === undefined || v === '') return false
        const n = Number(v)
        return Number.isFinite(n) && n >= -60 && n <= 60
      }
      const curT = isReasonableTemp(c.temp) ? c.temp : null
      const minT = isReasonableTemp(d.tempn) ? d.tempn : null
      const maxT = isReasonableTemp(d.temp) ? d.temp : null

      const viewData = {
        city: d.city || city,
        date: c.date || d.date || '',
        time: c.time || d.time || '',
        currentTemp: curT || minT || maxT || '?',
        minTemp: minT || maxT || curT || '?',
        maxTemp: maxT || minT || curT || '?',
        currentWeather: c.weather || d.weather || '',
        wind: c.wind || d.wind || '',
        humidity: c.humidity || '',
        visibility: c.visibility || '',
        air: c.air || c.air_pm25 || '',
        cover: buildBgUrl(),
        items: picked,
        glassStyle: buildGlassStyle(_MODULE_KEY)
      }

      const img = await renderImage(viewData)
      if (!img) return this.reply('图片渲染失败，请稍后再试')
      return this.reply(img)
    } catch (err) {
      logger.error(`[weather] request error: ${err.message || err}`)
      return this.reply('天气接口请求失败，请稍后再试')
    }
  }
}
