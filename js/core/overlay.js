/** 在画布上绘制分割轮廓与编号，配色与安卓版一致 */
import roiUtil from './roi.js'

/**
 * @param {CanvasRenderingContext2D} ctx
 * @param {object} analysis counter.analyze 的返回值
 * @param {object|null} roi
 */
function draw(ctx, canvas, analysis, roi) {
  const multi = !!analysis.multi
  const width = multi ? analysis.sourceWidth : analysis.cropSize
  const height = multi ? analysis.sourceHeight : analysis.cropSize
  canvas.width = width
  canvas.height = height
  let image
  if (ctx.createImageData) image = ctx.createImageData(width, height)
  else image = ctx.getImageData(0, 0, width, height)
  image.data.set(multi ? analysis.sourceRgba : analysis.crop)
  ctx.putImageData(image, 0, 0)

  const visualScale = multi ? Math.max(1, Math.min(width, height) / 900) : 1
  if (roi && roiUtil.isUsable(roi)) {
    const scale = multi ? 1 : analysis.cropSize / analysis.region.side
    const offsetX = multi ? 0 : analysis.region.x
    const offsetY = multi ? 0 : analysis.region.y
    const shapes = roiUtil.strokeShapes(roi, scale, offsetX, offsetY)
    ctx.save()
    ctx.strokeStyle = 'rgba(39,131,222,0.59)'
    ctx.lineWidth = 2.6 * visualScale
    if (ctx.setLineDash) ctx.setLineDash([14 * visualScale, 9 * visualScale])
    for (let index = 0; index < shapes.length; index++) {
      const shape = shapes[index]
      ctx.beginPath()
      if (shape.type === 'rect') ctx.rect(shape.x, shape.y, shape.w, shape.h)
      else if (shape.type === 'circle') ctx.arc(shape.x, shape.y, shape.r, 0, 2 * Math.PI)
      else {
        ctx.moveTo(shape.points[0].x, shape.points[0].y)
        for (let i = 1; i < shape.points.length; i++) ctx.lineTo(shape.points[i].x, shape.points[i].y)
        ctx.closePath()
      }
      ctx.stroke()
    }
    ctx.restore()
  }

  ctx.fillStyle = 'rgba(70,161,113,0.24)'
  ctx.strokeStyle = 'rgb(42,137,84)'
  ctx.lineWidth = 2.2 * visualScale
  const seeds = analysis.seeds
  for (let i = 0; i < seeds.length; i++) {
    const seed = seeds[i]
    ctx.beginPath()
    ctx.moveTo(seed.xs[0], seed.ys[0])
    for (let k = 1; k < seed.xs.length; k++) ctx.lineTo(seed.xs[k], seed.ys[k])
    ctx.closePath()
    ctx.fill()
    ctx.stroke()
  }

  ctx.textAlign = 'center'
  ctx.textBaseline = 'middle'
  ctx.font = 'bold ' + Math.round(13 * visualScale) + 'px sans-serif'
  ctx.lineWidth = 3.5 * visualScale
  ctx.strokeStyle = '#ffffff'
  ctx.fillStyle = 'rgb(28,72,48)'
  for (let i = 0; i < seeds.length; i++) {
    const label = String(seeds[i].id)
    ctx.strokeText(label, seeds[i].centerX, seeds[i].centerY)
    ctx.fillText(label, seeds[i].centerX, seeds[i].centerY)
  }
}

/** 逐粒 CSV */
function toCsv(analysis, photoName) {
  const lines = ['序号,中心X(px),中心Y(px),面积(px),等效直径(px),置信度']
  for (let i = 0; i < analysis.seeds.length; i++) {
    const seed = analysis.seeds[i]
    lines.push(
      [
        seed.id,
        seed.centerX.toFixed(1),
        seed.centerY.toFixed(1),
        seed.areaPx,
        seed.equivalentDiameterPx.toFixed(2),
        seed.score.toFixed(4),
      ].join(',')
    )
  }
  const header = ['# 文件,' + (photoName || '未命名'), '# 总数,' + analysis.count]
  if (analysis.multi) {
    header.push('# 坐标系,原图像素')
    header.push('# 原图尺寸,' + analysis.sourceWidth + ' ' + analysis.sourceHeight)
    header.push('# 计数区域,' + analysis.regions.length)
  } else {
    header.push('# 分析画布,' + analysis.cropSize)
    header.push(
      '# 裁剪区域,' +
        analysis.region.x +
        ' ' +
        analysis.region.y +
        ' ' +
        analysis.region.side +
        ' ' +
        analysis.region.side
    )
  }
  return header.concat(lines).join('\n')
}

export default { draw: draw, toCsv: toCsv }
