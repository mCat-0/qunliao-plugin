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

// 默认背景（内联 SVG base64），当随机图 API 超时/失败/空时使用
const FALLBACK_BG =
  'data:image/svg+xml;base64,' +
  Buffer.from(
    '<svg xmlns="http://www.w3.org/2000/svg" width="1200" height="1600" viewBox="0 0 1200 1600">' +
    '<defs><linearGradient id="g" x1="0" y1="0" x2="1" y2="1">' +
    '<stop offset="0%" stop-color="#3a1c71"/>' +
    '<stop offset="50%" stop-color="#d76d77"/>' +
    '<stop offset="100%" stop-color="#ffaf7b"/>' +
    '</linearGradient></defs><rect width="1200" height="1600" fill="url(#g)"/></svg>'
  ).toString('base64')

/**
 * 预取图片 URL：
 * - 若成功返回最终（重定向后）的 URL；
 * - 若失败/非图片/超时，则回退到内联 SVG 渐变。
 * 同时把 Content-Type / Content-Length 作为"图片合法性"的兜底检查，避免把"API 返回的 JSON 错误页面"当作图片渲染。
 */
async function resolveBgImageUrl (rawUrl, timeoutMs) {
  if (!rawUrl) return FALLBACK_BG
  const ms = Number(timeoutMs)
  const safeTimeout = Number.isFinite(ms) && ms > 0 ? ms : 5000

  let abortId
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
      logger.warn(`[hotSearch] bg image HTTP ${resp.status} for ${rawUrl}`)
      return FALLBACK_BG
    }
    const ct = (resp.headers.get('content-type') || '').toLowerCase()
    if (ct && !ct.startsWith('image/') && !ct.startsWith('application/octet-stream')) {
      logger.warn(`[hotSearch] bg image bad content-type: ${ct}`)
      return FALLBACK_BG
    }
    // 能走到这里：URL 可访问、返回体是图片 → 用"最终 URL"
    // fetch 不直接暴露 final url，这里复用 resp.url（多数环境会有重定向后的）
    return resp.url || rawUrl
  } catch (err) {
    logger.warn(`[hotSearch] bg image fetch failed: ${err && err.message ? err.message : err}`)
    return FALLBACK_BG
  } finally {
    clearTimeout(timer)
  }
}

async function renderImage (data) {
  const tplFile = `${pluResPath}html/hotSearch/hotSearch.html`
  if (!fs.existsSync(tplFile)) {
    logger.error(`[hotSearch] 模板不存在: ${tplFile}`)
    return false
  }

  // 先拿到"一定能渲染"的背景 URL
  if (data && data.cover) {
    data.cover = await resolveBgImageUrl(data.cover, getNumber(_MODULE_KEY, 'bgFetchTimeout', 5000))
  }

  const screenData = {
    saveId: 'hotSearch',
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
