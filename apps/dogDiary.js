import plugin from '../../../lib/plugins/plugin.js'
import {
  isModuleEnabled,
  isGroupAllowed,
  getString,
  httpFetch
} from '../components/ModuleHelper.js'

const _MODULE_KEY = 'dogDiary'

export class DogDiary extends plugin {
  constructor () {
    super({
      name: '舔狗日记',
      dsc: '发送今日舔狗日记',
      event: 'message',
      priority: 50,
      rule: [
        { reg: '^#舔狗日记$', fnc: 'getDogDiary' }
      ]
    })
  }

  async getDogDiary () {
    if (!isModuleEnabled(_MODULE_KEY)) {
      return this.reply('「舔狗日记」功能已在配置中禁用')
    }
    if (!isGroupAllowed(this.e, _MODULE_KEY)) {
      return this.reply('当前群未在白名单内，无法使用舔狗日记')
    }
    try {
      const apiUrl = getString(_MODULE_KEY, 'apiUrl', 'https://v2.xxapi.cn/api/dog')
      const resp = await httpFetch(apiUrl)
      if (!resp.ok) return this.reply(`请求失败：HTTP ${resp.status}`)
      const json = await resp.json()
      if (json && json.code === 200 && json.data) return this.reply(json.data)
      return this.reply('舔狗日记暂时写不出来了，主人再等等')
    } catch (err) {
      logger.error(`[dogDiary] request error: ${err.message || err}`)
      return this.reply('舔狗日记暂时写不出来了，主人再等等')
    }
  }
}
