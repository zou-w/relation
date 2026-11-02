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
     SQLite (单文件)             ← 12 张表
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

首次启动还会创建一个超级管理员：

| 账号 | 密码 | 角色 |
|---|---|---|
| `admin` | `admin123` | 超级管理员 |
| `demo` | `demo123` | 普通账号（seed 时创建） |

> 登录后第一件事是改密码。生产环境可用 `ADMIN_USER` / `ADMIN_PASSWORD` 环境变量指定初始账号。

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

12 张表。业务上四条主线：**人－组织－事件**是骨架，**资源画像**是价值，**关系**是杠杆，**项目**是事由；另有三张表负责账号与授权。

| 表 | 作用 | 关键字段 |
|---|---|---|
| `persons` | 联系人 | `is_self`（本人节点）、`is_key_contact`（重点）、`sensitivity`（涉敏） |
| `organizations` | 企业/政府单位 | `alias`（简称搜索）、`parent_org_id`（树形层级）、`org_type` |
| `employments` | 任职桥 | `power_level`（决策/审批/经办）、`is_current` |
| `person_attributes` | **资源画像** | `attr_type`：resource/sphere/tag/influence/channel，`weight` 1–5 |
| `relations` | 人↔人 | `strength`（我和他多熟）、`influence`（他对别人话语权） |
| `contact_events` | 接触记录 | `next_date`（跟进提醒）、`is_done` |
| `org_relations` | 组织↔组织 | `relation_type` |
| `projects` | **项目** | `status`（筹备/投标/进行/结项/失单）、`owner_org_id`（业主）、`amount` |
| `project_members` | 项目参与人 | `role_type`（负责/商务/技术/审批/引荐/顾问）、`role_title`、`duty`、`is_key` |
| `users` | 账号 | `username`、`password_hash`（scrypt）、`role`（super_admin/user）、`status` |
| `sessions` | 登录会话 | `token`、`expires_at`（30 天） |
| `data_shares` | 数据共享 | `owner_id`、`grantee_id`、`person_id`（空 = 整份数据） |

每条业务数据都带 `owner_id`（`persons` / `organizations` / `projects` / `relations`），这是隔离的根。

### 三个关键设计

**1. "你自己"也是节点**（`is_self=1`）
只有把自己入图，"我→A→B"的引荐链、"我的人脉覆盖度"才算得出来。

**2. 亲密度与影响力正交**
`strength` 是我和他的关系，`influence` 是他对他人的话语权。两者独立——一个跟我很熟的人，未必能影响目标。

**3. 资源画像独立建表**
不塞进 `remark` 文本，才能被结构化检索。这是"借资源"能成立的前提。

**4. 项目是关系的"事由"**
只记"我认识他"信息量很薄；记成"他在这个项目里负责审批"，关系才有上下文、可被追问、可被复用。一个人在一个项目里只保留一条角色记录，兼任写进 `role_title`。

**5. 跨单位认识是独立识别出来的**
"不在同一单位但认识"最容易漏记，也最值钱——它正是打通两家单位的那条线。判定规则（`src/lib/cross-org.js`）：

| 条件 | 说明 |
|---|---|
| 两人都有现任单位，且没有共同单位 | 用 `employments` 判断，一人挂靠多家单位时按"有交集即同单位"处理 |
| 关系类型属于 `classmate / relative / friend / acquaintance` | 同事、上下级、合作默认视作工作关系，不计入 |
| 任一方没填单位 | 标 `unknown`，不硬判 |

识别结果同时喂给三处：图谱（紫红粗线 + 两端紫圈）、联系人详情（关系列表标"跨单位"）、搭线路径（"我→李伟→赵敏"这种跨单位的二跳路径优先排前面）。

### 账号与数据隔离

| 角色 | 能看到什么 | 能改什么 |
|---|---|---|
| 普通账号 | 自己录入的人 / 单位 / 项目 / 关系，加上别人共享给他的 | 只有自己的 |
| 超级管理员 | 全部账号的全部数据 | 全部，并可管理账号与共享 |

规则落在 SQL 层，不靠前端藏按钮：`src/lib/scope.js` 生成可见性条件，所有查询都带上 `ctx`。共享是**只读**的——被共享人能看到、能拿来搭关系、能在自己的图谱里用，但不能改对方的原始记录（`403`）。

共享粒度两种：整份数据（`person_id` 为空）或指定联系人。单位与项目跟着人走，否则图谱会断。

> 老库升级：启动时自动 `ALTER TABLE relations ADD COLUMN owner_id`，并把历史上 `owner_id='me'` 的数据交给第一个超管，不会丢数据。

---

## 五、API 一览

所有 `/api/*` 业务接口都需要携带 `Authorization: Bearer <token>`，只有健康检查、枚举、登录注册公开。

### 账号
```
POST   /api/auth/register       注册（普通账号，注册即登录）
POST   /api/auth/login          登录，返回 token
GET    /api/auth/me             当前账号 + 我的数据量 / 共享统计
POST   /api/auth/logout         退出
PATCH  /api/auth/password       改密码
PATCH  /api/auth/profile        改显示名 / 电话 / 备注
```

### 超管后台（普通账号 403）
```
GET    /api/admin/users                 账号列表（含数据量、在线会话数）
POST   /api/admin/users                 新建账号
PATCH  /api/admin/users/:id             改显示名 / 角色 / 启停
POST   /api/admin/users/:id/password    重置密码（强制下线）
DELETE /api/admin/users/:id             删账号（名下数据转给操作者）
GET    /api/admin/sessions              活跃会话（登录时间 / IP / 设备）
GET    /api/admin/shares                共享关系
POST   /api/admin/shares                新建共享（整份或指定人）
DELETE /api/admin/shares/:id            取消共享
GET    /api/admin/users/:id/persons     某账号名下的人（共享时挑选）
```

### 基础
```
GET  /api/health              健康检查
GET  /api/enums               枚举字典（11 组）
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

GET  /api/graph?key_only=1         图谱 nodes + edges（默认带项目节点，with_projects=0 可关）
GET  /api/graph?cross_org=1        只看跨单位认识（自动裁掉无关节点）
```

图谱返回里多了两处与"跨单位认识"相关的字段：

```json
{
  "cross": {
    "count": 2,
    "pairs": [
      { "id": 107, "from": "p86", "to": "p85", "fromName": "刘敏", "toName": "赵敏",
        "fromOrg": "市建筑业协会", "toOrg": "市发展和改革委员会",
        "relationType": "classmate", "label": "同学" }
    ]
  },
  "edges": [
    { "id": "r107", "source": "p86", "target": "p85", "kind": "relation",
      "label": "同学", "crossOrg": true, "crossReason": "cross", "spansOrg": true }
  ]
}
```

### 项目
```
GET    /api/projects                          项目列表（keyword / status / key_only / person_id / org_id）
GET    /api/projects/stats                    项目概览（在推进 / 参与人 / 被忽略的关键人）
POST   /api/projects                          新建项目
GET    /api/projects/:id                      详情（含成员、角色统计、业主单位）
PATCH  /api/projects/:id                      编辑
DELETE /api/projects/:id                      删除（成员级联）
GET    /api/projects/:id/members              成员列表（详情已含）
POST   /api/projects/:id/members              加成员（同人重复提交改为更新角色）
POST   /api/projects/:id/members/batch        批量加成员（返回 added/skipped/failed）
PATCH  /api/projects/:id/members/:mid         改角色 / 职责 / 关键标记
DELETE /api/projects/:id/members/:mid         移出项目
GET    /api/projects/:id/candidates           可选人员池（标记谁已加入）
GET    /api/projects/:id/graph                单项目局部关系网
```

**共 60 个接口，冒烟测试 85 项全部通过。**

---

## 六、前端页面

| 路由 | 页面 | 说明 |
|---|---|---|
| `/` | 今日 | 待办（逾期/今日/未来）+ 冷接触 + 统计 + 快捷入口 |
| `/record` | 快速记录 | 姓名必填其余可后补，单位点一下就能选已填过的，3 秒落库 |
| `/search` | 查人 | 姓名/单位/职务/备注模糊搜，重点人物筛选 |
| `/resources` | 借资源 | 资源检索 + 圈子渗透度 + 常用标签 |
| `/person/:id` | 联系人详情 | 任职、资源画像、触达路径、影响力、人际关系、接触时间线 |
| `/projects` | 项目 | 项目列表，状态筛选、金额、参与人数与核心角色 |
| `/project/:id` | 项目详情 | 概览 + 参与人按角色分组 + 加人 + 进项目关系图 |
| `/graph` | 关系图 | Cytoscape 图谱，全屏独立页；带项目节点，`?project=id` 看单项目 |
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
- 图谱用 `manualChunks` 单独打包（443KB+），**只有进入图谱页才加载**，不影响首页启动

### 跨单位关系怎么在图上表达

这是后加的一层，做法是"不新增节点、只强化边"：

1. **样式上区分**：跨单位关系用 3px 紫红实线（`#9333ea`），普通关系是 1.4px 灰线；两端人员节点加紫色描边圈，远看就知道"这里连着两家单位"
2. **布局上拉开**：跨单位边的 `idealEdgeLength` 设为 175（普通 110）、`edgeElasticity` 降到 0.16，自然形成"两个单位圈子被一条线连起来"的形态
3. **可聚焦**：顶部「跨单位」按钮 → `?cross_org=1`，只留跨单位的人和他们所在的单位，一屏看完所有"跨界"通道
4. **可强调/取消**：跨单位条数旁有「取消强调」，纯切 class，不重排、不闪
5. **可阅读**：点顶部的「跨单位认识 N 条」弹出清单（谁—什么关系—哪家单位到哪家单位），点一条自动把两个人居中选中；点图上的边也会弹出这条关系的说明
6. **布局可复现**：力导向布局前用固定种子替换 `Math.random`，同一批数据每次进来、每次「重排」都是同一张图，不会"点一下换一个样子"

`fcose` 带非重叠约束，人物气泡不会互相压字，这是之前 `cose` 布局常见的毛病。

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

系统自带账号体系，不再依赖 Nginx Basic Auth：

- 口令用 **scrypt** 加盐哈希存储，不落明文
- 登录签发随机 token（`sessions` 表，30 天有效），每个账号最多保留 3 个活跃会话
- 停用账号 / 重置密码会立即删除该账号所有会话，已登录设备下次请求即被踢下线
- 权限判断在服务端：所有查询带 `ctx`，普通账号的 SQL 里直接拼可见范围，改别人的数据返回 `403`
- 公开注册默认开启；如果不想让人自助注册，可在 Nginx 层拦掉 `POST /api/auth/register`，或只由超管在后台建号

仍建议叠加一层 **IP 白名单** 作为纵深防御：

```nginx
allow 你的IP;
deny all;
```

`sensitivity` 字段已预留（normal/sensitive/secret），后续可做字段级脱敏（如对共享数据隐藏手机号）。

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
基础       ✅ 健康检查 / 枚举字典 / 未登录被拦 / 错误密码被拒
账号权限   ✅ 超管登录 / 当前账号 / 普通账号登录 / 只能看自己的+共享
           ✅ 共享数据只读 / 越权修改 403 / 普通账号进后台 403 / 图谱同样隔离
           ✅ 超管建号 / 建立共享 / 被共享人可见 / 取消共享立即失效 / 删号
联系人     ✅ 查人 / 按单位搜 / 重点筛选 / 快速录入(自动建组织)
           ✅ 详情 / 加密还原 / 枚举校验 / 编辑 / 打标 / 邻居
资源检索   ✅ 关键词 / 类型筛选 / 圈子渗透度 / 枚举校验 / 总览
触达路径   ✅ 二跳路径(我→张建国→李伟) / 组织抓手 / 影响力
接触提醒   ✅ 记录(自动关联单位) / 待办分级 / 冷接触 / 完成 / 校验
关系       ✅ 本人节点 / 建立 / 枚举校验 / 重复拦截 / 列表
组织       ✅ 简称搜索 / 详情(含在任人员)
图谱       ✅ 节点+边 / 边标签中文 / 重点聚焦 / 统计 / 项目节点
           ✅ 跨单位识别 / 两端单位必不同 / 同单位不误判 / 边标注 spansOrg
           ✅ 只看跨单位(cross_org=1) 自动聚焦
项目       ✅ 列表 / 概览 / 名称必填 / 状态枚举校验 / 新建
           ✅ 加成员 / 重复加改为更新 / 角色枚举校验 / 无效联系人拒绝
           ✅ 详情含中文角色 / 候选池 / 批量加(含无效 id) / 改角色
           ✅ 局部图谱(项目节点+角色边) / 按人反查项目 / 人员详情带项目
           ✅ 全图含项目节点 / 移除成员 / 删除并级联
Excel 导入 ✅ 模板下载(28KB) / 中文件名 / 字段清单 / 空表拒绝
           ✅ 非 xlsx 拒绝 / 空表导入拒绝
批量管理   ✅ 空 ids 拒绝 / 本人节点保护
清理       ✅ 级联删除

85/85 通过
```

实测输出示例：
```
二跳路径   我 → 张建国(市住房和城乡建设局) → 李伟
资源检索   张建国 | 市住建局 副局长(决策) | 消防审批口人脉 权重5
加密验证   库中 phone = enc1:4Rho+Y2RF...（密文），读取还原 13800001111
图谱       10 节点 / 19 边（8 人际含 2 条跨单位 + 4 任职 + …）
```

---

## 十一、后续可做

| 优先级 | 事项 | 理由 |
|---|---|---|
| 高 | **操作审计日志** | 谁能改共享、谁重置了密码，现在只有结果没有记录 |
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
│   │   ├── schema.sql      12 张表
│   │   ├── driver.js       双驱动封装
│   │   ├── init.js         建表
│   │   └── seed.js         演示数据
│   ├── lib/
│   │   ├── crypto.js       AES-256-GCM + 密钥持久化
│   │   ├── auth.js         口令哈希 / 会话 / 默认超管 / 历史数据迁移
│   │   ├── scope.js        数据可见范围（所有查询的权限条件都在这）
│   │   ├── enums.js        枚举字典 + 中文标签反解
│   │   ├── queries.js      核心查询（资源/路径/影响力/图谱）
│   │   ├── cross-org.js    跨单位认识识别（判定规则集中在这一个文件）
│   │   ├── projects.js     项目查询（列表/详情/成员/局部图谱）
│   │   ├── excel-template.js  模板生成（样式/批注/下拉/说明页）
│   │   └── excel-parse.js     模板解析与逐行校验
│   ├── middleware/auth.js  Bearer 校验 / 超管校验
│   └── routes/             auth / admin / persons / resources / events / orgs
│                           relations / graph / import / projects
└── test/smoke.js           85 项冒烟测试

docs/
└── import-template.xlsx    导入模板快照（权威版本以 API 为准）

relation-web/
├── vite.config.js          构建 + PWA + 代理
├── public/                 图标
├── dist/                   构建产物
└── src/
    ├── main.js / App.vue
    ├── api/index.js        统一请求封装（自动带 token，401 跳登录）
    ├── stores/auth.js      登录态
    ├── router/index.js     路由守卫
    ├── styles/global.css   设计令牌
    ├── components/TabBar.vue / OrgInput.vue / ProjectFormSheet.vue
    └── views/              Login（登录注册）/ Admin（账号与共享）
                            Today / Search / Resources / Graph / Record / Person
                            Projects / Project / Manage（人员管理）/ Import（导入向导）
                            RelRecord（记录跨单位认识）
```
