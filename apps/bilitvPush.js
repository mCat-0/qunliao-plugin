import fs from 'node:fs'
import path from 'node:path'
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
const puppeteer = (await import(libUrl('puppeteer/puppeteer.js'))).default
const cfg = (await import(libUrl('config/config.js'))).default
const common = (await import(libUrl('common/common.js'))).default

const {
  isModuleEnabled,
  getModuleConfig,
  getString,
  getStringList,
  getNumber,
  getBoolean,
  httpFetch
} = await import('../components/ModuleHelper.js')

const _MODULE_KEY = 'bilitvPush'

// ===== 默认配置 =====
const DEFAULT_UP_UIDS = [
  '401742377',
  '1636034895',
  '1340190821',
  '3546886017387331'
]
const DEFAULT_HOURS = [6, 11, 12, 18, 20, 22]
const DEFAULT_INTERVAL_HOURS = 8

// ===== 配置读取辅助 =====
function cfgList (key, fallback) { return getStringList(_MODULE_KEY, key, fallback) }
function cfgStr (key, fallback) { return getString(_MODULE_KEY, key, fallback) }
function cfgNum (key, fallback) { return getNumber(_MODULE_KEY, key, fallback) }
function cfgBool (key, fallback) { return getBoolean(_MODULE_KEY, key, fallback) }

// 通用：把 "1,2 3\n4" 或数组 [1,2,3] 统一拆成字符串数组
function toTokens (raw) {
  if (raw == null) return []
  if (Array.isArray(raw)) return raw.map((x) => String(x).trim()).filter(Boolean)
  const s = String(raw)
  if (!s) return []
  return s.split(/[,\s\u3001;；\n\r\t]+/).map((x) => x.trim()).filter(Boolean)
}

function getSubscribeUIDs () {
  const raw = cfgStr('subscribeUIDs', '') || cfgList('subscribeUIDs', DEFAULT_UP_UIDS)
  const tokens = Array.isArray(raw) ? raw.map((x) => String(x).trim()) : toTokens(raw)
  if (tokens.length === 0) return DEFAULT_UP_UIDS.slice()
  return tokens.filter((s) => /^\d+$/.test(s))
}

// ====== 白名单群解析（与 dailyNews 保持一致） ======
// 1) 优先读取模块配置 onlyGroupID（可通过锅巴面板设置）
// 2) 回落到 Yunzai 全局 cfg.other.whiteGroup
// 3) 如仍为空，则取 Bot.gl 中所有加入的群
function getWhiteGroups () {
  const m = getModuleConfig(_MODULE_KEY)
  let groups = null
  if (Array.isArray(m.onlyGroupID) && m.onlyGroupID.length > 0) {
    groups = m.onlyGroupID.map((g) => Number(g)).filter((g) => g && !Number.isNaN(g))
  }
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

function getAdminQQs () {
  const raw = cfgStr('extraAdminQQ', '') || cfgList('extraAdminQQ', [])
  const tokens = Array.isArray(raw) ? raw.map((x) => String(x).trim()) : toTokens(raw)
  return tokens.filter((s) => /^\d+$/.test(s))
}

function getCronHours () {
  const raw = cfgStr('cronHours', '') || cfgList('cronHours', DEFAULT_HOURS)
  const tokens = Array.isArray(raw) ? raw.map((x) => String(x).trim()) : toTokens(raw)
  const arr = tokens
    .map((x) => Number(x))
    .filter((n) => Number.isFinite(n) && n >= 0 && n <= 23)
    .map(Math.floor)
  if (arr.length === 0) return DEFAULT_HOURS.slice()
  return arr
}

function getIntervalHours () {
  const v = cfgNum('scanIntervalHours', DEFAULT_INTERVAL_HOURS)
  if (!isFinite(v) || v <= 0) return DEFAULT_INTERVAL_HOURS
  return v
}

// 夜间时段判断：nightStartHour <= hour < nightEndHour（支持跨 0 点，例如 23~8）
function isNightHour (hh) {
  const start = Number(cfgNum('nightStartHour', 23))
  const end = Number(cfgNum('nightEndHour', 8))
  if (!Number.isFinite(start) || !Number.isFinite(end)) return false
  const s = Math.max(0, Math.min(23, Math.floor(start)))
  const e = Math.max(0, Math.min(23, Math.floor(end)))
  if (s === e) return false
  if (s < e) return hh >= s && hh < e
  // s > e：跨 0 点
  return hh >= s || hh < e
}

// 是否允许当前时刻扫描（指令触发不受限，仅定时扫描受限）
function isScheduleBlocked () {
  if (cfgBool('nightScanEnabled', false)) return false
  return isNightHour(new Date().getHours())
}

function isAdminUser (e) {
  if (e?.isMaster === true || e?.is_master === true) return true
  const uid = String(e?.user_id || e?.sender?.user_id || '')
  if (!uid) return false
  const admins = getAdminQQs()
  if (admins.includes(uid)) return true
  // 兜底：读取全局 Bot 配置
  try {
    const masterQQs = []
    for (const field of ['Bot?.config?.master', 'Bot?.master', 'Bot?.config?.other?.masterQQ', 'Bot?.config?.other?.master']) {
      try {
        const val = eval(field)
        if (Array.isArray(val)) masterQQs.push(...val)
        else if (typeof val === 'string' || typeof val === 'number') masterQQs.push(val)
      } catch (_) { /* ignore */ }
    }
    const normalized = masterQQs.map((x) => String(x).trim()).filter(Boolean)
    if (normalized.includes(uid)) return true
  } catch (_) { /* ignore */ }
  return false
}

// ===== B站 API 访问 =====
// 说明：api.bilibili.com/x/space/acc/info 已对无登录态请求启用风控（-401 非法访问 / -352 风控校验失败）。
// 本模块改用 live 域下**公开可用**的批量接口：
//   POST https://api.live.bilibili.com/room/v1/Room/get_status_info_by_uids
//   body: { "uids": [mid, mid, ...] }
// 返回结构：{ code: 0, data: { "<mid>": { uname, face, room_id, live_status, title, cover_from_user, keyframe, area_v2_name, area_v2_parent_name, ... } } }
// live_status: 0=未开播 1=直播中 2=轮播
async function bilibiliFetchJson (url, opts) {
  try {
    const headers = Object.assign({
      'Accept': 'application/json',
      'Referer': 'https://www.bilibili.com/',
      'Origin': 'https://www.bilibili.com',
      'Accept-Language': 'zh-CN,zh;q=0.9',
      'Content-Type': 'application/json'
    }, (opts && opts.headers) || {})
    const res = await httpFetch(url, Object.assign({}, opts || {}, { headers }))
    if (!res.ok) {
      return { ok: false, error: 'HTTP ' + res.status }
    }
    const body = await res.text()
    try {
      return { ok: true, data: JSON.parse(body) }
    } catch (_) {
      return { ok: false, error: '非 JSON 响应', raw: body.slice(0, 200) }
    }
  } catch (err) {
    return { ok: false, error: (err && err.message) ? err.message : String(err) }
  }
}

// 批量查询一组 mid 的直播状态；一次最多传 100 个 mid，这里按 30 个一组拆分。
async function batchQueryBiliLive (mids) {
  const all = []
  const pageSize = 30
  for (let i = 0; i < mids.length; i += pageSize) {
    const slice = mids.slice(i, i + pageSize)
    const r = await bilibiliFetchJson('https://api.live.bilibili.com/room/v1/Room/get_status_info_by_uids', {
      method: 'POST',
      body: JSON.stringify({ uids: slice })
    })
    if (!r.ok) continue
    const d = r.data
    if (!d || d.code !== 0 || !d.data) continue
    for (const key of Object.keys(d.data)) {
      all.push(d.data[key])
    }
    // 批次之间小间隔，降低被风控概率
    await new Promise((res) => setTimeout(res, 150))
  }
  return all
}

// 把接口返回对象标准化为模块内部卡片结构
function normalizeBiliCard (raw) {
  if (!raw) return null
  const mid = raw.uid ? String(raw.uid) : ''
  const liveStatus = Number(raw.live_status) || 0
  const isLive = liveStatus === 1
  const name = raw.uname || (mid ? ('UID ' + mid) : '未知UP')
  const cover = (raw.cover_from_user || raw.keyframe || raw.face || '').replace(/^http:/i, 'https:')
  const area = [raw.area_v2_parent_name, raw.area_v2_name].filter(Boolean).join('·') || ''
  const roomId = raw.room_id ? String(raw.room_id) : ''
  return {
    ok: true,
    mid: mid,
    name: name,
    roomId: roomId,
    url: roomId ? ('https://live.bilibili.com/' + roomId) : ('https://space.bilibili.com/' + mid),
    isLive: isLive,
    title: raw.title || '直播间',
    cover: cover,
    areaName: area,
    upName: name
  }
}

// 向后兼容：单 mid 查询（内部走批量，返回标准化卡片）
async function queryUPLiveInfo (mid) {
  const arr = await batchQueryBiliLive([String(mid)])
  if (arr.length === 0) return { ok: false, error: '查询失败或UP未开通直播间', mid: String(mid), name: '未知UP' }
  const c = normalizeBiliCard(arr[0])
  return Object.assign({ ok: true }, c)
}

// ===== 渲染图片（使用 Yunzai puppeteer 统一渲染器） =====
// 模板候选目录：优先本插件的 resources，其次 example 插件公共目录。
// 与 weather/hotSearch/dailyNews 保持一致的路径解析风格。
function _resolveBiliPushTpl () {
  const yunzai = findYunzaiRoot(__dirname)
  const pluginRoot = path.resolve(__dirname, '..')
  const candidates = [
    path.join(pluginRoot, 'resources'),
    path.join(yunzai, 'plugins', 'example', 'qunliao-plugin-release', 'resources'),
    path.join(yunzai, 'plugins', 'example', 'resources')
  ]
  for (const dir of candidates) {
    const tpl = path.join(dir, 'html', 'bilitvPush', 'bilitvPush.html')
    try {
      if (fs.existsSync(tpl)) {
        return { tplFile: tpl, pluResPath: dir.replace(/[\\/]$/, '') + path.sep }
      }
    } catch (_) { /* ignore */ }
  }
  return { tplFile: null, pluResPath: null }
}

async function renderCards (cards) {
  try {
    const { tplFile, pluResPath } = _resolveBiliPushTpl()
    if (!tplFile) {
      try { logger.error('[bilitvPush] 找不到 HTML 模板: resources/html/bilitvPush/bilitvPush.html') } catch (_) { /* ignore */ }
      return null
    }

    const bgCover = cards.length > 0 ? cards[0].cover : ''
    const enabled = cfgBool('glassEnabled', true)
    const defaultGradient = 'linear-gradient(135deg, rgba(14,165,233,0.45) 0%, rgba(99,102,241,0.40) 50%, rgba(236,72,153,0.40) 100%)'
    const data = {
      cover: bgCover,
      cardCount: cards.length,
      glassEnabled: enabled ? 'true' : 'false',
      glassBlur: String(cfgNum('glassBlur', 3)),
      glassSaturate: String(cfgNum('glassSaturate', 140)),
      glassOpacity: String(cfgNum('glassOpacity', 0.35)),
      glassBorder: String(cfgStr('glassBorder', 'rgba(255,255,255,0.18)')),
      glassRadius: String(cfgNum('glassRadius', 16)),
      coverFilterEnabled: cfgBool('coverFilterEnabled', true) ? 'true' : 'false',
      coverGradient: String(cfgStr('coverGradient', defaultGradient) || defaultGradient),
      coverMaskOpacity: String(cfgNum('coverMaskOpacity', 0.55)),
      cards: cards.map((c) => ({
        cover: c.cover,
        upName: c.name,
        title: c.title,
        areaName: c.areaName,
        url: c.url
      }))
    }

    const screenData = {
      saveId: 'bilitvPush',
      tplFile: tplFile,
      pluResPath: pluResPath,
      data: data,
      imgType: 'jpeg',
      quality: 92,
      // 确保页面等待“远程图片资源（封面/头像）下载完”再截图。
      // networkidle2 = 至少 2 个网络连接空闲 500ms，比默认 load 更保守。
      // 同时提升到 30s 上限，避免慢速封面图导致超时。
      pageGotoParams: {
        waitUntil: ['load', 'networkidle2'],
        timeout: 30000
      }
    }

    const renderRet = await puppeteer.screenshot('bilitvPush', screenData)
    if (!renderRet || renderRet === false) return null
    return renderRet
  } catch (err) {
    try { logger.error('[bilitvPush] 渲染失败: ' + (err && err.message)) } catch (_) { /* ignore */ }
    return null
  }
}

// ===== 扫描并构建卡片列表 =====
async function scanLiveUPs () {
  const mids = getSubscribeUIDs()
  if (mids.length === 0) return { total: 0, cards: [] }
  // 用批量接口一次查询所有订阅 UP，避免多次串行请求被风控
  const rows = await batchQueryBiliLive(mids)
  const cards = rows
    .map(normalizeBiliCard)
    .filter((c) => c && c.isLive)
  return { total: mids.length, cards }
}

// 把「渲染图 + 多条直播信息文本」合成一条消息（数组形式，QQ 自动拼成图文混排）
function buildLiveMessage (cards, img) {
  const segments = []
  if (img) segments.push(img)

  const lines = []
  for (let i = 0; i < cards.length; i++) {
    const c = cards[i]
    lines.push(`【${(c.name || '未知UP').trim()}】正在直播中...`)
    lines.push(`直播间：${(c.url || '').trim()}`)
    if (i < cards.length - 1) lines.push('')
  }
  segments.push(lines.join('\n'))
  return segments
}

// 向白名单群批量推送（与 dailyNews.pushToGroups 一致：Bot.pickGroup(gid).sendMsg([msg])）
async function pushToAllWhitelistGroups (cards) {
  const groups = getWhiteGroups()
  if (groups.length === 0 || cards.length === 0) return { groups: 0, cards: cards.length }

  const img = await renderCards(cards)
  if (!img) return { groups: 0, cards: cards.length }
  const message = buildLiveMessage(cards, img)

  let success = 0
  for (const gid of groups) {
    try {
      const group = Bot.pickGroup(Number(gid))
      if (!group) continue
      await group.sendMsg(message)
      success++
      await common.sleep(1500)
    } catch (err) {
      try { logger.error('[bilitvPush] 推送失败 group=' + gid + ' err=' + (err && err.message)) } catch (_) { /* ignore */ }
    }
  }
  logger.mark('[bilitvPush] 推送完成：直播中 ' + cards.length + ' 个，成功 ' + success + '/' + groups.length + ' 个群')
  return { groups: success, cards: cards.length }
}

async function pushToCurrentGroup (e, cards) {
  if (cards.length === 0) return false
  const img = await renderCards(cards)
  if (!img) {
    await e.reply('图片渲染失败，请检查 puppeteer 环境')
    return false
  }
  await e.reply(buildLiveMessage(cards, img))
  return true
}

// ===== 定时器 =====
// 约定：使用 cron 风格的小时数组 + 基于 interval 的兜底扫描。
// - 启动时立即排一次（可通过配置控制是否立即扫描）
// - 用 setInterval 每 60 秒检查一次当前时间是否命中指定小时
// - 为避免重复推送：用 "当天该小时已推送过" 的状态记录
let scheduleState = {
  lastPushAt: 0,
  pushedTodayHours: new Set(),
  currentDateKey: '',
  intervalTimer: null,
  startedAt: 0
}

function nowHH () { return new Date().getHours() }
function todayKey () {
  const d = new Date()
  return d.getFullYear() + '-' + (d.getMonth() + 1) + '-' + d.getDate()
}

async function doScheduledPush () {
  if (!isModuleEnabled(_MODULE_KEY)) return
  if (isScheduleBlocked()) return
  try {
    const { cards } = await scanLiveUPs()
    if (cards.length === 0) return
    const r = await pushToAllWhitelistGroups(cards)
    logger.mark('[bilitvPush] 定时扫描完成：直播中 ' + r.cards + ' 个，已推送 ' + r.groups + ' 个群')
  } catch (err) {
    try { logger.error('[bilitvPush] 定时扫描异常: ' + (err && err.message)) } catch (_) { /* ignore */ }
  }
}

function ensureScheduleStart () {
  if (scheduleState.intervalTimer) return
  scheduleState.startedAt = Date.now()
  // 每 60 秒检查一次（每小时最多触发一次；夜间时段会自动跳过）
  scheduleState.intervalTimer = setInterval(() => {
    try {
      const key = todayKey()
      if (key !== scheduleState.currentDateKey) {
        scheduleState.currentDateKey = key
        scheduleState.pushedTodayHours = new Set()
      }
      const hh = nowHH()
      // 夜间时段：直接跳过，不清空 pushedTodayHours，避免跨零点后重复推送
      if (isScheduleBlocked()) return
      const cronHours = getCronHours()
      if (cronHours.includes(hh) && !scheduleState.pushedTodayHours.has(hh)) {
        scheduleState.pushedTodayHours.add(hh)
        doScheduledPush()
      }
      // 基于 interval 的兜底扫描：每隔 scanIntervalHours 小时无条件扫描一次
      const intervalMs = getIntervalHours() * 60 * 60 * 1000
      if (Date.now() - scheduleState.lastPushAt >= intervalMs) {
        scheduleState.lastPushAt = Date.now()
        doScheduledPush()
      }
    } catch (_) { /* ignore */ }
  }, 60 * 1000)

  // 启动时立即执行一次（仅一次，避免频繁；若当前处于夜间则跳过）
  setTimeout(() => doScheduledPush(), 3000)
}

// ===== 指令入口 =====
export class BiliTVPush extends plugin {
  constructor () {
    super({
      name: 'qunliao-BiliTVPush',
      dsc: 'B站直播订阅推送',
      event: 'message',
      priority: 15,
      rule: [
        { reg: '^#B站推送$', fnc: 'pushNow' },
        { reg: '^#B站全部推送$', fnc: 'pushAll' },
        { reg: '^#B站订阅列表$', fnc: 'listSub' }
      ]
    })

    ensureScheduleStart()
  }

  async pushNow (e) {
    if (!isModuleEnabled(_MODULE_KEY)) return this.reply('B站推送功能已禁用')
    if (!isAdminUser(e)) return this.reply('仅管理员可使用该指令')

    await this.reply('正在扫描订阅UP的直播状态，请稍候...')
    const { cards } = await scanLiveUPs()
    if (cards.length === 0) {
      return this.reply('当前订阅的UP均未开播')
    }
    const ok = await pushToCurrentGroup(e, cards)
    if (!ok) return
  }

  async pushAll (e) {
    if (!isModuleEnabled(_MODULE_KEY)) return this.reply('B站推送功能已禁用')
    if (!isAdminUser(e)) return this.reply('仅管理员可使用该指令')

    await this.reply('正在扫描订阅UP的直播状态，并向全部白名单群推送，请稍候...')
    const { cards } = await scanLiveUPs()
    if (cards.length === 0) {
      return this.reply('当前订阅的UP均未开播')
    }
    const r = await pushToAllWhitelistGroups(cards)
    if (r.groups === 0) return this.reply('推送失败：没有可用的白名单群或消息发送失败')
    return this.reply('扫描完成：直播中 ' + r.cards + ' 个，已推送 ' + r.groups + ' 个白名单群')
  }

  async listSub (e) {
    if (!isModuleEnabled(_MODULE_KEY)) return this.reply('B站推送功能已禁用')
    if (!isAdminUser(e)) return this.reply('仅管理员可使用该指令')
    const mids = getSubscribeUIDs()
    if (mids.length === 0) return this.reply('当前没有订阅的UP')

    // 用批量接口一次查询所有订阅UP，获取名字（未开通直播间也能拿到 uname）
    const rows = await batchQueryBiliLive(mids)
    const rowByMid = new Map()
    for (const r of rows) {
      if (r && r.uid) rowByMid.set(String(r.uid), r)
    }

    const lines = []
    for (let i = 0; i < mids.length; i++) {
      const mid = mids[i]
      const row = rowByMid.get(mid)
      const name = (row && row.uname) || (row && row.uname)
      const displayName = name && String(name).trim() ? String(name).trim() : 'UP主'
      lines.push(`${i + 1}.【${displayName}】`)
      lines.push(mid)
      if (i < mids.length - 1) lines.push('')
    }
    return this.reply(lines.join('\n'))
  }
}
