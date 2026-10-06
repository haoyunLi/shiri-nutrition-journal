export const VERSION = 1;
export const EMPTY_PROFILE = { age: null, sex: null, heightCm: null, weightKg: null, activity: null, targetKcal: null };
export const ACTIVITY = { sedentary: 1.2, light: 1.375, moderate: 1.55, high: 1.725 };
const fail = message => { throw new Error(message); };
export function dateKey(value = new Date(), timezone = 'Asia/Shanghai') {
    const parts = new Intl.DateTimeFormat('en-CA', { timeZone: timezone, year: 'numeric', month: '2-digit', day: '2-digit' }).formatToParts(new Date(value));
    return ['year', 'month', 'day'].map(k => parts.find(p => p.type === k).value).join('-');
}
export function validDate(value) { if (typeof value !== 'string' || !/^\d{4}-\d{2}-\d{2}$/.test(value))
    return false; const d = new Date(value + 'T12:00:00Z'); return !isNaN(d) && d.toISOString().slice(0, 10) === value; }
export function shiftDate(date, n) { const d = new Date(date + 'T12:00:00Z'); d.setUTCDate(d.getUTCDate() + n); return d.toISOString().slice(0, 10); }
const number = (v, min, max, label, nullable = false) => { if (nullable && v === null)
    return null; if (typeof v !== 'number' || !Number.isFinite(v) || v < min || v > max)
    fail(`${label}应为 ${min}–${max} 的数字`); return v; };
const str = (v, max, label) => { if (typeof v !== 'string' || v.length > max)
    fail(`${label}格式不正确`); return v.trim(); };
const optional = (v, max, label) => str(v ?? '', max, label);
export function validateProfile(p) {
    if (!p || typeof p !== 'object')
        fail('个人资料格式不正确');
    const profile = { age: number(p.age, 18, 100, '年龄', true), sex: p.sex, heightCm: number(p.heightCm, 100, 250, '身高', true), weightKg: number(p.weightKg, 30, 350, '体重', true), activity: p.activity, targetKcal: number(p.targetKcal, 500, 6000, '手动参考目标', true) };
    if (![null, 'male', 'female'].includes(p.sex))
        fail('请选择公式使用的生理性别');
    if (p.activity !== null && !Object.hasOwn(ACTIVITY, p.activity))
        fail('活动水平不正确');
    return profile;
}
export function energy(p) {
    if ([p.age, p.sex, p.heightCm, p.weightKg, p.activity].some(v => v == null))
        return null;
    const bmr = 10 * p.weightKg + 6.25 * p.heightCm - 5 * p.age + (p.sex === 'male' ? 5 : -161);
    return { ree: Math.round(bmr), maintenance: Math.round(bmr * ACTIVITY[p.activity]) };
}
export function totals(meals) { return meals.reduce((a, m) => ({ kcal: a.kcal + m.kcal, low: a.low + m.low, high: a.high + m.high }), { kcal: 0, low: 0, high: 0 }); }
export function remaining(target, total) { return target == null ? null : { point: target - total.kcal, low: target - total.high, high: target - total.low }; }
export function movingAverage(weights, end, days = 7) { const start = shiftDate(end, 1 - days); const rows = weights.filter(w => w.date >= start && w.date <= end); return rows.length ? rows.reduce((s, w) => s + w.kg, 0) / rows.length : null; }
function identity(r) {
    const id = str(r.id, 100, '记录 ID');
    if (!/^[\w-]+$/.test(id))
        fail('记录 ID 仅允许字母、数字、下划线和连字符');
    if (!validDate(r.date))
        fail('记录日期必须为有效的 YYYY-MM-DD');
    if (typeof r.updatedAt !== 'string' || !/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}(\.\d{1,3})?(Z|[+-]\d{2}:\d{2})$/.test(r.updatedAt) || isNaN(Date.parse(r.updatedAt)))
        fail('更新时间需要 ISO 时间及明确时区');
    return { id, date: r.date, updatedAt: new Date(r.updatedAt).toISOString() };
}
export function validateMeal(r) {
    const base = identity(r);
    if (!['早餐', '午餐', '晚餐', '加餐'].includes(r.slot))
        fail('餐次不正确');
    const kcal = number(r.kcal, 0, 10000, '热量'), low = number(r.low, 0, 10000, '下限'), high = number(r.high, 0, 10000, '上限');
    if (low > kcal || kcal > high)
        fail('热量需要位于下限和上限之间');
    if (!['低', '中', '高'].includes(r.confidence))
        fail('置信度不正确');
    const sourceUrl = optional(r.sourceUrl, 1000, '来源链接');
    if (sourceUrl) {
        let url;
        try {
            url = new URL(sourceUrl);
        }
        catch {
            fail('来源链接格式不正确');
        }
        if (url.protocol !== 'https:' || url.username || url.password)
            fail('来源链接必须为无账户信息的 HTTPS 链接');
    }
    if (!str(r.title, 150, '餐食名称'))
        fail('请填写餐食名称');
    if (r.retrievedAt && !validDate(r.retrievedAt))
        fail('来源核查日期需要有效的 YYYY-MM-DD');
    const photo = optional(r.photo, 4194500, '照片');
    if (photo && !/^\/api\/photos\/[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/.test(photo) && !/^data:image\/(jpeg|png|webp);base64,[A-Za-z0-9+/]+=*$/.test(photo))
        fail('照片仅接受本地 JPEG、PNG 或 WebP 数据');
    return { ...base, slot: r.slot, title: str(r.title, 150, '餐食名称'), portion: optional(r.portion, 500, '份量'), oil: optional(r.oil, 500, '油与酱料'), kcal, low, high, confidence: r.confidence, source: optional(r.source, 500, '来源说明'), sourceUrl, notes: optional(r.notes, 1000, '备注'), photo, sourceMessageId: optional(r.sourceMessageId, 200, '消息 ID'), region: optional(r.region, 100, '地区'), retrievedAt: optional(r.retrievedAt, 100, '来源核查日期'), servings: number(r.servings ?? 1, 0.01, 100, '标示份数'), eatenFraction: number(r.eatenFraction ?? 1, 0, 1, '实际食用比例'), baseKcal: number(r.baseKcal ?? kcal, 0, 10000, '基础热量'), customizationKcal: number(r.customizationKcal ?? 0, 0, 10000, '额外配料热量') };
}
export function validateWeight(r) { return { ...identity(r), kg: number(r.kg, 30, 350, '体重') }; }
export function validateEnvelope(raw) {
    if (!raw || typeof raw !== 'object' || raw.version !== VERSION)
        fail('仅支持 version: 1 的记录文件');
    const timezone = str(raw.timezone, 100, '时区');
    try {
        dateKey(new Date(), timezone);
    }
    catch {
        fail('时区需要有效的 IANA 名称');
    }
    if (!Array.isArray(raw.meals) || !Array.isArray(raw.weights) || raw.meals.length > 5000 || raw.weights.length > 5000)
        fail('餐食与体重需为数组，每类最多 5000 条');
    const meals = raw.meals.map(validateMeal), weights = raw.weights.map(validateWeight);
    for (const rows of [meals, weights])
        if (new Set(rows.map(r => r.id)).size !== rows.length)
            fail('文件中存在重复 ID，请先合并');
    if (new Set(weights.map(r => r.date)).size !== weights.length)
        fail('同一天仅支持一条体重记录');
    const budgets = raw.budgets ?? [];
    if (!Array.isArray(budgets) || budgets.length > 1000)
        fail('目标版本格式不正确');
    const checkedBudgets = budgets.map(b => { if (!validDate(b.effectiveDate))
        fail('目标生效日期不正确'); return { id: str(b.id, 100, '目标版本 ID'), effectiveDate: b.effectiveDate, targetKcal: number(b.targetKcal, 500, 6000, '目标', true), updatedAt: identity({ id: b.id, date: b.effectiveDate, updatedAt: b.updatedAt }).updatedAt }; });
    if (new Set(checkedBudgets.map(b => b.id)).size !== checkedBudgets.length)
        fail('目标版本 ID 重复');
    const completeness = raw.completeness ?? {};
    if (!completeness || typeof completeness !== 'object' || Array.isArray(completeness) || Object.keys(completeness).length > 5000)
        fail('每日完整度格式不正确');
    for (const [date, status] of Object.entries(completeness)) {
        if (!validDate(date) || !['recording', 'complete', 'partial'].includes(status))
            fail('每日完整度格式不正确');
    }
    const completenessUpdatedAt = raw.completenessUpdatedAt ?? {};
    if (!completenessUpdatedAt || typeof completenessUpdatedAt !== 'object' || Array.isArray(completenessUpdatedAt) || Object.keys(completenessUpdatedAt).length > 5000)
        fail('完整度更新时间格式不正确');
    const stamps = {};
    for (const [date, updatedAt] of Object.entries(completenessUpdatedAt)) {
        if (!Object.hasOwn(completeness, date))
            fail('完整度更新时间缺少对应状态');
        stamps[date] = identity({ id: 'status', date, updatedAt }).updatedAt;
    }
    return { version: VERSION, timezone, meals, weights, budgets: checkedBudgets, completeness, ...(Object.keys(stamps).length ? {completenessUpdatedAt: stamps} : {}), ...(raw.profile ? { profile: validateProfile(raw.profile) } : {}) };
}
export function mergeRecords(current, incoming) {
    const next = validateEnvelope(incoming);
    if (next.timezone !== current.timezone)
        fail('导入时区与当前记录不同；请先在资料页明确选择相同的记录时区');
    let added = 0, updated = 0, skipped = 0;
    function upsert(old, rows) { const map = new Map(old.map(r => [r.id, r])); for (const row of rows) {
        const prev = map.get(row.id);
        if (!prev) {
            map.set(row.id, row);
            added++;
        }
        else if (Date.parse(row.updatedAt) > Date.parse(prev.updatedAt)) {
            map.set(row.id, row);
            updated++;
        }
        else if (Date.parse(row.updatedAt) === Date.parse(prev.updatedAt) && JSON.stringify(prev) !== JSON.stringify(row)) {
            fail(`记录 ${row.id} 有相同更新时间但内容不同；请确认后使用新的更新时间`);
        }
        else
            skipped++;
    } return [...map.values()].sort((a, b) => a.date.localeCompare(b.date) || a.id.localeCompare(b.id)); }
    const meals = upsert(current.meals, next.meals), weights = upsert(current.weights, next.weights);
    if (new Set(weights.map(w => w.date)).size !== weights.length)
        fail('已有该日期的体重记录，请沿用原记录 ID 更新');
    const completeness = { ...current.completeness }, completenessUpdatedAt = { ...current.completenessUpdatedAt };
    for (const [date, status] of Object.entries(next.completeness)) {
        const oldStamp = completenessUpdatedAt[date], stamp = next.completenessUpdatedAt?.[date];
        if (oldStamp && (!stamp || stamp < oldStamp))
            continue;
        if (oldStamp && stamp === oldStamp && completeness[date] !== status)
            fail('当天状态有相同更新时间但内容不同，请先核对');
        if (!stamp && Object.hasOwn(completeness, date))
            continue;
        completeness[date] = status;
        if (stamp)
            completenessUpdatedAt[date] = stamp;
    }
    return { state: { ...current, meals, weights, completeness, completenessUpdatedAt }, report: { added, updated, skipped } };
}
export function demoState(date = dateKey()) {
    const stamp = '2026-10-01T12:00:00Z';
    const state = { version: VERSION, timezone: 'Asia/Shanghai', demo: true, budgets: [], completeness: { [date]: 'recording' }, profile: { ...EMPTY_PROFILE }, weights: [72.4, 72.1, 72.3, 72, 72.2, 71.9, 72.1].map((kg, i) => ({ id: `demo-weight-${i}`, date: shiftDate(date, i - 6), kg, updatedAt: stamp })), meals: [
            { id: 'demo-breakfast', date, slot: '早餐', title: '燕麦、牛奶与蓝莓', portion: '燕麦 40 g · 牛奶 200 ml · 蓝莓 60 g', oil: '未添加油；牛奶种类待确认', kcal: 340, low: 300, high: 390, confidence: '中', source: '合成示例 · 按份量估算，非已核实食品数据', sourceUrl: '', notes: '照片不能确认品牌与准确重量。', photo: '', updatedAt: stamp },
            { id: 'demo-lunch', date, slot: '午餐', title: '鸡肉饭与时蔬', portion: '米饭约 150 g · 鸡肉约 120 g · 时蔬一份', oil: '烹调油约 5–15 g；酱料量不明', kcal: 620, low: 500, high: 780, confidence: '低', source: '合成示例 · 份量及用油待确认', sourceUrl: '', notes: '估算区间同时包含份量与烹调差异。', photo: '', updatedAt: stamp }
        ] };
    return { ...state, meals: state.meals.map(validateMeal), weights: state.weights.map(validateWeight) };
}
export function budgetFor(budgets, date) { return [...(budgets ?? [])].filter(b => b.effectiveDate <= date).sort((a, b) => b.effectiveDate.localeCompare(a.effectiveDate) || b.updatedAt.localeCompare(a.updatedAt))[0]?.targetKcal ?? null; }
