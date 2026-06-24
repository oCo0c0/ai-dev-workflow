/**
 * Excel生成工具 - 为task-breakdown-estimator skill提供Excel模板配置读取
 * 注意：此模块仅提供配置读取，实际Excel生成使用injectTasksToTemplate保持样式
 */

const XLSX = require('xlsx');
const fs = require('fs');
const path = require('path');
const AdmZip = require('adm-zip');

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
 * 从模板文件读取下拉配置（备用）
 */
function loadDropdownsFromTemplate(templatePath) {
  try {
    const wb = XLSX.readFile(templatePath);
    const sheet = wb.Sheets['下拉字段'];
    if (!sheet) return {};

    const rows = XLSX.utils.sheet_to_json(sheet, {header: 1});
    if (!rows.length) return {};

    const headers = rows[0];
    const result = {};

    for (let col = 0; col < headers.length; col++) {
      const name = headers[col]?.trim();
      if (!name) continue;

      const values = [];
      for (let r = 1; r < rows.length; r++) {
        const v = rows[r][col];
        if (typeof v === 'string' && v.trim()) values.push(v.trim());
        else if (typeof v === 'number') values.push(String(v));
      }
      result[name] = values;
    }
    return result;
  } catch (err) {
    console.warn('Failed to load dropdowns from template:', err.message);
    return {};
  }
}

/**
 * 获取下拉配置（优先skill references，降级模板文件）
 */
function getDropdowns(templatePath) {
  const skillConfig = loadTemplateConfig();
  if (skillConfig && skillConfig.dropdowns) {
    return skillConfig.dropdowns;
  }
  return loadDropdownsFromTemplate(templatePath);
}

/**
 * 获取表头配置（优先skill references，降级模板文件）
 */
function getHeaders(templatePath) {
  const skillConfig = loadTemplateConfig();
  if (skillConfig && skillConfig.headers) {
    return skillConfig.headers;
  }

  // 从模板文件读取
  try {
    const wb = XLSX.readFile(templatePath);
    const sheet = wb.Sheets['任务拆解表模版'];
    if (!sheet) return [];

    const rows = XLSX.utils.sheet_to_json(sheet, {header: 1});
    return rows[0]?.map(h => h?.trim() ?? '') || [];
  } catch (err) {
    console.warn('Failed to load headers from template:', err.message);
    return [];
  }
}

/**
 * XML 注入器：直接改模板 sheet1.xml + sharedStrings.xml，保全部样式/下拉/主题
 * 从src/server/routes/plan.ts移植过来，保持完全一致的实现
 */
function injectTasksToTemplate(templatePath, outputPath, headers, rows) {
  // 1. 拷贝模板 → 输出
  fs.copyFileSync(templatePath, outputPath);
  const zip = new AdmZip(outputPath);

  // 2. 解析 sharedStrings，建立 text → index 反查
  const ssXml = zip.readAsText('xl/sharedStrings.xml');
  const strings = [];
  const stringToIndex = {};
  const siRegex = /<si>([\s\S]*?)<\/si>/g;
  let m;
  let idx = 0;
  while ((m = siRegex.exec(ssXml)) !== null) {
    const textParts = m[1].match(/<t[^>]*>([\s\S]*?)<\/t>/g) || [];
    const text = textParts.map(t => t.replace(/<t[^>]*>/, '').replace(/<\/t>/, '')).join('');
    strings.push(text);
    if (stringToIndex[text] === undefined) stringToIndex[text] = idx;
    idx++;
  }

  const getOrAddString = (text) => {
    if (stringToIndex[text] !== undefined) return stringToIndex[text];
    const i = strings.length;
    strings.push(text);
    stringToIndex[text] = i;
    return i;
  };

  const colLetter = (n) => {
    let s = '';
    while (n > 0) {
      const r = (n - 1) % 26;
      s = String.fromCharCode(65 + r) + s;
      n = Math.floor((n - 1) / 26);
    }
    return s;
  };

  const escapeXml = (s) => s
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;');

  // 3. 生成数据行 XML
  const rowXmlArr = [];
  rows.forEach((row, rIdx) => {
    const rowNum = rIdx + 2;
    const cells = [];
    headers.forEach((h, cIdx) => {
      const colNum = cIdx + 1;
      const ref = `${colLetter(colNum)}${rowNum}`;
      const val = row[h];
      if (val === undefined || val === null || val === '') return;

      if (typeof val === 'number' || (/^-?\d+(\.\d+)?$/.test(String(val)) && h.includes('工时'))) {
        cells.push(`<c r="${ref}"><v>${Number(val)}</v></c>`);
        return;
      }

      const str = String(val);
      const sIdx = getOrAddString(str);
      cells.push(`<c r="${ref}" t="s"><v>${sIdx}</v></c>`);
    });
    if (cells.length > 0) {
      rowXmlArr.push(`<row r="${rowNum}" spans="1:${headers.length}">${cells.join('')}</row>`);
    }
  });

  // 4. 替换 sheet1.xml 的 sheetData
  let sheetXml = zip.readAsText('xl/worksheets/sheet1.xml');
  const newData = `<sheetData><row r="1" ht="18" customHeight="1" spans="1:17"></row>${rowXmlArr.join('')}</sheetData>`;
  const origRow1Match = sheetXml.match(/<row r="1"[^>]*>[\s\S]*?<\/row>/);
  const origRow1 = origRow1Match ? origRow1Match[0] : '';
  const finalSheetData = `<sheetData>${origRow1}${rowXmlArr.join('')}</sheetData>`;
  sheetXml = sheetXml.replace(/<sheetData>[\s\S]*?<\/sheetData>/, finalSheetData);

  const lastRow = rows.length + 1;
  sheetXml = sheetXml.replace(/<dimension ref="[^"]*"/, `<dimension ref="A1:Q${lastRow}"`);

  zip.updateFile('xl/worksheets/sheet1.xml', Buffer.from(sheetXml, 'utf-8'));

  // 5. 更新 sharedStrings
  const newUnique = strings.length;
  const newCount = strings.length;
  const siBlocks = strings.map(s => `<si><t xml:space="preserve">${escapeXml(s)}</t></si>`).join('');
  const newSs = `<?xml version="1.0" encoding="UTF-8" standalone="yes"?>\n<sst xmlns="http://schemas.openxmlformats.org/spreadsheetml/2006/main" count="${newCount}" uniqueCount="${newUnique}">${siBlocks}</sst>`;
  zip.updateFile('xl/sharedStrings.xml', Buffer.from(newSs, 'utf-8'));

  // 6. 写出
  zip.writeZip(outputPath);
}

/**
 * 从markdown表格解析任务数据（与plan.ts保持一致）
 */
function parseMarkdownTable(raw) {
  const HEADER_ALIASES = {
    '需求号ID': ['requirementId', '需求号', '需求号ID'],
    '任务ID（如有）': ['taskId', '任务ID', '任务编号'],
    '标题': ['title', '标题', 'name', '需求任务', '任务'],
    '描述': ['description', '描述', 'desc', 'detail', '任务描述'],
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

  const lines = raw.split('\n').map(l => l.trim()).filter(l => l.startsWith('|') && l.endsWith('|'));
  if (lines.length < 2) return [];

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
  injectTasksToTemplate,
  getDropdowns,
  getHeaders,
  loadTemplateConfig,
  parseMarkdownTable
};