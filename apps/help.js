import fs from 'node:fs'
import path from 'node:path'
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

function libUrl (rel) {
  const parts = rel.split('/').filter(Boolean)
  const abs = path.join(yunzaiRoot, 'lib', ...parts)
  return pathToFileURL(abs).href
}

const plugin = (await import(libUrl('plugins/plugin.js'))).default
const puppeteer = (await import(libUrl('puppeteer/puppeteer.js'))).default

const {
  getString,
  getNumber,
  isGroupAllowed,
  isModuleEnabled,
  httpFetch
} = await import('../components/ModuleHelper.js')

const _MODULE_KEY = 'help'
const _path = process.cwd().replace(/\\/g, '/')
const CACHE_DIR = path.join(process.cwd().replace(/\\/g, '/'), 'data', 'cache', 'help')

const APPS_DIR = __dirname.replace(/\\/g, '/')

// ============================================================
// 模块显示名称映射（用于图片展示）
// ============================================================
const MODULE_NAMES = {
  dailyNews: '每日早报',
  goodNight: '早晚安问候',
  hotSearch: '多平台热搜',
  weather: '天气查询',
  dujitang: '毒鸡汤',
  dogDiary: '舔狗日记',
  cosImage: 'COS 图片',
  jkImage: 'JK 图片',
  heisiImage: '黑丝图片',
  baisiImage: '白丝图片',
  KFCV50: 'KFC 疯狂星期四',
  historyToday: '历史上的今天',
  marriageCertificate: '结婚证生成器',
  help: '群聊帮助'
}

// ============================================================
// 配置读取（动态，支持锅巴面板即时生效）
// ============================================================
function getTitle () { return getString(_MODULE_KEY, 'title', '群聊帮助') }
function getSubtitle () { return getString(_MODULE_KEY, 'subtitle', 'mCat群聊指令查看') }
function getBgMode () { return getString(_MODULE_KEY, 'bgMode', 'api') } // 'api' | 'local'
function getBgApiUrl () { return getString(_MODULE_KEY, 'bgApiUrl', 'https://api.elaina.cat/random/mobile') }
function getBgLocalPath () { return getString(_MODULE_KEY, 'bgLocalPath', '') }

function ensureCacheDir () {
  try {
    if (!fs.existsSync(CACHE_DIR)) fs.mkdirSync(CACHE_DIR, { recursive: true })
  } catch (err) {
    logger.warn('[help] cache dir failed:', err?.message)
  }
}

// ============================================================
// 静态详细命令列表：主指令 + 功能描述 + 管理员标识
// hasAdmin: true 表示模块含管理员指令，图片中该模块占整行（单列）
// ============================================================
function getAllCommands () {
  return [
    {
      moduleName: '每日早报',
      hasAdmin: true,
      commands: [
        { cmd: '#早报', desc: '发送早报' },
        { cmd: '#推送早报', desc: '将早报推送至全部白名单群组', admin: true },
        { cmd: '#刷新早报', desc: '管理员指令，清除早报图片缓存', admin: true }
      ]
    },
    {
      moduleName: '图片模块',
      hasAdmin: false,
      commands: [
        { cmd: '我要看黑丝 / #黑丝', desc: '发送随机黑丝图' },
        { cmd: '我要看白丝 / #白丝', desc: '发送随机白丝图' },
        { cmd: '我要看jk / #jk', desc: '发送随机jk图' },
        { cmd: 'cos / #Cos', desc: '发送随机cos图' }
      ]
    },
    {
      moduleName: '早晚安问候',
      hasAdmin: false,
      commands: [
        { cmd: '早安 / 早上好', desc: '关键字触发，回复随机早安文案' },
        { cmd: '晚安 / 我要睡了 / 我要休息了', desc: '关键字触发，回复随机晚安文案，并禁言8小时' }
      ]
    },
    {
      moduleName: '毒鸡汤',
      hasAdmin: false,
      commands: [
        { cmd: '#毒鸡汤 / 来碗鸡汤', desc: '生活不易，何须努力' }
      ]
    },
    {
      moduleName: '舔狗日记',
      hasAdmin: false,
      commands: [
        { cmd: '#舔狗日记', desc: '做一只合格的舔狗' }
      ]
    },
    {
      moduleName: '结婚证生成器',
      hasAdmin: false,
      commands: [
        { cmd: '我要和XX结婚 / 我和XX结婚了', desc: '生成结婚证图片' }
      ]
    },
    {
      moduleName: 'KFC 疯狂星期四',
      hasAdmin: false,
      commands: [
        { cmd: '#v50 / 吃肯德基 / 疯狂星期四', desc: '随机疯四文案' }
      ]
    },
    {
      moduleName: '历史上的今天',
      hasAdmin: false,
      commands: [
        { cmd: '#历史上的今天', desc: '查询历史今天事件' }
      ]
    },
    {
      moduleName: '多平台热搜',
      hasAdmin: false,
      commands: [
        { cmd: '#热搜 / #微博热搜', desc: '今日热搜资讯，默认抖音，支持多平台' }
      ]
    },
    {
      moduleName: '天气查询',
      hasAdmin: false,
      commands: [
        { cmd: '#天气 / #城市天气', desc: '查询对应城市天气信息' }
      ]
    },
    {
      moduleName: '群聊帮助',
      hasAdmin: false,
      commands: [
        { cmd: '#群聊帮助 / #mCat群聊帮助', desc: '查看插件指令' }
      ]
    },
    {
      moduleName: '在线更新',
      hasAdmin: true,
      commands: [
        { cmd: '#更新群聊插件', desc: '从仓库获取最新版本，保留用户配置', admin: true },
        { cmd: '#修复群聊插件', desc: '从仓库获取全部文件，强制覆盖并清除用户配置', admin: true }
      ]
    }
  ]
}

// ============================================================
// 下载背景图片到本地（解决防盗链）
// ============================================================
async function getBackgroundImage () {
  const mode = getBgMode()
  if (mode === 'local') {
    const localPath = getBgLocalPath()
    if (localPath && fs.existsSync(localPath)) {
      return `file://${localPath.replace(/\\/g, '/')}`
    }
    logger.warn('[help] 本地背景图片路径无效或不存在，回退到 API 模式')
  }

  // API 模式：下载到本地缓存
  try {
    const apiUrl = getBgApiUrl()
    if (!apiUrl) return null

    ensureCacheDir()
    const cacheFile = path.join(CACHE_DIR, `bg-${Date.now()}.jpg`)

    logger.mark(`[help] downloading background: ${apiUrl}`)
    const res = await httpFetch(apiUrl)
    if (!res || !res.ok) {
      logger.warn(`[help] background API HTTP error`)
      return null
    }

    const buffer = Buffer.from(await res.arrayBuffer())
    fs.writeFileSync(cacheFile, buffer)
    logger.mark(`[help] background saved: ${cacheFile}`)
    return `file://${cacheFile.replace(/\\/g, '/')}`
  } catch (err) {
    logger.warn('[help] background image failed:', err?.message)
    return null
  }
}

// ============================================================
// 渲染帮助图片
// ============================================================
async function renderHelpImage () {
  ensureCacheDir()

  const __pluginRoot = path.resolve(APPS_DIR, '..').replace(/\\/g, '/')

  const candidateDirs = [
    `${__pluginRoot}/resources`,
    `${_path}/plugins/example/qunliao-plugin/resources`,
    `${_path}/plugins/qunliao-plugin/resources`,
    `${_path}/plugins/example/resources`,
    `${_path}/resources`
  ]

  let tplFile = null
  let pluResPath = null
  for (const dir of candidateDirs) {
    const candidate = `${dir}/html/help/help.html`
    if (fs.existsSync(candidate)) {
      tplFile = candidate
      pluResPath = `${dir}/`
      break
    }
  }

  if (!tplFile) {
    logger.error('[help] 找不到 HTML 模板：resources/html/help/help.html')
    return false
  }

  // 获取背景图
  const bg = await getBackgroundImage()

  // 获取指令列表（静态详细清单）
  // 排序：普通模块(hasAdmin=false) 在前，含管理员指令的模块挨在一起
  const rawModules = getAllCommands()
  const modules = [...rawModules].sort((a, b) => {
    const aScore = a.hasAdmin ? 1 : 0
    const bScore = b.hasAdmin ? 1 : 0
    return aScore - bScore
  })

  const data = {
    title: getTitle(),
    subtitle: getSubtitle(),
    background: bg || '',
    modules
  }

  const cacheFile = path.join(CACHE_DIR, `help-${Date.now()}.jpg`)

  const screenData = {
    saveId: 'help',
    tplFile: tplFile,
    pluResPath: pluResPath,
    data: data,
    imgType: 'jpeg',
    quality: 92,
    path: cacheFile
  }

  const img = await puppeteer.screenshot('help', screenData)
  if (!img) {
    logger.error('[help] image render failed')
    return false
  }

  logger.mark(`[help] image generated: ${cacheFile}`)
  return img
}

// ============================================================
// 插件主类
// ============================================================
export class help extends plugin {
  constructor () {
    super({
      name: '群聊帮助',
      dsc: '查看 qunliao-plugin 所有可用指令',
      event: 'message',
      priority: 5000,
      rule: [
        { reg: '^#?(mcat群聊帮助|群聊帮助|MCAT群聊帮助|mCat群聊帮助)$', fnc: 'showHelp' }
      ]
    })
  }

  async showHelp (e) {
    if (!isModuleEnabled(_MODULE_KEY)) {
      await e.reply('「群聊帮助」功能已在配置中禁用')
      return true
    }
    if (!isGroupAllowed(_MODULE_KEY, e)) return true

    await e.reply('正在生成指令清单，请稍候…')

    try {
      const img = await renderHelpImage()
      if (img) {
        await e.reply(img)
      } else {
        await e.reply('生成指令图片失败，请查看控制台日志')
      }
    } catch (err) {
      logger.error('[help] render failed:', err?.message || err)
      await e.reply('生成指令图片失败，请稍后再试')
    }
    return true
  }
}
