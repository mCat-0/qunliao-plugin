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
  getNumber,
  httpFetch
} = await import('../components/ModuleHelper.js')

const _MODULE_KEY = 'historyToday'

export class HistoryToday extends plugin {
  constructor () {
    super({
      name: '历史上的今天',
      dsc: '查询历史上的今天发生的大事',
      event: 'message',
      priority: 50,
      rule: [
        { reg: '^#历史上的今天$|^#历史今日$', fnc: 'getHistoryToday' }
      ]
    })
  }

  async getHistoryToday () {
    if (!isModuleEnabled(_MODULE_KEY)) {
      return this.reply('「历史上的今天」功能已在配置中禁用')
    }
    if (!isGroupAllowed(this.e, _MODULE_KEY)) {
      return this.reply('当前群未在白名单内，无法使用历史上的今天')
    }
    try {
      const apiUrl = getString(
        _MODULE_KEY, 'apiUrl', 'https://uapis.cn/api/v1/misc/hotboard'
      )
      const maxItems = Math.max(1, Math.min(50, Number(getNumber(_MODULE_KEY, 'maxItems', 10))))
      const finalUrl = apiUrl.includes('?')
        ? `${apiUrl}&type=history`
        : `${apiUrl}?type=history`

      const resp = await httpFetch(finalUrl)
      if (!resp.ok) return this.reply(`请求失败：HTTP ${resp.status}`)

      const json = await resp.json()
      if (!json || !Array.isArray(json.list) || json.list.length === 0) {
        return this.reply('暂无历史上的今天数据')
      }

      const list = json.list.slice(0, maxItems)
      const now = new Date()
      const dateStr = `${now.getMonth() + 1}月${now.getDate()}日`

      let msg = `📜 历史上的今天（${dateStr}）`
      msg += '\n──────────────────'
      for (const item of list) {
        const year = (item.extra && item.extra.year) || ''
        msg += `\n${year ? year + '年 · ' : ''}${item.title || '(无标题)'}`
      }
      return this.reply(msg)
    } catch (err) {
      logger.error(`[historyToday] request error: ${err.message || err}`)
      return this.reply('获取历史事件异常，请稍后再试')
    }
  }
}
