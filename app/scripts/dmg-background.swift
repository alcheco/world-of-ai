// Fondo de la ventana del .dmg: la app a la izquierda, Aplicaciones a la
// derecha y una flecha dorada entre ambas. Colores del design system.
//   swift scripts/dmg-background.swift src-tauri/dmg-background.png
import AppKit

let out = CommandLine.arguments[1]
let W: CGFloat = 660, H: CGFloat = 400, scale: CGFloat = 2
let rep = NSBitmapImageRep(bitmapDataPlanes: nil, pixelsWide: Int(W * scale), pixelsHigh: Int(H * scale), bitsPerSample: 8,
                           samplesPerPixel: 4, hasAlpha: true, isPlanar: false, colorSpaceName: .deviceRGB, bytesPerRow: 0, bitsPerPixel: 0)!
rep.size = NSSize(width: W, height: H) // 144 ppp: nítido en pantallas Retina
NSGraphicsContext.saveGraphicsState()
NSGraphicsContext.current = NSGraphicsContext(bitmapImageRep: rep)
let ctx = NSGraphicsContext.current!.cgContext
func rgb(_ r: CGFloat, _ g: CGFloat, _ b: CGFloat, _ a: CGFloat = 1) -> CGColor { CGColor(srgbRed: r / 255, green: g / 255, blue: b / 255, alpha: a) }

// Fondo: vacío arcano → negro.
let space = CGColorSpace(name: CGColorSpace.sRGB)!
let bg = CGGradient(colorsSpace: space, colors: [rgb(11, 26, 46), rgb(7, 9, 13)] as CFArray, locations: [0, 1])!
ctx.drawRadialGradient(bg, startCenter: CGPoint(x: W / 2, y: H * 0.62), startRadius: 0, endCenter: CGPoint(x: W / 2, y: H * 0.62), endRadius: W * 0.7, options: [.drawsAfterEndLocation])

// Marco de bronce.
ctx.setStrokeColor(rgb(107, 82, 38))
ctx.setLineWidth(2)
ctx.stroke(CGRect(x: 10, y: 10, width: W - 20, height: H - 20))

// Flecha entre los iconos (centros en x=180 y x=480, y=190 desde arriba).
let y = H - 190
ctx.setStrokeColor(rgb(255, 209, 0))
ctx.setLineWidth(5)
ctx.setLineCap(.round)
ctx.setLineDash(phase: 0, lengths: [2, 12])
ctx.move(to: CGPoint(x: 262, y: y))
ctx.addLine(to: CGPoint(x: 386, y: y))
ctx.strokePath()
ctx.setLineDash(phase: 0, lengths: [])
ctx.setFillColor(rgb(255, 209, 0))
ctx.move(to: CGPoint(x: 404, y: y))
ctx.addLine(to: CGPoint(x: 384, y: y + 13))
ctx.addLine(to: CGPoint(x: 384, y: y - 13))
ctx.closePath()
ctx.fillPath()

func text(_ s: String, _ size: CGFloat, _ color: NSColor, _ yTop: CGFloat, bold: Bool = false) {
  let font = NSFont(name: bold ? "Georgia-Bold" : "Georgia", size: size) ?? NSFont.systemFont(ofSize: size)
  let style = NSMutableParagraphStyle(); style.alignment = .center
  let attrs: [NSAttributedString.Key: Any] = [.font: font, .foregroundColor: color, .paragraphStyle: style, .kern: 1.2]
  (s as NSString).draw(in: NSRect(x: 0, y: H - yTop - size * 1.4, width: W, height: size * 1.5), withAttributes: attrs)
}
text("WoAI", 26, NSColor(srgbRed: 1, green: 0.82, blue: 0, alpha: 1), 34, bold: true)
text("Arrastra WoAI a Aplicaciones  ·  Drag WoAI to Applications", 13, NSColor(srgbRed: 0.88, green: 0.88, blue: 0.88, alpha: 1), 318)
text("Después ábrelo desde Aplicaciones  ·  Then open it from Applications", 11, NSColor(srgbRed: 0.54, green: 0.54, blue: 0.58, alpha: 1), 344)

NSGraphicsContext.restoreGraphicsState()
try! rep.representation(using: .png, properties: [:])!.write(to: URL(fileURLWithPath: out))
print("escrito \(out)")
