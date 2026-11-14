// Genera los iconos de WoAI con CoreGraphics (sin dependencias).
//   swift scripts/icons.swift src-tauri/icons
// Escribe source.png (1024², base para `tauri icon`) y tray.png (plantilla
// monocroma para la barra de menús de macOS).
import CoreGraphics
import Foundation
import ImageIO
import UniformTypeIdentifiers

let outDir = CommandLine.arguments.count > 1 ? CommandLine.arguments[1] : "."

func save(_ ctx: CGContext, _ name: String) {
    let url = URL(fileURLWithPath: outDir).appendingPathComponent(name)
    let dest = CGImageDestinationCreateWithURL(url as CFURL, UTType.png.identifier as CFString, 1, nil)!
    CGImageDestinationAddImage(dest, ctx.makeImage()!, nil)
    CGImageDestinationFinalize(dest)
    print("escrito \(url.path)")
}

func context(_ size: Int) -> CGContext {
    let ctx = CGContext(data: nil, width: size, height: size, bitsPerComponent: 8, bytesPerRow: 0,
                        space: CGColorSpace(name: CGColorSpace.sRGB)!,
                        bitmapInfo: CGImageAlphaInfo.premultipliedLast.rawValue)!
    ctx.setShouldAntialias(true)
    ctx.interpolationQuality = .high
    return ctx
}

func rgb(_ r: CGFloat, _ g: CGFloat, _ b: CGFloat, _ a: CGFloat = 1) -> CGColor {
    CGColor(srgbRed: r / 255, green: g / 255, blue: b / 255, alpha: a)
}

/// Libro abierto en un cuadro unidad (0…1), con el lomo en x = 0.5.
func bookPages() -> (CGPath, CGPath) {
    let left = CGMutablePath()
    left.move(to: CGPoint(x: 0.5, y: 0.22))
    left.addCurve(to: CGPoint(x: 0.08, y: 0.27), control1: CGPoint(x: 0.38, y: 0.15), control2: CGPoint(x: 0.2, y: 0.17))
    left.addLine(to: CGPoint(x: 0.08, y: 0.78))
    left.addCurve(to: CGPoint(x: 0.5, y: 0.74), control1: CGPoint(x: 0.2, y: 0.68), control2: CGPoint(x: 0.38, y: 0.67))
    left.closeSubpath()
    var flip = CGAffineTransform(translationX: 1, y: 0).scaledBy(x: -1, y: 1)
    let right = left.copy(using: &flip)!
    return (left, right)
}

/// Destello de cuatro puntas centrado en c.
func sparkle(_ c: CGPoint, _ r: CGFloat) -> CGPath {
    let p = CGMutablePath()
    let k: CGFloat = 0.22
    p.move(to: CGPoint(x: c.x, y: c.y + r))
    p.addQuadCurve(to: CGPoint(x: c.x + r, y: c.y), control: CGPoint(x: c.x + r * k, y: c.y + r * k))
    p.addQuadCurve(to: CGPoint(x: c.x, y: c.y - r), control: CGPoint(x: c.x + r * k, y: c.y - r * k))
    p.addQuadCurve(to: CGPoint(x: c.x - r, y: c.y), control: CGPoint(x: c.x - r * k, y: c.y - r * k))
    p.addQuadCurve(to: CGPoint(x: c.x, y: c.y + r), control: CGPoint(x: c.x - r * k, y: c.y + r * k))
    return p
}

// ------------------------------------------------------------ icono de la app
do {
    let S: CGFloat = 1024
    let ctx = context(Int(S))
    // Margen del icono de macOS (~10 %) y esquinas redondeadas.
    let inset: CGFloat = 100
    let rect = CGRect(x: inset, y: inset, width: S - 2 * inset, height: S - 2 * inset)
    let tile = CGPath(roundedRect: rect, cornerWidth: 185, cornerHeight: 185, transform: nil)

    // Sombra suave.
    ctx.saveGState()
    ctx.setShadow(offset: CGSize(width: 0, height: -14), blur: 36, color: rgb(0, 0, 0, 0.45))
    ctx.addPath(tile)
    ctx.setFillColor(rgb(20, 16, 40))
    ctx.fillPath()
    ctx.restoreGState()

    // Fondo: degradado violeta oscuro → azul noche.
    ctx.saveGState()
    ctx.addPath(tile)
    ctx.clip()
    let bg = CGGradient(colorsSpace: CGColorSpace(name: CGColorSpace.sRGB)!,
                        colors: [rgb(58, 36, 102), rgb(18, 22, 54)] as CFArray, locations: [0, 1])!
    ctx.drawLinearGradient(bg, start: CGPoint(x: S / 2, y: rect.maxY), end: CGPoint(x: S / 2, y: rect.minY), options: [])
    // Resplandor detrás del libro.
    let glow = CGGradient(colorsSpace: CGColorSpace(name: CGColorSpace.sRGB)!,
                          colors: [rgb(255, 200, 90, 0.35), rgb(255, 200, 90, 0)] as CFArray, locations: [0, 1])!
    ctx.drawRadialGradient(glow, startCenter: CGPoint(x: S / 2, y: S * 0.5), startRadius: 0,
                           endCenter: CGPoint(x: S / 2, y: S * 0.5), endRadius: 360, options: [])
    ctx.restoreGState()

    // Borde dorado.
    ctx.addPath(CGPath(roundedRect: rect.insetBy(dx: 14, dy: 14), cornerWidth: 172, cornerHeight: 172, transform: nil))
    ctx.setStrokeColor(rgb(232, 182, 72))
    ctx.setLineWidth(18)
    ctx.strokePath()

    // Libro.
    let bookRect = CGRect(x: 232, y: 250, width: 560, height: 470)
    var t = CGAffineTransform(translationX: bookRect.minX, y: bookRect.minY).scaledBy(x: bookRect.width, y: bookRect.height)
    let (l, r) = bookPages()
    let gold = CGGradient(colorsSpace: CGColorSpace(name: CGColorSpace.sRGB)!,
                          colors: [rgb(255, 226, 140), rgb(214, 150, 40)] as CFArray, locations: [0, 1])!
    for page in [l, r] {
        let p = page.copy(using: &t)!
        ctx.saveGState()
        ctx.addPath(p)
        ctx.clip()
        ctx.drawLinearGradient(gold, start: CGPoint(x: 0, y: bookRect.maxY), end: CGPoint(x: 0, y: bookRect.minY), options: [])
        ctx.restoreGState()
        ctx.addPath(p)
        ctx.setStrokeColor(rgb(120, 70, 10))
        ctx.setLineWidth(10)
        ctx.setLineJoin(.round)
        ctx.strokePath()
    }
    // Renglones.
    ctx.setStrokeColor(rgb(150, 95, 25, 0.75))
    ctx.setLineWidth(12)
    ctx.setLineCap(.round)
    for i in 0..<3 {
        let y = bookRect.minY + bookRect.height * (0.52 + CGFloat(i) * 0.075)
        ctx.move(to: CGPoint(x: bookRect.minX + 0.17 * bookRect.width, y: y - 8))
        ctx.addLine(to: CGPoint(x: bookRect.minX + 0.4 * bookRect.width, y: y))
        ctx.move(to: CGPoint(x: bookRect.maxX - 0.17 * bookRect.width, y: y - 8))
        ctx.addLine(to: CGPoint(x: bookRect.maxX - 0.4 * bookRect.width, y: y))
    }
    ctx.strokePath()

    // Destellos (la IA).
    ctx.setFillColor(rgb(255, 250, 225))
    ctx.setShadow(offset: .zero, blur: 30, color: rgb(255, 220, 120, 0.9))
    ctx.addPath(sparkle(CGPoint(x: 680, y: 770), 92))
    ctx.addPath(sparkle(CGPoint(x: 790, y: 680), 40))
    ctx.fillPath()

    save(ctx, "source.png")
}

// ------------------------------------------------------------ icono de la bandeja (plantilla)
do {
    let S: CGFloat = 44
    let ctx = context(Int(S))
    ctx.setFillColor(rgb(0, 0, 0))
    let bookRect = CGRect(x: 3, y: 7, width: 32, height: 26)
    var t = CGAffineTransform(translationX: bookRect.minX, y: bookRect.minY).scaledBy(x: bookRect.width, y: bookRect.height)
    let (l, r) = bookPages()
    ctx.setStrokeColor(rgb(0, 0, 0))
    ctx.setLineWidth(3.2)
    ctx.setLineJoin(.round)
    ctx.addPath(l.copy(using: &t)!)
    ctx.addPath(r.copy(using: &t)!)
    ctx.strokePath()
    ctx.addPath(sparkle(CGPoint(x: 36, y: 35), 8))
    ctx.fillPath()
    save(ctx, "tray.png")
}
