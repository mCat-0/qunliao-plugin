import plugin from '../../../lib/plugins/plugin.js'
import {
  isModuleEnabled,
  isGroupAllowed,
  getString,
  httpFetch
} from '../components/ModuleHelper.js'

const _MODULE_KEY = 'hotSearch'

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
  douyin: '抖音',
  weibo: '微博',
  bilibili: 'B站',
  baidu: '百度',
  toutiao: '头条',
  sina: '新浪',
  genshin: '原神',
  kuaishou: '快手',
  xiaohongshu: '小红书',
  zhihu: '知乎',
  starrail: '星铁'
}

export class HotSearch extends plugin {
  constructor () {
    super({
      name: '热搜',
      dsc: '查询各大平台热搜',
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
    const platformKey = match[1].trim()
    const type = PLATFORM_MAP[platformKey]
    if (!type) {
      const supported = Object.keys(PLATFORM_MAP)
        .filter((_, idx) => idx % 2 === 0)
        .slice(0, 8)
        .join('/')
      return this.reply(`暂不支持「${platformKey}」，支持：${supported} 等`)
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
      const apiUrl = getString(
        _MODULE_KEY, 'apiUrl', 'https://uapis.cn/api/v1/misc/hotboard'
      )
      const finalUrl = apiUrl.includes('?')
        ? `${apiUrl}&type=${encodeURIComponent(type)}`
        : `${apiUrl}?type=${encodeURIComponent(type)}`

      const resp = await httpFetch(finalUrl)
      if (!resp.ok) return this.reply(`请求失败：HTTP ${resp.status}`)
      const json = await resp.json()
      if (!json || !Array.isArray(json.list) || json.list.length === 0) {
        return this.reply('获取热搜失败，接口未返回数据')
      }
      const list = json.list.slice(0, 10)
      const name = PLATFORM_NAME[type] || type
      const update = json.update_time ? `（${json.update_time}）` : ''
      let msg = `🔥 ${name}热搜 TOP${list.length}${update}\n`
      msg += '──────────────────'
      for (const item of list) {
        const idx = item.index || list.indexOf(item) + 1
        const hot = item.hot_value ? ` 🔥${formatHot(item.hot_value)}` : ''
        msg += `\n${idx}. ${item.title || '(无标题)'}${hot}`
      }
      return this.reply(msg)
    } catch (err) {
      logger.error(`[hotSearch] request error: ${err.message || err}`)
      return this.reply('获取热搜异常，请稍后再试')
    }
  }
}

function formatHot (v) {
  const n = Number(v)
  if (!isFinite(n)) return ''
  if (n >= 100000000) return (n / 100000000).toFixed(1) + '亿'
  if (n >= 10000) return (n / 10000).toFixed(1) + '万'
  return String(n)
}
