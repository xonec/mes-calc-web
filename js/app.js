// MES 包材计算 · 单页版逻辑
// 计算内核：js/calc.js（与 mes-uniapp/utils/calc.js 逐字节同一份，公式不做任何修改）
// 数据：历史记录 / 产品参数只写本机 localStorage，不联网、不登录、不含人员与订单数据。

import { BUCKET_KEYS, computeMaterial, computeWeightRange } from './calc.js'
import {
    newRecordId,
    loadRecords,
    saveRecord,
    removeRecord,
    clearRecords,
    findProduct,
    saveProduct
} from './store.js'

/* ---------------- 状态 ---------------- */

function emptyBuckets() {
    const buckets = {}
    BUCKET_KEYS.forEach(key => { buckets[key] = '' })
    return buckets
}

const state = {
    batchNo: '',
    productCode: '',
    buckets: emptyBuckets(),
    zeroCount: '',
    perCase: '',
    perPallet: '',
    sampleCount: '',
    labelExtra: '',
    securityExtra: '',
    bottleWeight: '',
    bottleWeightMin: '',
    boxNetWeight: '',
    boxNetWeightMin: '',
    batchStatus: 'incomplete',
    currentPallet: 1,
    materials: [],
    weightRange: '—',
    calc: null
}

/* ---------------- DOM ---------------- */

const $ = selector => document.querySelector(selector)
const $$ = selector => Array.from(document.querySelectorAll(selector))

const el = {
    productCode: $('#productCode'),
    batchNo: $('#batchNo'),
    productHint: $('#productHint'),
    buckets: $$('input[data-bucket]'),
    zeroCount: $('#zeroCount'),
    perCase: $('#perCase'),
    perPallet: $('#perPallet'),
    sampleCount: $('#sampleCount'),
    labelExtra: $('#labelExtra'),
    securityExtra: $('#securityExtra'),
    bottleWeight: $('#bottleWeight'),
    bottleWeightMin: $('#bottleWeightMin'),
    boxNetWeight: $('#boxNetWeight'),
    boxNetWeightMin: $('#boxNetWeightMin'),
    inboundCount: $('#inboundCount'),
    innerIssued: $('#innerIssued'),
    bucketCount: $('#bucketCount'),
    caseCountText: $('#caseCountText'),
    palletCode: $('#palletCode'),
    statusOptions: $('#statusOptions'),
    weightProductChip: $('#weightProductChip'),
    weightRange: $('#weightRange'),
    palletPageChip: $('#palletPageChip'),
    palletRange: $('#palletRange'),
    zeroBoxRow: $('#zeroBoxRow'),
    zeroBoxInfo: $('#zeroBoxInfo'),
    pagerButtons: $$('[data-go]'),
    materials: $$('input[data-material][data-input]'),
    usedTexts: $$('[data-used]'),
    btnSave: $('#btnSave'),
    btnHistory: $('#btnHistory'),
    btnClear: $('#btnClear'),
    btnCopy: $('#btnCopy'),
    btnExport: $('#btnExport'),
    historyMask: $('#historyMask'),
    historyList: $('#historyList'),
    historyClose: $('#historyClose'),
    historyClear: $('#historyClear'),
    confirmMask: $('#confirmMask'),
    confirmTitle: $('#confirmTitle'),
    confirmContent: $('#confirmContent'),
    confirmCancel: $('#confirmCancel'),
    confirmOk: $('#confirmOk'),
    toast: $('#toast')
}

/* ---------------- 工具函数 ---------------- */

const onlyDigits = value => String(value == null ? '' : value).replace(/[^\d]/g, '')

function onlyDecimal(value) {
    const cleaned = String(value == null ? '' : value).replace(/[^\d.]/g, '')
    const parts = cleaned.split('.')
    return parts.length <= 1 ? cleaned : parts.shift() + '.' + parts.join('')
}

function sanitizeBatchNo(value) {
    return String(value == null ? '' : value).toUpperCase().replace(/[^A-Z0-9]/g, '').slice(0, 12)
}

function sanitizeProductCode(value) {
    return String(value == null ? '' : value).toUpperCase().replace(/[^A-Z0-9]/g, '').slice(0, 10)
}

/** 只读值拆「数字 + 单位/补充」，与 App 生产数据格一致（数字 44rpx、单位 26rpx）。 */
function splitValue(value) {
    const text = String(value == null ? '' : value).trim()
    const match = text.match(/^([0-9]+(?:\.[0-9]+)?)([\s\S]*)$/)
    if (!match) return { main: text, unit: '' }
    return { main: match[1], unit: match[2].trim() }
}

function isZeroValue(value) {
    const text = String(value == null ? '' : value).trim()
    return text === '0' || /^0(?:\s|$)/.test(text)
}

function renderValue(node, value) {
    if (!node) return
    const parts = splitValue(value)
    const num = document.createElement('span')
    num.className = 'cell-num'
    num.textContent = parts.main
    node.replaceChildren(num)
    if (parts.unit) {
        const unit = document.createElement('span')
        unit.className = 'cell-unit'
        unit.textContent = parts.unit
        node.appendChild(unit)
    }
    node.classList.toggle('zero', isZeroValue(value) || parts.main === '')
}

function formatTime(iso) {
    const date = new Date(iso)
    if (!iso || Number.isNaN(date.getTime())) return ''
    const pad = n => String(n).padStart(2, '0')
    return `${pad(date.getMonth() + 1)}-${pad(date.getDate())} ${pad(date.getHours())}:${pad(date.getMinutes())}`
}

function formatStamp(date) {
    const pad = n => String(n).padStart(2, '0')
    return `${date.getFullYear()}${pad(date.getMonth() + 1)}${pad(date.getDate())}-${pad(date.getHours())}${pad(date.getMinutes())}`
}

let toastTimer = null
function showToast(message) {
    if (!el.toast) return
    el.toast.textContent = message
    el.toast.hidden = false
    clearTimeout(toastTimer)
    toastTimer = setTimeout(() => { el.toast.hidden = true }, 2400)
}

/* ---------------- 计算与渲染 ---------------- */

function calculate() {
    const result = computeMaterial({
        buckets: state.buckets,
        zeroCount: state.zeroCount,
        perCase: state.perCase,
        perPallet: state.perPallet,
        // 单页版没有订单/上托确认流程：始终按「已具备托参数」计算，与 App 无订单时一致
        palletPending: false,
        sampleCount: state.sampleCount,
        labelExtra: state.labelExtra,
        securityExtra: state.securityExtra,
        currentPallet: state.currentPallet
    })

    state.currentPallet = result.currentPallet
    state.calc = result

    // 重建包材行时保留手填的 领用/损耗/退回（按包材名匹配，同 App）
    const previous = {}
    state.materials.forEach(material => {
        previous[material.name] = {
            issued: material.issued,
            loss: material.loss,
            returned: material.returned
        }
    })
    state.materials = result.materials.map(item => {
        const manual = previous[item.name] || {}
        return {
            name: item.name,
            used: item.used,
            issued: manual.issued || '',
            loss: manual.loss || '',
            returned: manual.returned || ''
        }
    })

    state.weightRange = computeWeightRange(state.bottleWeight, state.boxNetWeight)
    return result
}

function render() {
    const r = state.calc
    if (!r) return

    renderValue(el.inboundCount, r.inboundCount)
    renderValue(el.innerIssued, r.innerIssued)
    renderValue(el.bucketCount, r.bucketCount)
    renderValue(el.caseCountText, r.caseCountText)
    renderValue(el.palletCode, r.palletCode)

    el.weightRange.textContent = state.weightRange
    el.weightProductChip.textContent = state.productCode || '未选择产品'

    el.palletPageChip.textContent = r.palletPage
    el.palletRange.textContent = r.palletRange || '暂无件号'
    const showZeroBox = !!r.zeroBoxInfo && r.currentPallet === r.totalPallets
    el.zeroBoxRow.hidden = !showZeroBox
    el.zeroBoxInfo.textContent = showZeroBox ? r.zeroBoxInfo : ''

    // 包材「实用」列
    const usedByName = {}
    state.materials.forEach(material => { usedByName[material.name] = material.used })
    el.usedTexts.forEach(node => {
        const name = node.getAttribute('data-used')
        node.textContent = usedByName[name] == null ? '0' : String(usedByName[name])
    })

    // 本批状态
    Array.from(el.statusOptions.children).forEach(button => {
        button.classList.toggle('active', button.getAttribute('data-status') === state.batchStatus)
    })

    // 托分页按钮
    el.pagerButtons.forEach(button => {
        const action = button.getAttribute('data-go')
        if (action === 'first' || action === 'prev') button.disabled = r.currentPallet <= 1
        else button.disabled = r.currentPallet >= r.totalPallets
    })
}

function recalc() {
    calculate()
    render()
}

/* ---------------- 表单回填（载入/清空时） ---------------- */

function syncInputs() {
    el.batchNo.value = state.batchNo
    el.productCode.value = state.productCode
    el.buckets.forEach(input => {
        input.value = state.buckets[input.getAttribute('data-bucket')] || ''
    })
    el.zeroCount.value = state.zeroCount
    el.perCase.value = state.perCase
    el.perPallet.value = state.perPallet
    el.sampleCount.value = state.sampleCount
    el.labelExtra.value = state.labelExtra
    el.securityExtra.value = state.securityExtra
    el.bottleWeight.value = state.bottleWeight
    el.bottleWeightMin.value = state.bottleWeightMin
    el.boxNetWeight.value = state.boxNetWeight
    el.boxNetWeightMin.value = state.boxNetWeightMin
    el.materials.forEach(input => {
        const name = input.getAttribute('data-material')
        const field = input.getAttribute('data-input')
        const material = state.materials.find(item => item.name === name)
        input.value = material ? (material[field] || '') : ''
    })
}

/* ---------------- 可选：本地产品参数（按产品编码回填空项） ---------------- */

function applyLocalProduct() {
    const code = state.productCode
    if (!code) {
        el.productHint.hidden = true
        el.productHint.textContent = ''
        return
    }
    const product = findProduct(code)
    if (!product) {
        el.productHint.hidden = true
        el.productHint.textContent = ''
        return
    }
    let filled = false
    if (!state.perCase && product.perCase) {
        state.perCase = String(product.perCase)
        el.perCase.value = state.perCase
        filled = true
    }
    if (!state.perPallet && product.perPallet) {
        state.perPallet = String(product.perPallet)
        el.perPallet.value = state.perPallet
        filled = true
    }
    const text = '本机产品参数：瓶/件 ' + (product.perCase || '—') + ' · 件/托 ' + (product.perPallet || '—')
    el.productHint.textContent = filled ? text + '（已填入空项）' : text
    el.productHint.hidden = false
}

/* ---------------- 保存 / 历史 / 清空 ---------------- */

function buildRecord() {
    const r = state.calc
    return {
        id: newRecordId(),
        savedAt: new Date().toISOString(),
        batchNo: state.batchNo,
        productCode: state.productCode,
        batchStatus: state.batchStatus,
        bottlePerCase: Number(state.perCase) || 0,
        casePerPallet: Number(state.perPallet) || 0,
        zeroCount: Number(state.zeroCount) || 0,
        sampleCount: Number(state.sampleCount) || 0,
        labelExtra: Number(state.labelExtra) || 0,
        securityExtra: Number(state.securityExtra) || 0,
        buckets: BUCKET_KEYS.reduce((acc, key) => {
            acc[key] = Number(state.buckets[key]) || 0
            return acc
        }, {}),
        weights: {
            bottleWeight: state.bottleWeight,
            bottleWeightMin: state.bottleWeightMin,
            boxNetWeight: state.boxNetWeight,
            boxNetWeightMin: state.boxNetWeightMin
        },
        materialInputs: state.materials.reduce((acc, material) => {
            acc[material.name] = {
                issued: Number(material.issued) || 0,
                loss: Number(material.loss) || 0,
                returned: Number(material.returned) || 0
            }
            return acc
        }, {}),
        // 结果快照：仅用于历史列表展示，载入后仍按输入重新计算
        summary: {
            bucketCount: r.bucketCount,
            caseCountText: r.caseCountText,
            inboundCount: r.inboundCount,
            innerIssued: r.innerIssued,
            palletCode: r.palletCode,
            totalPallets: r.totalPallets,
            currentPallet: r.currentPallet,
            weightRange: state.weightRange
        }
    }
}

function saveCurrent() {
    calculate()
    render()
    if (!state.batchNo) {
        showToast('请先填写批号')
        el.batchNo.focus()
        return
    }
    const { ok, list } = saveRecord(buildRecord())
    if (!ok) {
        showToast('保存失败：浏览器本地存储不可用')
        return
    }
    if (state.productCode) {
        saveProduct({ code: state.productCode, perCase: state.perCase, perPallet: state.perPallet })
        applyLocalProduct()
    }
    showToast('已保存到本机历史（共 ' + list.length + ' 条）')
}

function applyRecord(record) {
    state.batchNo = record.batchNo || ''
    state.productCode = record.productCode || ''
    state.batchStatus = record.batchStatus === 'complete' ? 'complete' : 'incomplete'
    state.perCase = record.bottlePerCase ? String(record.bottlePerCase) : ''
    state.perPallet = record.casePerPallet ? String(record.casePerPallet) : ''
    state.zeroCount = record.zeroCount ? String(record.zeroCount) : ''
    state.sampleCount = record.sampleCount ? String(record.sampleCount) : ''
    state.labelExtra = record.labelExtra ? String(record.labelExtra) : ''
    state.securityExtra = record.securityExtra ? String(record.securityExtra) : ''
    const weights = record.weights || {}
    state.bottleWeight = weights.bottleWeight || ''
    state.bottleWeightMin = weights.bottleWeightMin || ''
    state.boxNetWeight = weights.boxNetWeight || ''
    state.boxNetWeightMin = weights.boxNetWeightMin || ''
    BUCKET_KEYS.forEach(key => {
        const value = record.buckets ? record.buckets[key] : ''
        state.buckets[key] = value ? String(value) : ''
    })
    state.currentPallet = (record.summary && record.summary.currentPallet) || 1

    calculate()
    // 回填手填的包材领用/损耗/退回
    if (record.materialInputs) {
        state.materials.forEach(material => {
            const input = record.materialInputs[material.name]
            if (!input) return
            material.issued = input.issued ? String(input.issued) : ''
            material.loss = input.loss ? String(input.loss) : ''
            material.returned = input.returned ? String(input.returned) : ''
        })
    }
    syncInputs()
    render()
    applyLocalProduct()
}

function clearAll() {
    state.batchNo = ''
    state.productCode = ''
    state.buckets = emptyBuckets()
    state.zeroCount = ''
    state.perCase = ''
    state.perPallet = ''
    state.sampleCount = ''
    state.labelExtra = ''
    state.securityExtra = ''
    state.bottleWeight = ''
    state.bottleWeightMin = ''
    state.boxNetWeight = ''
    state.boxNetWeightMin = ''
    state.batchStatus = 'incomplete'
    state.currentPallet = 1
    state.materials = []
    calculate()
    syncInputs()
    render()
    el.productHint.hidden = true
    el.productHint.textContent = ''
    showToast('已清空当前计算')
}

function historySummary(record) {
    const summary = record.summary || {}
    const parts = []
    if (record.productCode) parts.push('产品 ' + record.productCode)
    if (summary.caseCountText) parts.push(summary.caseCountText)
    if (summary.inboundCount) parts.push(summary.inboundCount)
    if (summary.palletCode) parts.push(summary.palletCode)
    return parts.join(' · ') || '无计算结果'
}

function createHistoryItem(record) {
    const item = document.createElement('div')
    item.className = 'history-item'

    const main = document.createElement('div')
    main.className = 'history-main'
    const batch = document.createElement('span')
    batch.className = 'history-batch'
    batch.textContent = record.batchNo
    const time = document.createElement('span')
    time.className = 'history-time'
    time.textContent = formatTime(record.savedAt)
    main.append(batch, time)

    const sub = document.createElement('div')
    sub.className = 'history-sub'
    sub.textContent = historySummary(record)

    const actions = document.createElement('div')
    actions.className = 'history-actions'
    const loadButton = document.createElement('button')
    loadButton.type = 'button'
    loadButton.className = 'tool-btn load'
    loadButton.textContent = '载入'
    loadButton.addEventListener('click', () => {
        applyRecord(record)
        el.historyMask.hidden = true
        showToast('已载入历史记录')
    })
    const removeButton = document.createElement('button')
    removeButton.type = 'button'
    removeButton.className = 'tool-btn remove'
    removeButton.textContent = '删除'
    removeButton.addEventListener('click', async () => {
        const confirmed = await showConfirm({
            title: '删除该条记录',
            content: '删除批号 ' + record.batchNo + ' 的历史记录？删除后无法恢复。',
            confirmText: '删除',
            danger: true
        })
        if (!confirmed) return
        removeRecord(record.id)
        renderHistory()
        showToast('已删除')
    })
    actions.append(loadButton, removeButton)

    item.append(main, sub, actions)
    return item
}

function renderHistory() {
    const records = loadRecords()
    el.historyList.replaceChildren()
    if (!records.length) {
        const empty = document.createElement('p')
        empty.className = 'history-empty'
        empty.textContent = '暂无历史记录：计算后点「保存」即可存入本机。'
        el.historyList.appendChild(empty)
        return records
    }
    records.forEach(record => el.historyList.appendChild(createHistoryItem(record)))
    return records
}

function openHistory() {
    renderHistory()
    el.historyMask.hidden = false
}

async function clearHistory() {
    const records = loadRecords()
    if (!records.length) {
        showToast('暂无历史记录')
        return
    }
    const confirmed = await showConfirm({
        title: '清空历史记录',
        content: '将删除本机保存的全部 ' + records.length + ' 条记录，无法恢复。确认清空？',
        confirmText: '清空',
        danger: true
    })
    if (!confirmed) return
    clearRecords()
    renderHistory()
    showToast('已清空历史记录')
}

/* ---------------- 复制结果 / 导出 CSV ---------------- */

function buildCopyText() {
    const r = state.calc
    const lines = ['MES 包材计算（本机）']
    if (state.batchNo) lines.push('批号：' + state.batchNo)
    if (state.productCode) lines.push('产品编码：' + state.productCode)
    lines.push('瓶/件：' + (state.perCase || '—') + '　件/托：' + (state.perPallet || '—'))
    lines.push('每桶件数：' + BUCKET_KEYS.map(key => key + '=' + (state.buckets[key] || 0)).join(' '))
    lines.push('桶数：' + r.bucketCount + '　件数：' + r.caseCountText + '　瓶数：' + r.inboundCount)
    lines.push('托数：' + r.palletCode + '　件号：' + r.palletRange)
    lines.push('重量区间：' + state.weightRange)
    if (r.materials.length) lines.push('包材用量：' + r.materials.map(material => material.name + ' ' + material.used).join('；'))
    lines.push('本批状态：' + (state.batchStatus === 'complete' ? '已完成' : '未完成'))
    return lines.join('\n')
}

function legacyCopy(text) {
    const textarea = document.createElement('textarea')
    textarea.value = text
    textarea.setAttribute('readonly', '')
    textarea.style.position = 'fixed'
    textarea.style.top = '-1000px'
    textarea.style.opacity = '0'
    document.body.appendChild(textarea)
    textarea.select()
    const ok = document.execCommand('copy')
    document.body.removeChild(textarea)
    if (!ok) throw new Error('copy failed')
}

async function copyResult() {
    const text = buildCopyText()
    try {
        if (navigator.clipboard && typeof navigator.clipboard.writeText === 'function') {
            await navigator.clipboard.writeText(text)
        } else {
            legacyCopy(text)
        }
        showToast('已复制计算结果')
    } catch (error) {
        try {
            legacyCopy(text)
            showToast('已复制计算结果')
        } catch (fallbackError) {
            showToast('复制失败，请长按手动记录')
        }
    }
}

function csvCell(value) {
    const text = value == null ? '' : String(value)
    return /[",\r\n]/.test(text) ? '"' + text.replace(/"/g, '""') + '"' : text
}

function buildCSV() {
    const r = state.calc
    const rows = [
        ['批号', state.batchNo],
        ['产品编码', state.productCode],
        ['瓶/件', state.perCase],
        ['件/托', state.perPallet],
        ['每桶件数', BUCKET_KEYS.map(key => key + '=' + (state.buckets[key] || 0)).join(' ')],
        ['桶数', r.bucketCount],
        ['件数', r.caseCountText],
        ['入库瓶数', r.inboundCount],
        ['领用内包数', r.innerIssued],
        ['取样数', state.sampleCount],
        ['托数', r.palletCode],
        ['件号', r.palletRange],
        ['重量区间', state.weightRange],
        ['本批状态', state.batchStatus === 'complete' ? '已完成' : '未完成'],
        [],
        ['包材', '领用', '实用', '损耗', '退回']
    ]
    state.materials.forEach(material => {
        rows.push([material.name, material.issued, material.used, material.loss, material.returned])
    })
    return rows.map(row => row.map(csvCell).join(',')).join('\r\n')
}

function exportCSV() {
    const csv = '\uFEFF' + buildCSV()
    const blob = new Blob([csv], { type: 'text/csv;charset=utf-8' })
    const url = URL.createObjectURL(blob)
    const link = document.createElement('a')
    link.href = url
    link.download = 'MES包材计算_' + (state.batchNo || '未命名') + '_' + formatStamp(new Date()) + '.csv'
    link.rel = 'noopener'
    document.body.appendChild(link)
    link.click()
    document.body.removeChild(link)
    setTimeout(() => URL.revokeObjectURL(url), 1000)
    showToast('已导出 CSV')
}

/* ---------------- 确认弹层 ---------------- */

let confirmResolver = null

function showConfirm({ title, content, confirmText = '确定', danger = false }) {
    el.confirmTitle.textContent = title
    el.confirmContent.textContent = content
    el.confirmOk.textContent = confirmText
    el.confirmOk.classList.toggle('danger', danger)
    el.confirmMask.hidden = false
    return new Promise(resolve => { confirmResolver = resolve })
}

function closeConfirm(result) {
    el.confirmMask.hidden = true
    const resolver = confirmResolver
    confirmResolver = null
    if (resolver) resolver(result)
}

/* ---------------- 事件绑定 ---------------- */

function bindNumberInput(input, key, options = {}) {
    if (!input) return
    input.addEventListener('input', () => {
        const cleaned = options.decimal ? onlyDecimal(input.value) : onlyDigits(input.value)
        if (input.value !== cleaned) input.value = cleaned
        state[key] = cleaned
        recalc()
    })
}

function bindEvents() {
    // 批号 / 产品编码
    el.batchNo.addEventListener('input', () => {
        const cleaned = sanitizeBatchNo(el.batchNo.value)
        if (el.batchNo.value !== cleaned) el.batchNo.value = cleaned
        state.batchNo = cleaned
    })
    el.productCode.addEventListener('input', () => {
        const cleaned = sanitizeProductCode(el.productCode.value)
        if (el.productCode.value !== cleaned) el.productCode.value = cleaned
        state.productCode = cleaned
        el.weightProductChip.textContent = cleaned || '未选择产品'
        applyLocalProduct()
        recalc()
    })

    // 分桶 A–J
    el.buckets.forEach(input => {
        const key = input.getAttribute('data-bucket')
        input.addEventListener('input', () => {
            const cleaned = onlyDigits(input.value)
            if (input.value !== cleaned) input.value = cleaned
            state.buckets[key] = cleaned
            recalc()
        })
    })

    bindNumberInput(el.zeroCount, 'zeroCount')
    bindNumberInput(el.perCase, 'perCase')
    bindNumberInput(el.perPallet, 'perPallet')
    bindNumberInput(el.sampleCount, 'sampleCount')
    bindNumberInput(el.labelExtra, 'labelExtra')
    bindNumberInput(el.securityExtra, 'securityExtra')
    bindNumberInput(el.bottleWeight, 'bottleWeight', { decimal: true })
    bindNumberInput(el.bottleWeightMin, 'bottleWeightMin', { decimal: true })
    bindNumberInput(el.boxNetWeight, 'boxNetWeight', { decimal: true })
    bindNumberInput(el.boxNetWeightMin, 'boxNetWeightMin', { decimal: true })

    // 包材明细：领用 / 损耗 / 退回（只记录，不参与自动计算）
    el.materials.forEach(input => {
        const name = input.getAttribute('data-material')
        const field = input.getAttribute('data-input')
        input.addEventListener('input', () => {
            const cleaned = onlyDigits(input.value)
            if (input.value !== cleaned) input.value = cleaned
            const material = state.materials.find(item => item.name === name)
            if (material) material[field] = cleaned
        })
    })

    // 本批状态 seg
    el.statusOptions.addEventListener('click', event => {
        const button = event.target.closest('[data-status]')
        if (!button) return
        state.batchStatus = button.getAttribute('data-status') === 'complete' ? 'complete' : 'incomplete'
        render()
    })

    // 卡内三键
    el.btnSave.addEventListener('click', saveCurrent)
    el.btnHistory.addEventListener('click', openHistory)
    el.btnClear.addEventListener('click', async () => {
        const hasInput = !!state.batchNo || !!state.productCode ||
            Object.values(state.buckets).some(value => value) || !!state.perCase || !!state.perPallet
        if (!hasInput) {
            showToast('当前没有可清空的内容')
            return
        }
        const confirmed = await showConfirm({
            title: '清空当前计算',
            content: '清空后批号、桶数与参数归零，已保存的历史记录不受影响。确认清空？',
            confirmText: '清空',
            danger: true
        })
        if (confirmed) clearAll()
    })

    // 复制 / 导出
    el.btnCopy.addEventListener('click', copyResult)
    el.btnExport.addEventListener('click', exportCSV)

    // 托分页
    el.pagerButtons.forEach(button => {
        button.addEventListener('click', () => {
            const r = state.calc
            const action = button.getAttribute('data-go')
            if (action === 'first') state.currentPallet = 1
            else if (action === 'prev') state.currentPallet = Math.max(1, state.currentPallet - 1)
            else if (action === 'next') state.currentPallet = Math.min(r.totalPallets, state.currentPallet + 1)
            else if (action === 'last') state.currentPallet = r.totalPallets
            recalc()
        })
    })

    // 卡片折叠
    $$('[data-toggle]').forEach(head => {
        head.addEventListener('click', () => {
            const card = head.closest('.card')
            const collapsed = card.classList.toggle('collapsed')
            head.setAttribute('aria-expanded', String(!collapsed))
        })
    })

    // 历史弹层
    el.historyClose.addEventListener('click', () => { el.historyMask.hidden = true })
    el.historyClear.addEventListener('click', clearHistory)
    el.historyMask.addEventListener('click', event => {
        if (event.target === el.historyMask) el.historyMask.hidden = true
    })

    // 确认弹层
    el.confirmCancel.addEventListener('click', () => closeConfirm(false))
    el.confirmOk.addEventListener('click', () => closeConfirm(true))
    el.confirmMask.addEventListener('click', event => {
        if (event.target === el.confirmMask) closeConfirm(false)
    })

    // Esc 关闭弹层
    document.addEventListener('keydown', event => {
        if (event.key !== 'Escape') return
        if (!el.confirmMask.hidden) { closeConfirm(false); return }
        if (!el.historyMask.hidden) el.historyMask.hidden = true
    })
}

/* ---------------- 初始化 ---------------- */

function init() {
    bindEvents()
    calculate()
    syncInputs()
    render()
    applyLocalProduct()
}

init()
