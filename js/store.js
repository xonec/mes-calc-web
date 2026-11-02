// 本地存储：历史记录 + 产品参数（localStorage，仅保存在本机浏览器，不上传）
// 说明：历史按「批号」去重（同一批号再次保存覆盖旧记录），最多保留 50 条；
//      产品参数按产品编码索引，用于「可选本地产品参数」自动回填（最多 100 条）。

const RECORDS_KEY = 'mes-calc-web:records:v1'
const PRODUCTS_KEY = 'mes-calc-web:products:v1'
const MAX_RECORDS = 50
const MAX_PRODUCTS = 100

function readJSON(key, fallback) {
    try {
        const raw = localStorage.getItem(key)
        if (!raw) return fallback
        const value = JSON.parse(raw)
        return value == null ? fallback : value
    } catch (error) {
        // 存储被禁用 / 内容损坏：回退为空，不影响计算
        return fallback
    }
}

function writeJSON(key, value) {
    try {
        localStorage.setItem(key, JSON.stringify(value))
        return true
    } catch (error) {
        return false
    }
}

export function newRecordId() {
    return 'rec-' + Date.now().toString(36) + '-' + Math.random().toString(36).slice(2, 7)
}

/* ---------------- 历史记录 ---------------- */

export function loadRecords() {
    const list = readJSON(RECORDS_KEY, [])
    return Array.isArray(list) ? list.filter(item => item && item.batchNo) : []
}

export function saveRecord(record) {
    const list = loadRecords()
    const rest = list.filter(item => item.batchNo !== record.batchNo)
    const next = [record, ...rest].slice(0, MAX_RECORDS)
    const ok = writeJSON(RECORDS_KEY, next)
    return { ok, list: next }
}

export function removeRecord(id) {
    const next = loadRecords().filter(item => item.id !== id)
    writeJSON(RECORDS_KEY, next)
    return next
}

export function clearRecords() {
    try {
        localStorage.removeItem(RECORDS_KEY)
    } catch (error) {
        /* ignore */
    }
    return []
}

/* ---------------- 产品参数（可选本地档案） ---------------- */

export function loadProducts() {
    const list = readJSON(PRODUCTS_KEY, [])
    return Array.isArray(list) ? list.filter(item => item && item.code) : []
}

export function findProduct(code) {
    const target = String(code || '').trim()
    if (!target) return null
    return loadProducts().find(item => item.code === target) || null
}

/** 保存/更新一个产品的计算参数（编码、瓶/件、件/托、更新时间）。 */
export function saveProduct(product) {
    const code = String((product && product.code) || '').trim()
    if (!code) return
    const list = loadProducts().filter(item => item.code !== code)
    const next = [{
        code,
        perCase: Number(product.perCase) || 0,
        perPallet: Number(product.perPallet) || 0,
        updatedAt: new Date().toISOString()
    }, ...list].slice(0, MAX_PRODUCTS)
    writeJSON(PRODUCTS_KEY, next)
}
