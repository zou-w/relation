# 人脉关系网记录系统

记录工作中接触的人，梳理成关系网，**借资源为己所用**。H5 + PWA，手机和电脑都能用。

---

## 一、这是什么

一套面向政企人脉管理的轻量工具，核心不是"画好看的网图"，而是回答四个问题：

| 你的问题 | 系统能力 |
|---|---|
| 我要做某类业务，谁手里有这渠道？ | **资源检索** |
| 我要见某人，能通过谁搭上线？ | **触达路径**（二阶人脉） |
| 谁能影响这个人 / 拍板？ | **影响力查询** |
| 我多久没联系某人了？ | **冷接触提醒** |

### 与最初设计的差异

原方案做微信小程序，现改为 **H5 + PWA**，原因：

- **电脑端**：小程序在电脑上只能挤在微信客户端里，录档案、批量整理很痛苦；网页全屏 + 键盘输入，效率差一倍
- **上线门槛**：政企数据类工具走小程序审核风险高，可能被驳回；网页有备案域名即可上线
- **代码复用**：统一 RESTful API，将来要上小程序不用改后端

手机端可"添加到主屏幕"，图标和全屏体验接近原生 App。

---

## 二、技术栈

```
微信小程序 / H5 浏览器 / 手机主屏
            ↓ HTTPS
     Nginx 反向代理 + SSL
            ↓
     Node.js (Express)  API      ← 57MB 常驻
            ↓
     SQLite (单文件)             ← 7 张表
```

| 层 | 选型 | 说明 |
|---|---|---|
| 后端 | Node.js 22 + Express 4 | 低内存，2G 服务器从容 |
| 数据库 | SQLite（better-sqlite3，回退 node:sqlite） | 零运维，单文件备份 |
| 前端 | Vue 3 + Vite 5 + Vant 4 | 移动优先，桌面自适应 |
| 图谱 | Cytoscape.js | Canvas 渲染，手势流畅 |
| PWA | vite-plugin-pwa | 可安装、离线缓存 |
| Excel | exceljs | 模板生成（样式/批注/下拉）+ 解析，纯 JS 无原生依赖 |

总内存占用约 **300–500MB**，2G 服务器留足余量。

---

## 三、快速开始

### 1. 后端

```bash
cd relation-api
npm install --omit=optional     # 跳过需要编译的原生模块
npm run seed                    # 建表 + 写入演示数据
npm start                       # 启动，默认 3100 端口
```

首次启动会自动生成 `.env` 并写入加密密钥，**这个文件要立刻备份**（见安全章节）。

### 2. 前端

```bash
cd relation-web
npm install
npm run dev                     # 开发模式，5173 端口，已配代理
```

浏览器打开 <http://localhost:5173>

### 3. 生产构建

```bash
cd relation-web && npm run build      # 产物在 dist/
cd ../relation-api && npm start       # 会自动托管 ../relation-web/dist
```

后端检测到 `../relation-web/dist` 存在时，会直接托管前端静态文件，**单进程跑完整应用**，不需要额外的 Nginx 静态目录。

---

## 四、数据模型

7 张表，三条主线：**人－组织－事件**是骨架，**资源画像**是价值，**关系**是杠杆。

| 表 | 作用 | 关键字段 |
|---|---|---|
| `persons` | 联系人 | `is_self`（本人节点）、`is_key_contact`（重点）、`sensitivity`（涉敏） |
| `organizations` | 企业/政府单位 | `alias`（简称搜索）、`parent_org_id`（树形层级）、`org_type` |
| `employments` | 任职桥 | `power_level`（决策/审批/经办）、`is_current` |
| `person_attributes` | **资源画像** | `attr_type`：resource/sphere/tag/influence/channel，`weight` 1–5 |
| `relations` | 人↔人 | `strength`（我和他多熟）、`influence`（他对别人话语权） |
| `contact_events` | 接触记录 | `next_date`（跟进提醒）、`is_done` |
| `org_relations` | 组织↔组织 | `relation_type` |

### 三个关键设计

**1. "你自己"也是节点**（`is_self=1`）
只有把自己入图，"我→A→B"的引荐链、"我的人脉覆盖度"才算得出来。

**2. 亲密度与影响力正交**
`strength` 是我和他的关系，`influence` 是他对他人的话语权。两者独立——一个跟我很熟的人，未必能影响目标。

**3. 资源画像独立建表**
不塞进 `remark` 文本，才能被结构化检索。这是"借资源"能成立的前提。

---

## 五、API 一览

### 基础
```
GET  /api/health              健康检查
GET  /api/enums               枚举字典（8 组）
GET  /api/graph/stats         首页统计
```

### 联系人
```
GET    /api/persons                       查人（keyword / key_only / org_id / has_attr / missing_phone / page+page_size）
POST   /api/persons                       快速录入（自动建组织+任职）
POST   /api/persons/batch-delete          批量删除（本人节点自动跳过）
GET    /api/persons/:id                   详情（含任职/画像/关系/接触）
PATCH  /api/persons/:id                   编辑
DELETE /api/persons/:id                   删除
GET    /api/persons/:id/neighbors         一跳邻居（图谱按需加载）
POST   /api/persons/:id/attributes        资源画像打标
DELETE /api/persons/:id/attributes/:aid   删除画像
```

### Excel 批量导入
```
GET  /api/import/template               下载模板（带必填标注/批注/下拉/填写说明）
GET  /api/import/fields                 模板字段清单（前端渲染填写要求）
POST /api/import/preview                上传预检，逐行校验，不写库
POST /api/import/execute?mode=skip      确认导入（skip 跳过已存在 / update 覆盖）
```

### 资源（第一价值）
```
GET /api/resources/search?q=&type=&min_weight=   资源检索
GET /api/resources/spheres                       圈子渗透度
GET /api/resources/paths/:personId               触达路径（1跳/2跳）
GET /api/resources/org/:orgId/reach              组织抓手：该单位能通过谁
GET /api/resources/influencers/:personId         谁能影响 ta
GET /api/resources/overview                      资源分布概览
```

### 接触与提醒
```
POST  /api/events                   记录接触（自动关联其现任单位）
GET   /api/events                   事件列表
GET   /api/events/pending?days=7    待办（逾期/今日/未来）
GET   /api/events/cold?days=30      冷接触：多久没联系
PATCH /api/events/:id               勾选完成
DELETE/api/events/:id               删除
```

### 关系 / 组织 / 图谱
```
GET    /api/relations              关系列表
POST   /api/relations              建立关系
PATCH  /api/relations/:id          调整强度/影响力
DELETE /api/relations/:id          删除
GET    /api/relations/org          组织间关系
POST   /api/relations/org          建立组织关系

GET  /api/orgs?q=                  组织搜索（支持简称）
POST /api/orgs                     新建组织
GET  /api/orgs/:id                 组织详情（含在任人员）

GET  /api/graph?key_only=1         图谱 nodes + edges
```

**共 34 个接口，冒烟测试 46 项全部通过。**

---

## 六、前端页面

| 路由 | 页面 | 说明 |
|---|---|---|
| `/` | 今日 | 待办（逾期/今日/未来）+ 冷接触 + 统计 + 快捷入口 |
| `/record` | 快速记录 | 姓名必填其余可后补，单位带联想，3 秒落库 |
| `/search` | 查人 | 姓名/单位/职务/备注模糊搜，重点人物筛选 |
| `/resources` | 借资源 | 资源检索 + 圈子渗透度 + 常用标签 |
| `/person/:id` | 联系人详情 | 任职、资源画像、触达路径、影响力、人际关系、接触时间线 |
| `/graph` | 关系图 | Cytoscape 图谱，全屏独立页 |
| `/manage` | 管理 | 人员列表、搜索筛选、新增/编辑/删除、批量删除、导入入口 |
| `/import` | 导入名单 | 三步向导：下载模板 → 上传预检 → 确认入库 |

### 人员管理（`/manage`）

- 列表支持搜索、筛选（全部 / 重点 / 有资源 / 缺手机）、分页加载（每页 100，可「加载更多」）
- 行内点「编辑」开抽屉改姓名、单位、职务、权力角色、手机、邮箱、重点标记、备注
- 「批量」进入多选，可全选本页、批量删除；**本人节点受保护，删不掉**
- 改单位才动任职记录，只改名不会在任职表里留下垃圾数据
- 清空手机号是显式操作（PATCH 传空串），不会被当成「不修改」

### Excel 导入向导（`/import`）

三步走，**预检不写库**，确认后才真正落盘。

**模板设计**

| 设计 | 做法 |
|---|---|
| 必填标注 | 表头写成「姓名 *」，必填列浅红底、红色加粗，非必填浅灰底 |
| 填写提示 | 每个表头的**批注**里写明规则和可选值，鼠标悬停即见 |
| 防填错 | 权力角色 / 认识途径 / 涉敏等级 / 性别 / 是否重点 都做了**下拉数据验证**，填错直接拦 |
| 格式保护 | 数据区预设文本格式，手机号不会被 Excel 转成 `1.38E+10` |
| 好读 | 冻结表头与姓名列，列宽按内容预设，500 行预留 |
| 说明页 | 独立的「填写说明」工作表：15 个字段的必填性、格式、说明、可选值、示例 |

模板 15 列：姓名（必填）、单位、职务、部门、权力角色、手机号、微信号、邮箱、性别、认识途径、是否重点、涉敏等级、出生日期、资源标签、备注。

**校验策略：宽进严出**

- 自动修正但不拦：手机号带横杠/空格、全角逗号、`1975/3/12` 这类日期、Excel 科学计数法、姓名字间空格
- 拦住不放过：姓名为空、枚举值不认识（报错里列出全部可选值）、超过 500 行
- 提示但放过：号段不常见、邮箱格式可疑、资源标签超过 8 个

**判重与写入**

- 按「姓名 + 单位」判断是否已有；命中则可选 **跳过**（默认，保留现有资料）或 **更新**（只覆盖表格里填了的内容）
- 文件内重复行自动识别，第二行起跳过，不会重复入库
- 单位不存在时自动创建；资源标签按 `、` `,` `；` `/` 切分，每条落成一条 resource 画像，**已存在的标签不会重复追加**
- 写入在事务里逐行执行，单行失败不影响其他行，最后给出「新增/更新/跳过/失败」四项计数和失败明细

> 模板也可直接从仓库取：`docs/import-template.xlsx`（快照）。权威版本以 `GET /api/import/template` 为准，代码改了模板会自动跟着变。

---

## 七、图谱流畅性是怎么做到的

你提的"滑动要很流畅"，落到具体技术点上是四件事：

### 1. 布局只算一次，算完就锁死

```js
layout.run();          // cose 布局，900+ 次迭代
instance.autolock(true);  // 之后节点坐标固定，拖拽不再触发重算
```

政企人脉关系是**稳定**的——人不会每秒换单位。没必要每帧跑力导算法。这一条省掉 80% 的 CPU。

### 2. 拖拽只改视口，不重排节点

Cytoscape 的 pan/zoom 本质是变换矩阵运算，走 GPU 合成。节点坐标一动不动，所以再多节点也不卡。

### 3. 拖拽时临时降级渲染

```js
hideEdgesOnViewport: true,   // 拖拽时隐藏边
hideLabelsOnViewport: true,  // 拖拽时隐藏文字
```

松手立即恢复。这是移动端保持 60fps 的关键——文字和边的绘制开销远大于圆点。

### 4. 缩放分级 + 按需加载

- 缩放 < 0.55 时，自动隐藏任职虚线和单位文字
- 图省一次只渲染概览，点某个节点才异步拉他的一跳邻居（`/neighbors`）

### 另外两个细节

- `<div class="cy-container">` 加了 `will-change: transform`，提示浏览器该层可独立合成
- 图谱用 `manualChunks` 单独打包（443KB），**只有进入图谱页才加载**，不影响首页启动

---

## 八、部署到你的服务器

### 1. 环境准备（Ubuntu/Debian）

```bash
# Node 22
curl -fsSL https://deb.nodesource.com/setup_22.x | sudo -E bash -
sudo apt install -y nodejs nginx
```

### 2. 上传与安装

```bash
cd /opt && sudo mkdir -p relation && sudo chown $USER relation
# 把 relation-api 和 relation-web 传上去
cd /opt/relation/relation-api && npm install --omit=optional
npm run seed
cd ../relation-web && npm install && npm run build
```

### 3. PM2 守护

```bash
sudo npm i -g pm2
cd /opt/relation/relation-api
pm2 start src/server.js --name relation-api
pm2 save && pm2 startup
```

内存限制（可选，2G 机器更稳）：
```bash
pm2 start src/server.js --name relation-api --max-memory-restart 400M
```

### 4. Nginx + HTTPS

```nginx
server {
    listen 80;
    server_name your-domain.com;
    return 301 https://$host$request_uri;
}

server {
    listen 443 ssl http2;
    server_name your-domain.com;

    ssl_certificate     /etc/letsencrypt/live/your-domain.com/fullchain.pem;
    ssl_certificate_key /etc/letsencrypt/live/your-domain.com/privkey.pem;

    # 图谱与静态资源压缩
    gzip on;
    gzip_types text/css application/javascript application/json image/svg+xml;
    gzip_min_length 1024;

    # 前端静态文件（也可由 Node 托管）
    root /opt/relation/relation-web/dist;
    index index.html;

    # PWA 的 sw.js 不能被缓存
    location = /sw.js {
        add_header Cache-Control "no-cache";
        try_files $uri =404;
    }

    location /assets/ {
        expires 1y;
        add_header Cache-Control "public, immutable";
    }

    # API 反代
    location /api/ {
        proxy_pass http://127.0.0.1:3100;
        proxy_http_version 1.1;
        proxy_set_header Host $host;
        proxy_set_header X-Real-IP $remote_addr;
        proxy_set_header X-Forwarded-Proto $scheme;
    }

    location / {
        try_files $uri $uri/ /index.html;
    }
}
```

证书：
```bash
sudo apt install certbot python3-certbot-nginx
sudo certbot --nginx -d your-domain.com
```

### 5. 开机自启与备份

```bash
# 每日备份 SQLite（单文件，直接复制即可）
crontab -e
0 3 * * * cp /opt/relation/relation-api/data/relation.db /opt/relation/backup/relation-$(date +\%F).db && find /opt/relation/backup -mtime +30 -delete
```

> SQLite 开了 WAL 模式，备份时建议用 `sqlite3 relation.db ".backup /path/backup.db"` 更安全。

---

## 九、安全与合规

### 密钥（最重要）

`.env` 里的 `APP_ENC_KEY` 用于加密手机号、微信等涉敏字段。

> ⚠️ **丢了就解不开。** 这个文件一旦丢失，已加密的数据无法恢复。请立即：
> - 复制一份到密码管理器或离线存储
> - **不要提交到 git**（`.gitignore` 已排除 `.env`）

备份数据库时，`.env` 要单独备份，两者必须配套。

### 数据落库验证

```bash
node -e "
const {DatabaseSync}=require('node:sqlite');
const db=new DatabaseSync('data/relation.db');
console.log(db.prepare('SELECT name, phone FROM persons WHERE phone IS NOT NULL').all());
"
```
应看到 `phone` 是 `enc1:...` 密文，而非明文。

### 访问控制

当前是**单用户、无登录**设计。放到公网前建议二选一：

- **Nginx Basic Auth**（最省事）
  ```bash
  sudo apt install apache2-utils
  sudo htpasswd -c /etc/nginx/.htpasswd yourname
  # 在 server 块加：
  auth_basic "Restricted";
  auth_basic_user_file /etc/nginx/.htpasswd;
  ```
- **IP 白名单**：`allow 你的IP; deny all;`

`sensitivity` 字段已预留（normal/sensitive/secret），未来多人共享时可据此做字段级可见性控制。

### 合规边界

工具涉及政府单位人员信息，请注意：

| 用途 | 风险 |
|---|---|
| 个人记忆、工作往来备忘 | 通常无问题 |
| 用于商务经营、招投标并向公职人员输送利益 | 可能触碰《反不正当竞争法》甚至刑法行贿条款 |

建议只记录**正常的业务往来**，不记录任何承诺、好处、利益输送相关内容。

---

## 十、已验证的测试结果

后端冒烟测试（`npm run smoke`）：

```
基础       ✅ 健康检查 / 枚举字典
联系人     ✅ 查人 / 按单位搜 / 重点筛选 / 快速录入(自动建组织)
           ✅ 详情 / 加密还原 / 枚举校验 / 编辑 / 打标 / 邻居
资源检索   ✅ 关键词 / 类型筛选 / 圈子渗透度 / 枚举校验 / 总览
触达路径   ✅ 二跳路径(我→张建国→李伟) / 组织抓手 / 影响力
接触提醒   ✅ 记录(自动关联单位) / 待办分级 / 冷接触 / 完成 / 校验
关系       ✅ 本人节点 / 建立 / 枚举校验 / 重复拦截 / 列表
组织       ✅ 简称搜索 / 详情(含在任人员)
图谱       ✅ 节点+边 / 边标签中文 / 重点聚焦 / 统计
Excel 导入 ✅ 模板下载(28KB) / 中文件名 / 字段清单 / 空表拒绝
           ✅ 非 xlsx 拒绝 / 空表导入拒绝
批量管理   ✅ 空 ids 拒绝 / 本人节点保护
清理       ✅ 级联删除

46/46 通过
```

实测输出示例：
```
二跳路径   我 → 张建国(市住房和城乡建设局) → 李伟
资源检索   张建国 | 市住建局 副局长(决策) | 消防审批口人脉 权重5
加密验证   库中 phone = enc1:4Rho+Y2RF...（密文），读取还原 13800001111
图谱       8 节点 / 11 边（7 人际 + 4 任职）
```

---

## 十一、后续可做

| 优先级 | 事项 | 理由 |
|---|---|---|
| 高 | **访问登录** | 上公网前必须解决 |
| 高 | Excel 批量导入 | 存量通讯录一次性灌入 |
| 中 | 生日提醒 | `birthday` 字段已在，缺定时扫描 |
| 中 | 图谱按组织聚合 | 节点多了需要折叠单位 |
| 低 | 迁 PostgreSQL | 多人协作或数据量上万时 |
| 低 | 微信小程序端 | 目前 H5 已覆盖双端，有分享需求再做 |

---

## 十二、目录结构

```
relation-api/
├── .env                    加密密钥与端口（勿提交）
├── data/relation.db        SQLite 数据文件
├── src/
│   ├── server.js           入口
│   ├── db/
│   │   ├── schema.sql      7 张表
│   │   ├── driver.js       双驱动封装
│   │   ├── init.js         建表
│   │   └── seed.js         演示数据
│   ├── lib/
│   │   ├── crypto.js       AES-256-GCM + 密钥持久化
│   │   ├── enums.js        枚举字典 + 中文标签反解
│   │   ├── queries.js      核心查询（资源/路径/影响力/图谱）
│   │   ├── excel-template.js  模板生成（样式/批注/下拉/说明页）
│   │   └── excel-parse.js     模板解析与逐行校验
│   └── routes/             persons / resources / events / orgs / relations / graph / import
└── test/smoke.js           46 项冒烟测试

docs/
└── import-template.xlsx    导入模板快照（权威版本以 API 为准）

relation-web/
├── vite.config.js          构建 + PWA + 代理
├── public/                 图标
├── dist/                   构建产物
└── src/
    ├── main.js / App.vue
    ├── api/index.js        统一请求封装
    ├── router/index.js
    ├── styles/global.css   设计令牌
    ├── components/TabBar.vue
    └── views/              Today / Search / Resources / Graph / Record / Person
                            Manage（人员管理）/ Import（导入向导）
```
