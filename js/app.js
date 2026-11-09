// MES 包材计算 · 单页版逻辑
// 计算内核：js/calc.js（公式与 mes-uniapp/utils/calc.js 完全一致，仅注释措辞不同）
// 数据：历史记录只写本机 localStorage，不联网、不登录、不含人员与订单数据。

import { BUCKET_KEYS, computeMaterial, computeWeightRange } from './calc.js'
import {
    newRecordId,
    loadRecords,
    saveRecord,
    removeRecord,
    clearRecords
} from './store.js'

/* ---------------- 状态 ---------------- */

function emptyBuckets() {
    const buckets = {}
    BUCKET_KEYS.forEach(key => { buckets[key] = '' })
    return buckets
}

const state = {
    batchNo: '',
    buckets: emptyBuckets(),
    zeroCount: '',
    perCase: '',
    perPallet: '',
    sampleCount: '',
    labelExtra: '',
    securityExtra: '',
    bottleWeight: '',
    boxNetWeight: '',
    currentPallet: 1,
    materials: [],
    weightRange: '—',
    calc: null
}

/* ---------------- DOM ---------------- */

const $ = selector => document.querySelector(selector)
const $$ = selector => Array.from(document.querySelectorAll(selector))

const el = {
    batchNo: $('#batchNo'),
    btnScan: $('#btnScan'),
    buckets: $$('input[data-bucket]'),
    zeroCount: $('#zeroCount'),
    perCase: $('#perCase'),
    perPallet: $('#perPallet'),
    sampleCount: $('#sampleCount'),
    labelExtra: $('#labelExtra'),
    securityExtra: $('#securityExtra'),
    bottleWeight: $('#bottleWeight'),
    boxNetWeight: $('#boxNetWeight'),
    inboundCount: $('#inboundCount'),
    innerIssued: $('#innerIssued'),
    bucketCount: $('#bucketCount'),
    caseCountText: $('#caseCountText'),
    palletCode: $('#palletCode'),
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
    scanMask: $('#scanMask'),
    scanVideo: $('#scanVideo'),
    scanClose: $('#scanClose'),
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

function isZeroValue(value) {
    const text = String(value == null ? '' : value).trim()
    return text === '0' || /^0(?:\s|$)/.test(text)
}

/** 统一写法「数字 空格 单位」：把「5925瓶」补成「5925 瓶」，并归一多余空白。 */
function normalizeDisplayValue(value) {
    return String(value == null ? '' : value)
        .replace(/\s+/g, ' ')
        .trim()
        .replace(/([0-9])(?=[^\d\s])/g, '$1 ')
        .replace(/([^\d\s])(?=[0-9])/g, '$1 ')
}

/**
 * 只读值分段渲染（口径与 App 目标版式一致）：
 * - 每个「数字 + 单位」是一段：数字 44u 主色、单位 26u muted；
 * - 段内不拆行，只在 + 处分行（复合值第 2/3 个数字不再被并成小字）；
 * - 0 值整体用 muted。
 */
function renderValue(node, value) {
    if (!node) return
    node.replaceChildren()
    const text = normalizeDisplayValue(value)
    node.classList.toggle('zero', !text || isZeroValue(value))
    if (!text) return
    text.split(/\s*\+\s*/).forEach((segmentText, index) => {
        if (index > 0) {
            const op = document.createElement('span')
            op.className = 'cell-op'
            op.textContent = ' + '
            node.appendChild(op)
        }
        const segment = document.createElement('span')
        segment.className = 'cell-seg'
        const match = segmentText.trim().match(/^([0-9]+(?:\.[0-9]+)?)\s*([\s\S]*)$/)
        if (!match) {
            segment.textContent = segmentText.trim()
            node.appendChild(segment)
            return
        }
        const num = document.createElement('span')
        num.className = 'cell-num'
        num.textContent = match[1]
        segment.appendChild(num)
        const unitText = match[2].trim()
        if (unitText) {
            const unit = document.createElement('span')
            unit.className = 'cell-unit'
            unit.textContent = ' ' + unitText
            segment.appendChild(unit)
        }
        node.appendChild(segment)
    })
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
        const used = usedByName[name]
        node.textContent = used == null ? '0' : String(used)
        // 实用列 0 值弱化为 muted，>0 才用主色
        node.classList.toggle('zero-value', !used)
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
    el.boxNetWeight.value = state.boxNetWeight
    el.materials.forEach(input => {
        const name = input.getAttribute('data-material')
        const field = input.getAttribute('data-input')
        const material = state.materials.find(item => item.name === name)
        input.value = material ? (material[field] || '') : ''
    })
}

/* ---------------- 保存 / 历史 / 清空 ---------------- */

function buildRecord() {
    const r = state.calc
    return {
        id: newRecordId(),
        savedAt: new Date().toISOString(),
        batchNo: state.batchNo,
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
            boxNetWeight: state.boxNetWeight
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
    showToast('已保存到本机历史（共 ' + list.length + ' 条）')
}

function applyRecord(record) {
    state.batchNo = record.batchNo || ''
    state.perCase = record.bottlePerCase ? String(record.bottlePerCase) : ''
    state.perPallet = record.casePerPallet ? String(record.casePerPallet) : ''
    state.zeroCount = record.zeroCount ? String(record.zeroCount) : ''
    state.sampleCount = record.sampleCount ? String(record.sampleCount) : ''
    state.labelExtra = record.labelExtra ? String(record.labelExtra) : ''
    state.securityExtra = record.securityExtra ? String(record.securityExtra) : ''
    const weights = record.weights || {}
    state.bottleWeight = weights.bottleWeight || ''
    state.boxNetWeight = weights.boxNetWeight || ''
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
}

function clearAll() {
    state.batchNo = ''
    state.buckets = emptyBuckets()
    state.zeroCount = ''
    state.perCase = ''
    state.perPallet = ''
    state.sampleCount = ''
    state.labelExtra = ''
    state.securityExtra = ''
    state.bottleWeight = ''
    state.boxNetWeight = ''
    state.currentPallet = 1
    state.materials = []
    calculate()
    syncInputs()
    render()
    showToast('已清空当前计算')
}

function historySummary(record) {
    const summary = record.summary || {}
    const parts = []
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
    lines.push('瓶/件：' + (state.perCase || '—') + '　件/托：' + (state.perPallet || '—'))
    lines.push('每桶件数：' + BUCKET_KEYS.map(key => key + '=' + (state.buckets[key] || 0)).join(' '))
    lines.push('桶数：' + r.bucketCount + '　件数：' + r.caseCountText + '　瓶数：' + r.inboundCount)
    lines.push('托数：' + r.palletCode + '　件号：' + r.palletRange)
    lines.push('重量区间：' + state.weightRange)
    if (r.materials.length) lines.push('包材用量：' + r.materials.map(material => material.name + ' ' + material.used).join('；'))
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

/* ---------------- 扫码（浏览器原生 BarcodeDetector，零依赖） ---------------- */

// 只接受常见一维码与二维码；BarcodeDetector.getSupportedFormats() 过滤后再构造
const SCAN_FORMATS = ['code_128', 'ean_13', 'ean_8', 'upc_a', 'upc_e', 'itf', 'codabar', 'code_39', 'code_93', 'qr_code']
const SCAN_INTERVAL_MS = 300

let scanStream = null
let scanDetector = null
let scanTimer = null
let scanRunning = false

/** 扫码结果清洗：去空白/非字母数字、转大写、最多 12 位（与手填批号同一规则）。 */
function cleanScannedCode(raw) {
    return sanitizeBatchNo(raw)
}

function stopScanner() {
    scanRunning = false
    if (scanTimer) {
        clearInterval(scanTimer)
        scanTimer = null
    }
    if (scanStream) {
        scanStream.getTracks().forEach(track => {
            try { track.stop() } catch (error) { /* ignore */ }
        })
        scanStream = null
    }
    if (el.scanVideo) {
        try { el.scanVideo.pause() } catch (error) { /* ignore */ }
        el.scanVideo.srcObject = null
    }
    if (el.scanMask) el.scanMask.hidden = true
}

async function openScanner() {
    if (scanRunning) return
    const hasDetector = typeof window.BarcodeDetector === 'function'
    const hasCamera = !!(navigator.mediaDevices && typeof navigator.mediaDevices.getUserMedia === 'function')
    // 非安全上下文（http 域名）、浏览器无 BarcodeDetector、无相机 API：一律按不支持处理
    if (!window.isSecureContext || !hasDetector || !hasCamera) {
        showToast('当前浏览器不支持扫码，请手动输入')
        return
    }

    try {
        const supported = await window.BarcodeDetector.getSupportedFormats()
        const formats = SCAN_FORMATS.filter(format => supported.indexOf(format) >= 0)
        if (!formats.length) throw new Error('no supported barcode format')
        scanDetector = new window.BarcodeDetector({ formats })
    } catch (error) {
        showToast('当前浏览器不支持扫码，请手动输入')
        return
    }

    scanRunning = true
    el.scanMask.hidden = false
    try {
        scanStream = await navigator.mediaDevices.getUserMedia({ video: { facingMode: 'environment' }, audio: false })
        if (!scanRunning) {
            // 取流期间用户已关闭浮层
            scanStream.getTracks().forEach(track => {
                try { track.stop() } catch (error) { /* ignore */ }
            })
            scanStream = null
            return
        }
        el.scanVideo.srcObject = scanStream
        const played = el.scanVideo.play()
        if (played && typeof played.catch === 'function') played.catch(() => { /* 自动播放失败不阻塞识别 */ })
        scanTimer = setInterval(scanFrame, SCAN_INTERVAL_MS)
    } catch (error) {
        // 相机被拒 / 无摄像头 / 被系统占用：统一提示手动输入，不卡死
        stopScanner()
        showToast('当前浏览器不支持扫码，请手动输入')
    }
}

async function scanFrame() {
    if (!scanRunning || !scanDetector || !el.scanVideo) return
    try {
        const codes = await scanDetector.detect(el.scanVideo)
        const raw = codes && codes.length ? String(codes[0].rawValue || '') : ''
        const cleaned = cleanScannedCode(raw)
        if (!cleaned) return
        state.batchNo = cleaned
        el.batchNo.value = cleaned
        stopScanner()
        showToast('已填入批号：' + cleaned)
    } catch (error) {
        // 单帧失败（无码/画面模糊）：继续下一帧
    }
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
    // 批号 + 扫码
    el.batchNo.addEventListener('input', () => {
        const cleaned = sanitizeBatchNo(el.batchNo.value)
        if (el.batchNo.value !== cleaned) el.batchNo.value = cleaned
        state.batchNo = cleaned
    })
    el.btnScan.addEventListener('click', openScanner)
    el.scanClose.addEventListener('click', stopScanner)

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
    bindNumberInput(el.boxNetWeight, 'boxNetWeight', { decimal: true })

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

    // 卡内三键
    el.btnSave.addEventListener('click', saveCurrent)
    el.btnHistory.addEventListener('click', openHistory)
    el.btnClear.addEventListener('click', async () => {
        const hasInput = !!state.batchNo ||
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
        if (!el.scanMask.hidden) { stopScanner(); return }
        if (!el.confirmMask.hidden) { closeConfirm(false); return }
        if (!el.historyMask.hidden) el.historyMask.hidden = true
    })

    // 页面切到后台/锁屏时立即释放相机
    document.addEventListener('visibilitychange', () => {
        if (document.hidden) stopScanner()
    })
}

/* ---------------- 初始化 ---------------- */

function init() {
    bindEvents()
    calculate()
    syncInputs()
    render()
}

init()

/* ---------------- PWA：Service Worker 注册 + 安装引导 ---------------- */

/** 仅在 HTTPS / localhost 注册 Service Worker；失败静默，不影响计算。 */
function registerServiceWorker() {
    if (!('serviceWorker' in navigator)) return
    const isLocalhost = ['localhost', '127.0.0.1', '[::1]'].indexOf(location.hostname) >= 0
    const isSecure = window.isSecureContext || location.protocol === 'https:' || isLocalhost
    if (!isSecure) return
    navigator.serviceWorker.register('./sw.js').catch(() => {
        // SW 不可用时页面照常计算，不打扰用户
    })
}

/**
 * 轻量安装引导（不占主流程）：
 * - Chrome/Edge：捕获 beforeinstallprompt 后在页脚显示「安装到桌面」，点击触发安装；appinstalled 后隐藏
 * - iOS Safari：无该事件，显示一行可关闭的「分享 → 添加到主屏幕」提示（仅 iOS Safari 且未独立运行）
 */
function setupInstallPrompt() {
    const installBox = document.getElementById('pwaInstall')
    const installButton = document.getElementById('pwaInstallBtn')
    const iosHint = document.getElementById('pwaIosHint')
    const iosClose = document.getElementById('pwaIosClose')
    const standalone = (window.matchMedia && window.matchMedia('(display-mode: standalone)').matches) ||
        window.navigator.standalone === true
    if (standalone) return

    let deferredPrompt = null
    if (installBox && installButton) {
        window.addEventListener('beforeinstallprompt', event => {
            event.preventDefault()
            deferredPrompt = event
            installBox.hidden = false
        })
        installButton.addEventListener('click', async () => {
            if (!deferredPrompt || typeof deferredPrompt.prompt !== 'function') return
            installBox.hidden = true
            try {
                deferredPrompt.prompt()
                await deferredPrompt.userChoice
            } catch (error) {
                // 用户取消安装 / 浏览器拒绝：忽略
            }
            deferredPrompt = null
        })
        window.addEventListener('appinstalled', () => {
            installBox.hidden = true
            deferredPrompt = null
        })
    }

    const userAgent = navigator.userAgent || ''
    const isIos = /iPhone|iPad|iPod/i.test(userAgent)
    // iOS Safari 不支持 beforeinstallprompt（即「不支持」安装事件），给一行可关闭的添加到主屏幕提示
    const isIosSafari = isIos && /Safari/i.test(userAgent) && !/CriOS|FxiOS|EdgiOS|OPiOS/i.test(userAgent)
    if (iosHint && iosClose && isIosSafari) {
        iosHint.hidden = false
        iosClose.addEventListener('click', () => { iosHint.hidden = true })
    }
}

registerServiceWorker()
setupInstallPrompt()
