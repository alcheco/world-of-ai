// Rasteriza un SVG con AppKit (macOS 14+ lee SVG de forma nativa).
//   swift scripts/raster.swift <in.svg> <out.png> <tamaño> <margen 0..0.5> [template]
// Con "template", negro sobre blanco pasa a negro con alfa (icono plantilla de la barra de menús).
import AppKit
let a = CommandLine.arguments
let img = NSImage(contentsOf: URL(fileURLWithPath: a[1]))!
let size = Int(a[3])!, pad = CGFloat(Double(a[4])!) * CGFloat(size)
let template = a.count > 5
let rep = NSBitmapImageRep(bitmapDataPlanes: nil, pixelsWide: size, pixelsHigh: size, bitsPerSample: 8, samplesPerPixel: 4, hasAlpha: true, isPlanar: false, colorSpaceName: .deviceRGB, bytesPerRow: 0, bitsPerPixel: 0)!
NSGraphicsContext.saveGraphicsState()
NSGraphicsContext.current = NSGraphicsContext(bitmapImageRep: rep)
NSGraphicsContext.current!.imageInterpolation = .high
if template { NSColor.white.setFill(); NSRect(x: 0, y: 0, width: size, height: size).fill() }
let avail = CGFloat(size) - 2 * pad
let s = img.size; let k = min(avail / s.width, avail / s.height)
let w = s.width * k, h = s.height * k
img.draw(in: NSRect(x: (CGFloat(size) - w) / 2, y: (CGFloat(size) - h) / 2, width: w, height: h))
NSGraphicsContext.restoreGraphicsState()
if template {
  // negro sobre blanco → negro con alfa (plantilla de la barra de menús)
  for y in 0..<size { for x in 0..<size {
    let c = rep.colorAt(x: x, y: y)!.usingColorSpace(.deviceRGB)!
    let alpha = 1 - (c.redComponent + c.greenComponent + c.blueComponent) / 3
    rep.setColor(NSColor(deviceRed: 0, green: 0, blue: 0, alpha: alpha), atX: x, y: y)
  } }
}
try! rep.representation(using: .png, properties: [:])!.write(to: URL(fileURLWithPath: a[2]))
print("ok \(a[2])")
