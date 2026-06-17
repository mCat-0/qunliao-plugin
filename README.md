
<div align="center">

# 🌟 QunLiao Plugin · 群聊插件

> 一个集成化的 Yunzai-Bot 插件，将 11 个常用的群聊功能一站式整合

[![Yunzai-Bot](https://img.shields.io/badge/Yunzai--Bot-v3.0+-blue?style=flat-square)](https://gitee.com/yoimiya-kokomi/Miao-Yunzai)
[![Module Count](https://img.shields.io/badge/模块-11_个-2ea44f?style=flat-square)](#-模块清单)
[![Node.js](https://img.shields.io/badge/Node.js->=16-43853D?style=flat-square)](https://nodejs.org/)
[![License](https://img.shields.io/badge/License-MIT-97ca00?style=flat-square)](LICENSE)

</div>

---

## 📋 目录

- [✨ 功能亮点](#-功能亮点)
- [📁 目录结构](#-目录结构)
- [🎮 模块清单](#-模块清单)
- [🔧 扩展性设计](#-扩展性设计)
- [⚙️ 配置方式](#️-配置方式)
- [🚀 快速部署](#-快速部署)
- [💡 新增模块示例](#-新增模块示例)

---

## ✨ 功能亮点

<div align="center">

| 🏷️ 特性 | 说明 |
|--------|------|
| **📦 模块化** | 11 个功能互相独立，可单独开关 |
| **🔄 自动加载** | apps/ 目录下的文件自动识别，无需手动注册 |
| **🎨 图片渲染** | 早报/帮助支持 HTML+CSS 模板渲染，精美排版 |
| **🎛️ 可视化配置** | 完整支持锅巴面板，无需改代码即可配置 |
| **🖼️ 多字体** | 内置抖音美好体，确保中文渲染美观 |
| **🛡️ 自循环保护** | 关键词触发模块防自回复，避免机器人刷屏 |

</div>

---

## 📁 目录结构

```
qunliao-plugin/
├── 📄 index.js              ═════▶ 插件入口（动态模块加载器）
├── 📦 package.json          ═════▶ 包描述
├── 📖 README.md             ═════▶ 本文档
├── ⚙️  guoba.support.js     ═════▶ 锅巴面板支持（可视化配置）
│
├── 📂 apps/                 ═════▶ 功能模块（11 个）
│   ├── 📰 dailyNews.js              ← 每日早报（定时推送 + 图片渲染）
│   ├── 🌙 goodNight.js              ← 早安/晚安问候（含禁言）
│   ├── 🔥 hotSearch.js              ← 多平台热搜
│   ├── ☁️  weather.js               ← 城市天气查询
│   ├── ☠️  dujitang.js              ← 毒鸡汤
│   ├── 🐕 dogDiary.js               ← 舔狗日记
│   ├── 📸 cosImage.js               ← 随机图片（JK/黑丝/白丝/COS）
│   ├── 🍗 KFCV50.js                 ← KFC 疯狂星期四
│   ├── 📜 historyToday.js           ← 历史上的今天
│   ├── 💍 marriageCertificate.js    ← 结婚证生成器
│   └── 📋 help.js                   ← 群聊帮助（指令列表图片）
│
├── 📂 components/           ═════▶ 公共组件
│   ├── Config.js              ← 配置加载器
│   └── ModuleHelper.js       ← 公共工具函数
│
├── 📂 model/               ═════▶ 路径解析
│   └── path.js
│
├── 📂 config/              ═════▶ 默认配置
│   └── config_default.yaml
│
└── 📂 resources/           ═════▶ 静态资源
    ├── fonts/
    │   └── DouyinSansBold.ttf   ← 抖音美好体
    └── html/
        ├── dailyNews/            ← 早报 HTML/CSS 模板
        └── help/                 ← 帮助 HTML/CSS 模板
```

---

## 🎮 模块清单

| # | 📦 模块 | 📄 文件 | 🎯 触发指令 | 📝 功能描述 |
|---|--------|--------|-----------|-----------|
| 1 | 📰 每日早报 | `dailyNews.js` | `#早报` / `#推送早报` / `#刷新早报` | 抓取每日新闻，渲染为精美图片，06:30 定时推送 |
| 2 | 🌙 早晚安问候 | `goodNight.js` | `早安` / `早上好` / `晚安` / `我要睡了` / `我要休息了` | 随机问候文案回复，晚安触发 8 小时禁言 |
| 3 | 🔥 多平台热搜 | `hotSearch.js` | `#热搜` / `#抖音热搜` / `#微博热搜` ... | 多平台 Top-10 热搜榜单 |
| 4 | ☁️ 天气查询 | `weather.js` | `#天气` / `#城市名天气`（例：`#广州天气`） | 实时天气 + 生活指数 |
| 5 | ☠️ 毒鸡汤 | `dujitang.js` | `#毒鸡汤` / `毒鸡汤` / `来碗鸡汤` | 随机毒鸡汤文案 |
| 6 | 🐕 舔狗日记 | `dogDiary.js` | `#舔狗日记` | 随机舔狗日记文案 |
| 7 | 📸 随机图片 | `cosImage.js` | `#JK` / `我要看jk` / `#黑丝` / `我要看黑丝` / `#白丝` / `我要看白丝` / `cos` / `#cos` / `#cos图` | 随机 JK/黑丝/白丝/COS 图片 |
| 8 | 🍗 KFC 疯狂星期四 | `KFCV50.js` | `疯狂星期四` / `KFC` / `#V50` / `吃肯德基` | 随机疯四文案 |
| 9 | 📜 历史上的今天 | `historyToday.js` | `#历史上的今天` | 查询历史上今日事件 |
| 10 | 💍 结婚证生成器 | `marriageCertificate.js` | `我要和@某人结婚` / `我和某人结婚了` / `我要和@某人结婚了` | 生成结婚证图片，支持 @ 对象或直接输入 |
| 11 | 📋 群聊帮助 | `help.js` | `#群聊帮助` / `#mcat群聊帮助` | 列出本插件所有指令，生成精美双列图片 |

---

## 🔧 扩展性设计

<div align="center">

| 特性 | 说明 |
|------|------|
| **🔍 自动发现** | `index.js` 通过 `fs.readdirSync()` 扫描 `./apps/` 目录，任何新增的 `.js` 文件会被自动加载 |
| **⚡ 零代码接入** | 在 `apps/` 下新增一个文件，导出一个继承 `plugin` 的类，**重启即完成接入** |
| **🧩 模块独立** | 每个模块互相独立，互不影响，不存在模块间 import |

</div>

---

## ⚙️ 配置方式

> **编辑配置文件**：`config/config_default.yaml`  
> 可开关各个模块、调整运行参数、自定义 API 地址。

> **可视化配置**：通过锅巴面板（guoba.support.js 提供的图形界面进行配置，**无需编写任何代码**。

---

## 🚀 快速部署

### 步骤 1：放置插件
将整个 `qunliao-plugin/` 目录放入 `Yunzai-Bot/plugins/` 目录下

### 步骤 2：重启机器人
```bash
# 根据你的 Yunzai 启动方式重启
```

### 步骤 3：确认加载成功
启动日志中应显示：

```
[qunliao-plugin] loading QunLiao-PLUGIN
[qunliao-plugin] QunLiao-PLUGIN loaded successfully (11 modules)
```

### 步骤 4：测试指令
在群聊中发送：

```
#群聊帮助    ← 查看所有指令
#早报        ← 测试早报
#舔狗日记    ← 测试文本类模块
```

---

## 💡 新增模块示例

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

> **保存，重启机器人** — 你的模块即被自动加载！

---

<div align="center">

**Made with ❤️ for Yunzai-Bot**

</div>
