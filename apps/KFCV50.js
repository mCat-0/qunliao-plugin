import plugin from '../../../lib/plugins/plugin.js'
import {
  isModuleEnabled,
  isGroupAllowed,
  getString,
  getStringList,
  httpFetch
} from '../components/ModuleHelper.js'

const _MODULE_KEY = 'KFCV50'
const DEFAULT_TRIGGER = ['疯狂星期四', '吃肯德基', 'kfc', 'KFC', '#v50', '#V50']

function matchTrigger (text) {
  const triggers = getStringList(_MODULE_KEY, 'triggerKeywords', DEFAULT_TRIGGER)
  if (!triggers || triggers.length === 0) return false
  return triggers.some((t) => text.includes(t))
}

export class KFCV50 extends plugin {
  constructor () {
    super({
      name: 'KFC疯狂星期四',
      dsc: '发送 KFC 疯狂星期四 文案',
      event: 'message',
      priority: 50,
      rule: [
        { reg: '.+', fnc: 'onMessage', log: false }
      ]
    })
  }

  async onMessage (e) {
    // 跳过机器人自己发的消息（避免自己的回复反复触发）
    const senderId = e.user_id || (e.sender && (e.sender.user_id || e.sender.uin))
    const selfId = e.self_id || (e.bot && (e.bot.uin || e.bot.user_id))
    if (senderId && selfId && String(senderId) === String(selfId)) return false

    const text = (e.msg || e.raw_message || e.message || '').trim()
    if (!text) return false
    if (!isModuleEnabled(_MODULE_KEY)) return false
    if (!isGroupAllowed(e, _MODULE_KEY)) return false
    if (!matchTrigger(text)) return false

    try {
      const apiUrl = getString(
        _MODULE_KEY, 'apiUrl', 'https://api.suyanw.cn/api/kfcyl.php?type=json'
      )
      const resp = await httpFetch(apiUrl)
      if (!resp.ok) return this.reply('你也配？我都还没吃，V我50谢谢')

      let text1 = null
      // 先读原始文本（避免 resp.json() 失败后 body 被消费无法再读）
      const rawText = await resp.text()
      try {
        const json = JSON.parse(rawText)
        text1 = json && (json.text || json.msg || json.data)
      } catch (jsonErr) {
        // API 实际返回纯文本（如中文段子），直接使用原始文本
        text1 = rawText.trim()
      }

      if (text1) return this.reply(text1)
      return this.reply('你也配？我都还没吃，V我50谢谢')
    } catch (err) {
      logger.error(`[KFCV50] request error: ${err.message || err}`)
      return this.reply('你也配？我都还没吃，V我50谢谢')
    }
  }
}
