import plugin from '../../../lib/plugins/plugin.js'
import puppeteer from '../../../lib/puppeteer/puppeteer.js'
import cfg from '../../../lib/config/config.js'
import { segment } from 'oicq'
import fs from 'node:fs'
import path from 'node:path'
import common from '../../../lib/common/common.js'
import { getModuleConfig, getString, getNumber, isGroupAllowed, isModuleEnabled, httpFetch } from '../components/ModuleHelper.js'

const _MODULE_KEY = 'dailyNews'
const _path = process.cwd().replace(/\\/g, '/')

const CACHE_DIR = path.join(process.cwd().replace(/\\/g, '/'), 'data', 'cache', 'dailyNews')

const todayCache = {
  dateKey: '',
  newsData: null,
  imgPath: null,
  expireAt: 0
}

// 从 Config 动态读取这些值（锅巴面板修改后立即生效）
function getCacheKeepDays () {
  const n = getNumber(_MODULE_KEY, 'cacheKeepDays', 2)
  return n > 0 ? n : 2
}
function getCacheTtlMs () {
  // 文件缓存 TTL：默认 12 小时（避免跨天命中旧缓存），最小 1 小时
  const hours = getNumber(_MODULE_KEY, 'cacheTtlHours', 12)
  const ttlHours = hours > 0 ? hours : 12
  return 1000 * 60 * 60 * Math.min(ttlHours, 18)
}
function getApiUrl () {
  return getString(_MODULE_KEY, 'apiUrl', 'https://60s.crystelf.top/v2/60s')
}
function getCoverImageUrl () {
  return getString(_MODULE_KEY, 'coverImageUrl', 'https://api.elaina.cat/random/pc/')
}
function getCron () {
  return getString(_MODULE_KEY, 'cron', '0 30 6 * * ?')
}

function ensureCacheDir () {
  try {
    if (!fs.existsSync(CACHE_DIR)) {
      fs.mkdirSync(CACHE_DIR, { recursive: true })
    }
  } catch (err) {
    logger.warn('[dailyNews] cache dir create failed:', err)
  }
}

function getDateKey () {
  const d = new Date()
  const y = d.getFullYear()
  const m = String(d.getMonth() + 1).padStart(2, '0')
  const day = String(d.getDate()).padStart(2, '0')
  return `${y}-${m}-${day}`
}

function cleanExpiredCache () {
  try {
    if (!fs.existsSync(CACHE_DIR)) return
    const files = fs.readdirSync(CACHE_DIR)
    const now = Date.now()
    const ttl = getCacheTtlMs()
    let cleaned = 0
    for (const file of files) {
      const fullPath = path.join(CACHE_DIR, file)
      try {
        const stat = fs.statSync(fullPath)
        if (!stat.isFile()) continue
        if (now - stat.mtimeMs > ttl) {
          fs.unlinkSync(fullPath)
          cleaned++
        }
      } catch (_) { /* ignore */ }
    }
    if (cleaned > 0) logger.mark(`[dailyNews] cleaned ${cleaned} expired cache files`)
  } catch (err) {
    logger.warn('[dailyNews] cache cleanup failed:', err)
  }
}

function getWhiteGroups () {
  // 优先读取模块配置的 onlyGroupID
  const m = getModuleConfig(_MODULE_KEY)
  let groups = null
  if (Array.isArray(m.onlyGroupID) && m.onlyGroupID.length > 0) {
    groups = m.onlyGroupID.map((g) => Number(g)).filter((g) => g && !Number.isNaN(g))
  }
  // 再回落到 yunzai 全局配置（兼容旧行为）
  if (!groups || groups.length === 0) {
    let whiteGroup = cfg.other?.whiteGroup || []
    if (!Array.isArray(whiteGroup)) whiteGroup = [String(whiteGroup)]
    groups = whiteGroup.map((g) => Number(g)).filter((g) => g && !Number.isNaN(g))
  }
  if (!groups || groups.length === 0) {
    if (Bot?.gl) {
      groups = Array.from(Bot.gl.keys()).map((g) => Number(g))
    }
  }
  return groups || []
}

async function fetchNews () {
  const dateKey = getDateKey()
  if (todayCache.dateKey === dateKey && todayCache.newsData && Date.now() < todayCache.expireAt) {
    return todayCache.newsData
  }
  try {
    const apiUrl = getApiUrl()
    logger.mark(`[dailyNews] fetching from: ${apiUrl}`)
    const resp = await httpFetch(apiUrl)
    if (!resp.ok) {
      logger.error(`[dailyNews] API HTTP ${resp.status}`)
      return false
    }
    const json = await resp.json()
    if (!json || json.code !== 200 || !json.data) {
      logger.error('[dailyNews] API data abnormal', json?.message || '')
      return false
    }
    // 封面图处理逻辑：
    // 1. 优先使用配置中的 coverImageUrl（用户指定的图源 API）
    // 2. 只有当配置为空时，才使用 API 自带的 cover 作为备用
    // 3. 无论哪种，都把图片下载到本地文件，避免防盗链/重定向问题
    const configuredCover = getCoverImageUrl()
    const hasApiCover = json.data.cover && String(json.data.cover).trim()
    const apiCover = hasApiCover ? json.data.cover : null
    if (configuredCover && String(configuredCover).trim()) {
      json.data.cover = configuredCover
      logger.mark(`[dailyNews] 使用配置图源: ${configuredCover}`)
    } else if (apiCover) {
      // 保持 API 自带的 cover
      logger.mark(`[dailyNews] 使用 API 提供的封面: ${String(apiCover).slice(0, 80)}...`)
    } else {
      logger.mark(`[dailyNews] 无封面图可用`)
    }

    // 把封面图 URL 下载到本地，避免防盗链/重定向问题
    if (json.data.cover) {
      try {
        const coverFilePath = path.join(CACHE_DIR, `cover-${dateKey}.jpg`)
        const coverUrl = json.data.cover
        // 根据域名选择合适的 header：微信图片需要 Referer
        const fetchOpts = coverUrl.includes('mmbiz.qpic.cn') || coverUrl.includes('qpic.cn')
          ? { headers: {
              'Referer': 'https://mp.weixin.qq.com/',
              'Accept': 'image/webp,image/apng,image/*,*/*;q=0.8',
              'Accept-Language': 'zh-CN,zh;q=0.9,en;q=0.8'
            } }
          : { headers: {
              'Accept': 'image/webp,image/apng,image/*,*/*;q=0.8',
              'Accept-Language': 'zh-CN,zh;q=0.9,en;q=0.8'
            } }
        const respImg = await httpFetch(coverUrl, fetchOpts)
        if (respImg && respImg.ok) {
          const buffer = await respImg.arrayBuffer()
          fs.writeFileSync(coverFilePath, Buffer.from(buffer))
          const size = fs.existsSync(coverFilePath) ? fs.statSync(coverFilePath).size : 0
          // 小于 3KB 的图片极可能是防盗链的占位图，不用它
          if (size > 3 * 1024) {
            logger.mark(`[dailyNews] 封面图已下载到本地: ${coverFilePath} (${Math.round(size / 1024)}KB)`)
            // headless browser 加载本地图片需要 file:// 协议
            const fileUrl = coverFilePath.replace(/\\/g, '/')
            json.data.cover = fileUrl.startsWith('file://') ? fileUrl : `file://${fileUrl}`
          } else {
            logger.warn(`[dailyNews] 封面图过小 (${Math.round(size / 1024)}KB)，疑似被防盗链拦截，不使用`)
            json.data.cover = null
          }
        }
      } catch (e) {
        logger.warn(`[dailyNews] 封面图下载失败，使用原 URL: ${e?.message || e}`)
        // 失败就保持原 URL，由浏览器尝试加载
      }
    }

    // 检查 API 返回的日期
    const dataDate = json.data?.date ? String(json.data.date).trim() : ''
    const isTodayData = !dataDate || dataDate.includes(dateKey) || dateKey.includes(dataDate)

    // 无论 API 日期是否匹配今天，都保存到内存缓存（避免每次都重复请求）
    // 但如果 API 还没更新（返回的是昨天的数据），设置较短的过期时间（30 分钟）
    todayCache.dateKey = dateKey
    todayCache.newsData = json.data
    if (isTodayData) {
      todayCache.expireAt = Date.now() + 1000 * 60 * 60 * 12
      logger.mark(`[dailyNews] fetched ${dateKey} news data (API date: ${dataDate || 'none'}), cached 12h`)
    } else {
      todayCache.expireAt = Date.now() + 1000 * 60 * 30
      logger.mark(`[dailyNews] API date (${dataDate}) != today (${dateKey}), cached for 30min only`)
    }
    cleanExpiredCache()
    return json.data
  } catch (err) {
    logger.error('[dailyNews] request error', err?.message || err)
    return false
  }
}

async function renderNewsImage (data) {
  // 关键：缓存文件名永远用"今天"的日期，不用 API 返回的 data.date
  // 避免 API 还没更新时，用旧日期命中昨天的缓存文件
  const todayKey = getDateKey()
  const cacheFilePath = path.join(CACHE_DIR, `dailyNews-${todayKey}.jpg`)
  const ttlMs = getCacheTtlMs()

  // 检查 API 返回的日期是否与今天一致。不一致说明 API 还没更新 → 跳过文件缓存
  const dataDate = data?.date ? String(data.date).trim() : ''
  const dataDateMatchesToday = !dataDate || dataDate.includes(todayKey) || todayKey.includes(dataDate)

  if (dataDateMatchesToday) {
    try {
      if (fs.existsSync(cacheFilePath)) {
        const stat = fs.statSync(cacheFilePath)
        if (Date.now() - stat.mtimeMs < ttlMs) {
          logger.mark(`[dailyNews] using cached image: ${cacheFilePath}`)
          return segment.image(cacheFilePath)
        }
        try { fs.unlinkSync(cacheFilePath) } catch (_) { /* ignore */ }
      }
    } catch (err) {
      logger.warn('[dailyNews] read cache failed:', err)
    }

    // 内存缓存：todayCache.dateKey 是今天，直接用
    if (todayCache.dateKey === todayKey && todayCache.imgPath && fs.existsSync(todayCache.imgPath)) {
      return segment.image(todayCache.imgPath)
    }
  } else {
    logger.mark(`[dailyNews] API date (${dataDate}) != today (${todayKey}), skip file cache, render fresh`)
  }

  ensureCacheDir()

  // ============================================================
  // 自适应路径搜索：在多个可能的位置找 HTML 模板
  // 支持：example/qunliao-plugin、qunliao-plugin、example/resources
  // ============================================================
  const candidateDirs = [
    `${_path}/plugins/example/qunliao-plugin/resources`,
    `${_path}/plugins/qunliao-plugin/resources`,
    `${_path}/plugins/example/resources`,
    `${_path}/resources`
  ]
  let tplFile = null
  let pluResPath = null
  for (const dir of candidateDirs) {
    const candidate = `${dir}/html/dailyNews/dailyNews.html`
    if (fs.existsSync(candidate)) {
      tplFile = candidate
      pluResPath = `${dir}/`
      logger.mark(`[dailyNews] 模板路径: ${candidate}`)
      break
    } else {
      logger.debug(`[dailyNews] 搜索路径不存在: ${candidate}`)
    }
  }

  if (!tplFile) {
    logger.error(`[dailyNews] 所有候选路径都找不到 HTML 模板`)
    logger.error(`[dailyNews] 已搜索的路径: ${candidateDirs.join(', ')}`)
    logger.error(`[dailyNews] 请把 qunliao-plugin/resources/html/dailyNews/ 目录上传到 Yunzai 服务器`)
    return false
  }

  const screenData = {
    saveId: 'dailyNews',
    tplFile: tplFile,
    pluResPath: pluResPath,
    data: data,
    imgType: 'jpeg',
    quality: 95,
    path: cacheFilePath
  }
  const img = await puppeteer.screenshot('dailyNews', screenData)
  if (!img) {
    logger.error('[dailyNews] image render failed')
    return false
  }

  // 只有当 API 日期与今天一致时，才把图片加入持久缓存
  if (dataDateMatchesToday) {
    todayCache.dateKey = todayKey
    todayCache.imgPath = cacheFilePath
    logger.mark(`[dailyNews] image cached: ${cacheFilePath}`)
    cleanExpiredCache()
  } else {
    logger.mark(`[dailyNews] image NOT cached (API date != today), will re-render on next request`)
  }

  return img
}

async function pushToGroups (groupIds) {
  if (!groupIds || groupIds.length === 0) {
    logger.warn('[dailyNews] no target groups configured, skip push')
    return false
  }
  const data = await fetchNews()
  if (!data) return false
  const img = await renderNewsImage(data)
  if (!img) return false
  let success = 0
  for (const gid of groupIds) {
    try {
      const group = Bot.pickGroup(Number(gid))
      if (!group) {
        logger.warn(`[dailyNews] cannot get group: ${gid}`)
        continue
      }
      await group.sendMsg([img])
      logger.mark(`[dailyNews] pushed to group: ${gid}`)
      success++
      await common.sleep(1500)
    } catch (err) {
      logger.error(`[dailyNews] push failed: ${gid}`, err)
    }
  }
  logger.mark(`[dailyNews] push completed, success ${success}/${groupIds.length} groups`)
  return true
}

export class dailyNews extends plugin {
  constructor () {
    super({
      name: '每日早报',
      dsc: '每日定时推送早报 / #早报 手动触发',
      event: 'message',
      priority: 500,
      rule: [
        { reg: '^#早报$', fnc: 'manualNews' },
        { reg: '^#推送早报$', permission: 'master', fnc: 'pushNews' },
        { reg: '^#刷新早报$', permission: 'master', fnc: 'refreshNews' }
      ]
    })
    // cron 从 Config 读取（运行时动态读取一次以完成注册；之后若要改需重启）
    this.task = {
      cron: getCron(),
      name: '每日早报推送任务',
      fnc: () => this.autoPushTask(),
      log: true
    }
  }

  async manualNews () {
    if (!isModuleEnabled(_MODULE_KEY)) {
      await this.reply('「每日早报」功能已在配置中禁用')
      return true
    }
    if (!isGroupAllowed(this.e, _MODULE_KEY)) {
      await this.reply('当前群未在白名单内，无法使用每日早报')
      return true
    }
    const data = await fetchNews()
    if (!data) {
      await this.reply('早报获取失败，请稍后再试～')
      return true
    }
    const img = await renderNewsImage(data)
    if (!img) {
      await this.reply('早报图片生成失败')
      return true
    }
    await this.reply(img)
    return true
  }

  async pushNews () {
    if (!isModuleEnabled(_MODULE_KEY)) {
      await this.reply('「每日早报」功能已在配置中禁用')
      return true
    }
    const groups = getWhiteGroups()
    if (!groups || groups.length === 0) {
      await this.reply('暂无白名单群，推送已取消')
      return true
    }
    await this.reply(`开始向 ${groups.length} 个白名单群推送早报…`)
    await pushToGroups(groups)
    await this.reply('早报推送完毕')
    return true
  }

  async refreshNews () {
    const dateKey = getDateKey()
    const cacheFilePath = path.join(CACHE_DIR, `dailyNews-${dateKey}.jpg`)
    try {
      if (fs.existsSync(cacheFilePath)) fs.unlinkSync(cacheFilePath)
    } catch (_) { /* ignore */ }
    todayCache.dateKey = ''
    todayCache.newsData = null
    todayCache.imgPath = null
    logger.mark(`[dailyNews] ${dateKey} cache cleared`)
    await this.reply('当日早报缓存已清空，下次调用将重新拉取并生成')
    return true
  }

  async autoPushTask () {
    if (!isModuleEnabled(_MODULE_KEY)) {
      logger.warn('[dailyNews] module disabled, skip scheduled push')
      return
    }
    const groups = getWhiteGroups()
    if (!groups || groups.length === 0) {
      logger.warn('[dailyNews] no white groups configured, scheduled push skipped')
      return
    }
    logger.mark(`[dailyNews] scheduled push starting, target groups: ${groups.length}`)
    await pushToGroups(groups)
  }
}

export default dailyNews
