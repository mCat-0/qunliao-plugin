import plugin from '../../../lib/plugins/plugin.js'
import {
  isModuleEnabled,
  isGroupAllowed,
  getString,
  httpFetch
} from '../components/ModuleHelper.js'

const _MODULE_KEY = 'weather'

export class Weather extends plugin {
  constructor () {
    super({
      name: '天气查询',
      dsc: '查询城市天气',
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
      const apiUrl = getString(
        _MODULE_KEY, 'apiUrl', 'https://api.suyanw.cn/api/weather.php'
      )
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
      let msg = `🌤 ${d.city} · ${c.date || ''} ${c.time || ''}\n`
      msg += `🌡 当前 ${c.temp || d.tempn || '?'}°C ${c.weather || d.weather || ''}\n`
      msg += `📉 今日 ${d.tempn}°C / ${d.temp}°C  ${d.weather || ''}\n`
      msg += `💨 ${c.wind || ''} ${c.windSpeed || d.windSpeed || ''}\n`
      msg += `💧 湿度 ${c.humidity || ''}  👁 能见度 ${c.visibility || ''}  🍃 空气 ${c.air || c.air_pm25 || ''}\n`
      msg += `🕒 发布时间 ${d.time || ''}`
      if (d.living && d.living.length > 0) {
        const keys = ['雨伞指数', '感冒指数', '穿衣指数', '紫外线强度指数', '心情指数']
        const picked = d.living.filter((x) => keys.includes(x.name)).slice(0, 3)
        if (picked.length) {
          msg += '\n\n📋 生活指数：'
          msg += picked.map((x) => `\n· ${x.name}：${x.index} — ${x.tips}`).join('')
        }
      }
      return this.reply(msg)
    } catch (err) {
      logger.error(`[weather] request error: ${err.message || err}`)
      return this.reply('天气接口请求失败，请稍后再试')
    }
  }
}
