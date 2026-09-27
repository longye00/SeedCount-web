/**
 * ONNX Runtime Web 推理后端。
 * 与小程序版 utils/model.js 提供同一组接口（ensureSession / runTile），
 * 模型是同一个 seed_sd1.onnx，输入输出节点名完全一致。
 */

const MODEL_URL = 'seed_sd1.onnx'
const MODEL_BYTES = 5729460
const INPUT_NAME = 'serving_default_image:0'
const PROB_NAME = 'StatefulPartitionedCall_1:0'
const DIST_NAME = 'StatefulPartitionedCall_1:1'
const INPUT_SHAPE = [1, 768, 768, 3]

let session = null
let preparing = null

/** 下载模型并显示进度（部署到服务器后，由 Service Worker 做离线缓存） */
async function fetchModel(onProgress) {
  const res = await fetch(MODEL_URL)
  if (!res.ok) throw new Error('下载模型失败：HTTP ' + res.status)
  const total = Number(res.headers.get('content-length')) || MODEL_BYTES
  const reader = res.body.getReader()
  const chunks = []
  let received = 0
  for (;;) {
    const part = await reader.read()
    if (part.done) break
    chunks.push(part.value)
    received += part.value.length
    onProgress('正在下载模型', Math.min(95, Math.round((received / total) * 95)))
  }
  const merged = new Uint8Array(received)
  let offset = 0
  for (const c of chunks) {
    merged.set(c, offset)
    offset += c.length
  }
  return merged
}

function configureOrt() {
  if (!window.ort) throw new Error('推理引擎未加载，请检查 vendor/ort/ 是否完整')
  ort.env.wasm.wasmPaths = new URL('vendor/ort/', window.location.href).href
  // 移动端温控考虑，最多 4 线程；无 COOP/COEP 时自动退化为单线程
  const hc = navigator.hardwareConcurrency || 4
  ort.env.wasm.numThreads = Math.min(4, Math.max(1, hc - 1))
}

/** 创建（或复用）推理会话。onProgress(message, percent) */
function ensureSession(onProgress) {
  const report = onProgress || function () {}
  if (session) return Promise.resolve(session)
  if (preparing) return preparing
  preparing = (async () => {
    configureOrt()
    const bytes = await fetchModel(report)
    report('正在加载推理引擎', 96)
    session = await ort.InferenceSession.create(bytes, {
      executionProviders: ['wasm'],
      graphOptimizationLevel: 'all',
    })
    report('模型就绪', 100)
    return session
  })().catch((error) => {
    preparing = null
    throw error
  })
  return preparing
}

/** 单个 768×768 分块推理，返回结构与小程序版 model.runTile 完全一致 */
async function runTile(input) {
  const active = await ensureSession()
  const feeds = {}
  feeds[INPUT_NAME] = new ort.Tensor('float32', input, INPUT_SHAPE)
  const result = await active.run(feeds)
  const prob = result[PROB_NAME]
  const dist = result[DIST_NAME]
  if (!prob || !dist) throw new Error('模型输出名称不匹配')
  return {
    prob: prob.data,
    dist: dist.data,
    outWidth: prob.dims[2],
    outHeight: prob.dims[1],
  }
}

export default { ensureSession, runTile }
