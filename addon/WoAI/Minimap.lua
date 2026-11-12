-- WoAI: botón redondo en el borde del minimapa.
-- Clic: abre/cierra la ventana. Arrastrar: lo mueve alrededor del minimapa.
local ADDON, ns = ...
local Core = ns.Core
ns.Minimap = {}
local M = ns.Minimap

local function place(btn, angle)
  local rad = math.rad(angle)
  local r = (Minimap:GetWidth() / 2) + 5
  btn:ClearAllPoints()
  btn:SetPoint("CENTER", Minimap, "CENTER", math.cos(rad) * r, math.sin(rad) * r)
end

function M:Init()
  if self.button or not Minimap then return end
  WoAI_DB.settings.minimapAngle = WoAI_DB.settings.minimapAngle or 200

  local b = CreateFrame("Button", "WoAIMinimapButton", Minimap)
  b:SetSize(31, 31)
  b:SetFrameStrata("MEDIUM")
  b:SetFrameLevel(Minimap:GetFrameLevel() + 8)
  b:RegisterForClicks("LeftButtonUp", "RightButtonUp")
  b:RegisterForDrag("LeftButton")
  b:SetHighlightTexture("Interface\\Minimap\\UI-Minimap-ZoomButton-Highlight")

  local bg = b:CreateTexture(nil, "BACKGROUND")
  bg:SetTexture("Interface\\Minimap\\UI-Minimap-Background")
  bg:SetSize(20, 20)
  bg:SetPoint("CENTER")

  local icon = b:CreateTexture(nil, "ARTWORK")
  icon:SetTexture("Interface\\Icons\\INV_Misc_Book_09")
  icon:SetSize(18, 18)
  icon:SetPoint("CENTER")
  icon:SetTexCoord(0.07, 0.93, 0.07, 0.93)
  b.icon = icon

  local border = b:CreateTexture(nil, "OVERLAY")
  border:SetTexture("Interface\\Minimap\\MiniMap-TrackingBorder")
  border:SetSize(53, 53)
  border:SetPoint("TOPLEFT")

  -- Punto verde cuando hay respuestas nuevas.
  local badge = b:CreateTexture(nil, "OVERLAY", nil, 7)
  badge:SetTexture("Interface\\COMMON\\Indicator-Green")
  badge:SetSize(12, 12)
  badge:SetPoint("TOPRIGHT", -2, -2)
  b.badge = badge

  b:SetScript("OnClick", function(_, button)
    if button == "RightButton" and ns.Tracker and ns.Tracker.frame then
      WoAI_DB.settings.trackerCollapsed = not WoAI_DB.settings.trackerCollapsed
      ns.Tracker:Refresh()
    else
      ns.UI:Toggle()
    end
  end)

  b:SetScript("OnDragStart", function(self)
    self:SetScript("OnUpdate", function()
      local mx, my = Minimap:GetCenter()
      local scale = Minimap:GetEffectiveScale()
      local cx, cy = GetCursorPosition()
      cx, cy = cx / scale, cy / scale
      local angle = math.deg(math.atan2(cy - my, cx - mx))
      WoAI_DB.settings.minimapAngle = angle
      place(self, angle)
    end)
  end)
  b:SetScript("OnDragStop", function(self) self:SetScript("OnUpdate", nil) end)

  b:SetScript("OnEnter", function(self)
    GameTooltip:SetOwner(self, "ANCHOR_LEFT")
    GameTooltip:AddLine("|cff8fd3ffWoAI|r")
    local unread = #Core:Unread()
    local pending = #(WoAI_DB.outbox or {})
    if unread > 0 then GameTooltip:AddLine(string.format("%d respuesta(s) nueva(s)", unread), 0.2, 1, 0.6) end
    if pending > 0 then GameTooltip:AddLine(string.format("%d prompt(s) en curso", pending), 1, 0.82, 0) end
    GameTooltip:AddLine("Clic: abrir conversaciones", 1, 1, 1)
    GameTooltip:AddLine("Clic derecho: plegar misiones WoAI", 1, 1, 1)
    GameTooltip:AddLine("Arrastrar: mover el botón", 0.7, 0.7, 0.7)
    GameTooltip:Show()
  end)
  b:SetScript("OnLeave", function() GameTooltip:Hide() end)

  self.button = b
  place(b, WoAI_DB.settings.minimapAngle)
  self:Refresh()
end

function M:Refresh()
  if not self.button then return end
  if #Core:Unread() > 0 then self.button.badge:Show() else self.button.badge:Hide() end
end
