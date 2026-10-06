import { demoState, EMPTY_PROFILE, VERSION, dateKey, shiftDate, validateEnvelope, validateMeal, validateWeight, validateProfile, mergeRecords, totals, remaining, movingAverage, energy, budgetFor, validDate } from './model.js';
import { prepareImport } from './import.js';
import { requestJSON } from './network.js';
let state, revision = 0, saving = false, view = 'today', editing = null, notice = '', dirty = false, busy = false, trendDays = 7, lastLoaded = '', syncWarning = '';
let selected = dateKey(new Date(), 'Asia/Shanghai');
const e = s => String(s ?? '').replace(/[&<>"']/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
const icon = (name) => { const paths = { today: 'M4 5h16v15H4z M8 3v4m8-4v4M4 11h16', trend: 'M4 19V5m0 14h16M7 15l4-5 4 2 5-7', history: 'M5 7a8 8 0 1 1-1 9M2 3v5h5m5 0v5l3 2', profile: 'M12 12a4 4 0 1 0 0-8 4 4 0 0 0 0 8m-7 8a7 7 0 0 1 14 0', plus: 'M12 5v14M5 12h14', leaf: 'M20 4C8 3 3 8 5 15s15 3 15-11M5 20l10-10', arrow: 'M4 12h16m-6-6 6 6-6 6' }; return `<svg width="22" height="22" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.7" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="${paths[name] || paths.today}"/></svg>`; };
const num = (n) => Math.round(n).toLocaleString('zh-CN');
function notify(message, error = false) { notice = message; let box = document.querySelector('#operation-notice'); if (!box) {
    box = document.createElement('div');
    box.className = 'notice';box.id='operation-notice';
    document.querySelector('#surface').before(box);
} box.setAttribute('role', error ? 'alert' : 'status'); box.textContent = message; if (error)
    box.scrollIntoView({ block: 'nearest' }); }
function lock(value) { if (busy === value)
    return; busy = value; document.querySelector('main')?.setAttribute('aria-busy', String(value)); document.querySelectorAll('button,input,select,textarea').forEach(node => { if (value) {
    node.dataset.wasDisabled = String(node.disabled);
    node.disabled = true;
}
else {
    node.disabled = node.dataset.wasDisabled === 'true';
    delete node.dataset.wasDisabled;
} }); const box = document.querySelector('#connection-status'); if (box)
    box.textContent = value ? '正在保存，请稍候…' : `已读取 · ${lastLoaded}`; }
async function persist(next, message, onSuccess = () => { }) { if (saving)
    return false; saving = true; lock(true); notify('正在保存到私人日记…'); try {
    const result = await requestJSON('/api/journal', { method: 'PUT', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ state: next, revision }) });
    state = result.state;
    revision = result.revision;
    dirty = false;
    notice = message;
    lastLoaded = new Date().toLocaleTimeString('zh-CN', { hour: '2-digit', minute: '2-digit', timeZone: state.timezone });
    onSuccess();
    render();
    return true;
}
catch (error) {
    notify(error.message + (error.status === 409 ? ' 未保存的输入已保留；先复制需要保留的内容，再点击「刷新记录」核对。' : ''), true);
    if (error.status === 401) {
        const a = document.createElement('a');
        a.href = '/signin-with-chatgpt?return_to=%2F';
        a.textContent = '重新登录';
        document.querySelector('#operation-notice').append(' ', a);
    }
    return false;
}
finally {
    saving = false;
    lock(false);
} }
function navigate(action) { if (busy)
    return; if (dirty && !confirm('有尚未保存的输入。离开会放弃这些输入，继续？'))
    return; dirty = false; notice = ''; action(); render(); window.scrollTo(0, 0); }
function chart(weights, end) {
    const dates = Array.from({ length: trendDays }, (_, i) => shiftDate(end, i + 1 - trendDays)), rows = dates.map(date => ({ date, w: weights.find(w => w.date === date)?.kg, avg: movingAverage(weights, date) }));
    const values = rows.flatMap(r => [r.w, r.avg]).filter(v => v != null);
    if (!values.length)
        return `<div class="empty">这 ${trendDays} 天还没有称重记录。可以先记录一次体重。</div>`;
    const min = Math.min(...values) - .3, max = Math.max(...values) + .3, x = i => 48 + i * 282 / (trendDays - 1), y = v => 150 - (v - min) / (max - min) * 120;
    const segments = [];
    let segment = [];
    rows.forEach((r, i) => { if (r.avg == null) {
        if (segment.length)
            segments.push(segment);
        segment = [];
    }
    else
        segment.push(`${x(i)},${y(r.avg)}`); });
    if (segment.length)
        segments.push(segment);
    return `<div class="chart"><svg viewBox="0 0 350 205" role="img" aria-label="最近 ${trendDays} 天原始体重与七日移动平均，完整数字见下方数据表"><path class="gridline" d="M45 30H330M45 90H330M45 150H330"/><text x="0" y="34">${max.toFixed(1)}</text><text x="0" y="154">${min.toFixed(1)}</text>${segments.map(points => `<polyline class="average" points="${points.join(' ')}"/>`).join('')}${rows.map((r, i) => `${r.w != null ? `<circle class="raw" cx="${x(i)}" cy="${y(r.w)}" r="4"><title>${r.date} 原始体重 ${r.w} kg</title></circle>` : ''}${trendDays === 7 || i === 0 || i === trendDays - 1 || i % 7 === 0 ? `<text x="${x(i)}" y="185" text-anchor="middle">${r.date.slice(5).replace('-', '/')}</text>` : ''}`).join('')}</svg></div><div class="legend"><span><i class="raw-dot"></i>每日原始体重</span><span><i class="avg-line"></i>7 日移动平均</span></div><details><summary>查看图表数据</summary><div class="table-scroll"><table><caption>截至 ${end}，最近 ${trendDays} 天</caption><thead><tr><th scope="col">日期</th><th scope="col">原始 kg</th><th scope="col">7 日平均 kg</th><th scope="col">样本天数</th></tr></thead><tbody>${rows.slice().reverse().map(r => `<tr><th scope="row">${r.date}</th><td>${r.w == null ? '未记录' : r.w.toFixed(1)}</td><td>${r.avg == null ? '—' : r.avg.toFixed(1)}</td><td>${weights.filter(w => w.date >= shiftDate(r.date, -6) && w.date <= r.date).length}/7</td></tr>`).join('')}</tbody></table></div></details>`;
}
function mealRows(rows) { return rows.length ? rows.slice().sort((a, b) => ['早餐', '午餐', '晚餐', '加餐'].indexOf(a.slot) - ['早餐', '午餐', '晚餐', '加餐'].indexOf(b.slot) || a.updatedAt.localeCompare(b.updatedAt)).map(m => `<button class="meal-row" data-edit="${e(m.id)}">${m.photo ? `<img alt="${e(m.title)}的私人照片" src="${e(m.photo)}">` : `<div class="meal-placeholder">${icon('leaf')}<span>无照片</span></div>`}<span class="meal-info"><span class="meal-slot">${e(m.slot)} · ${e(m.confidence)}置信度</span><strong>${e(m.title)}</strong><span>${e(m.portion || '份量待确认')}</span></span><span class="meal-energy"><strong>${num(m.kcal)}</strong><span>${num(m.low)}–${num(m.high)} kcal</span></span>${icon('arrow')}</button>`).join('') : '<div class="empty">这一天还没有餐食记录。没有记录不代表没有摄入。</div>'; }
function summary() { const meals = state.meals.filter(m => m.date === selected), t = totals(meals), target = energy(state.profile) ? budgetFor(state.budgets, selected) : null, r = meals.length ? remaining(target, t) : null, status = state.completeness?.[selected] || 'recording'; return `<section class="summary"><div class="summary-main"><h2>${selected === dateKey(new Date(), state.timezone) ? '今日已记录摄入' : '当天已记录摄入'}</h2><div class="intake">${meals.length ? num(t.kcal) : '—'}<span>kcal</span></div><p>${meals.length ? `估算范围 <b>${num(t.low)}–${num(t.high)}</b> kcal` : '添加餐食后显示估算范围'}</p><span class="status">${{ recording: '记录中', complete: '当天已完整记录', partial: '部分记录' }[status]} · ${meals.length} 餐</span></div><div class="target"><h3>相对参考目标</h3>${r ? `<strong>${r.point >= 0 ? '与目标相差' : '已记录量高于'} ${num(Math.abs(r.point))} kcal</strong><p>参考目标减已记录量：${num(r.low)} 至 ${num(r.high)} kcal</p><p>参考目标 ${num(target)} kcal · 由你手动设定</p>` : `<strong>${target == null ? '等待资料与目标' : '等待餐食记录'}</strong><p>${target == null ? '先补充公式资料与活动水平，再自行设置参考目标。' : '添加餐食后再比较，未记录不会当作零摄入。'}</p><button class="text-button" data-view="profile">查看资料 ${icon('arrow')}</button>`}<small>${status === 'complete' ? '' : '当前为部分已记录量，不能当作全天摄入。'}估算有误差。今天的记录不需要用明天的少吃来补偿。</small></div></section>`; }
function today() { const rows = state.meals.filter(m => m.date === selected); return `${summary()}<section><div class="section-head"><h2>餐食日记</h2><button class="primary" id="add-meal">${icon('plus')}记录餐食</button></div>${mealRows(rows)}<div class="completeness"><label for="complete">当天记录状态</label><select id="complete"><option value="recording">记录中</option><option value="complete">完整：餐食与饮料均已记录</option><option value="partial">部分：存在遗漏</option></select></div></section><section class="weight-preview"><div><h2>每日体重</h2><p>看连续变化，允许自然波动。</p></div>${weightForm()}<button class="text-button" data-view="trend">查看趋势 ${icon('arrow')}</button></section>`; }
function weightForm() { const weight = state.weights.find(w => w.date === selected); return `<form id="weight-form"><label for="weight">${selected} 的体重（kg）</label><div class="inline"><input id="weight" name="kg" type="number" step="0.1" min="30" max="350" required placeholder="例如 72.1" value="${weight?.kg ?? ''}"><button class="primary" type="submit">${weight ? '更新' : '保存'}</button></div></form>`; }
function trend() { const end = selected, avg = movingAverage(state.weights, end), count = state.weights.filter(w => w.date >= shiftDate(end, -6) && w.date <= end).length; return `<section><div class="section-head"><h2>体重趋势</h2><div class="segmented" aria-label="趋势时间范围">${[7, 30].map(days => `<button data-trend-days="${days}" aria-pressed="${trendDays === days}">${days} 天</button>`).join('')}</div></div><div class="trend-title"><strong>${avg == null ? '—' : avg.toFixed(1)} <small>kg</small></strong><span>7 日平均 · ${count}/7 天有称重</span></div>${chart(state.weights, end)}<p class="muted">平均只使用已记录的称重。缺失日期不会补造称重；单日变化不能判断脂肪变化。</p>${weightForm()}<h3 class="space-top">原始记录</h3><div class="data-list">${state.weights.slice().sort((a, b) => b.date.localeCompare(a.date)).map(w => `<div><time>${e(w.date)}</time><b>${w.kg.toFixed(1)} kg</b><button class="text-button" data-weight-date="${w.date}">编辑</button></div>`).join('') || '<p class="muted">还没有称重记录。</p>'}</div></section>`; }
function history() { const dates = [...new Set([...state.meals.map(m => m.date), ...state.weights.map(w => w.date), ...Object.keys(state.completeness || {})])].sort().reverse(); return `<section><h2>记录历史</h2><p class="muted">完整度来自你的确认；未记录的日期与餐食不会计为零。</p><div class="history-list">${dates.length ? dates.map(date => { const meals = state.meals.filter(m => m.date === date), t = totals(meals), w = state.weights.find(w => w.date === date); return `<button data-date="${date}"><span><strong>${date}</strong><small>${{ complete: '完整', partial: '部分', recording: '记录中' }[state.completeness?.[date] || 'recording']} · ${meals.length} 餐</small></span><span>${meals.length ? `${num(t.kcal)} kcal` : '摄入未记录'}<small>${meals.length ? `${num(t.low)}–${num(t.high)} kcal` : ''}${w ? ` · ${w.kg} kg` : ''}</small></span>${icon('arrow')}</button>`; }).join('') : '<div class="empty">还没有记录。可从今日开始。</div>'}</div></section>`; }
function profile() { const p = state.profile, en = energy(p); return `<section><h2>个人资料与参考目标</h2>${state.metadata?.goalWeightKg ? `<p class="muted">你记录的目标体重：${e(state.metadata.goalWeightKg)} kg${state.metadata.bodyFatPct ? ` · 自报体脂约 ${e(state.metadata.bodyFatPct)}%` : ""}。体脂估计不参与静息公式。</p>` : ""}<p class="muted">资料保存在你的私人日记。参考目标由你决定，不自动调整。</p><form id="profile-form" class="form-grid"><label>年龄（18 岁及以上）<input name="age" type="number" min="18" max="100" value="${p.age ?? ''}" placeholder="未填写"></label><label>公式使用的生理性别<select name="sex"><option value="">未选择</option><option value="male">男性公式</option><option value="female">女性公式</option></select></label><label>身高（cm）<input name="heightCm" type="number" min="100" max="250" step="0.1" value="${p.heightCm ?? ''}"></label><label>公式参考体重（kg）<input name="weightKg" type="number" min="30" max="350" step="0.1" value="${p.weightKg ?? ''}"></label><label class="full">活动水平<select name="activity"><option value="">未选择</option><option value="sedentary">久坐 · 1.2</option><option value="light">轻度活动 · 1.375</option><option value="moderate">中等活动 · 1.55</option><option value="high">高度活动 · 1.725</option></select></label><label class="full">你设置的每日参考目标（kcal，可留空）<input name="targetKcal" type="number" min="500" max="6000" value="${p.targetKcal ?? ''}"><small>保存后从下方的生效日期开始，历史目标版本保留。资料不全时不显示个性化目标。数值范围是校验，不是推荐。</small></label><label class="full">参考目标生效日期<input name="effectiveDate" type="date" value="${selected}" required></label><label class="full">记录时区<input name="timezone" value="${e(state.timezone)}" required><small>例如 Asia/Shanghai。已有记录的日期不会随时区改变重分配。</small></label><button class="primary full">保存资料</button></form><div class="explanation"><h3>静息代谢 ≠ 每日摄入目标</h3>${en ? `<p>估算静息代谢 <b>约 ${num(en.ree)} kcal/日</b>；活动系数下的维持消耗 <b>约 ${num(en.maintenance)} kcal/日</b>。</p>` : '<p>年龄、公式生理性别、身高、体重、活动水平齐全后，才显示完整估算。</p>'}<p>Mifflin–St Jeor 预测静息能量消耗（REE），并非实测基础代谢（BMR）。公式：10 × kg + 6.25 × cm − 5 × 年龄，男性 +5，女性 −161。活动系数只是粗略估计，已包含活动，不再叠加运动消耗。摄入目标需另行确定，不会根据某一天的记录自动调整。</p><a href="https://pubmed.ncbi.nlm.nih.gov/2305711/" target="_blank" rel="noopener noreferrer">查看原始研究</a></div></section><section><h2>目标版本</h2><div class="data-list">${(state.budgets || []).slice().reverse().map(b => `<div><time>${b.effectiveDate}</time><span>${b.targetKcal == null ? '未设置' : num(b.targetKcal) + ' kcal'}</span></div>`).join('') || '<p class="muted">尚未设置参考目标。</p>'}</div></section>${dataTools()}`; }
function dataTools() { return `<section><h2>数据与隐私</h2><p>私人 Sites 存储 · 使用 ChatGPT 登录。你可以在聊天中请 dot 整理并更新记录。</p><p class="muted">记录和照片保存在私人网站存储中，浏览器不是记录的唯一来源。导出的文件包含敏感记录，请保存在你认可的私有位置。</p><div class="actions"><button id="export" class="secondary">导出记录</button><label class="secondary file-label">导入 JSON<input id="import" type="file" accept="application/json,.json"></label><label class="secondary file-label">恢复备份<input id="restore" type="file" accept="application/json,.json"></label></div><details class="destructive"><summary>清空当前日记</summary><p>此操作会移除当前记录、资料与参考目标。请先导出备份。</p><button id="blank" class="secondary">清空并重新开始</button></details><details><summary>如何接收 dot 整理的记录</summary><p>你在聊天中发送餐食照片或体重，dot 复核日期、份量与估算依据，更新这份私人日记。发布更新后，网站会在你打开或刷新时合并记录；稳定 ID 和更新时间防止重复。你也可直接在网站修改或导入 JSON。</p><p>dot 会确认更新是否已发布。首次打开后存入私人记录库；不会按时自动更新，也不会在你没发送记录时推测今天吃了什么。</p></details><h3 class="space-top">餐厅官方营养来源</h3><p class="muted">选择与你的国家、产品和份量相匹配的来源；官方标准配方与实际用油、酱料或加料分开记录。</p><a href="https://www.mcdonalds.com/us/en-us/about-our-food/nutrition-calculator.html" target="_blank" rel="noopener noreferrer">McDonald’s 美国 · 官方营养计算器</a><br><a href="https://www.mcdonalds.com/us/en-us/mcdonalds-app/nutrition.html" target="_blank" rel="noopener noreferrer">McDonald’s 美国 · 营养资料说明</a></section>`; }
function mealForm() { const m = editing === 'new' ? { slot: '早餐', title: '', portion: '', oil: '', kcal: '', low: '', high: '', confidence: '低', source: '照片估算 · 待确认', sourceUrl: '', notes: '', photo: '', region: '', retrievedAt: '', servings: 1, eatenFraction: 1, baseKcal: '', customizationKcal: 0 } : state.meals.find(m => m.id === editing); return `<section class="editor"><div class="section-head"><h2>${editing === 'new' ? '记录餐食' : '餐食详情'}</h2><button id="cancel" class="secondary">返回</button></div><p class="muted">${selected} · 最先确认最大的不确定因素，例如饭量、用油或酱料。</p><form id="meal-form" class="form-grid"><label>餐次<select name="slot">${['早餐', '午餐', '晚餐', '加餐'].map(v => `<option ${v === m.slot ? 'selected' : ''}>${v}</option>`).join('')}</select></label><label>餐食名称<input name="title" maxlength="150" required value="${e(m.title)}"></label><label class="full">份量 / 重量<input name="portion" maxlength="500" value="${e(m.portion)}" placeholder="例如米饭 150 g，鸡肉 120 g"></label><label class="full">用油、酱料与其他不确定因素<input name="oil" maxlength="500" value="${e(m.oil)}" placeholder="例如油约 5–15 g；酱汁量待确认"></label><div class="three full">${[['low', '估算下限'], ['kcal', '中心估算'], ['high', '估算上限']].map(([key, label]) => `<label>${label}（kcal）<input name="${key}" type="number" min="0" max="10000" required value="${m[key]}"></label>`).join('')}</div><label>估算置信度<select name="confidence">${['低', '中', '高'].map(v => `<option ${v === m.confidence ? 'selected' : ''}>${v}</option>`).join('')}</select><label>来源地区<input name="region" maxlength="100" value="${e(m.region)}" placeholder="例如中国大陆 / 美国"></label><label class="full">来源 / 估算依据<input name="source" maxlength="500" value="${e(m.source)}"></label><label class="full">官方或参考来源链接<input name="sourceUrl" type="url" maxlength="1000" value="${e(m.sourceUrl)}" placeholder="https://"></label><label>来源核查日期<input name="retrievedAt" type="date" value="${e(m.retrievedAt)}"></label><label>标示份数<input name="servings" type="number" min="0.01" max="100" step="0.01" value="${m.servings}"></label><label>实际食用比例（0–1）<input name="eatenFraction" type="number" min="0" max="1" step="0.01" value="${m.eatenFraction}"></label><label>标准餐 / 基础热量（kcal）<input name="baseKcal" type="number" min="0" max="10000" value="${m.baseKcal ?? ''}"></label><label>额外配料估算（kcal）<input name="customizationKcal" type="number" min="0" max="10000" value="${m.customizationKcal}"></label><p class="full muted">基础值、份数与食用比例用于保留依据；不会替代上方已复核的中心估算。区间由真实份量与用油假设决定，不是统计置信区间。</p><label class="full">餐食照片（私人存储）<input id="photo" type="file" accept="image/jpeg,image/png,image/webp"><small>最多 3 MB；缩小后保存到私人网站，移除原文件元数据。</small></label><output id="chosen-photo" class="full" aria-live="polite"></output>${m.sourceUrl ? `<a class="full" href="${e(m.sourceUrl)}" target="_blank" rel="noopener noreferrer">打开参考来源</a>` : ''}${m.photo ? `<img class="photo-preview full" src="${e(m.photo)}" alt="餐食照片"><label class="full"><input type="checkbox" name="removePhoto">移除照片</label>` : ''}<label class="full">备注<textarea name="notes" maxlength="1000">${e(m.notes)}</textarea></label><button class="primary full" type="submit">保存餐食</button>${editing !== 'new' ? '<button id="delete-meal" class="text-button full" type="button">删除这条餐食</button>' : ''}</form></section>`; }
function render() {
    document.querySelector('#app').innerHTML = `<aside><a class="brand" href="#today">${icon('leaf')}食日<span>饮食与体重记录</span></a><nav aria-label="主导航">${[['today', '今日'], ['trend', '趋势'], ['history', '历史'], ['profile', '资料']].map(([v, label]) => `<button data-view="${v}" ${view === v ? 'aria-current="page"' : ''}>${icon(v)}<span>${label}</span></button>`).join('')}</nav><div class="sidebar-note">留意身体的节奏<br>每次记录，都可以修正。</div></aside><main><a class="skip-link" href="#surface">跳到记录内容</a><header><div><h1>${{ today: '今天，慢慢记录', trend: '看一段时间的变化', history: '让记录有迹可循', profile: '按你的节奏设置' }[view]}</h1><p>${state.demo ? '合成示例 · 非个人健康记录' : '私人日记 · 登录后跨设备查看'}</p></div><label class="date-picker"><span>记录日期</span><input id="date" type="date" value="${selected}" required></label></header><div class="sync-bar"><span id="connection-status" role="status">已读取 · ${e(lastLoaded)}</span><button id="refresh" class="text-button">刷新记录</button></div><div class="date-actions"><button data-step="-1" class="secondary" aria-label="前一天">前一天</button><button id="go-today" class="secondary">回到今天</button><button data-step="1" class="secondary" aria-label="后一天">后一天</button><span>${e(state.timezone)}</span></div>${syncWarning ? `<div class="notice" role="alert">${e(syncWarning)}</div>` : ''}<div class="privacy-strip">${icon('leaf')}<span>${state.demo ? '你正在浏览合成示例。开始个人记录前，请在资料页新建空白日记。' : '仅你可访问。聊天更新发布后，刷新即可查看最新记录。'}</span></div>${notice ? `<div id="operation-notice" class="notice" role="status">${e(notice)}</div>` : ''}<div id="surface">${editing ? mealForm() : ({ today, trend, history, profile }[view])()}</div><footer>记录是观察，不是评分。 <span>${e(state.timezone)}</span></footer></main>`;
    bind();
    if (!editing && view === 'today')
        document.querySelector('#complete').value = state.completeness?.[selected] || 'recording';
    if (!editing && view === 'profile') {
        document.querySelector('[name=sex]').value = state.profile.sex || '';
        document.querySelector('[name=activity]').value = state.profile.activity || '';
    }
}
function handle(fn) { return async (event) => { try {
    await fn(event);
}
catch (error) {
    notify(error.message, true);
} }; }
async function readPhoto(file) { if (!['image/jpeg', 'image/png', 'image/webp'].includes(file.type) || file.size > 3 * 1024 * 1024)
    throw new Error('请选择 3 MB 以内的 JPEG、PNG 或 WebP 照片。'); const bitmap = await createImageBitmap(file), canvas = document.createElement('canvas'), scale = Math.min(1, 1000 / Math.max(bitmap.width, bitmap.height)); canvas.width = Math.round(bitmap.width * scale); canvas.height = Math.round(bitmap.height * scale); canvas.getContext('2d').drawImage(bitmap, 0, 0, canvas.width, canvas.height); bitmap.close(); return canvas.toDataURL('image/jpeg', .72); }
function bind() {
    document.querySelectorAll('form').forEach(form => form.addEventListener('input', () => { dirty = true; }));
    document.querySelectorAll('[data-view]').forEach(b => b.onclick = () => navigate(() => { view = b.dataset.view; editing = null; }));
    document.querySelector('.brand').onclick = ev => { ev.preventDefault(); navigate(() => { view = 'today'; editing = null; }); };
    document.querySelector('#date').onchange = handle(ev => { const date = ev.target.value; if (!validDate(date))
        throw new Error('请选择有效日期'); navigate(() => { selected = date; editing = null; }); ev.target.value = selected; });
    document.querySelectorAll('[data-step]').forEach(b => b.onclick = () => navigate(() => { selected = shiftDate(selected, Number(b.dataset.step)); editing = null; }));
    document.querySelector('#go-today').onclick = () => navigate(() => { selected = dateKey(new Date(), state.timezone); view = 'today'; editing = null; });
    document.querySelector('#refresh').onclick = handle(async () => { if (busy)
        return; if (dirty && !confirm('刷新会放弃当前未保存的输入，请先复制需要保留的内容。继续刷新？'))
        return; lock(true); try {
        const result = await requestJSON('/api/journal', { cache: 'no-store' });
        state = result.state;
        revision = result.revision;
        syncWarning = result.syncWarning || '';
        dirty = false;
        editing = null;
        lastLoaded = new Date().toLocaleTimeString('zh-CN', { hour: '2-digit', minute: '2-digit', timeZone: state.timezone });
        notice = '已读取最新私人记录。';
        render();
    }
    finally {
        lock(false);
    } });
    document.querySelectorAll('[data-trend-days]').forEach(b => b.onclick = () => navigate(() => { trendDays = Number(b.dataset.trendDays); }));
    document.querySelectorAll('[data-edit]').forEach(b => b.onclick = () => navigate(() => { editing = b.dataset.edit; }));
    document.querySelector('#add-meal')?.addEventListener('click', () => navigate(() => { editing = 'new'; }));
    document.querySelector('#cancel')?.addEventListener('click', () => navigate(() => { editing = null; }));
    document.querySelector('#complete')?.addEventListener('change', handle(async (ev) => { const status = ev.target.value; const ok = await persist({ ...state, completeness: { ...state.completeness, [selected]: status }, completenessUpdatedAt: { ...state.completenessUpdatedAt, [selected]: new Date().toISOString() } }, '已更新当天记录状态。'); if (!ok)
        ev.target.value = state.completeness?.[selected] || 'recording'; }));
    document.querySelector('#weight-form')?.addEventListener('submit', handle(async (ev) => { ev.preventDefault(); const old = state.weights.find(w => w.date === selected), row = validateWeight({ id: old?.id || crypto.randomUUID(), date: selected, kg: Number(new FormData(ev.target).get('kg')), updatedAt: new Date().toISOString() }); await persist({ ...state, weights: [...state.weights.filter(w => w.id !== row.id), row] }, '体重已保存。'); }));
    document.querySelectorAll('[data-date]').forEach(b => b.onclick = () => navigate(() => { selected = b.dataset.date; view = 'today'; editing = null; }));
    document.querySelectorAll('[data-weight-date]').forEach(b => b.onclick = () => { navigate(() => { selected = b.dataset.weightDate; }); document.querySelector('#weight')?.focus(); });
    document.querySelector('#profile-form')?.addEventListener('submit', handle(async (ev) => { ev.preventDefault(); const form = new FormData(ev.target), p = {}; for (const key of ['age', 'heightCm', 'weightKg', 'targetKcal'])
        p[key] = form.get(key) === '' ? null : Number(form.get(key)); p.sex = form.get('sex') || null; p.activity = form.get('activity') || null; const timezone = form.get('timezone').trim(); dateKey(new Date(), timezone); const effectiveDate = form.get('effectiveDate'); if (!validDate(effectiveDate))
        throw new Error('请选择有效的目标生效日期'); const profile = validateProfile(p), budgets = [...(state.budgets || [])]; if (profile.targetKcal !== budgetFor(budgets, effectiveDate))
        budgets.push({ id: crypto.randomUUID(), effectiveDate, targetKcal: profile.targetKcal, updatedAt: new Date().toISOString() }); await persist({ ...state, profile, timezone, budgets }, '资料已保存。参考目标按生效日期保留版本。'); }));
    document.querySelector('#photo')?.addEventListener('change',handle(async ev=>{const file=ev.target.files[0],preview=document.querySelector('#chosen-photo');preview.replaceChildren();if(!file)return;try{const img=document.createElement('img');img.className='photo-preview';img.alt='即将保存的餐食照片预览';img.src=await readPhoto(file);preview.append(img);}catch(error){ev.target.value='';throw error;}}));
    document.querySelector('#meal-form')?.addEventListener('submit', handle(async (ev) => { ev.preventDefault(); if (busy)
        return; const f = new FormData(ev.target), old = state.meals.find(m => m.id === editing), row = Object.fromEntries(f); for (const key of ['kcal', 'low', 'high', 'servings', 'eatenFraction', 'customizationKcal'])
        row[key] = Number(row[key]); row.baseKcal = row.baseKcal === '' ? row.kcal : Number(row.baseKcal); row.id = old?.id || crypto.randomUUID(); row.date = old?.date || selected; row.updatedAt = new Date().toISOString(); row.sourceMessageId = old?.sourceMessageId || ''; row.photo = f.get('removePhoto') ? '' : old?.photo || ''; const meal = validateMeal(row); const file = document.querySelector('#photo').files[0]; lock(true); try {
        if (file)
            meal.photo = await uploadPhoto(await readPhoto(file));
        await persist({ ...state, meals: [...state.meals.filter(m => m.id !== meal.id), meal] }, '餐食已保存。估算可随时修正。', () => { editing = null; });
    }
    finally {
        lock(false);
    } }));
    document.querySelector('#delete-meal')?.addEventListener('click', handle(async () => { if (confirm('删除当前餐食记录？历史修订保留。')) {
        const id = editing;
        await persist({ ...state, meals: state.meals.filter(m => m.id !== id) }, '餐食已删除。', () => { editing = null; });
    } }));
    document.querySelector('#export')?.addEventListener('click', handle(async () => { if (busy)
        return; lock(true); try {
        const exported = structuredClone(state);
        for (const meal of exported.meals) {
            if (meal.photo)
                meal.photo = await photoData(meal.photo);
        }
        const blob = new Blob([JSON.stringify(exported, null, 2)], { type: 'application/json' }), url = URL.createObjectURL(blob), a = document.createElement('a');
        a.href = url;
        a.download = `shiri-${dateKey(new Date(), state.timezone)}.local.json`;
        a.click();
        setTimeout(() => URL.revokeObjectURL(url), 1000);
        notify('备份已生成，包含私人记录与照片，请妥善保存。');
    }
    finally {
        lock(false);
    } }));
    document.querySelector('#import')?.addEventListener('change', handle(async (ev) => { const file = ev.target.files[0]; if (!file || busy)
        return; lock(true); try {
        if (file.size > 8 * 1024 * 1024)
            throw new Error('文件超过 8 MB，请分批导入。');
        const result = await prepareImport(state, JSON.parse(await file.text()), photoData);
        if (!confirm(`导入预览：新增 ${result.report.added} 条，更新 ${result.report.updated} 条，跳过 ${result.report.skipped} 条。资料与参考目标不变。继续？`))
            return;
        await materializePhotos(result.state.meals);
        await persist(result.state, `导入完成：新增 ${result.report.added}，更新 ${result.report.updated}，跳过 ${result.report.skipped}。`);
    }
    finally {
        lock(false);
        ev.target.value = '';
    } }));
    document.querySelector('#restore')?.addEventListener('change', handle(async (ev) => { const file = ev.target.files[0]; if (!file || busy)
        return; lock(true); try {
        if (file.size > 8 * 1024 * 1024)
            throw new Error('备份超过 8 MB，请减少照片后重试。');
        const raw = JSON.parse(await file.text()), checked = validateEnvelope(raw);
        if (!checked.profile)
            throw new Error('备份缺少个人资料，请使用导入记录。');
        if (!confirm('恢复会替换当前所有记录、照片、资料与目标版本。已先备份现有日记，并确认文件来源可信？'))
            return;
        await materializePhotos(checked.meals);
        await persist({ ...checked, metadata: raw.metadata || {}, demo: false }, '已恢复备份。', () => { selected = dateKey(new Date(), state.timezone); });
    }
    finally {
        lock(false);
        ev.target.value = '';
    } }));
    document.querySelector('#blank')?.addEventListener('click', handle(async () => { if (confirm('清空会移除当前记录、资料与目标。已导出备份，并确定重新开始？'))
        await persist({ version: VERSION, timezone: state.timezone, demo: false, profile: { ...EMPTY_PROFILE }, meals: [], weights: [], budgets: [], completeness: {} }, '当前日记已清空。'); }));
}
async function photoData(path) { const response = await fetch(path, { cache: 'no-store', signal: AbortSignal.timeout(30000) }); if (!response.ok || !response.headers.get('content-type')?.startsWith('image/'))
    throw new Error('照片读取失败，请重新登录或稍后重试。'); const blob = await response.blob(); return new Promise((resolve, reject) => { const reader = new FileReader(); reader.onload = () => resolve(reader.result); reader.onerror = () => reject(new Error('照片读取失败。')); reader.readAsDataURL(blob); }); }
const uploadedPhotos = new Map();
async function uploadPhoto(encoded) { if (uploadedPhotos.has(encoded))
    return uploadedPhotos.get(encoded); const blob = await (await fetch(encoded)).blob(), result = await requestJSON('/api/photos', { method: 'POST', headers: { 'Content-Type': blob.type }, body: blob }); uploadedPhotos.set(encoded, result.photo); return result.photo; }
async function materializePhotos(meals) { for (const meal of meals)
    if (meal.photo?.startsWith('data:'))
        meal.photo = await uploadPhoto(meal.photo); }
window.addEventListener('beforeunload', ev => { if (dirty || busy) {
    ev.preventDefault();
    ev.returnValue = '';
} });
async function start() { try {
    const result = await requestJSON('/api/journal', { cache: 'no-store' });
    state = result.state;
    revision = result.revision;
    syncWarning = result.syncWarning || '';
    selected = dateKey(new Date(), state.timezone);
    lastLoaded = new Date().toLocaleTimeString('zh-CN', { hour: '2-digit', minute: '2-digit', timeZone: state.timezone });
    render();
}
catch (error) {
    document.querySelector('#app').innerHTML = `<main><h1>食日</h1><p role="alert">${e(error.message)}</p><div class="actions"><a href="/signin-with-chatgpt?return_to=%2F">使用 ChatGPT 登录</a><button id="retry" class="secondary">重新读取</button></div><p>已有记录不会被示例覆盖。</p></main>`;
    document.querySelector('#retry').onclick = () => start();
} }
start();
