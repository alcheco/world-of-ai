-- WoAI: tokens del design system (colores, texturas y marcos).
-- Fuente de verdad visual del addon; los valores coinciden con docs/brand.
local ADDON, ns = ...
local T = {}
ns.Theme = T

T.MEDIA = "Interface\\AddOns\\" .. ADDON .. "\\Media\\"
T.ICON = T.MEDIA .. "WoAI-Icon"
T.MINIMAP_ICON = T.MEDIA .. "WoAI-Minimap"

-- r, g, b[, a]
T.color = {
  arcane     = { 0.56, 0.83, 1.00 },       -- marca, título, enlaces
  gold       = { 1.00, 0.82, 0.00 },       -- encabezados, proyectos
  metal      = { 0.79, 0.64, 0.29 },       -- bordes destacados
  bronze     = { 0.42, 0.32, 0.15 },       -- borde de ventana
  crimson    = { 0.43, 0.09, 0.09 },
  void       = { 0.04, 0.04, 0.06, 0.97 }, -- fondo de la ventana
  panel      = { 0.06, 0.06, 0.08, 0.95 },
  panel2     = { 0.10, 0.10, 0.13, 1 },    -- filas
  well       = { 0.02, 0.02, 0.03, 1 },    -- caja de texto
  edge       = { 0.25, 0.25, 0.30, 1 },    -- borde de paneles internos
  rowEdge    = { 0.18, 0.18, 0.22, 1 },
  hover      = { 0.20, 0.20, 0.28, 1 },
  select     = { 0.18, 0.26, 0.38, 1 },
  selectEdge = { 0.40, 0.60, 0.90, 1 },
  text       = { 0.88, 0.88, 0.88 },
  muted      = { 0.60, 0.60, 0.60 },
  code       = { 0.75, 0.90, 0.75 },
  ok         = { 0.20, 1.00, 0.60 },
  err        = { 1.00, 0.33, 0.33 },
  -- burbujas de conversación
  userBg     = { 0.10, 0.14, 0.20, 1 }, userEdge    = { 0.20, 0.30, 0.45, 1 },
  agentBg    = { 0.09, 0.09, 0.11, 1 }, agentEdge   = { 0.20, 0.20, 0.24, 1 },
  pendingBg  = { 0.16, 0.13, 0.05, 1 }, pendingEdge = { 0.50, 0.40, 0.10, 1 },
}

-- Para códigos de escape |cff…
T.hex = {
  arcane = "8fd3ff", gold = "ffd100", ok = "33ff99", err = "ff5555",
  muted = "999999", faint = "777777", soft = "aaaaaa", code = "bfe6bf",
}

--- Devuelve los componentes de un token, con alfa opcional sobrescrito.
function T:RGBA(key, alpha)
  local c = self.color[key]
  return c[1], c[2], c[3], alpha or c[4] or 1
end

--- Envuelve `text` en el color `key` (|cff…|r).
function T:Wrap(key, text)
  return "|cff" .. self.hex[key] .. text .. "|r"
end

T.BACKDROP = {
  bgFile = "Interface\\Buttons\\WHITE8X8",
  edgeFile = "Interface\\Buttons\\WHITE8X8",
  edgeSize = 1,
}

--- Fondo y borde de un frame con BackdropTemplate a partir de dos tokens.
function T:Paint(f, bgKey, edgeKey)
  f:SetBackdropColor(self:RGBA(bgKey))
  f:SetBackdropBorderColor(self:RGBA(edgeKey))
end

--- Marco de ventana: borde bronce con un filo negro por fuera y otro dorado
--- tenue por dentro, como los marcos del cliente.
function T:WindowFrame(f)
  f:SetBackdropBorderColor(self:RGBA("bronze"))
  local outer = CreateFrame("Frame", nil, f, "BackdropTemplate")
  outer:SetPoint("TOPLEFT", -2, 2)
  outer:SetPoint("BOTTOMRIGHT", 2, -2)
  outer:SetFrameLevel(math.max(0, f:GetFrameLevel() - 1))
  outer:SetBackdrop({ edgeFile = "Interface\\Buttons\\WHITE8X8", edgeSize = 2 })
  outer:SetBackdropBorderColor(0, 0, 0, 1)
  local inner = f:CreateTexture(nil, "BORDER")
  inner:SetPoint("TOPLEFT", 1, -1)
  inner:SetPoint("TOPRIGHT", -1, -1)
  inner:SetHeight(1)
  inner:SetColorTexture(self:RGBA("metal", 0.35))
  return outer
end
