/**
 * 关系网图谱路由
 */
import { Router } from 'express';
import { graphData, stats } from '../lib/queries.js';

const router = Router();

/** 图谱数据：nodes + edges */
router.get('/', (req, res) => {
  const { key_only, limit, with_projects } = req.query;
  const data = graphData({
    keyOnly: key_only === '1' || key_only === 'true',
    limit: Math.min(Number(limit) || 200, 1000),
    // 默认带项目节点；显式传 0 可关掉
    withProjects: with_projects !== '0',
  });

  // 补上中文标签，前端直接用
  const relationLabels = {
    superior: '上下级', colleague: '同事', introducer: '引荐人',
    classmate: '同学', relative: '亲属', cooperation: '合作', friend: '朋友',
  };
  for (const e of data.edges) {
    if (e.kind === 'relation') e.label = relationLabels[e.label] || e.label;
  }

  res.json({ ...data, counts: { nodes: data.nodes.length, edges: data.edges.length } });
});

/** 首页统计概览 */
router.get('/stats', (req, res) => {
  res.json(stats());
});

export default router;
