-- WoAI: bloque tipo "misiones" bajo el rastreador de objetivos.
-- Muestra respuestas nuevas, errores y prompts en curso. Clic = abre la conversación.
local ADDON, ns = ...
local Core = ns.Core
ns.Tracker = {}
local T = ns.Tracker

local WIDTH = 248
local MAX_LINES = 8
local LINE_H = 30

local function shortTitle(job)
  local s = job.sessionId and Core:FindSession(job.agent, job.sessionId)
  local t = (s and s.title) or (job.prompt or ""):match("^[^\n]*") or "?"
  if #t > 38 then t = t:sub(1, 36) .. "…" end
  return Core:Escape(t), s and s.project or Core:ProjectOfCwd(job.cwd)
end

function T:Init()
  if self.frame then return end
  local f = CreateFrame("Frame", "WoAITrackerFrame", UIParent)
  f:SetSize(WIDTH, 26)
  f:SetFrameStrata("LOW")
  f:SetClampedToScreen(true)
  f:SetMovable(true)
  f:EnableMouse(true)
  f:RegisterForDrag("LeftButton")
  f:SetScript("OnDragStart", function(self) if IsShiftKeyDown() then self:StartMoving() end end)
  f:SetScript("OnDragStop", function(self)
    self:StopMovingOrSizing()
    local point, _, rel, x, y = self:GetPoint()
    WoAI_DB.settings.trackerPos = { point, rel, x, y }
  end)
  self.frame = f

  -- Cabecera estilo misiones.
  local header = CreateFrame("Button", nil, f)
  header:SetPoint("TOPLEFT")
  header:SetPoint("TOPRIGHT")
  header:SetHeight(24)
  header:RegisterForClicks("LeftButtonUp", "RightButtonUp")
  local bg = header:CreateTexture(nil, "BACKGROUND")
  bg:SetAllPoints()
  bg:SetColorTexture(0, 0, 0, 0.35)
  local line = header:CreateTexture(nil, "ARTWORK")
  line:SetPoint("BOTTOMLEFT")
  line:SetPoint("BOTTOMRIGHT")
  line:SetHeight(1)
  line:SetColorTexture(0.56, 0.83, 1, 0.6)
  header.text = header:CreateFontString(nil, "OVERLAY", _G.GameFontNormalMed2 and "GameFontNormalMed2" or "GameFontNormal")
  header.text:SetPoint("LEFT", 6, 0)
  header.toggle = header:CreateFontString(nil, "OVERLAY", "GameFontHighlight")
  header.toggle:SetPoint("RIGHT", -6, 0)
  header:SetScript("OnClick", function(_, button)
    if button == "RightButton" then
      WoAI_DB.settings.trackerPos = nil
      T:Place()
      return
    end
    WoAI_DB.settings.trackerCollapsed = not WoAI_DB.settings.trackerCollapsed
    T:Refresh()
  end)
  header:SetScript("OnEnter", function(self)
    GameTooltip:SetOwner(self, "ANCHOR_LEFT")
    GameTooltip:AddLine("WoAI")
    GameTooltip:AddLine("Clic: plegar/desplegar", 1, 1, 1)
    GameTooltip:AddLine("Mayús + arrastrar: mover", 1, 1, 1)
    GameTooltip:AddLine("Clic derecho: volver bajo las misiones", 1, 1, 1)
    GameTooltip:AddLine("En una misión: clic abre la conversación, clic derecho la descarta", 0.7, 0.7, 0.7, true)
    GameTooltip:Show()
  end)
  header:SetScript("OnLeave", function() GameTooltip:Hide() end)
  header:SetScript("OnDragStart", function() if IsShiftKeyDown() then f:StartMoving() end end)
  header:SetScript("OnDragStop", function() f:GetScript("OnDragStop")(f) end)
  header:RegisterForDrag("LeftButton")
  self.header = header

  self.lines = {}
  for i = 1, MAX_LINES do
    local b = CreateFrame("Button", nil, f)
    b:SetHeight(LINE_H)
    b:SetPoint("TOPLEFT", 0, -26 - (i - 1) * LINE_H)
    b:SetPoint("RIGHT")
    b.hl = b:CreateTexture(nil, "HIGHLIGHT")
    b.hl:SetAllPoints()
    b.hl:SetColorTexture(1, 1, 1, 0.08)
    b.title = b:CreateFontString(nil, "OVERLAY", "GameFontHighlight")
    b.title:SetPoint("TOPLEFT", 8, -2)
    b.title:SetPoint("RIGHT", -4, 0)
    b.title:SetJustifyH("LEFT")
    b.title:SetWordWrap(false)
    b.sub = b:CreateFontString(nil, "OVERLAY", "GameFontHighlightSmall")
    b.sub:SetPoint("TOPLEFT", b.title, "BOTTOMLEFT", 10, -2)
    b.sub:SetPoint("RIGHT", -4, 0)
    b.sub:SetJustifyH("LEFT")
    b.sub:SetWordWrap(false)
    b:RegisterForClicks("LeftButtonUp", "RightButtonUp")
    b:SetScript("OnClick", function(self, button)
      local job = self.job
      if not job then return end
      if button == "RightButton" then
        job.unread = nil
        T:Refresh()
        return
      end
      if job.sessionId then
        ns.UI:Open(job.agent, job.sessionId)
      else
        ns.UI:OpenNew(job.agent)
      end
      T:Refresh()
    end)
    self.lines[i] = b
  end

  self:Place()
  -- Reubica bajo las misiones cuando el rastreador cambia de tamaño.
  local elapsed = 0
  f:SetScript("OnUpdate", function(_, dt)
    elapsed = elapsed + dt
    if elapsed > 1 then
      elapsed = 0
      if not WoAI_DB.settings.trackerPos then T:Place() end
    end
  end)
  self:Refresh()
end

-- Punto más bajo con contenido visible del rastreador de objetivos.
local function trackerBottom()
  local otf = _G.ObjectiveTrackerFrame
  if not otf or not otf:IsShown() then return nil end
  local lowest = otf.Header and otf.Header:IsShown() and otf.Header:GetBottom() or otf:GetTop()
  for _, child in ipairs({ otf:GetChildren() }) do
    if child:IsShown() and child ~= otf.NineSlice and child:GetHeight() > 1 then
      local b = child:GetBottom()
      if b and (not lowest or b < lowest) then lowest = b end
    end
  end
  return lowest, otf
end

function T:Place()
  local f = self.frame
  f:ClearAllPoints()
  local pos = WoAI_DB.settings.trackerPos
  if pos then
    f:SetPoint(pos[1], UIParent, pos[2], pos[3], pos[4])
    return
  end
  local bottom, otf = trackerBottom()
  if bottom and otf:GetLeft() then
    f:SetPoint("TOPLEFT", UIParent, "BOTTOMLEFT", otf:GetLeft() + 10, bottom - 12)
  else
    f:SetPoint("TOPRIGHT", UIParent, "TOPRIGHT", -90, -280)
  end
end

-- Entradas a mostrar: no leídas primero, luego en curso y pendientes.
function T:Entries()
  local out = {}
  for _, job in ipairs(Core:Unread()) do
    table.insert(out, { job = job, kind = job.result == "error" and "error" or "done" })
  end
  for _, job in ipairs(WoAI_DB.outbox or {}) do
    local ack = Core:Ack(job.id)
    table.insert(out, { job = job, kind = (ack or job.sent) and "running" or "pending" })
  end
  return out
end

-- Estilo misión: icono de la misión + línea de objetivo.
local KIND = {
  done = { icon = "|A:QuestTurnin:14:14|a", obj = "|cff33ff99- Respuesta lista (1/1)|r", r = 1, g = 0.82, b = 0 },
  error = { icon = "|A:QuestTurnin:14:14|a", obj = "|cffff5555- Falló: ábrela para ver el error|r", r = 1, g = 0.45, b = 0.45 },
  running = { icon = "|A:QuestNormal:14:14|a", obj = "|cffd8d8d8- Esperando respuesta (0/1)|r", r = 1, g = 0.82, b = 0 },
  pending = { icon = "|A:QuestNormal:14:14|a", obj = "|cff999999- Enviando… (o con el próximo /reload) (0/1)|r", r = 0.75, g = 0.75, b = 0.75 },
}

function T:Refresh()
  if not self.frame then return end
  if ns.Minimap then ns.Minimap:Refresh() end
  local entries = self:Entries()
  if #entries == 0 then
    self.frame:Hide()
    return
  end
  self.frame:Show()
  local collapsed = WoAI_DB.settings.trackerCollapsed
  local unread = #Core:Unread()
  self.header.text:SetText(unread > 0 and string.format("WoAI |cff33ff99(%d nueva%s)|r", unread, unread > 1 and "s" or "")
    or string.format("WoAI (%d)", #entries))
  self.header.toggle:SetText(collapsed and "+" or "-")

  local shown = 0
  for i, b in ipairs(self.lines) do
    local e = not collapsed and entries[i]
    if e then
      local title, project = shortTitle(e.job)
      local k = KIND[e.kind]
            b.title:SetText(k.icon .. " " .. title)
      b.title:SetTextColor(k.r, k.g, k.b)
      b.sub:SetText(string.format("%s  |cff999999%s · %s|r", k.obj, Core.AGENT_LABEL[e.job.agent] or "", Core:Escape(project or "sin proyecto")))
      b.job = e.job
      b:Show()
      shown = shown + 1
    else
      b:Hide()
    end
  end
  self.frame:SetHeight(26 + shown * LINE_H)
end

-- Banner central tipo "¡Misión completada!" al entrar con respuestas nuevas.
function T:Celebrate()
  local unread = Core:Unread()
  if #unread == 0 then return end
  local b = self.banner
  if not b then
    b = CreateFrame("Frame", nil, UIParent)
    b:SetSize(600, 80)
    b:SetPoint("TOP", 0, -170)
    b:SetFrameStrata("HIGH")
    b.glow = b:CreateTexture(nil, "BACKGROUND")
    b.glow:SetPoint("CENTER")
    b.glow:SetSize(520, 70)
    b.glow:SetColorTexture(0, 0, 0, 0.45)
    b.title = b:CreateFontString(nil, "OVERLAY", _G.QuestFont_Enormous and "QuestFont_Enormous" or "GameFontNormalHuge")
    b.title:SetPoint("TOP", 0, -8)
    b.title:SetTextColor(1, 0.82, 0)
    b.sub = b:CreateFontString(nil, "OVERLAY", "GameFontHighlight")
    b.sub:SetPoint("TOP", b.title, "BOTTOM", 0, -6)
    b:SetScript("OnUpdate", function(self, dt)
      self.t = self.t + dt
      if self.t > 5 then
        self:SetAlpha(math.max(0, 1 - (self.t - 5)))
        if self.t > 6 then self:Hide() end
      end
    end)
    self.banner = b
  end
  local first = unread[1]
  local title = shortTitle(first)
  local failed = first.result == "error"
  b.title:SetText(failed and "Misión fallida" or "¡Misión completada!")
  b.title:SetTextColor(failed and 1 or 1, failed and 0.35 or 0.82, failed and 0.35 or 0)
  b.sub:SetText(string.format("%s: %s%s", Core.AGENT_LABEL[first.agent] or "", title,
    #unread > 1 and string.format("  |cff999999(+%d más)|r", #unread - 1) or ""))
  b.t = 0
  b:SetAlpha(1)
  b:Show()
  local kit = SOUNDKIT or {}
  local sound = failed and kit.IG_QUEST_FAILED or kit.IG_QUEST_LIST_COMPLETE or kit.UI_QUEST_ROLLING_FORWARD_01 or kit.READY_CHECK
  if sound then PlaySound(sound) end
end
