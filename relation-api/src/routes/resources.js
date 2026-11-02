/**
 * 资源检索路由 —— "借资源"第一价值的直接落地
 */
import { Router } from 'express';
import { all, get } from '../db/driver.js';
import { isValidEnum, enumValues } from '../lib/enums.js';
import { searchResources, sphereStats, findPaths, orgReach, influencers } from '../lib/queries.js';
import { personScope } from '../lib/scope.js';

const router = Router();

/** 资源检索：输入"招投标"，谁手里有这资源 */
router.get('/search', (req, res) => {
  const { q, type, min_weight, limit } = req.query;

  if (type && !isValidEnum('attr_type', type)) {
    return res.status(400).json({
      error: `type 取值非法：${type}；合法值：${enumValues('attr_type').join(' / ')}`,
    });
  }

  const rows = searchResources({
    keyword: q?.trim() || null,
    attrType: type || null,
    minWeight: Number(min_weight) || 1,
    limit: Math.min(Number(limit) || 50, 200),
  }, req.ctx);
  res.json({ total: rows.length, items: rows });
});

/** 圈子渗透度 */
router.get('/spheres', (req, res) => {
  res.json({ items: sphereStats(req.ctx) });
});

/** 触达路径：我要搭上线，谁能帮我 */
router.get('/paths/:personId', (req, res) => {
  const result = findPaths(Number(req.params.personId), 2, req.ctx);
  if (!result.target) return res.status(404).json({ error: '目标联系人不存在' });
  res.json(result);
});

/** 组织抓手：某单位我能通过谁 */
router.get('/org/:orgId/reach', (req, res) => {
  const result = orgReach(Number(req.params.orgId), req.ctx);
  if (!result) return res.status(404).json({ error: '组织不存在' });
  res.json(result);
});

/** 影响力：谁能影响目标 */
router.get('/influencers/:personId', (req, res) => {
  res.json({ items: influencers(Number(req.params.personId), req.ctx) });
});

/** 画像类型分布，供前端筛选器使用 */
router.get('/overview', (req, res) => {
  const ps = personScope(req.ctx, 'p');
  const byType = all(`
    SELECT pa.attr_type, COUNT(*) AS cnt
    FROM person_attributes pa JOIN persons p ON p.id = pa.person_id
    WHERE ${ps.sql}
    GROUP BY pa.attr_type ORDER BY cnt DESC
  `, ps.params);
  const topValues = all(`
    SELECT pa.attr_value, pa.attr_type, COUNT(*) AS cnt, MAX(pa.weight) AS max_weight
    FROM person_attributes pa JOIN persons p ON p.id = pa.person_id
    WHERE ${ps.sql}
    GROUP BY pa.attr_value, pa.attr_type
    ORDER BY cnt DESC, max_weight DESC LIMIT 30
  `, ps.params);
  res.json({ byType, topValues });
});

export default router;
