# QunLiao Plugin (群聊插件)

一个集成化的 Yunzai-Bot 插件，将 11 个常用的群聊文案功能整合到同一个插件中。适配锅巴面板，所有功能均可使用锅巴面板进行全部配置，配置立即生效

<br />

## 安装

在Yunzai根目录使用Git

> ```Shell
> ```

<br />

<br />

<br />

<br />

## 目录结构

<br />

```
qunliao-plugin/
├── index.js              # 插件入口（动态模块加载器）
├── package.json        # 包描述
├── README.md           # 本文档
├── guoba.support.js    # 锅巴面板支持（可视化配置）
├── apps/               # 功能模块（由 index.js 自动发现）
│   ├── dailyNews.js       # 每日早报（定时推送 + 图片渲染 + 缓存）
│   ├── goodNight.js      # 早安/晚安问候（含 8 小时禁言）
│   ├── hotSearch.js      # 多平台热搜
│   ├── weather.js        # 城市天气查询
│   ├── dujitang.js       # 毒鸡汤
│   ├── dogDiary.js        # 舔狗日记
│   ├── cosImage.js        # 随机图片（JK / 黑丝 / 白丝 / COS）
│   ├── KFCV50.js        # KFC 疯狂星期四
│   ├── historyToday.js     # 历史上的今天
│   ├── marriageCertificate.js  # 结婚证生成器
│   └── help.js            # 群聊帮助（指令列表图片）
├── components/           # 公共组件
│   ├── Config.js        # 配置加载器
│   └── ModuleHelper.js # 公共工具函数
├── model/              # 路径解析
│   └── path.js
├── config/
│   └── config_default.yaml  # 默认配置
└── resources/         # 静态资源
    ├── fonts/
    │   └── DouyinSansBold.ttf  # 抖音美好体
    └── html/
        ├── dailyNews/      # 早报 HTML/CSS 模板
        └── help/           # 帮助 HTML/CSS 模板
```

## 模块说明

| 模块        | 文件                     | 触发指令                                                           | 功能描述                                  |
| --------- | ---------------------- | -------------------------------------------------------------- | ------------------------------------- |
| 每日早报      | dailyNews.js           | `#早报` / `#推送早报` / `#刷新早报`                                      | 抓取每日新闻，渲染为精美图片发送，06:30 自动定时推送，支持白名单群组 |
| 早晚安问候     | goodNight.js           | 消息中含 `早安` / `早上好` / `晚安` / `我要睡了` / `我要休息了`                    | 调用问候文案回复，晚安触发 8 小时禁言                  |
| 多平台热搜     | hotSearch.js           | `#热搜` / `#抖音热搜` / `#微博热搜` ...                                  | 支持多平台的 Top-10 热搜榜单                    |
| 天气查询      | weather.js             | `#天气` / `#城市名天气`（例：`#广州天气`）                                    | 实时天气 + 生活指数                           |
| 毒鸡汤       | dujitang.js            | `#毒鸡汤` / `毒鸡汤` / `来碗鸡汤`                                        | 随机毒鸡汤文案                               |
| 舔狗日记      | dogDiary.js            | `#舔狗日记`                                                        | 随机舔狗日记文案                              |
| 随机图片      | cosImage.js            | `#JK` / `我要看jk` / `我要看黑丝` / `我要看白丝` / `cos` / `#cos` / `#cos图` | 随机 JK / 黑丝 / 白丝 / COS 图片              |
| KFC 疯狂星期四 | KFCV50.js              | `疯狂星期四` / `KFC` / `#V50` / `吃肯德基`                              | 随机疯四文案                                |
| 历史上的今天    | historyToday.js        | `#历史上的今天`                                                      | 查询历史上今日事件                             |
| 结婚证生成器    | marriageCertificate.js | `我要和XXX结婚` / `我和XXX结婚了`                                        | 生成结婚证图片                               |
| 群聊帮助      | help.js                | `#群聊帮助` / `#mcat群聊帮助`                                          | 列出本插件所有指令，生成双列图片                      |

## 扩展性说明

- **自动发现**：`index.js` 通过 `fs.readdirSync()` 扫描 `./apps/` 目录。任何新增的 `.js` 文件在重启机器人后会被自动加载。
- **零代码接入**：在 `apps/` 下新增一个文件，导出一个继承 `plugin` 的类。重启即完成接入。
- **模块独立**：每个模块互相独立，互不影响，不存在模块间 import。

## 配置

编辑 `config/config_default.yaml` 可开关各个模块或调整运行参数。也可以通过锅巴面板（guoba.support.js 提供的可视化界面进行配置。

## 部署

1. 将整个 `qunliao-plugin/` 目录放入 `Yunzai-Bot/plugins/` 目录下
2. 重启 Yunzai-Bot
3. 确认启动日志中显示：
   ```
   [qunliao-plugin] loading QunLiao-PLUGIN
   [qunliao-plugin] QunLiao-PLUGIN loaded successfully (11 modules)
   ```

## 新增模块示例

创建 `apps/yourFeature.js`：

```javascript
import plugin from '../../../lib/plugins/plugin.js'

export class YourFeature extends plugin {
  constructor () {
    super({
      name: 'YourFeature',
      dsc: '你的模块描述',
      event: 'message',
      priority: 50,
      rule: [
        { reg: '^#你的指令$', fnc: 'doSomething' }
      ]
    })
  }

  async doSomething () {
    await this.reply('你好，来自新模块！')
  }
}
```

保存，重启机器人 — 你的模块即被自动加载。
