/**
 * 浏览器端照片解码：File → RGBA 像素。
 * 与小程序 utils/canvas.js decodePhoto 对齐：EXIF 自动转正，长边上限 3000。
 */
const MAX_PHOTO_SIDE = 3000

/** createImageBitmap 支持 imageOrientation 时优先使用；否则退回 <img>（现代浏览器 drawImage 也会应用 EXIF 方向） */
async function loadBitmap(file) {
  if (window.createImageBitmap) {
    try {
      return await createImageBitmap(file, { imageOrientation: 'from-image' })
    } catch (e) {
      /* 走 <img> 兜底 */
    }
  }
  const url = URL.createObjectURL(file)
  try {
    const img = new Image()
    img.decoding = 'sync'
    await new Promise((resolve, reject) => {
      img.onload = resolve
      img.onerror = () => reject(new Error('图片解码失败'))
      img.src = url
    })
    return img
  } catch (e) {
    URL.revokeObjectURL(url)
    throw e
  }
}

/**
 * @param {File|Blob} file
 * @returns {Promise<{rgba: Uint8ClampedArray, width: number, height: number, canvas: HTMLCanvasElement}>}
 */
async function decodePhoto(file) {
  const source = await loadBitmap(file)
  const sw = source.width
  const sh = source.height
  if (!sw || !sh) throw new Error('无法读取图片尺寸')
  const longest = Math.max(sw, sh)
  const scale = longest > MAX_PHOTO_SIDE ? MAX_PHOTO_SIDE / longest : 1
  const width = Math.max(1, Math.round(sw * scale))
  const height = Math.max(1, Math.round(sh * scale))

  const canvas = document.createElement('canvas')
  canvas.width = width
  canvas.height = height
  const ctx = canvas.getContext('2d', { willReadFrequently: true })
  ctx.imageSmoothingEnabled = true
  ctx.imageSmoothingQuality = 'high'
  ctx.drawImage(source, 0, 0, width, height)
  if (source.close) source.close()
  const data = ctx.getImageData(0, 0, width, height)
  return { rgba: data.data, width, height, canvas }
}

export default { decodePhoto }
