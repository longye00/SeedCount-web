/**
 * 页面主逻辑。算法链路与安卓版 / 小程序版完全一致，这里只负责界面装配：
 * 选照片 → 可选框选 → 计数 → 结果（标注图 / CSV / 大图）。
 */
import counter from './core/counter.js'
import overlay from './core/overlay.js'
import roiUtil from './core/roi.js'
import model from './model-web.js'
import decoder from './decoder.js'
import RoiEditor from './roi-editor.js'

const $ = (id) => document.getElementById(id)
const el = {
  dropzone: $('dropzone'), takePhoto: $('takePhoto'), changePhoto: $('changePhoto'),
  fileCard: $('fileCard'), fileThumb: $('fileThumb'), fileName: $('fileName'), fileDim: $('fileDim'),
  roiTag: $('roiTag'), roiBtn: $('roiBtn'), roiClear: $('roiClear'),
  countBtn: $('countBtn'), progressBox: $('progressBox'), progressFill: $('progressFill'), stageText: $('stageText'),
  tabs: $('tabs'), tabOriginal: $('tabOriginal'), tabResult: $('tabResult'), tabTable: $('tabTable'),
  viewerToolbar: $('viewerToolbar'), viewerLabel: $('viewerLabel'), zoomBtn: $('zoomBtn'),
  stage: $('stage'), overlayCanvas: $('overlayCanvas'), photoView: $('photoView'), emptyState: $('emptyState'),
  tableView: $('tableView'), tableSummary: $('tableSummary'), tableBody: $('tableBody'),
  countBadge: $('countBadge'), countNum: $('countNum'), busyOverlay: $('busyOverlay'), busyText: $('busyText'),
  resultBody: $('resultBody'),
  mCount: $('mCount'), mDiameter: $('mDiameter'), mElapsed: $('mElapsed'),
  mScope: $('mScope'),
  saveImage: $('saveImage'), viewTable: $('viewTable'), saveCsv: $('saveCsv'), tableDownload: $('tableDownload'),
  cameraInput: $('cameraInput'), albumInput: $('albumInput'),
  roiModal: $('roiModal'), roiTools: $('roiTools'), roiHint2: $('roiHint2'), roiCounter: $('roiCounter'),
  roiCanvas: $('roiCanvas'), roiUndo: $('roiUndo'), roiReset: $('roiReset'),
  roiCancel: $('roiCancel'), roiAdd: $('roiAdd'), roiOk: $('roiOk'),
}

const state = {
  file: null,
  photoURL: '',
  name: '',
  rgba: null, width: 0, height: 0,
  photoCanvas: null,
  roi: null,
  analysis: null,
  showResult: false,
  showTable: false,
  busy: false,
}

const editor = new RoiEditor({
  modal: el.roiModal, tools: el.roiTools, hint: el.roiHint2, counter: el.roiCounter,
  canvas: el.roiCanvas, undo: el.roiUndo, reset: el.roiReset,
  cancel: el.roiCancel, add: el.roiAdd, ok: el.roiOk,
})

/* 只有触屏设备才提供「调用摄像头」，桌面浏览器点了也只是打开文件选择框 */
if (window.matchMedia && window.matchMedia('(pointer: coarse)').matches) el.takePhoto.hidden = false

function setBusy(busy, percent, stage) {
  state.busy = busy
  for (const node of [
    el.takePhoto, el.changePhoto, el.countBtn, el.roiBtn, el.roiClear,
    el.saveImage, el.viewTable, el.saveCsv, el.tableDownload,
  ]) {
    node.disabled = busy || (node === el.countBtn && !state.rgba) || (node === el.roiBtn && !state.rgba)
  }
  el.dropzone.style.pointerEvents = busy ? 'none' : ''
  el.progressBox.hidden = !busy
  el.busyOverlay.hidden = !busy
  if (busy) setProgress(percent || 0, stage || '')
}

function setProgress(percent, stage) {
  el.progressFill.style.width = Math.round(percent) + '%'
  el.stageText.textContent = stage
  el.busyText.textContent = stage
}

function scopeLabel() {
  const count = roiUtil.regions(state.roi).length
  return count ? count + ' 个区域' : '自动'
}

function syncRoiLabel() {
  const count = roiUtil.regions(state.roi).length
  el.roiBtn.textContent = count ? '编辑区域' : '添加区域'
  el.roiClear.hidden = !count
  el.roiTag.textContent = count ? count + ' 个区域' : '自动'
  el.roiTag.classList.toggle('is-set', !!count)
}

function setViewerLabel(text) {
  el.viewerLabel.textContent = text || ''
}

function resetResult() {
  state.analysis = null
  state.showResult = false
  state.showTable = false
  el.resultBody.hidden = true
  el.tabs.hidden = true
  el.tableView.hidden = true
  el.countBadge.hidden = true
  el.countBtn.textContent = '开始计数'
}

async function loadFile(file) {
  if (state.busy || !file) return
  if (!/^image\//.test(file.type) && !/\.(jpe?g|png|webp|bmp|gif|heic|heif)$/i.test(file.name)) {
    alert('请选择图片文件')
    return
  }
  setBusy(true, 2, '正在读取照片')
  resetResult()
  try {
    const decoded = await decoder.decodePhoto(file)
    if (state.photoURL) URL.revokeObjectURL(state.photoURL)
    state.file = file
    state.name = file.name || '现场拍摄.jpg'
    state.photoURL = URL.createObjectURL(file)
    state.rgba = decoded.rgba
    state.width = decoded.width
    state.height = decoded.height
    state.photoCanvas = decoded.canvas
    state.roi = null
    state.showResult = false
    state.showTable = false

    el.photoView.src = state.photoURL
    el.fileThumb.src = state.photoURL
    el.fileName.textContent = state.name
    el.fileDim.textContent = decoded.width + ' × ' + decoded.height + ' px'
    el.fileCard.hidden = false
    el.photoView.hidden = false
    el.overlayCanvas.hidden = true
    el.emptyState.hidden = true
    el.zoomBtn.hidden = false
    el.viewerToolbar.hidden = false
    el.dropzone.hidden = true
    setViewerLabel(state.name)
    syncRoiLabel()
    setBusy(false)
  } catch (error) {
    setBusy(false)
    alert('读取照片失败：' + (error && error.message ? error.message : error))
  }
}

function median(values) {
  if (!values.length) return null
  const sorted = values.slice().sort((a, b) => a - b)
  const middle = sorted.length >> 1
  return sorted.length % 2 ? sorted[middle] : (sorted[middle - 1] + sorted[middle]) / 2
}

function mergeRegionAnalyses(analyses, regions, started) {
  const candidates = []
  for (let regionIndex = 0; regionIndex < analyses.length; regionIndex++) {
    const analysis = analyses[regionIndex]
    const ratio = analysis.region.side / analysis.cropSize
    for (const seed of analysis.seeds) {
      candidates.push({
        id: 0,
        centerX: analysis.region.x + seed.centerX * ratio,
        centerY: analysis.region.y + seed.centerY * ratio,
        areaPx: Math.round(seed.areaPx * ratio * ratio),
        equivalentDiameterPx: seed.equivalentDiameterPx * ratio,
        score: seed.score,
        xs: seed.xs.map((x) => analysis.region.x + x * ratio),
        ys: seed.ys.map((y) => analysis.region.y + y * ratio),
        regionIndex: regionIndex + 1,
      })
    }
  }

  /* 相邻或重叠选区可能识别到同一粒；按原图中心位置去重。 */
  const accepted = []
  candidates.sort((a, b) => b.score - a.score)
  for (const candidate of candidates) {
    let duplicate = false
    for (const other of accepted) {
      const threshold = Math.max(
        3,
        Math.min(candidate.equivalentDiameterPx, other.equivalentDiameterPx) * .35
      )
      if (Math.hypot(candidate.centerX - other.centerX, candidate.centerY - other.centerY) <= threshold) {
        duplicate = true
        break
      }
    }
    if (!duplicate) accepted.push(candidate)
  }
  accepted.sort((a, b) => a.centerY - b.centerY || a.centerX - b.centerX)
  accepted.forEach((seed, index) => { seed.id = index + 1 })

  return {
    multi: true,
    count: accepted.length,
    seeds: accepted,
    sourceRgba: state.rgba,
    sourceWidth: state.width,
    sourceHeight: state.height,
    regions: regions,
    medianDiameterPx: median(accepted.map((seed) => seed.equivalentDiameterPx)),
    processingMs: Date.now() - started,
  }
}

async function analyzePhoto() {
  const regions = roiUtil.regions(state.roi)
  if (regions.length <= 1) {
    return counter.analyze({
      rgba: state.rgba,
      width: state.width,
      height: state.height,
      roi: state.roi,
      runTile: model.runTile,
      onProgress: setProgress,
    })
  }

  const started = Date.now()
  const analyses = []
  for (let index = 0; index < regions.length; index++) {
    const analysis = await counter.analyze({
      rgba: state.rgba,
      width: state.width,
      height: state.height,
      roi: regions[index],
      runTile: model.runTile,
      onProgress: (percent, message) => {
        const overall = ((index + percent / 100) / regions.length) * 100
        setProgress(overall, '区域 ' + (index + 1) + '/' + regions.length + ' · ' + message)
      },
    })
    analyses.push(analysis)
  }
  return mergeRegionAnalyses(analyses, regions, started)
}

async function startCount() {
  if (state.busy || !state.rgba) return
  setBusy(true, 1, '正在准备模型')
  try {
    await model.ensureSession((message, percent) => {
      setProgress(Math.max(1, Math.round(percent * 0.05)), message)
    })
    const analysis = await analyzePhoto()
    state.analysis = analysis
    state.showResult = true
    state.showTable = false
    renderTable(analysis)

    const ctx = el.overlayCanvas.getContext('2d')
    overlay.draw(ctx, el.overlayCanvas, analysis, state.roi)

    el.countNum.textContent = analysis.count
    el.countBadge.hidden = false
    el.photoView.hidden = true
    el.overlayCanvas.hidden = false
    el.tableView.hidden = true
    el.tabs.hidden = false
    el.tabOriginal.classList.remove('is-active')
    el.tabResult.classList.add('is-active')
    el.tabTable.classList.remove('is-active')
    el.countBtn.textContent = '重新计数'

    el.mCount.textContent = analysis.count
    el.mDiameter.textContent = analysis.medianDiameterPx ? analysis.medianDiameterPx.toFixed(1) + ' px' : '-'
    el.mElapsed.textContent = (analysis.processingMs / 1000).toFixed(1) + ' 秒'
    el.mScope.textContent = scopeLabel()
    el.resultBody.hidden = false
    setBusy(false)
    el.resultBody.scrollIntoView({ behavior: 'smooth', block: 'nearest' })
  } catch (error) {
    setBusy(false)
    alert('计数失败：' + (error && error.message ? error.message : error))
  }
}

function showOriginal() {
  state.showResult = false
  state.showTable = false
  el.overlayCanvas.hidden = true
  el.photoView.hidden = false
  el.tableView.hidden = true
  el.countBadge.hidden = true
  el.tabOriginal.classList.add('is-active')
  el.tabResult.classList.remove('is-active')
  el.tabTable.classList.remove('is-active')
}

function showResult() {
  if (!state.analysis) return
  state.showResult = true
  state.showTable = false
  el.photoView.hidden = true
  el.overlayCanvas.hidden = false
  el.tableView.hidden = true
  el.countBadge.hidden = false
  el.tabResult.classList.add('is-active')
  el.tabOriginal.classList.remove('is-active')
  el.tabTable.classList.remove('is-active')
}

function showTable() {
  if (!state.analysis) return
  state.showResult = false
  state.showTable = true
  el.photoView.hidden = true
  el.overlayCanvas.hidden = true
  el.tableView.hidden = false
  el.countBadge.hidden = true
  el.tabTable.classList.add('is-active')
  el.tabOriginal.classList.remove('is-active')
  el.tabResult.classList.remove('is-active')
}

/** 看大图：新标签页打开，直接用浏览器原生缩放 */
function openViewer() {
  if (state.busy || state.showTable) return
  if (state.showResult && state.analysis) {
    el.overlayCanvas.toBlob((blob) => {
      if (blob) window.open(URL.createObjectURL(blob), '_blank')
    }, 'image/png')
  } else if (state.photoURL) {
    window.open(state.photoURL, '_blank')
  }
}

function download(url, name) {
  const a = document.createElement('a')
  a.href = url
  a.download = name
  document.body.appendChild(a)
  a.click()
  a.remove()
}

function saveAnnotatedImage() {
  if (!state.analysis) return
  el.overlayCanvas.toBlob((blob) => {
    if (!blob) return
    const url = URL.createObjectURL(blob)
    download(url, '种子计数-' + state.analysis.count + '粒-标注.png')
    setTimeout(() => URL.revokeObjectURL(url), 60000)
  }, 'image/png')
}

function saveCsv() {
  if (!state.analysis) return
  const csv = overlay.toCsv(state.analysis, state.name)
  const blob = new Blob(['\ufeff' + csv], { type: 'text/csv;charset=utf-8' })
  const url = URL.createObjectURL(blob)
  download(url, '种子计数-' + state.analysis.count + '粒.csv')
  setTimeout(() => URL.revokeObjectURL(url), 60000)
}

function renderTable(analysis) {
  const fragment = document.createDocumentFragment()
  if (!analysis.seeds.length) {
    const row = document.createElement('tr')
    const cell = document.createElement('td')
    cell.colSpan = 6
    cell.className = 'table-empty'
    cell.textContent = '没有识别结果'
    row.appendChild(cell)
    fragment.appendChild(row)
  } else {
    for (const seed of analysis.seeds) {
      const row = document.createElement('tr')
      const values = [
        seed.id,
        seed.centerX.toFixed(1),
        seed.centerY.toFixed(1),
        seed.areaPx,
        seed.equivalentDiameterPx.toFixed(2),
        seed.score.toFixed(4),
      ]
      for (const value of values) {
        const cell = document.createElement('td')
        cell.textContent = value
        row.appendChild(cell)
      }
      fragment.appendChild(row)
    }
  }
  el.tableBody.replaceChildren(fragment)
  el.tableSummary.textContent = analysis.count + ' 粒'
}

function openRoiEditor() {
  if (state.busy || !state.photoCanvas) return
  editor.open(state.photoCanvas, state.roi, (roi) => {
    if (roi !== null) {
      state.roi = roi
      resetResult()
      showOriginal()
      syncRoiLabel()
    }
  })
}

function clearRoi() {
  if (state.busy) return
  state.roi = null
  resetResult()
  showOriginal()
  syncRoiLabel()
}

/* 事件绑定 */
el.dropzone.addEventListener('click', () => el.albumInput.click())
el.dropzone.addEventListener('keydown', (e) => { if (e.key === 'Enter' || e.key === ' ') { e.preventDefault(); el.albumInput.click() } })
el.changePhoto.addEventListener('click', () => el.albumInput.click())
el.takePhoto.addEventListener('click', () => el.cameraInput.click())
el.cameraInput.addEventListener('change', (e) => { loadFile(e.target.files[0]); e.target.value = '' })
el.albumInput.addEventListener('change', (e) => { loadFile(e.target.files[0]); e.target.value = '' })
el.countBtn.addEventListener('click', startCount)
el.roiBtn.addEventListener('click', openRoiEditor)
el.roiClear.addEventListener('click', clearRoi)
el.tabOriginal.addEventListener('click', () => { if (state.analysis) showOriginal() })
el.tabResult.addEventListener('click', showResult)
el.tabTable.addEventListener('click', showTable)
el.zoomBtn.addEventListener('click', (e) => { e.stopPropagation(); openViewer() })
el.stage.addEventListener('click', () => { if (state.rgba && !state.showTable) openViewer() })
el.saveImage.addEventListener('click', saveAnnotatedImage)
el.viewTable.addEventListener('click', showTable)
el.saveCsv.addEventListener('click', saveCsv)
el.tableDownload.addEventListener('click', saveCsv)
document.addEventListener('keydown', (e) => { if (e.key === 'Escape' && !el.roiModal.hidden) editor.close(null) })

/* 拖放照片：预览区和左侧拖放区都接收 */
for (const zone of [el.stage, el.dropzone]) {
  for (const type of ['dragover', 'dragenter']) {
    zone.addEventListener(type, (e) => { e.preventDefault(); zone.classList.add('is-over') })
  }
  for (const type of ['dragleave', 'drop']) {
    zone.addEventListener(type, (e) => { e.preventDefault(); zone.classList.remove('is-over') })
  }
  zone.addEventListener('drop', (e) => {
    const file = e.dataTransfer && e.dataTransfer.files && e.dataTransfer.files[0]
    if (file) loadFile(file)
  })
}

/* PWA：注册 Service Worker（离线缓存页面与模型，可「添加到主屏幕」） */
if ('serviceWorker' in navigator && /^https?:$/.test(location.protocol)) {
  navigator.serviceWorker.register('sw.js').catch(() => {})
}

/* 后台静默预加载模型，首次计数更快 */
model.ensureSession(() => {}).catch(() => {})

/* 测试钩子（回归脚本用） */
window.SeedCount = { state, loadFile, startCount }
