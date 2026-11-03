'use strict';

// 通用技术 · 智能学伴 —— 零依赖 Node.js 版
// 数据全部驻留内存，进程重启即清空；静态内容由 export_data.py 从 Python 版导出。

const http = require('http');
const crypto = require('crypto');
const fs = require('fs');
const path = require('path');

const {
  TOPICS, QUIZ, CHAPTERS, STAGES, CONSTRAINT_KEYS, MODES,
  BASE_CSS, TOP, FOOT, STUDENT_BODY, TEACHER_BODY,
} = require('./data.json');

const PORT = process.env.PORT || 8000;
const HOST = '0.0.0.0';
const DEMO = false;

// ==================================================================
// 〇、大模型接入（有 key 用大模型，失败自动回退离线引擎）
// ==================================================================
const SYSTEM_PROMPT = [
  '你是周晓林主编《通用技术》（科学出版社）课程的智能学伴，必须遵守：',
  '1. 绝不直接给出标准答案或完整设计方案，只给“下一步该想什么”。',
  '2. 每次最多提 3 个递进问题，每个问题都指向具体可操作的思考动作。',
  '3. 引导方案时，必须覆盖成本、安全、环境、人文四类约束。',
  '4. 语气像耐心的助教，不说空话，不超过 180 字。',
  '5. 若学生要求直接给答案，礼貌拒绝，并给一个更小的思考台阶。',
].join('\n');

const DIRECT_PROMPT = [
  '你是周晓林主编《通用技术》（科学出版社）课程的智能学伴，当前处于「直接给答案」模式：',
  '1. 直接给结论，先说答案，再简要解释依据，不反问、不布置思考题。',
  '2. 概念题用课本术语下定义；画图题给规范步骤与易错点；设计题给可直接执行的方案要点。',
  '3. 设计类回答必须兼顾成本、安全、环境、人文四类约束。',
  '4. 不确定或课本未展开的内容要明确说明，不编造。',
  '5. 语气简洁，不超过 220 字。',
].join('\n');

let _llmLoaded = false;
let _llmCfg = null;

function llm_config() {
  if (_llmLoaded) return _llmCfg;
  _llmLoaded = true;
  try {
    const cfg = JSON.parse(fs.readFileSync(path.join(__dirname, '模型配置.json'), 'utf8'));
    const provs = (cfg.providers || []).filter((p) => p.api_key && p.model);
    if (provs.length) {
      _llmCfg = provs.find((p) => p.name === cfg.active) || provs[0];
      return _llmCfg;
    }
  } catch (e) { /* 没配置文件就走环境变量 */ }
  const key = process.env.LLM_API_KEY || process.env.OPENAI_API_KEY;
  if (key) {
    _llmCfg = {
      name: 'env',
      protocol: process.env.LLM_PROTOCOL || 'openai',
      base_url: process.env.LLM_BASE_URL || 'https://api.openai.com/v1',
      api_key: key,
      model: process.env.LLM_MODEL || 'gpt-4o-mini',
    };
  }
  return _llmCfg;
}

function _to_anthropic(messages) {
  const system = [];
  const msgs = [];
  for (const m of messages) {
    const text = m.content || '';
    if (m.role === 'system') system.push(text);
    else msgs.push({ role: m.role || 'user', content: text });
  }
  return { system: system.join('\n'), msgs };
}

function config_models() {
  const out = [];
  try {
    const raw = JSON.parse(fs.readFileSync(path.join(__dirname, '模型配置.json'), 'utf8'));
    for (const p of raw.providers || []) {
      if (p.protocol !== 'openai' || !p.api_key) continue;
      const names = (Array.isArray(p.models) && p.models.length) ? p.models : [p.model];
      for (const m of names) {
        if (typeof m === 'string' && m.trim() && !out.includes(m)) out.push(m);
      }
    }
  } catch (e) { /* 忽略 */ }
  if (!out.length) {
    const c = llm_config();
    if (c && c.model) out.push(c.model);
  }
  return out;
}

function active_model() {
  const c = llm_config();
  return c ? (c.model || '') : '';
}

async function llm(messages, model) {
  let cfg = llm_config();
  if (!cfg || !cfg.api_key) return null;
  if (model && config_models().includes(model)) {
    try {
      const raw = JSON.parse(fs.readFileSync(path.join(__dirname, '模型配置.json'), 'utf8'));
      const p = (raw.providers || []).find((x) => {
        if (x.protocol !== 'openai' || !x.api_key) return false;
        const names = (Array.isArray(x.models) && x.models.length) ? x.models : [x.model];
        return names.includes(model);
      });
      if (p) cfg = Object.assign({}, p);
    } catch (e) { /* 忽略 */ }
    cfg = Object.assign({}, cfg, { model: model });
  }
  const ctrl = new AbortController();
  const timer = setTimeout(() => ctrl.abort(), 25000);
  try {
    let url;
    let headers;
    let payload;
    const base = String(cfg.base_url || '').replace(/\/+$/, '');
    if (cfg.protocol === 'anthropic') {
      const parts = _to_anthropic(messages);
      payload = { model: cfg.model, max_tokens: 500, temperature: 0.6, messages: parts.msgs };
      if (parts.system) payload.system = parts.system;
      url = base + '/v1/messages';
      headers = {
        'Content-Type': 'application/json',
        'x-api-key': cfg.api_key,
        Authorization: 'Bearer ' + cfg.api_key,
        'anthropic-version': '2023-06-01',
      };
    } else {
      payload = { model: cfg.model, messages: messages, temperature: 0.6, max_tokens: 500 };
      url = base + '/chat/completions';
      headers = { 'Content-Type': 'application/json', Authorization: 'Bearer ' + cfg.api_key };
    }
    const r = await fetch(url, {
      method: 'POST', headers: headers, body: JSON.stringify(payload), signal: ctrl.signal,
    });
    if (!r.ok) return null;
    const data = await r.json();
    if (cfg.protocol === 'anthropic') {
      const out = (data.content || [])
        .filter((b) => b.type === 'text').map((b) => b.text).join('').trim();
      return out || null;
    }
    const out = data.choices && data.choices[0] && data.choices[0].message
      && data.choices[0].message.content;
    return out ? String(out).trim() : null;
  } catch (e) {
    return null;
  } finally {
    clearTimeout(timer);
  }
}

// ==================================================================
// 一、数据存储：进程内内存结构（替代 SQLite）
// ==================================================================
const students = [];
const messages = [];
const mistakes = [];
const projects = [];
const iterations = [];

function now() {
  return Date.now() / 1000;
}

function ensure_student(studentId, name, no) {
  if (!students.find((s) => s.id === studentId)) {
    students.push({
      id: studentId,
      name: name || studentId,
      no: no || '',
      created_at: now(),
    });
  }
}

function student_exists(studentId) {
  return students.some((s) => s.id === studentId);
}

function login_student(name, no) {
  name = String(name == null ? '' : name).trim().slice(0, 24);
  no = String(no == null ? '' : no).trim().slice(0, 16);
  if (!name) return null;

  const rows = students
    .filter((s) => s.name === name)
    .sort((a, b) => a.created_at - b.created_at);

  function newStudent() {
    const sid = 'S' + crypto.randomBytes(4).toString('hex');
    students.push({ id: sid, name, no, created_at: now() });
    return { id: sid, name, no, is_new: true };
  }

  if (no) {
    const hit = rows.find((r) => (r.no || '') === no);
    if (hit) {
      return { id: hit.id, name: hit.name, no: hit.no, is_new: false };
    }
    return newStudent();
  }
  if (!rows.length) return newStudent();
  if (rows.length === 1 && !(rows[0].no || '')) {
    return { id: rows[0].id, name: rows[0].name, no: '', is_new: false };
  }
  const msg = rows.length > 1
    ? `已有 ${rows.length} 位同名同学，请填写学号区分`
    : '该姓名已用学号登记，请填写你的学号';
  return { need_no: true, error: msg, name };
}

function add_message(studentId, mode, topic, role, content, hasImage, session) {
  messages.push({
    id: messages.length + 1,
    student_id: studentId,
    mode: mode,
    topic: topic,
    role: role,
    content: content,
    has_image: hasImage ? 1 : 0,
    session: session || 'legacy',
    created_at: now(),
  });
}

function list_sessions(studentId) {
  const rows = messages.filter((m) => m.student_id === studentId);
  const groups = new Map();
  for (const m of rows) {
    const key = m.session || 'legacy';
    if (!groups.has(key)) groups.set(key, { id: key, count: 0, last: 0 });
    const g = groups.get(key);
    g.count += 1;
    if (m.created_at > g.last) g.last = m.created_at;
  }
  const out = [];
  for (const g of groups.values()) {
    const first = rows.find(
      (m) => (m.session || 'legacy') === g.id && m.role === 'user' && String(m.content || '').trim()
    );
    const title = first ? String(first.content).trim().replace(/\s+/g, ' ') : '新对话';
    out.push({ id: g.id, title: title.slice(0, 26), count: g.count, updated_at: g.last });
  }
  out.sort((a, b) => b.updated_at - a.updated_at);
  return out;
}

function load_history(studentId, session) {
  return messages
    .filter((m) => m.student_id === studentId && (m.session || 'legacy') === session)
    .map((m) => ({
      role: m.role,
      content: m.content,
      mode: m.mode,
      topic: m.topic,
      has_image: m.has_image,
      created_at: m.created_at,
    }));
}

function count_topic_asks(studentId, topic) {
  if (!studentId || !topic) return 0;
  return messages.filter(
    (m) => m.student_id === studentId && m.topic === topic && m.role === 'user'
  ).length;
}

function add_mistake(studentId, topic, note) {
  mistakes.push({
    id: mistakes.length + 1,
    student_id: studentId,
    topic: topic,
    note: note,
    created_at: now(),
  });
}

function latestProject(studentId) {
  for (let i = projects.length - 1; i >= 0; i--) {
    if (projects[i].student_id === studentId) return projects[i];
  }
  return null;
}

function get_or_create_project(studentId, title) {
  let project = latestProject(studentId);
  if (!project) {
    const t = now();
    project = {
      id: projects.length + 1,
      student_id: studentId,
      title: title || '通用技术设计方案',
      stage: 0,
      data: {},
      created_at: t,
      updated_at: t,
    };
    projects.push(project);
  }
  return project;
}

function save_project(project) {
  const stored = projects.find((p) => p.id === project.id);
  if (stored) {
    stored.stage = project.stage;
    stored.data = project.data;
    stored.updated_at = now();
  }
}

function add_iteration(projectId, stage, content) {
  iterations.push({
    id: iterations.length + 1,
    project_id: projectId,
    stage: stage,
    content: content,
    created_at: now(),
  });
}

function student_stats(studentId) {
  const msgs = messages.filter((m) => m.student_id === studentId);
  const mis = mistakes
    .filter((m) => m.student_id === studentId)
    .map((m) => ({ topic: m.topic, note: m.note }));
  const proj = latestProject(studentId);
  const iters = proj
    ? iterations.filter((i) => i.project_id === proj.id).length
    : 0;
  return {
    topics: {},
    messages: msgs.filter((m) => m.role === 'user').length,
    mistakes: mis,
    stage: proj ? proj.stage : 0,
    iterations: iters,
    project_data: proj ? proj.data : {},
    images: msgs.reduce((sum, m) => sum + (m.has_image ? 1 : 0), 0),
  };
}

function py_round(x) {
  const floor = Math.floor(x);
  const diff = x - floor;
  if (diff < 0.5) return floor;
  if (diff > 0.5) return floor + 1;
  return floor % 2 === 0 ? floor : floor + 1;
}

function class_overview() {
  const userMsgs = messages.filter((m) => m.role === 'user');
  const topics = {};
  for (const m of userMsgs) {
    const t = m.topic || '未归类';
    topics[t] = (topics[t] || 0) + 1;
  }

  const stages = {};
  for (const p of projects) {
    stages[p.stage] = (stages[p.stage] || 0) + 1;
  }
  const itByProj = {};
  for (const it of iterations) {
    itByProj[it.project_id] = (itByProj[it.project_id] || 0) + 1;
  }

  const rows = [];
  for (const s of students) {
    const my = userMsgs.filter((m) => m.student_id === s.id);
    const myTopics = {};
    for (const m of my) {
      const t = m.topic || '未归类';
      myTopics[t] = (myTopics[t] || 0) + 1;
    }
    const proj = latestProject(s.id);
    const pdata = proj ? proj.data : {};
    const cons = pdata.constraints || {};
    const cover = Object.values(cons).filter((v) => v).length;
    const stage = proj ? proj.stage : 0;
    const itersN = proj ? (itByProj[proj.id] || 0) : 0;
    const myMis = mistakes.filter((m) => m.student_id === s.id);

    const breadthTopics = Object.keys(myTopics).filter((k) => k !== '未归类');
    const breadth = Math.min(breadthTopics.length, 5) / 5;
    const design = Math.min(stage / 5 * 0.7 + Math.min(itersN, 4) / 4 * 0.3, 1);
    const engineering = Math.min(cover / 4 * 0.75 + Math.min(my.length, 8) / 8 * 0.25, 1);
    const ethics = Math.min(
      ((cons['安全'] ? 1 : 0) + (cons['环境'] ? 1 : 0) + (cons['人文'] ? 1 : 0)) / 3,
      1
    );

    rows.push({
      id: s.id,
      name: s.name,
      no: s.no || '',
      questions: my.length,
      stage: stage,
      iterations: itersN,
      mistakes: myMis.length,
      constraint_cover: cons,
      obe: {
        '技术思想理解': py_round(breadth * 100),
        '设计方法运用': py_round(design * 100),
        '工程思维': py_round(engineering * 100),
        '技术伦理意识': py_round(ethics * 100),
      },
    });
  }

  const topicList = Object.entries(topics)
    .map(([topic, count]) => ({ topic, count }))
    .sort((a, b) => b.count - a.count);

  const names = ['找问题', '明确约束', '构思方案', '迭代优化', '方案自评'];
  const bottlenecks = Object.keys(stages)
    .map(Number)
    .sort((a, b) => a - b)
    .map((k) => ({
      stage: k < names.length ? names[k] : '已完成',
      count: stages[k],
    }));

  return {
    students: rows,
    topics: topicList,
    bottlenecks: bottlenecks,
    totals: {
      students: students.length,
      questions: userMsgs.length,
      projects: projects.length,
      iterations: iterations.length,
    },
  };
}

function seed_demo() {
  if (class_overview().totals.students > 0) return false;
  const demo = [
    ['2024111402', '王思远', { 结构: 5, 工艺: 3, 流程: 1 }, 2, 2,
      { 成本: true, 安全: false, 环境: false, 人文: false }, 3],
    ['2024111403', '陈可欣', { 控制: 7, 系统: 4, 三视图: 2 }, 4, 5,
      { 成本: true, 安全: true, 环境: true, 人文: true }, 1],
    ['2024111404', '刘子航', { 三视图: 8, 投影: 4, 结构: 1 }, 1, 1,
      { 成本: false, 安全: true, 环境: false, 人文: false }, 4],
    ['2024111405', '赵一诺', { 创新技法: 5, 流程: 3, 系统: 2 }, 4, 4,
      { 成本: true, 安全: true, 环境: true, 人文: false }, 0],
    ['2024111406', '孙嘉禾', { 控制: 4, 流程: 4, 工艺: 2 }, 2, 2,
      { 成本: true, 安全: false, 环境: true, 人文: false }, 2],
    ['2024111407', '周雨桐', { 三视图: 5, 投影: 3, 创新技法: 2 }, 3, 3,
      { 成本: true, 安全: true, 环境: false, 人文: false }, 1],
    ['2024111408', '吴俊熙', { 结构: 6, 系统: 2, 控制: 2 }, 3, 2,
      { 成本: true, 安全: true, 环境: false, 人文: true }, 3],
  ];
  for (const [sid, name, topicCounts, stage, iters, cons, misN] of demo) {
    ensure_student(sid, name, sid);
    for (const [topic, n] of Object.entries(topicCounts)) {
      for (let i = 0; i < n; i++) {
        const mode = i % 3 !== 0 ? 'knowledge' : 'design';
        add_message(sid, mode, topic, 'user', `${topic} 相关疑问`, false, 'demo');
        add_message(sid, mode, topic, 'assistant', '（演示数据）引导式回复', false, 'demo');
      }
    }
    const keys = Object.keys(topicCounts);
    for (let i = 0; i < misN; i++) {
      add_mistake(sid, keys[i % keys.length], '演示错题');
    }
    const pid = get_or_create_project(sid).id;
    for (let i = 0; i < iters; i++) {
      add_iteration(pid, Math.min(i + 1, 4), '方案迭代记录');
    }
    save_project({
      id: pid,
      stage: stage,
      data: { problem: '演示方案问题', constraints: cons, ideas: ['方案A', '方案B'] },
    });
  }
  return true;
}

// ==================================================================
// 二、启发式引导引擎
// ==================================================================
function classify(text) {
  let best = null;
  let score = 0;
  for (const key of Object.keys(TOPICS)) {
    const t = TOPICS[key];
    let s = 0;
    for (const a of t.aliases) {
      if (text.includes(a)) s += a.length;
    }
    if (s >= score && s > 0) {
      best = key;
      score = s;
    }
  }
  return best;
}

function detect_constraints(text) {
  return Object.keys(CONSTRAINT_KEYS).filter(
    (k) => CONSTRAINT_KEYS[k].some((w) => text.includes(w))
  );
}

function _knowledge_reply(topic, askCount, direct) {
  const t = TOPICS[topic];
  const chap = CHAPTERS[topic];
  const src = chap ? `\n\n（对应教材：周晓林主编《通用技术》${chap}）` : '';
  if (direct) {
    const body = t.points.map((p, i) => `${i + 1}. ${p}`).join('\n');
    return {
      reply: `「${topic}」直接给答案：\n${body}\n\n实例：${t.case}${src}`,
      questions: [],
      pitfalls: t.pitfalls,
      case: t.case,
      checklist: [],
      topic: topic,
      reveal: true,
      direct: true,
    };
  }
  if (askCount >= 2) {
    const body = t.points.map((p, i) => `${i + 1}. ${p}`).join('\n');
    return {
      reply: `「${topic}」你已经问过 ${askCount} 次了，这次不绕弯子，直接给你重点：\n`
        + `${body}\n\n${t.case}\n`
        + `对照一下你之前卡住的地方，看是哪一条没吃透。${src}`,
      questions: [],
      pitfalls: t.pitfalls,
      case: t.case,
      checklist: [],
      topic: topic,
      reveal: true,
    };
  }
  return {
    reply: `我们先不急着背结论。关于「${topic}」，给你一个定位：\n${t.position}\n\n`
      + `接着按顺序想下面三个问题，想清楚一个再来找我。${src}`,
    questions: t.chain.map(([q, intent]) => ({ q: q, intent: intent })),
    pitfalls: t.pitfalls,
    case: t.case,
    checklist: [],
    topic: topic,
  };
}

function _design_reply(text, project, direct) {
  const data = project.data;
  const stage = project.stage;
  const info = STAGES[stage];
  const found = detect_constraints(text);
  if (found.length) {
    if (!data.constraints) data.constraints = {};
    for (const k of found) {
      data.constraints[k] = true;
    }
  }
  if (stage === 0 && text.length >= 12 && !data.problem) {
    data.problem = text.slice(0, 300);
  }
  if ((stage === 2 || stage === 3) && text.length >= 8) {
    if (!data.ideas) data.ideas = [];
    if (!data.ideas.includes(text.slice(0, 60))) {
      data.ideas.push(text.slice(0, 300));
    }
  }
  project.data = data;
  save_project(project);
  add_iteration(project.id, stage, text.slice(0, 300));

  const cons = data.constraints || {};
  const missing = Object.keys(CONSTRAINT_KEYS).filter((k) => !cons[k]);
  const questions = info.ask.map((q) => ({ q: q, intent: '阶段引导' }));
  let checklist = info.checklist.slice();
  if (stage >= 1 && missing.length) {
    questions.unshift({
      q: `你还没考虑到的约束是：${missing.join('、')}。补上其中一条，会改变方案的哪一步？`,
      intent: '约束补全',
    });
    checklist = ['约束覆盖：' + Object.keys(CONSTRAINT_KEYS).map(
      (k) => `${k}${cons[k] ? '已覆盖' : '待补'}`
    ).join('、')];
  }
  const nIdeas = (data.ideas || []).length;
  if (stage === 2 && nIdeas < 2) {
    questions.unshift({
      q: `目前只记录了 ${nIdeas} 个方案，再想一个思路相反的，会是什么？`,
      intent: '方案数量',
    });
  }
  if (direct) {
    const body = (checklist.length ? checklist : info.checklist)
      .map((c, i) => `${i + 1}. ${c}`).join('\n');
    return {
      reply: `【${info.name}】直接给做法：${info.goal}\n\n按这个顺序做：\n${body}\n\n${info.tip}`,
      questions: [],
      pitfalls: [],
      checklist: checklist,
      topic: '技术方案设计',
      stage: stage,
      stage_name: info.name,
      constraints: data.constraints || {},
      missing_constraints: missing,
      can_advance: stage < STAGES.length - 1,
      reveal: true,
      direct: true,
    };
  }
  return {
    reply: `【${info.name}】${info.goal}\n\n${info.tip}`,
    questions: questions,
    pitfalls: [],
    checklist: checklist,
    topic: '技术方案设计',
    stage: stage,
    stage_name: info.name,
    constraints: data.constraints || {},
    missing_constraints: missing,
    can_advance: stage < STAGES.length - 1,
  };
}

function _drawing_reply(text, topic, askCount, direct) {
  const t = (topic && TOPICS[topic]) ? TOPICS[topic] : TOPICS['三视图'];
  let checklist = [];
  if (topic === '三视图' || topic === '投影' || !topic
      || ['视图', '投影', '制图', '图纸'].some((w) => text.includes(w))) {
    checklist = checklist.concat([
      '长对正：主视图与俯视图左右对齐',
      '高平齐：主视图与左视图上下对齐',
      '宽相等：俯视图与左视图前后相等',
      '不可见轮廓用虚线，可见轮廓用实线',
      '对称件画中心线',
    ]);
  }
  if (topic === '结构' || ['受力', '强度', '稳定'].some((w) => text.includes(w))) {
    checklist = checklist.concat([
      '判断每个构件受拉、受压还是受弯',
      '找出最先失效的构件',
      '检查重心是否落在支撑面内',
    ]);
  }
  if (topic === '工艺' || ['工艺', '加工', '连接', '榫接'].some((w) => text.includes(w))) {
    checklist = checklist.concat([
      '材料是否适合该工艺',
      '连接方式是否需要可拆卸',
      '工序顺序是否影响精度',
    ]);
  }
  if (!checklist.length) {
    checklist = ['先明确问的是读图、受力还是工艺，再逐条自查'];
  }
  if (direct) {
    const body = (t.points || []).map((p, i) => `${i + 1}. ${p}`).join('\n');
    const cl = checklist.map((c) => `- ${c}`).join('\n');
    return {
      reply: `「${topic || '三视图'}」直接给答案：\n${body}\n\n逐条核对：\n${cl}`,
      questions: [],
      pitfalls: t.pitfalls,
      case: t.case,
      checklist: checklist,
      topic: topic || '三视图',
      reveal: true,
      direct: true,
    };
  }
  if (askCount >= 2) {
    const body = (t.points || []).map((p, i) => `${i + 1}. ${p}`).join('\n');
    return {
      reply: `「${topic || '三视图'}」你已经问过 ${askCount} 次了，这次直接给重点：\n`
        + `${body}\n\n拿着这份重点逐条对照你的图，对不上的那条就是问题所在。`,
      questions: [],
      pitfalls: t.pitfalls,
      case: t.case,
      checklist: checklist,
      topic: topic || '三视图',
      reveal: true,
    };
  }
  return {
    reply: '制图类问题先别问“对不对”，我们拿检查清单自己找出来。\n'
      + '按顺序逐条过一遍，哪一条对不上，就把注意力放在那条上。',
    questions: t.chain.map(([q, intent]) => ({ q: q, intent: intent })),
    pitfalls: t.pitfalls,
    case: t.case,
    checklist: checklist,
    topic: topic || '三视图',
  };
}

function _review_reply(text, topic, studentId, direct) {
  topic = topic || '未归类';
  add_mistake(studentId, topic, text.slice(0, 300));
  const t = TOPICS[topic];
  const questions = [
    { q: '先不看答案，复述一遍你当时的判断依据，卡在哪一步？', intent: '复现思维过程' },
    { q: '这次错误更像哪一种：概念混淆、读图习惯，还是表达规范？', intent: '归因' },
    { q: '换一道同类题，你会先检查哪一条？', intent: '迁移' },
  ];
  if (t) {
    questions.push({ q: t.chain[0][0], intent: '同类题复练' });
  }
  if (direct) {
    const pit = (t && t.pitfalls.length
      ? t.pitfalls.map((p) => `- ${p}`) : ['- 概念混淆 / 条件遗漏 / 表达不规范']).join('\n');
    const pts = t
      ? t.points.map((p, i) => `${i + 1}. ${p}`).join('\n')
      : '1. 按课本定义与规范把这道题重做一遍';
    return {
      reply: `这道错题归到「${topic}」。直接给答案：\n常见错因：\n${pit}\n\n`
        + `正确要点：\n${pts}\n\n下次先检查：${t ? t.chain[0][0] : '题目条件是否看全'}`,
      questions: [],
      pitfalls: t ? t.pitfalls : [],
      checklist: [],
      topic: topic,
      case: t ? t.case : '',
      reveal: true,
      direct: true,
    };
  }
  return {
    reply: `已把这道错题归到「${topic}」。错题的价值不在记住答案，`
      + `而在于找出错在哪一类。\n先回答下面三个问题，我据此给你一组同类复练。`,
    questions: questions,
    pitfalls: t ? t.pitfalls : [],
    checklist: [],
    topic: topic,
    case: t ? t.case : '',
  };
}

function _quiz_reply(text) {
  const topic = classify(text);
  const item = topic ? QUIZ[topic] : undefined;
  if (!item) {
    if (topic && TOPICS[topic]) {
      const t = TOPICS[topic];
      return {
        reply: `来一道「${topic}」的简答题：先自己写两三句话，再点“看答案”对照。\n`
          + '题目：请说明这一考点的核心要点，并举一个生活或工程中的例子。',
        quiz: {
          topic: topic,
          q: '请说明该考点的核心要点，并举一个例子。',
          options: null,
          answer: t.points.slice(0, 3).join('；') + `。例：${t.case}`,
          why: `教材定位：${t.position}`,
        },
        questions: [],
        pitfalls: t.pitfalls,
        case: '',
        checklist: [],
        topic: topic,
      };
    }
    const quizKeys = Object.keys(QUIZ);
    const picked = quizKeys[Math.floor(Math.random() * quizKeys.length)];
    return quizItemReply(picked, QUIZ[picked]);
  }
  return quizItemReply(topic, item);
}

function quizItemReply(topic, item) {
  const letters = 'ABCD';
  const ans = item.answer;
  return {
    reply: `随堂练习 · ${topic}。先自己判断，选完我给出答案和理由。`,
    quiz: {
      topic: topic,
      q: item.q,
      options: item.options.slice(),
      answer: ans,
      answer_text: `${letters[ans]}. ${item.options[ans]}`,
      why: item.why,
    },
    questions: [],
    pitfalls: [],
    case: '',
    checklist: [],
    topic: topic,
  };
}

async function respond(studentId, mode, text, imageB64, style, model) {
  text = String(text == null ? '' : text).trim();
  const topic = classify(text);
  const direct = style === 'direct';
  const base = {
    mode: mode,
    topic: topic || '未归类',
    stage: null,
    questions: [],
    pitfalls: [],
    checklist: [],
    case: '',
    offline: true,
    reveal: false,
    style: style || 'guide',
  };

  let res;
  if (mode === 'quiz') {
    res = _quiz_reply(text);
  } else if (mode === 'design') {
    res = _design_reply(text, get_or_create_project(studentId), direct);
  } else if (mode === 'drawing') {
    res = _drawing_reply(text, topic, count_topic_asks(studentId, topic), direct);
  } else if (mode === 'review') {
    res = _review_reply(text, topic, studentId, direct);
  } else if (topic) {
    res = _knowledge_reply(topic, count_topic_asks(studentId, topic), direct);
  } else {
    res = {
      reply: '这个问题我没匹配到具体考点，但通用技术的思路是通用的。先做两步定位：\n'
        + '1. 它属于《通用技术》哪一章？（第1章概述 / 第2章设计基础 / 第3章结构与设计 / '
        + '第4章流程与设计 / 第5章系统与设计 / 第6章控制与设计 / 第7章电子控制技术 / '
        + '第8章简易机器人 / 第9章现代农业技术 / 第10章服装与家政 / '
        + '第11章汽车驾驶与保养 / 第12章建筑与设计）\n'
        + '2. 把日常说法换成课程术语：比如“怎么固定”＝连接方式，'
        + '“为什么一碰就倒”＝稳定性，“画出来”＝图样表达。\n\n'
        + '可直接选一个考点，我带你逐层拆：技术性质与价值、设计原则、技术素养、'
        + '设计的一般过程、发现与明确问题、人机关系、设计分析、方案构思、技术试验、'
        + '模型制作、方案评价、技术语言、投影与三视图、尺寸标注、剖视图、'
        + '木工/金工/电子工艺、装配与连接、创新技法、知识产权、结构、强度与稳定性、'
        + '流程、系统、控制、电子控制技术、简易机器人、现代农业技术、'
        + '服装与家政、汽车驾驶与保养、建筑与设计。',
      questions: [
        { q: '你这句话里，“要解决的问题”和“涉及的对象”分别是什么？', intent: '先界定问题与对象' },
        { q: '你更需要的是“怎么想方案”“怎么做出来”还是“怎么画图/怎么评价”？', intent: '定位到设计阶段' },
      ],
      pitfalls: ['用生活口语描述，导致找不到对应考点；换成课程术语再问一次往往就清楚了。'],
      checklist: [],
      topic: '未归类',
      case: '',
    };
  }

  if (mode !== 'review' && mode !== 'quiz' && (direct || !res.reveal)) {
    const want = direct ? '请直接给出答案，不要反问。' : '请只给引导，不给答案。';
    const ask = `学生问题：${text}\n当前模式：${MODES[mode] || mode}\n`
      + `已识别主题：${topic || '未识别'}\n${want}`;
    const content = imageB64
      ? [{ type: 'text', text: ask }, { type: 'image_url', image_url: { url: imageB64 } }]
      : ask;
    const out = await llm([
      { role: 'system', content: direct ? DIRECT_PROMPT : SYSTEM_PROMPT },
      { role: 'user', content: content },
    ], model);
    if (out) {
      res.reply = out;
      res.offline = false;
    }
  }

  Object.assign(base, res);
  base.mode_name = MODES[mode] || mode;
  return base;
}

// ==================================================================
// 三、界面组装
// ==================================================================
function page(body, sOn, tOn, title) {
  return '<!DOCTYPE html><html lang="zh-CN"><head><meta charset="utf-8">'
    + '<meta name="viewport" content="width=device-width,initial-scale=1">'
    + `<title>${title || '通用技术 · 智能学伴'}</title><style>${BASE_CSS}</style></head><body>`
    + TOP.split('__S__').join(sOn).split('__T__').join(tOn)
    + body + FOOT + '</body></html>';
}

// ==================================================================
// 四、HTTP 服务
// ==================================================================
function send(res, code, body, ctype) {
  let payload;
  if (Buffer.isBuffer(body)) {
    payload = body;
  } else if (typeof body === 'string') {
    payload = Buffer.from(body, 'utf8');
  } else {
    payload = Buffer.from(JSON.stringify(body), 'utf8');
  }
  res.writeHead(code, {
    'Content-Type': ctype || 'application/json; charset=utf-8',
    'Content-Length': String(payload.length),
    'Cache-Control': 'no-store',
  });
  res.end(payload);
}

function read_json(req) {
  return new Promise((resolve) => {
    let raw = '';
    req.on('data', (chunk) => {
      raw += chunk;
    });
    req.on('end', () => {
      try {
        resolve(raw ? JSON.parse(raw) : {});
      } catch (e) {
        resolve({});
      }
    });
    req.on('error', () => resolve({}));
  });
}

function handle_get(url) {
  const pathname = url.pathname;
  const query = url.searchParams;
  if (pathname === '/' || pathname === '/index.html') {
    return { code: 200, body: page(STUDENT_BODY, 'on', ''), ctype: 'text/html; charset=utf-8' };
  }
  if (pathname === '/teacher') {
    return {
      code: 200,
      body: page(TEACHER_BODY, '', 'on', '班级学情 · 通用技术 · 智能学伴'),
      ctype: 'text/html; charset=utf-8',
    };
  }
  if (pathname === '/api/class') {
    return { code: 200, body: class_overview() };
  }
  if (pathname === '/api/models') {
    return { code: 200, body: { models: config_models(), active: active_model() } };
  }
  if (pathname === '/api/link') {
    return { code: 200, body: { url: process.env.PUBLIC_URL || '' } };
  }
  if (pathname === '/api/sessions') {
    const sid = String(query.get('student') || '').trim();
    return { code: 200, body: { sessions: sid ? list_sessions(sid) : [] } };
  }
  if (pathname === '/api/history') {
    const sid = String(query.get('student') || '').trim();
    const sess = String(query.get('session') || '');
    return {
      code: 200,
      body: { session: sess, messages: sid ? load_history(sid, sess) : [] },
    };
  }
  if (pathname === '/api/profile') {
    const sid = String(query.get('student') || '').trim();
    const overview = class_overview();
    const row = overview.students.find((s) => s.id === sid);
    const st = row
      ? student_stats(sid)
      : { messages: 0, iterations: 0, mistakes: [], images: 0, stage: 0, project_data: {} };
    return {
      code: 200,
      body: {
        student: sid,
        questions: st.messages,
        iterations: st.iterations,
        mistakes_count: st.mistakes.length,
        images: st.images,
        stage: st.stage,
        constraints: st.project_data.constraints || {},
        obe: row
          ? row.obe
          : { '技术思想理解': 0, '设计方法运用': 0, '工程思维': 0, '技术伦理意识': 0 },
      },
    };
  }
  if (pathname === '/favicon.ico') {
    return { code: 204, body: Buffer.alloc(0) };
  }
  return { code: 404, body: { error: 'not found' } };
}

async function handle_post(req, url) {
  const body = await read_json(req);

  if (url.pathname === '/api/login') {
    const name = String(body.name || '').trim();
    const no = String(body.no || '').trim();
    if (!name) {
      return { code: 400, body: { error: '请先输入你的姓名' } };
    }
    const result = login_student(name, no);
    return { code: result.need_no ? 409 : 200, body: result };
  }

  const sid = String(body.student || '').trim();
  if (!sid || !student_exists(sid)) {
    return { code: 400, body: { error: '请先输入姓名进入学习' } };
  }

  if (url.pathname === '/api/chat') {
    const mode = body.mode || 'knowledge';
    const text = body.text || '';
    const image = body.image || '';
    if (!String(text).trim() && !image) {
      return { code: 400, body: { error: 'empty message' } };
    }
    let session = String(body.session || '').trim();
    if (!session) session = 'c' + Date.now();
    add_message(sid, mode, classify(String(text)) || '未归类', 'user', text,
      Boolean(image), session);
    const data = await respond(sid, mode, text, image, body.style || 'guide',
      body.model || '');
    add_message(sid, mode, data.topic || '未归类', 'assistant', data.reply || '',
      false, session);
    data.session = session;
    return { code: 200, body: data };
  }

  if (url.pathname === '/api/advance') {
    const project = get_or_create_project(sid);
    if (project.stage < STAGES.length - 1) {
      project.stage += 1;
      save_project(project);
    }
    const info = STAGES[project.stage];
    return {
      code: 200,
      body: {
        stage: project.stage,
        stage_name: info.name,
        goal: info.goal,
        ask: info.ask,
        checklist: info.checklist,
      },
    };
  }

  return { code: 404, body: { error: 'not found' } };
}

const server = http.createServer(async (req, res) => {
  try {
    const url = new URL(req.url, 'http://127.0.0.1');
    const result = req.method === 'GET'
      ? handle_get(url)
      : (req.method === 'POST' ? await handle_post(req, url) : { code: 404, body: { error: 'not found' } });
    send(res, result.code, result.body, result.ctype);
  } catch (e) {
    send(res, 500, { error: 'internal error' });
  }
});

if (DEMO) {
  seed_demo();
}

server.listen(PORT, HOST, () => {
  console.log('通用技术 · 智能学伴已启动: http://127.0.0.1:' + PORT);
  console.log('教师端: http://127.0.0.1:' + PORT + '/teacher');
  console.log('引擎：本地启发式（离线可用）');
});
