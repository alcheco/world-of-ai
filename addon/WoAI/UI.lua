-- WoAI: interfaz.
local ADDON, ns = ...
local Core = ns.Core
ns.UI = {}
local UI = ns.UI

local W, H, LEFT_W = 940, 600, 290
local MIN_W, MIN_H = 700, 420
local BACKDROP = {
  bgFile = "Interface\\Buttons\\WHITE8X8",
  edgeFile = "Interface\\Buttons\\WHITE8X8",
  edgeSize = 1,
}

local state = {
  filter = "all",
  search = "",
  selected = nil, -- { agent, id } o { new = true }
  newAgent = "claude",
  newCwdIndex = 1,
}

-- ---------------------------------------------------------------- helpers

local function Panel(parent, r, g, b, a)
  local f = CreateFrame("Frame", nil, parent, "BackdropTemplate")
  f:SetBackdrop(BACKDROP)
  f:SetBackdropColor(r or 0.06, g or 0.06, b or 0.08, a or 0.95)
  f:SetBackdropBorderColor(0.25, 0.25, 0.3, 1)
  return f
end

local function Button(parent, text, w, h)
  local b = CreateFrame("Button", nil, parent, "UIPanelButtonTemplate")
  b:SetSize(w or 90, h or 22)
  b:SetText(text)
  return b
end

local function Scroll(parent)
  local ok, scroll = pcall(CreateFrame, "ScrollFrame", nil, parent, "UIPanelScrollFrameTemplate")
  if not ok then scroll = CreateFrame("ScrollFrame", nil, parent) end
  scroll:EnableMouseWheel(true)
  scroll:SetScript("OnMouseWheel", function(self, delta)
    local v = self:GetVerticalScroll() - delta * 40
    v = math.max(0, math.min(v, self:GetVerticalScrollRange()))
    self:SetVerticalScroll(v)
  end)
  local child = CreateFrame("Frame", nil, scroll)
  child:SetSize(1, 1)
  scroll:SetScrollChild(child)
  return scroll, child
end

local function AgentTag(agent)
  return string.format("|c%s%s|r", Core.AGENT_COLOR[agent] or "ffffffff", Core.AGENT_LABEL[agent] or agent)
end

local STATUS_TEXT = {
  queued = "|cffffd100en cola|r",
  running = "|cffffd100ejecutando…|r",
  done = "|cff33ff99listo|r",
  error = "|cffff5555error|r",
}

-- ---------------------------------------------------------------- frame

function UI:Init()
  if self.frame then return end
  local f = Panel(UIParent, 0.04, 0.04, 0.06, 0.97)
  self.frame = f
  local size = WoAI_DB.settings.size
  f:SetSize(size and size[1] or W, size and size[2] or H)
  local pos = WoAI_DB.settings.windowPos
  if pos then f:SetPoint(pos[1], UIParent, pos[2], pos[3], pos[4]) else f:SetPoint("CENTER") end
  f:SetFrameStrata("HIGH")
  f:SetMovable(true)
  f:EnableMouse(true)
  f:RegisterForDrag("LeftButton")
  f:SetScript("OnDragStart", f.StartMoving)
  f:SetScript("OnDragStop", function(self)
    self:StopMovingOrSizing()
    UI:SavePosition()
  end)
  f:SetClampedToScreen(true)

  -- Redimensionable arrastrando la esquina inferior derecha.
  f:SetResizable(true)
  if f.SetResizeBounds then
    f:SetResizeBounds(MIN_W, MIN_H, 1800, 1200)
  elseif f.SetMinResize then
    f:SetMinResize(MIN_W, MIN_H)
  end
  local grip = CreateFrame("Button", nil, f)
  grip:SetSize(16, 16)
  grip:SetPoint("BOTTOMRIGHT", -2, 2)
  grip:SetFrameLevel(f:GetFrameLevel() + 20)
  grip:SetNormalTexture("Interface\\ChatFrame\\UI-ChatIM-SizeGrabber-Up")
  grip:SetHighlightTexture("Interface\\ChatFrame\\UI-ChatIM-SizeGrabber-Highlight")
  grip:SetPushedTexture("Interface\\ChatFrame\\UI-ChatIM-SizeGrabber-Down")
  grip:SetScript("OnMouseDown", function() f:StartSizing("BOTTOMRIGHT") end)
  grip:SetScript("OnMouseUp", function()
    f:StopMovingOrSizing()
    WoAI_DB.settings.size = { math.floor(f:GetWidth()), math.floor(f:GetHeight()) }
    UI:SavePosition()
    UI:Layout()
    UI:RefreshConversation()
  end)
  f:SetScript("OnSizeChanged", function() UI:Layout() end)
  f:Hide()
  _G.WoAIFrame = f
  table.insert(UISpecialFrames, "WoAIFrame")

  local title = f:CreateFontString(nil, "OVERLAY", "GameFontNormalLarge")
  title:SetPoint("TOPLEFT", 14, -12)
  title:SetText("|cff8fd3ffWoAI|r  ·  Claude & Codex")

  self.status = f:CreateFontString(nil, "OVERLAY", "GameFontDisableSmall")
  self.status:SetPoint("LEFT", title, "RIGHT", 16, 0)

  local close = CreateFrame("Button", nil, f, "UIPanelCloseButton")
  close:SetPoint("TOPRIGHT", 2, 2)

  local reload = Button(f, "/reload", 80, 22)
  reload:SetPoint("TOPRIGHT", -36, -10)
  reload:SetScript("OnClick", function() ReloadUI() end)

  self:BuildLeft()
  self:BuildRight()
  self:Layout()

  WoAI_DB.settings.collapsedGroups = WoAI_DB.settings.collapsedGroups or {}
  SLASH_WOAI1 = "/woai"
  SlashCmdList.WOAI = function(msg)
    if ns.Live and ns.Live:Slash(msg) then return end
    if ns.Uplink and (msg or ""):lower():match("^%s*enviar") then
      print(string.format("|cff8fd3ffWoAI|r: reenviando %d prompt(s) por captura.", ns.Uplink:Flush()))
      return
    end
    UI:Toggle()
  end
end

function UI:Toggle()
  if self.frame:IsShown() then
    self.frame:Hide()
  else
    self.frame:Show()
    self:Refresh()
  end
end

function WoAI_OnCompartmentClick()
  UI:Toggle()
end

function UI:Open(agent, sessionId)
  state.selected = { agent = agent, id = sessionId }
  local s = Core:FindSession(agent, sessionId)
  if s then WoAI_DB.settings.collapsedGroups[s.project or "Sin proyecto"] = nil end
  self.frame:Show()
  self:Refresh()
end

function UI:OpenNew(agent)
  state.selected = { new = true }
  state.newAgent = agent or state.newAgent
  self.frame:Show()
  self:Refresh()
end

-- ---------------------------------------------------------------- left: lista

function UI:BuildLeft()
  local left = Panel(self.frame)
  left:SetPoint("TOPLEFT", 10, -40)
  left:SetPoint("BOTTOMLEFT", 10, 10)
  left:SetWidth(LEFT_W)
  self.left = left

  local filters = { { "all", "Todos" }, { "claude", "Claude" }, { "codex", "Codex" } }
  self.filterButtons = {}
  local prev
  for _, fdef in ipairs(filters) do
    local b = Button(left, fdef[2], 70, 20)
    if prev then b:SetPoint("LEFT", prev, "RIGHT", 4, 0) else b:SetPoint("TOPLEFT", 8, -8) end
    b:SetScript("OnClick", function()
      state.filter = fdef[1]
      UI:RefreshList()
    end)
    b.key = fdef[1]
    self.filterButtons[#self.filterButtons + 1] = b
    prev = b
  end

  local new = Button(left, "+ Nueva", 60, 20)
  new:SetPoint("TOPRIGHT", -8, -8)
  new:SetScript("OnClick", function()
    state.selected = { new = true }
    UI:Refresh()
  end)

  local search = CreateFrame("EditBox", nil, left, "InputBoxTemplate")
  search:SetSize(LEFT_W - 28, 20)
  search:SetPoint("TOPLEFT", 16, -34)
  search:SetAutoFocus(false)
  search:SetScript("OnTextChanged", function(self)
    state.search = self:GetText()
    UI:RefreshList()
  end)
  search:SetScript("OnEscapePressed", function(self) self:ClearFocus() end)
  local hint = search:CreateFontString(nil, "OVERLAY", "GameFontDisableSmall")
  hint:SetPoint("LEFT", 4, 0)
  hint:SetText("Buscar…")
  search:HookScript("OnEditFocusGained", function() hint:Hide() end)
  search:HookScript("OnEditFocusLost", function(self) if self:GetText() == "" then hint:Show() end end)

  local scroll, child = Scroll(left)
  scroll:SetPoint("TOPLEFT", 6, -62)
  scroll:SetPoint("BOTTOMRIGHT", -28, 6)
  child:SetWidth(LEFT_W - 36)
  self.listScroll, self.listChild = scroll, child
  self.listButtons = {}
end

local ROW_H, HEADER_H = 42, 22

-- Cabecera de grupo (proyecto), plegable.
function UI:GroupHeader(i)
  self.groupHeaders = self.groupHeaders or {}
  local h = self.groupHeaders[i]
  if h then return h end
  h = CreateFrame("Button", nil, self.listChild)
  h:SetSize(LEFT_W - 36, HEADER_H)
  h.hl = h:CreateTexture(nil, "HIGHLIGHT")
  h.hl:SetAllPoints()
  h.hl:SetColorTexture(1, 1, 1, 0.06)
  h.line = h:CreateTexture(nil, "ARTWORK")
  h.line:SetPoint("BOTTOMLEFT", 0, 2)
  h.line:SetPoint("BOTTOMRIGHT", 0, 2)
  h.line:SetHeight(1)
  h.line:SetColorTexture(0.56, 0.83, 1, 0.35)
  h.text = h:CreateFontString(nil, "OVERLAY", "GameFontNormal")
  h.text:SetPoint("LEFT", 2, 1)
  h.text:SetPoint("RIGHT", -2, 1)
  h.text:SetJustifyH("LEFT")
  h.text:SetWordWrap(false)
  h:SetScript("OnClick", function(self)
    local c = WoAI_DB.settings.collapsedGroups
    c[self.group] = not c[self.group] or nil
    UI:RefreshList()
  end)
  self.groupHeaders[i] = h
  return h
end

function UI:ListButton(i)
  local b = self.listButtons[i]
  if b then return b end
  b = CreateFrame("Button", nil, self.listChild, "BackdropTemplate")
  b:SetBackdrop(BACKDROP)
  b:SetSize(LEFT_W - 36, ROW_H)
  -- Franja de color del agente.
  b.stripe = b:CreateTexture(nil, "ARTWORK")
  b.stripe:SetPoint("TOPLEFT", 1, -1)
  b.stripe:SetPoint("BOTTOMLEFT", 1, 1)
  b.stripe:SetWidth(3)
  b.title = b:CreateFontString(nil, "OVERLAY", "GameFontHighlightSmall")
  b.title:SetPoint("TOPLEFT", 10, -5)
  b.title:SetPoint("RIGHT", -6, 0)
  b.title:SetJustifyH("LEFT")
  b.title:SetWordWrap(false)
  b.sub = b:CreateFontString(nil, "OVERLAY", "GameFontDisableSmall")
  b.sub:SetPoint("BOTTOMLEFT", 10, 5)
  b.sub:SetPoint("RIGHT", -6, 0)
  b.sub:SetJustifyH("LEFT")
  b.sub:SetWordWrap(false)
  b:SetScript("OnClick", function(self)
    state.selected = { agent = self.session.agent, id = self.session.id }
    UI:Refresh()
  end)
  b:SetScript("OnEnter", function(self) self:SetBackdropColor(0.2, 0.2, 0.28, 1) end)
  b:SetScript("OnLeave", function(self) UI:PaintListButton(self) end)
  self.listButtons[i] = b
  return b
end

function UI:PaintListButton(b)
  local sel = state.selected
  local on = sel and not sel.new and b.session and sel.agent == b.session.agent and sel.id == b.session.id
  if on then
    b:SetBackdropColor(0.18, 0.26, 0.38, 1)
    b:SetBackdropBorderColor(0.4, 0.6, 0.9, 1)
  else
    b:SetBackdropColor(0.1, 0.1, 0.13, 1)
    b:SetBackdropBorderColor(0.18, 0.18, 0.22, 1)
  end
end

function UI:RefreshList()
  for _, b in ipairs(self.filterButtons) do
    if b.key == state.filter then b:LockHighlight() else b:UnlockHighlight() end
  end
  local unreadBySession = {}
  for _, job in ipairs(Core:Unread()) do
    if job.sessionId then unreadBySession[job.agent .. ":" .. job.sessionId] = true end
  end

  local groups = Core:Groups(state.filter, state.search)
  local collapsed = WoAI_DB.settings.collapsedGroups
  local searching = state.search ~= ""
  local y, nRows, nHeaders, total = 0, 0, 0, 0
  for _, g in ipairs(groups) do
    nHeaders = nHeaders + 1
    local h = self:GroupHeader(nHeaders)
    h.group = g.name
    local closed = collapsed[g.name] and not searching
    local nClaude, nCodex = 0, 0
    for _, s in ipairs(g.sessions) do
      if s.agent == "claude" then nClaude = nClaude + 1 else nCodex = nCodex + 1 end
    end
    local counts = {}
    if nClaude > 0 then table.insert(counts, string.format("|c%s%d|r", Core.AGENT_COLOR.claude, nClaude)) end
    if nCodex > 0 then table.insert(counts, string.format("|c%s%d|r", Core.AGENT_COLOR.codex, nCodex)) end
    h.text:SetText(string.format("%s %s%s|r  %s", closed and "+" or "-",
      g.noProject and "|cff999999" or "|cffffd100", Core:Escape(g.name), table.concat(counts, " · ")))
    h:ClearAllPoints()
    h:SetPoint("TOPLEFT", 0, -y)
    h:Show()
    y = y + HEADER_H + 2

    if not closed then
      for _, s in ipairs(g.sessions) do
        nRows = nRows + 1
        local b = self:ListButton(nRows)
        b.session = s
        local pending = #Core:PendingFor(s.agent, s.id)
        local unread = unreadBySession[s.agent .. ":" .. s.id]
        b.title:SetText((unread and "|TInterface\\COMMON\\Indicator-Green:10|t " or "") .. Core:Escape(s.title or "(sin título)"))
        local where = s.worktree and ("|cffaaaaaa" .. Core:Escape(s.worktree) .. "|r · ") or ""
        b.sub:SetText(string.format("%s · %s%s%s", AgentTag(s.agent), where, Core:Ago(s.updatedAt),
          pending > 0 and string.format("  |cffffd100(%d pendiente)|r", pending) or ""))
        local c = s.agent == "claude" and { 0.85, 0.47, 0.34 } or { 0.06, 0.64, 0.5 }
        b.stripe:SetColorTexture(c[1], c[2], c[3], 1)
        b:ClearAllPoints()
        b:SetPoint("TOPLEFT", 0, -y)
        self:PaintListButton(b)
        b:Show()
        y = y + ROW_H + 2
      end
    end
    total = total + #g.sessions
  end
  for i = nRows + 1, #self.listButtons do self.listButtons[i]:Hide() end
  for i = nHeaders + 1, #(self.groupHeaders or {}) do self.groupHeaders[i]:Hide() end
  self.listChild:SetHeight(math.max(1, y))
  if total == 0 then
    self.emptyList = self.emptyList or self.listChild:CreateFontString(nil, "OVERLAY", "GameFontDisable")
    self.emptyList:SetPoint("TOP", 0, -20)
    self.emptyList:SetText(Core:HasData() and "Sin sesiones." or "Sin datos.\nInicia el companion\ny haz /reload.")
    self.emptyList:Show()
  elseif self.emptyList then
    self.emptyList:Hide()
  end
end

-- ---------------------------------------------------------------- right: conversación

function UI:SavePosition()
  local p, _, rel, x, y = self.frame:GetPoint()
  WoAI_DB.settings.windowPos = { p, rel, x, y }
end

-- Ajusta los anchos que dependen del tamaño de la ventana.
function UI:Layout()
  if not self.msgChild or not self.input then return end
  local rw = self.frame:GetWidth() - LEFT_W - 28
  self.msgWidth = rw - 48
  self.msgChild:SetWidth(rw - 40)
  self.input:SetWidth(rw - 40)
  self.cwdBtn:SetWidth(math.max(120, rw - 140))
  for _, m in ipairs(self.msgPool) do
    m:SetWidth(self.msgWidth)
    m.text:SetWidth(self.msgWidth - 16)
  end
end

function UI:BuildRight()
  local right = Panel(self.frame)
  right:SetPoint("TOPLEFT", self.left, "TOPRIGHT", 8, 0)
  right:SetPoint("BOTTOMRIGHT", -10, 10)
  self.right = right
  local rw = W - LEFT_W - 28

  self.header = right:CreateFontString(nil, "OVERLAY", "GameFontNormal")
  self.header:SetPoint("TOPLEFT", 10, -10)
  self.header:SetPoint("RIGHT", -10, 0)
  self.header:SetJustifyH("LEFT")
  self.header:SetWordWrap(false)
  self.subheader = right:CreateFontString(nil, "OVERLAY", "GameFontDisableSmall")
  self.subheader:SetPoint("TOPLEFT", self.header, "BOTTOMLEFT", 0, -4)
  self.subheader:SetPoint("RIGHT", -10, 0)
  self.subheader:SetJustifyH("LEFT")
  self.subheader:SetWordWrap(false)

  -- Controles de sesión nueva.
  self.agentBtn = Button(right, "Agente", 110, 20)
  self.agentBtn:SetPoint("TOPLEFT", 10, -30)
  self.agentBtn:SetScript("OnClick", function()
    state.newAgent = state.newAgent == "claude" and "codex" or "claude"
    UI:RefreshConversation()
  end)
  self.cwdBtn = Button(right, "Carpeta", rw - 140, 20)
  self.cwdBtn:SetPoint("LEFT", self.agentBtn, "RIGHT", 6, 0)
  self.cwdBtn:SetScript("OnClick", function()
    -- Recorre: proyectos 1..n y luego 0 = "Sin proyecto".
    local ws = Core:Data().workspaces or {}
    state.newCwdIndex = (state.newCwdIndex + 1) % (#ws + 1)
    UI:RefreshConversation()
  end)

  -- Transcripción.
  local scroll, child = Scroll(right)
  scroll:SetPoint("TOPLEFT", 8, -56)
  scroll:SetPoint("BOTTOMRIGHT", -28, 128)
  child:SetWidth(rw - 40)
  self.msgScroll, self.msgChild = scroll, child
  self.msgWidth = rw - 48
  self.msgPool = {}

  -- Caja de prompt.
  local box = Panel(right, 0.02, 0.02, 0.03, 1)
  box:SetPoint("BOTTOMLEFT", 8, 36)
  box:SetPoint("BOTTOMRIGHT", -8, 36)
  box:SetHeight(84)
  local inScroll = CreateFrame("ScrollFrame", nil, box)
  inScroll:SetPoint("TOPLEFT", 6, -6)
  inScroll:SetPoint("BOTTOMRIGHT", -6, 6)
  local input = CreateFrame("EditBox", nil, inScroll)
  input:SetMultiLine(true)
  input:SetAutoFocus(false)
  input:SetMaxLetters(0)
  input:SetFontObject(ChatFontNormal)
  input:SetWidth(rw - 40)
  input:SetScript("OnEscapePressed", function(self) self:ClearFocus() end)
  input:SetScript("OnCursorChanged", function(self, x, y, w, h)
    if ScrollingEdit_OnCursorChanged then ScrollingEdit_OnCursorChanged(self, x, y, w, h) end
  end)
  input:SetScript("OnUpdate", function(self, elapsed)
    if ScrollingEdit_OnUpdate then ScrollingEdit_OnUpdate(self, elapsed, inScroll) end
  end)
  inScroll:SetScrollChild(input)
  box:EnableMouse(true)
  box:SetScript("OnMouseDown", function() input:SetFocus() end)
  self.input = input
  local ph = box:CreateFontString(nil, "OVERLAY", "GameFontDisable")
  ph:SetPoint("TOPLEFT", 8, -8)
  ph:SetText("Escribe un prompt…")
  input:SetScript("OnTextChanged", function(self)
    if self:GetText() == "" then ph:Show() else ph:Hide() end
    if ScrollingEdit_OnTextChanged then ScrollingEdit_OnTextChanged(self, inScroll) end
  end)

  local send = Button(right, "Enviar", 110, 24)
  send:SetPoint("BOTTOMRIGHT", -8, 8)
  send:SetScript("OnClick", function()
    local job = UI:Send()
    if job and ns.Uplink then ns.Uplink:Send(job) end
  end)

  self.hint = right:CreateFontString(nil, "OVERLAY", "GameFontDisableSmall")
  self.hint:SetPoint("BOTTOMLEFT", 10, 14)
  self.hint:SetPoint("RIGHT", send, "LEFT", -8, 0)
  self.hint:SetJustifyH("LEFT")
  self.hint:SetText("Enviar hace una captura de pantalla que lee el companion; si falla, el prompt sale con el próximo /reload.")
end

function UI:Target()
  local sel = state.selected
  if not sel then return nil end
  if sel.new then
    local ws = Core:Data().workspaces or {}
    -- cwd nil = sin proyecto: el companion usa su carpeta propia.
    return { agent = state.newAgent, sessionId = nil, cwd = ws[state.newCwdIndex] }
  end
  local s = Core:FindSession(sel.agent, sel.id)
  return { agent = sel.agent, sessionId = sel.id, cwd = s and s.cwd, session = s }
end

function UI:Send()
  local t = self:Target()
  if not t then
    UIErrorsFrame:AddMessage("WoAI: elige una sesión o crea una nueva.", 1, 0.3, 0.3)
    return false
  end
  local job, err = Core:Enqueue(t.agent, t.sessionId, t.cwd, self.input:GetText())
  if not job then
    UIErrorsFrame:AddMessage("WoAI: " .. err, 1, 0.3, 0.3)
    return false
  end
  self.input:SetText("")
  self.input:ClearFocus()
  self:Refresh()
  if ns.Tracker then ns.Tracker:Refresh() end
  return job
end

function UI:Message(i)
  local m = self.msgPool[i]
  if m then return m end
  m = CreateFrame("Frame", nil, self.msgChild, "BackdropTemplate")
  m:SetBackdrop(BACKDROP)
  m.who = m:CreateFontString(nil, "OVERLAY", "GameFontNormalSmall")
  m.who:SetPoint("TOPLEFT", 8, -6)
  m.text = m:CreateFontString(nil, "OVERLAY", "GameFontHighlight")
  m.text:SetPoint("TOPLEFT", 8, -22)
  m.text:SetWidth(self.msgWidth - 16)
  m.text:SetJustifyH("LEFT")
  m.text:SetJustifyV("TOP")
  m.text:SetSpacing(2)
  m.text:SetNonSpaceWrap(true)
  self.msgPool[i] = m
  return m
end

function UI:RefreshConversation()
  local sel = state.selected
  local t = self:Target()
  local entries = {}

  if not sel then
    self.header:SetText("Elige una conversación")
    self.subheader:SetText("")
    self.agentBtn:Hide()
    self.cwdBtn:Hide()
  elseif sel.new then
    self.header:SetText("Nueva conversación")
    local ws = Core:Data().workspaces or {}
    self.subheader:SetText("")
    self.agentBtn:Show()
    self.cwdBtn:Show()
    self.agentBtn:SetText(Core.AGENT_LABEL[state.newAgent])
    self.cwdBtn:SetText(t.cwd and string.format("|cffffd100%s|r  |cff999999%s|r", Core:Escape(Core:ProjectOfCwd(t.cwd) or ""), Core:Escape(t.cwd))
      or "|cffaaaaaaSin proyecto|r  |cff777777(carpeta propia de WoAI)|r")
    self.cwdBtn:Enable()
    for _, job in ipairs(Core:PendingFor(state.newAgent, nil)) do
      table.insert(entries, { role = "pending", text = job.prompt, job = job })
    end
  else
    self.agentBtn:Hide()
    self.cwdBtn:Hide()
    local s = t.session
    self.header:SetText(AgentTag(sel.agent) .. "  " .. Core:Escape(s and s.title or sel.id))
    self.subheader:SetText(s and string.format("|cffffd100%s|r%s · %s · %s", Core:Escape(s.project or "sin proyecto"),
      s.worktree and (" / " .. Core:Escape(s.worktree)) or "", Core:Ago(s.updatedAt), sel.id) or "")
    Core:MarkSessionRead(sel.agent, sel.id)
    if ns.Tracker then ns.Tracker:Refresh() end
    if s then
      for _, msg in ipairs(s.messages or {}) do table.insert(entries, msg) end
    end
    for _, job in ipairs(Core:PendingFor(sel.agent, sel.id)) do
      table.insert(entries, { role = "pending", text = job.prompt, job = job })
    end
  end

  local y = 0
  for i, e in ipairs(entries) do
    local m = self:Message(i)
    m:ClearAllPoints()
    m:SetPoint("TOPLEFT", 0, -y)
    m:SetWidth(self.msgWidth)
    m.text:SetWidth(self.msgWidth - 16)
    m.text:SetText(Core:Escape(e.text))
    if e.role == "user" then
      m.who:SetText("|cff8fd3ffTú|r  |cff777777" .. Core:Ago(e.ts) .. "|r")
      m:SetBackdropColor(0.1, 0.14, 0.2, 1)
      m:SetBackdropBorderColor(0.2, 0.3, 0.45, 1)
    elseif e.role == "assistant" then
      m.who:SetText(AgentTag(sel.agent or state.newAgent) .. "  |cff777777" .. Core:Ago(e.ts) .. "|r")
      m:SetBackdropColor(0.09, 0.09, 0.11, 1)
      m:SetBackdropBorderColor(0.2, 0.2, 0.24, 1)
    else
      local ack = Core:Ack(e.job.id)
      local st = ack and STATUS_TEXT[ack.status]
        or (e.job.sent and "|cffffd100enviado, esperando al companion|r" or "|cffffd100enviando… (o con el próximo /reload)|r")
      local extra = ack and ack.error and ("\n|cffff5555" .. Core:Escape(ack.error) .. "|r") or ""
      m.who:SetText("|cff8fd3ffTú|r  " .. st .. extra)
      m:SetBackdropColor(0.16, 0.13, 0.05, 1)
      m:SetBackdropBorderColor(0.5, 0.4, 0.1, 1)
    end
    local whoH = m.who:GetStringHeight()
    m.text:ClearAllPoints()
    m.text:SetPoint("TOPLEFT", 8, -(whoH + 10))
    local h = m.text:GetStringHeight() + whoH + 18
    m:SetHeight(h)
    m:Show()
    y = y + h + 6
  end
  for i = #entries + 1, #self.msgPool do self.msgPool[i]:Hide() end
  self.msgChild:SetHeight(math.max(1, y))

  -- Ir al final.
  C_Timer.After(0, function()
    self.msgScroll:SetVerticalScroll(self.msgScroll:GetVerticalScrollRange())
  end)
end

function UI:RefreshStatus()
  local pending = #(WoAI_DB.outbox or {})
  local d = Core:Data()
  local txt = Core:HasData() and ("datos " .. Core:Ago(d.generatedAt)) or "sin datos del companion"
  if ns.Live and ns.Live.Status then txt = txt .. "  ·  " .. ns.Live:Status() end
  if pending > 0 then txt = txt .. string.format("  ·  |cffffd100%d prompt(s) por enviar/recibir|r", pending) end
  self.status:SetText(txt)
end

function UI:Refresh()
  if not self.frame or not self.frame:IsShown() then return end
  self:RefreshStatus()
  self:RefreshList()
  self:RefreshConversation()
end
