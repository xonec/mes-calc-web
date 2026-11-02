// 包材/生产数据核心计算（纯函数，与 materials.vue 的 calculateMaterial 逻辑完全一致）
// 抽取目的：便于单元测试，避免核心计算逻辑藏在 Vue 组件里无法验证。
// 输入输出均为纯数据，不依赖 Vue 实例。

export const BUCKET_KEYS = ['A', 'B', 'C', 'D', 'E', 'F', 'G', 'H', 'I', 'J']

const pad3 = n => String(n).padStart(3, '0')

// 计算某一托的件号分段（连续桶号合并为区间，如 A001-A003、B001-B002）
function segmentCodes(codes) {
    const segs = []
    codes.forEach(code => {
        const letter = code[0]
        const num = parseInt(code.slice(1), 10)
        const tail = segs[segs.length - 1]
        if (tail && tail.letter === letter && num === tail.end + 1) tail.end = num
        else segs.push({ letter, start: num, end: num })
    })
    return segs.map(s => `${s.letter}${pad3(s.start)}-${s.letter}${pad3(s.end)}`).join('、')
}

// 核心计算。输入：
//   { buckets:{A..J}, zeroCount, perCase, perPallet, sampleCount, labelExtra, securityExtra, currentPallet }
// 返回计算结果对象（含 UI 展示字符串）。
export function computeMaterial(input) {
    input = input || {}
    const bucketsIn = input.buckets || {}

    const values = BUCKET_KEYS.map(k => Math.max(0, Number(bucketsIn[k]) || 0))
    const buckets = {}
    BUCKET_KEYS.forEach((k, i) => { buckets[k] = values[i] })

    const bucketCount = values.filter(Boolean).length
    const cases = values.reduce((s, v) => s + v, 0)
    const zero = Math.max(0, Number(input.zeroCount) || 0)
    const perCase = Math.max(1, Number(input.perCase) || 1)
    const perPallet = Math.max(1, Number(input.perPallet) || 1)
    const palletReady = input.palletPending !== true
    const sample = Math.max(0, Number(input.sampleCount) || 0)
    const labelExtra = Math.max(0, Number(input.labelExtra) || 0)
    const securityExtra = Math.max(0, Number(input.securityExtra) || 0)

    const bottles = cases * perCase + zero
    const issued = bottles + sample
    const pallets = palletReady ? Math.floor(cases / perPallet) : null
    const palletRemainder = palletReady ? cases % perPallet : null
    const totalPallets = palletReady ? Math.max(1, Math.ceil(cases / perPallet)) : null
    const marks = cases + (zero ? 1 : 0) + bucketCount
    const currentPallet = palletReady ? Math.min(Math.max(1, Number(input.currentPallet) || 1), totalPallets) : 0

    // 件号：按桶 A→J 顺序连续编号（桶字母 + 3 位序号，从 001 起），每托按 件/托 切分
    const codeList = []
    BUCKET_KEYS.forEach((k, i) => {
        const n = values[i]
        for (let j = 1; j <= n; j++) codeList.push(k + pad3(j))
    })
    const chunk = palletReady ? codeList.slice((currentPallet - 1) * perPallet, currentPallet * perPallet) : []
    const palletRange = palletReady ? segmentCodes(chunk) || '暂无件号' : '上托待补充，暂不分托'

    // 零箱只可能位于最后一桶的最后一箱之后：取整批件号列表的最后一个再 +1
    const lastCode = codeList[codeList.length - 1]
    let zeroBoxInfo = ''
    if (zero && lastCode) {
        const L = lastCode[0]
        const n = parseInt(lastCode.slice(1), 10)
        zeroBoxInfo = `${L}${pad3(n + 1)}（${zero} 瓶）`
    }

    const materials = [
        ['标签', issued + labelExtra],
        ['唛头', marks],
        ['纸箱', cases + (zero ? 1 : 0)],
        ['防伪', issued + securityExtra]
    ]

    return {
        buckets,
        bucketCount,
        caseCount: cases,
        caseCountText: cases ? (cases + ' 件' + (zero ? ` + ${zero} 瓶` : '')) : '0',
        zeroBottleCount: zero,
        bottleCount: bottles,
        innerPackageIssued: issued,
        sampleCount: sample,
        totalPallets,
        markCount: marks,
        currentPallet,
        inboundCount: bottles + ' 瓶',
        innerIssued: issued + ' 瓶',
        palletCode: palletReady ? (cases ? (pallets + ' 托' + (palletRemainder ? ` + ${palletRemainder} 件` : '') + (zero ? ` + ${zero} 瓶` : '')) : '0 托') : '上托待补充',
        palletPage: palletReady ? `第 ${currentPallet} 托 / 共 ${totalPallets} 托` : '上托待补充',
        palletRange,
        zeroBoxInfo,
        labelExtra,
        securityExtra,
        materials: materials.map(([name, used]) => ({ name, used })),
        materialUsed: Object.fromEntries(materials)
    }
}

// 重量范围：单箱净重 ± 单瓶重量的一半
export function computeWeightRange(bottleWeight, boxNetWeight) {
    const bottle = Math.max(0, Number(bottleWeight) || 0)
    const box = Math.max(0, Number(boxNetWeight) || 0)
    const half = bottle / 2
    return (box && bottle) ? `${Math.max(0, box - half).toFixed(3)}–${(box + half).toFixed(3)} kg` : '—'
}
