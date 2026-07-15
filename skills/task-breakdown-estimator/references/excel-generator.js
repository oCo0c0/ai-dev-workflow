/**
 * Excel生成工具 - 为task-breakdown-estimator skill提供内置Excel生成能力
 * 无需外部模板文件，自包含实现
 */

const XLSX = require('xlsx');
const fs = require('fs');
const path = require('path');

/**
 * 从技能references目录读取配置
 */
function loadTemplateConfig() {
  const referencesPath = path.join(__dirname, 'template-structure.json');
  if (fs.existsSync(referencesPath)) {
    return JSON.parse(fs.readFileSync(referencesPath, 'utf-8'));
  }
  return null;
}

/**
 * 生成基础Excel工作簿（含样式和下拉验证）
 */
function createBaseWorkbook(config) {
  const wb = XLSX.utils.book_new();

  // 创建任务拆解表
  const wsData = [config.headers];
  const ws = XLSX.utils.aoa_to_sheet(wsData);

  // 设置列宽
  ws['!cols'] = config.headers.map((_, i) => ({ wch: i === 2 ? 30 : 20 }));

  XLSX.utils.book_append_sheet(wb, ws, '任务拆解表');

  // 创建下拉字段说明表
  const dropdownData = [Object.keys(config.dropdowns)];
  const maxLen = Math.max(...Object.values(config.dropdowns).map(arr => arr.length));

  for (let i = 0; i < maxLen; i++) {
    const row = Object.keys(config.dropdowns).map(key => config.dropdowns[key][i] || null);
    dropdownData.push(row);
  }

  const dropdownWs = XLSX.utils.aoa_to_sheet(dropdownData);
  XLSX.utils.book_append_sheet(wb, dropdownWs, '下拉字段');

  return wb;
}

/**
 * 将任务数据写入Excel
 * @param {Array} tasks - 任务数组
 * @param {string} outputPath - 输出文件路径
 * @param {Object} context - 上下文信息 {requirementId, project, devLead, testLead}
 */
function generateTasksExcel(tasks, outputPath, context = {}) {
  const config = loadTemplateConfig();
  if (!config) {
    throw new Error('Template configuration not found');
  }

  // 字段映射别名（与plan.ts保持一致）
  const HEADER_ALIASES = {
    '需求号ID': ['requirementId', '需求号', '需求号ID'],
    '任务ID（如有）': ['taskId', '任务ID', '任务编号'],
    '标题': ['title', '标题', 'name'],
    '描述': ['description', '描述', 'desc', 'detail'],
    '负责人': ['assignee', '负责人', 'owner'],
    '状态': ['status', '状态'],
    '所属项目': ['project', '所属项目', 'projectName'],
    '所属产品': ['product', '所属产品', 'productName'],
    '工作项类型': ['workItemType', '工作项类型', 'type', 'itemType'],
    '优先级': ['priority', '优先级'],
    '预估工时（小时）': ['estimatedHours', '预估工时', 'hours', 'effort'],
    '计划开始日期': ['startDate', '计划开始日期', 'start'],
    '计划完成日期': ['endDate', '计划完成日期', 'end', 'due'],
    '任务拆解类型': ['taskType', '任务拆解类型', 'category'],
    '任务复杂度': ['complexity', '任务复杂度', 'difficulty'],
    '需求开发主程': ['devLead', '需求开发主程'],
    '需求测试主程': ['testLead', '需求测试主程'],
  };

  // 取字段值
  function pick(row, aliases) {
    for (const a of aliases) {
      const v = row[a];
      if (typeof v === 'string' && v.trim()) return v.trim();
      if (typeof v === 'number') return String(v);
    }
    return '';
  }

  // 构建数据行
  const dataRows = tasks.map((task, index) => {
    return config.headers.map(header => {
      const aliases = HEADER_ALIASES[header] || [];
      let value = pick(task, aliases);

      // 上下文覆盖
      if (header === '需求号ID' && !value) value = context.requirementId || '';
      if (header === '所属项目' && !value) value = context.project || '';
      if (header === '需求开发主程' && !value) value = context.devLead || '';
      if (header === '需求测试主程' && !value) value = context.testLead || '';
      if (header === '任务ID（如有）' && !value) value = String(index + 1);

      // 下拉列验证（可选）
      if (config.dropdowns[header] && config.dropdowns[header].length > 0) {
        const enumValues = config.dropdowns[header];
        const lower = value.toLowerCase().trim();
        const exact = enumValues.find(v => v.toLowerCase() === lower);
        if (exact) value = exact;
      }

      // 工时转数字
      if (header === '预估工时（小时）' && value) {
        const n = Number(value);
        if (!isNaN(n)) return n;
      }

      return value || '—';
    });
  });

  // 创建工作簿
  const wb = createBaseWorkbook(config);

  // 更新任务拆解表数据
  const ws = wb.Sheets['任务拆解表'];
  const fullData = [config.headers, ...dataRows];
  XLSX.utils.sheet_add_aoa(ws, fullData, { origin: 'A1' });

  // 写入文件
  XLSX.writeFile(wb, outputPath);

  return { success: true, path: outputPath, count: tasks.length };
}

/**
 * 从markdown表格解析任务数据（与plan.ts保持一致）
 */
function parseMarkdownTable(raw) {
  const lines = raw.split('\n').map(l => l.trim()).filter(l => l.startsWith('|') && l.endsWith('|'));
  if (lines.length < 2) return [];

  const HEADER_ALIASES = {
    '需求号ID': ['requirementId', '需求号', '需求号ID'],
    '任务ID（如有）': ['taskId', '任务ID', '任务编号'],
    '标题': ['title', '标题', 'name'],
    '描述': ['description', '描述', 'desc', 'detail'],
    '负责人': ['assignee', '负责人', 'owner'],
    '状态': ['status', '状态'],
    '所属项目': ['project', '所属项目', 'projectName'],
    '所属产品': ['product', '所属产品', 'productName'],
    '工作项类型': ['workItemType', '工作项类型', 'type', 'itemType'],
    '优先级': ['priority', '优先级'],
    '预估工时（小时）': ['estimatedHours', '预估工时', 'hours', 'effort'],
    '计划开始日期': ['startDate', '计划开始日期', 'start'],
    '计划完成日期': ['endDate', '计划完成日期', 'end', 'due'],
    '任务拆解类型': ['taskType', '任务拆解类型', 'category'],
    '任务复杂度': ['complexity', '任务复杂度', 'difficulty'],
    '需求开发主程': ['devLead', '需求开发主程'],
    '需求测试主程': ['testLead', '需求测试主程'],
  };

  const aliasToField = {};
  for (const [field, aliases] of Object.entries(HEADER_ALIASES)) {
    aliasToField[field] = field;
    for (const a of aliases) aliasToField[a] = field;
  }

  const titleFieldKey = Object.keys(HEADER_ALIASES).find(k => HEADER_ALIASES[k].includes('title'));
  const descFieldKey = Object.keys(HEADER_ALIASES).find(k => HEADER_ALIASES[k].includes('description'));

  let headerLineIdx = -1;
  let colIndex = {};

  for (let i = 0; i < lines.length; i++) {
    const cells = lines[i].split('|').slice(1, -1).map(c => c.trim());
    if (cells.every(c => /^[-:]+$/.test(c) || c === '')) continue;

    const fields = cells.map(c => aliasToField[c]).filter(Boolean);
    if (fields.includes(titleFieldKey) && fields.includes(descFieldKey)) {
      headerLineIdx = i;
      cells.forEach((h, idx) => {
        const f = aliasToField[h];
        if (f && colIndex[f] === undefined) colIndex[f] = idx;
      });
      break;
    }
  }

  if (headerLineIdx < 0) return [];

  const rows = [];
  for (let i = headerLineIdx + 1; i < lines.length; i++) {
    const cells = lines[i].split('|').slice(1, -1).map(c => c.trim());
    if (cells.every(c => /^[-:]+$/.test(c) || c === '')) continue;

    if (cells.some(c => aliasToField[c] === titleFieldKey) && cells.filter(c => aliasToField[c]).length >= 5) {
      break;
    }

    const row = {};
    for (const [field, idx] of Object.entries(colIndex)) {
      const val = cells[idx];
      if (val !== undefined && val !== '' && val !== '—') {
        row[field] = val;
      }
    }

    if (row[titleFieldKey] || row[descFieldKey]) {
      rows.push(row);
    }
  }

  return rows;
}

module.exports = {
  generateTasksExcel,
  parseMarkdownTable,
  loadTemplateConfig
};