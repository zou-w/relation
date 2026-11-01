-- ============================================================
-- 人脉关系网 · 数据库结构 (SQLite)
-- 9 张表：persons / organizations / employments / person_attributes
--         relations / contact_events / org_relations
--         projects / project_members
-- 幂等设计：可重复执行
-- ============================================================

PRAGMA foreign_keys = ON;
PRAGMA journal_mode = WAL;

-- ------------------------------------------------------------
-- 1. persons  联系人（人＝节点）
-- ------------------------------------------------------------
CREATE TABLE IF NOT EXISTS persons (
  id              INTEGER PRIMARY KEY AUTOINCREMENT,
  name            TEXT    NOT NULL,
  title           TEXT,                       -- 职务
  gender          TEXT,                       -- male|female|unknown
  phone           TEXT,                       -- 涉敏，加密存储
  wechat          TEXT,                       -- 涉敏，加密存储
  email           TEXT,
  birthday        TEXT,                       -- YYYY-MM-DD
  met_way         TEXT,                       -- 认识途径枚举
  is_self         INTEGER NOT NULL DEFAULT 0, -- 1 = 本人节点
  is_key_contact  INTEGER NOT NULL DEFAULT 0, -- 1 = 重点人物
  sensitivity     TEXT    NOT NULL DEFAULT 'normal', -- normal|sensitive|secret
  remark          TEXT,
  owner_id        TEXT    NOT NULL DEFAULT 'me',      -- 预留多人
  created_at      TEXT    NOT NULL DEFAULT (datetime('now','localtime')),
  updated_at      TEXT    NOT NULL DEFAULT (datetime('now','localtime'))
);

CREATE INDEX IF NOT EXISTS idx_person_name    ON persons(name);
CREATE INDEX IF NOT EXISTS idx_person_key     ON persons(is_key_contact);
CREATE INDEX IF NOT EXISTS idx_person_owner   ON persons(owner_id);
CREATE INDEX IF NOT EXISTS idx_person_self    ON persons(is_self);

-- ------------------------------------------------------------
-- 2. organizations  组织（企业 / 政府单位 / 事业单位）
-- ------------------------------------------------------------
CREATE TABLE IF NOT EXISTS organizations (
  id             INTEGER PRIMARY KEY AUTOINCREMENT,
  name           TEXT    NOT NULL,
  alias          TEXT,                          -- 简称，解决"住建局"搜不到全称
  org_type       TEXT    NOT NULL DEFAULT 'enterprise', -- gov|enterprise|institution|association|other
  level          TEXT,                          -- 层级，如 部级/厅级/处级/科级
  region         TEXT,                          -- 行政区域
  parent_org_id  INTEGER REFERENCES organizations(id) ON DELETE SET NULL,
  address        TEXT,
  business       TEXT,                          -- 主营 / 职能
  is_key_org     INTEGER NOT NULL DEFAULT 0,
  remark         TEXT,
  owner_id       TEXT    NOT NULL DEFAULT 'me',
  created_at     TEXT    NOT NULL DEFAULT (datetime('now','localtime'))
);

CREATE INDEX IF NOT EXISTS idx_org_name   ON organizations(name);
CREATE INDEX IF NOT EXISTS idx_org_parent ON organizations(parent_org_id);
CREATE INDEX IF NOT EXISTS idx_org_type   ON organizations(org_type);

-- ------------------------------------------------------------
-- 3. employments  任职（人 ↔ 组织的桥）
-- ------------------------------------------------------------
CREATE TABLE IF NOT EXISTS employments (
  id           INTEGER PRIMARY KEY AUTOINCREMENT,
  person_id    INTEGER NOT NULL REFERENCES persons(id) ON DELETE CASCADE,
  org_id       INTEGER NOT NULL REFERENCES organizations(id) ON DELETE CASCADE,
  position     TEXT,                              -- 具体职务名
  department   TEXT,                              -- 部门
  power_level  TEXT,                              -- decision|approval|operator|support|unknown
  is_current   INTEGER NOT NULL DEFAULT 1,        -- 是否现任
  start_date   TEXT,
  end_date     TEXT,
  created_at   TEXT NOT NULL DEFAULT (datetime('now','localtime'))
);

CREATE INDEX IF NOT EXISTS idx_emp_person ON employments(person_id);
CREATE INDEX IF NOT EXISTS idx_emp_org    ON employments(org_id);
CREATE UNIQUE INDEX IF NOT EXISTS uk_emp_current
  ON employments(person_id, org_id) WHERE is_current = 1;

-- ------------------------------------------------------------
-- 4. person_attributes  资源画像（"借资源"的核心表）
-- ------------------------------------------------------------
CREATE TABLE IF NOT EXISTS person_attributes (
  id          INTEGER PRIMARY KEY AUTOINCREMENT,
  person_id   INTEGER NOT NULL REFERENCES persons(id) ON DELETE CASCADE,
  attr_type   TEXT    NOT NULL,   -- resource|sphere|tag|influence|channel
  attr_value  TEXT    NOT NULL,
  weight      INTEGER NOT NULL DEFAULT 3,  -- 1-5，可用度/可信度
  note        TEXT,
  created_at  TEXT    NOT NULL DEFAULT (datetime('now','localtime'))
);

CREATE INDEX IF NOT EXISTS idx_attr_person ON person_attributes(person_id);
CREATE INDEX IF NOT EXISTS idx_attr_type   ON person_attributes(attr_type);
CREATE INDEX IF NOT EXISTS idx_attr_value  ON person_attributes(attr_value);

-- ------------------------------------------------------------
-- 5. relations  人 ↔ 人关系
-- ------------------------------------------------------------
CREATE TABLE IF NOT EXISTS relations (
  id            INTEGER PRIMARY KEY AUTOINCREMENT,
  from_person   INTEGER NOT NULL REFERENCES persons(id) ON DELETE CASCADE,
  to_person     INTEGER NOT NULL REFERENCES persons(id) ON DELETE CASCADE,
  relation_type TEXT    NOT NULL,   -- superior|colleague|introducer|classmate|relative|cooperation|friend
  direction     TEXT    NOT NULL DEFAULT 'two-way', -- one-way|two-way
  strength      INTEGER NOT NULL DEFAULT 3,         -- 我和他的亲密度 1-5
  influence     INTEGER NOT NULL DEFAULT 3,         -- 他对别人的话语权 1-5
  introducer_id INTEGER REFERENCES persons(id) ON DELETE SET NULL,
  note          TEXT,
  created_at    TEXT    NOT NULL DEFAULT (datetime('now','localtime'))
);

CREATE INDEX IF NOT EXISTS idx_rel_from ON relations(from_person);
CREATE INDEX IF NOT EXISTS idx_rel_to   ON relations(to_person);

-- ------------------------------------------------------------
-- 6. contact_events  接触事件（让关系"活"起来）
-- ------------------------------------------------------------
CREATE TABLE IF NOT EXISTS contact_events (
  id             INTEGER PRIMARY KEY AUTOINCREMENT,
  person_id      INTEGER NOT NULL REFERENCES persons(id) ON DELETE CASCADE,
  org_id         INTEGER REFERENCES organizations(id) ON DELETE SET NULL,
  event_date     TEXT    NOT NULL,
  scene          TEXT,                          -- meeting|dinner|visit|call|wechat|other
  subject        TEXT,                          -- 聊了什么
  next_action    TEXT,                          -- 下一步做什么
  next_date      TEXT,                          -- 跟进截止日
  is_done        INTEGER NOT NULL DEFAULT 0,
  created_at     TEXT    NOT NULL DEFAULT (datetime('now','localtime'))
);

CREATE INDEX IF NOT EXISTS idx_ev_person ON contact_events(person_id);
CREATE INDEX IF NOT EXISTS idx_ev_date   ON contact_events(event_date);
CREATE INDEX IF NOT EXISTS idx_ev_next   ON contact_events(next_date, is_done);

-- ------------------------------------------------------------
-- 7. org_relations  组织 ↔ 组织
-- ------------------------------------------------------------
CREATE TABLE IF NOT EXISTS org_relations (
  id            INTEGER PRIMARY KEY AUTOINCREMENT,
  from_org      INTEGER NOT NULL REFERENCES organizations(id) ON DELETE CASCADE,
  to_org        INTEGER NOT NULL REFERENCES organizations(id) ON DELETE CASCADE,
  relation_type TEXT    NOT NULL,   -- parent|subsidiary|cooperation|supervise|competition
  note          TEXT,
  created_at    TEXT    NOT NULL DEFAULT (datetime('now','localtime'))
);

CREATE INDEX IF NOT EXISTS idx_orgrel_from ON org_relations(from_org);
CREATE INDEX IF NOT EXISTS idx_orgrel_to   ON org_relations(to_org);

-- ------------------------------------------------------------
-- 8. projects  项目（人脉的"事由"，把关系落到具体合作上）
-- ------------------------------------------------------------
CREATE TABLE IF NOT EXISTS projects (
  id            INTEGER PRIMARY KEY AUTOINCREMENT,
  name          TEXT    NOT NULL,
  code          TEXT,                          -- 项目编号 / 招标编号
  project_type  TEXT    NOT NULL DEFAULT 'other',  -- gov_tender|enterprise|research|other
  status        TEXT    NOT NULL DEFAULT 'active', -- planning|bidding|active|closed|lost
  owner_org_id  INTEGER REFERENCES organizations(id) ON DELETE SET NULL, -- 业主 / 甲方
  our_role      TEXT,                          -- 我方角色：总包/分包/投标/顾问
  region        TEXT,
  amount        REAL,                          -- 金额（万元）
  start_date    TEXT,
  end_date      TEXT,
  milestone     TEXT,                          -- 当前阶段 / 关键节点
  is_key        INTEGER NOT NULL DEFAULT 0,    -- 1 = 重点项目
  remark        TEXT,
  owner_id      TEXT    NOT NULL DEFAULT 'me',
  created_at    TEXT    NOT NULL DEFAULT (datetime('now','localtime')),
  updated_at    TEXT    NOT NULL DEFAULT (datetime('now','localtime'))
);

CREATE INDEX IF NOT EXISTS idx_proj_name   ON projects(name);
CREATE INDEX IF NOT EXISTS idx_proj_status ON projects(status);
CREATE INDEX IF NOT EXISTS idx_proj_owner  ON projects(owner_org_id);

-- ------------------------------------------------------------
-- 9. project_members  项目参与人（人 ↔ 项目的桥，带角色）
-- ------------------------------------------------------------
CREATE TABLE IF NOT EXISTS project_members (
  id          INTEGER PRIMARY KEY AUTOINCREMENT,
  project_id  INTEGER NOT NULL REFERENCES projects(id) ON DELETE CASCADE,
  person_id   INTEGER NOT NULL REFERENCES persons(id) ON DELETE CASCADE,
  role_type   TEXT    NOT NULL DEFAULT 'other', -- leader|business|technical|approver|resource|advisor|other
  role_title  TEXT,                            -- 自定义角色名，如"评标委员会成员"
  duty        TEXT,                            -- 在这个项目里具体做什么
  is_key      INTEGER NOT NULL DEFAULT 0,      -- 1 = 项目里的关键人
  note        TEXT,
  created_at  TEXT    NOT NULL DEFAULT (datetime('now','localtime'))
);

CREATE INDEX IF NOT EXISTS idx_pm_project ON project_members(project_id);
CREATE INDEX IF NOT EXISTS idx_pm_person  ON project_members(person_id);
-- 一个人在一个项目里只保留一条角色记录，兼任写进 role_title
CREATE UNIQUE INDEX IF NOT EXISTS uk_pm_person
  ON project_members(project_id, person_id);
