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

function buildGlassVars (moduleKey) {
  return {
    glassEnabled: getBoolean(moduleKey, 'glassEnabled', true),
    glassBlur: clamp(getNumber(moduleKey, 'glassBlur', 14), 0, 60, 14),
    glassSaturate: clamp(getNumber(moduleKey, 'glassSaturate', 140), 0, 300, 140),
    glassOpacity: clamp(getNumber(moduleKey, 'glassOpacity', 0.35), 0, 1, 0.35).toFixed(3),
    glassBorder: safeColor(getString(moduleKey, 'glassBorder', ''), 'rgba(255,255,255,0.18)'),
    glassRadius: clamp(getNumber(moduleKey, 'glassRadius', 16), 0, 48, 16)
  }
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

// 默认背景（内联 SVG base64），当随机图 API 超时/失败/空时使用
const FALLBACK_BG =
  'data:image/svg+xml;base64,' +
  Buffer.from(
    '<svg xmlns="http://www.w3.org/2000/svg" width="1200" height="1600" viewBox="0 0 1200 1600">' +
    '<defs><linearGradient id="g" x1="0" y1="0" x2="1" y2="1">' +
    '<stop offset="0%" stop-color="#1e3a8a"/>' +
    '<stop offset="50%" stop-color="#38bdf8"/>' +
    '<stop offset="100%" stop-color="#f0abfc"/>' +
    '</linearGradient></defs><rect width="1200" height="1600" fill="url(#g)"/></svg>'
  ).toString('base64')

async function resolveBgImageUrl (rawUrl, timeoutMs) {
  if (!rawUrl) return FALLBACK_BG
  const ms = Number(timeoutMs)
  const safeTimeout = Number.isFinite(ms) && ms > 0 ? ms : 5000
  const abortCtl = new AbortController()
  const timer = setTimeout(() => abortCtl.abort(), safeTimeout)
  try {
    const resp = await fetch(rawUrl, {
      method: 'GET',
      redirect: 'follow',
      signal: abortCtl.signal,
      headers: {
        'User-Agent':
          'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/126.0 Safari/537.36'
      }
    })
    if (!resp.ok) {
      logger.warn(`[weather] bg image HTTP ${resp.status} for ${rawUrl}`)
      return FALLBACK_BG
    }
    const ct = (resp.headers.get('content-type') || '').toLowerCase()
    if (ct && !ct.startsWith('image/') && !ct.startsWith('application/octet-stream')) {
      logger.warn(`[weather] bg image bad content-type: ${ct}`)
      return FALLBACK_BG
    }
    return resp.url || rawUrl
  } catch (err) {
    logger.warn(`[weather] bg image fetch failed: ${err && err.message ? err.message : err}`)
    return FALLBACK_BG
  } finally {
    clearTimeout(timer)
  }
}

async function renderImage (data) {
  const tplFile = `${pluResPath}html/weather/weather.html`

  if (!fs.existsSync(tplFile)) {
    logger.error(`[weather] 模板不存在: ${tplFile}`)
    return false
  }

  // 先拿到"一定能渲染"的背景 URL
  if (data && data.cover) {
    data.cover = await resolveBgImageUrl(data.cover, getNumber(_MODULE_KEY, 'bgFetchTimeout', 5000))
  }

  const screenData = {
    saveId: 'weather',
    tplFile: tplFile,
    pluResPath: pluResPath,
    data: data,
    imgType: 'jpeg',
    quality: 92,
    // 重要：确保页面等待"远程图片资源下载完"再截图。
    // networkidle2 = 至少 2 个网络连接空闲 500ms，比默认 load 更保守。
    // 同时提升到 30s 上限，避免慢速背景图导致超时。
    pageGotoParams: {
      waitUntil: ['load', 'networkidle2'],
      timeout: 30000
    }
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

      // 修正感官问题：如果实时温度比最低温度还低，则以实时温度为准作为最低温度
      let effectiveMin = minT
      if (curT !== null && minT !== null && Number(curT) < Number(minT)) {
        effectiveMin = curT
      }

      const viewData = Object.assign(
        {
          city: d.city || city,
          date: c.date || d.date || '',
          time: c.time || d.time || '',
          currentTemp: curT || minT || '?',
          minTemp: effectiveMin || curT || minT || '?',
          currentWeather: c.weather || d.weather || '',
          wind: c.wind || d.wind || '',
          humidity: c.humidity || '',
          visibility: c.visibility || '',
          air: c.air || c.air_pm25 || '',
          cover: buildBgUrl(),
          items: picked
        },
        buildGlassVars(_MODULE_KEY)
      )

      const img = await renderImage(viewData)
      if (!img) return this.reply('图片渲染失败，请稍后再试')
      return this.reply(img)
    } catch (err) {
      logger.error(`[weather] request error: ${err.message || err}`)
      return this.reply('天气接口请求失败，请稍后再试')
    }
  }
}
