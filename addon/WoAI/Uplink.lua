-- WoAI: envío de prompts sin /reload.
--
-- El juego solo escribe las SavedVariables al hacer /reload, pero Screenshot()
-- escribe un archivo al momento. Para enviar un prompt, el addon lo dibuja
-- durante un instante como una cuadrícula de celdas de color en la esquina
-- superior izquierda y hace una captura. El companion vigila Screenshots/,
-- decodifica la imagen, encola el prompt y borra la captura.
--
-- Formato (todo en celdas de CELL píxeles físicos):
--   fila 0: celdas alternas negro/blanco (el companion mide el tamaño de celda)
--   fila 1: niveles 0..3 en gris (calibración), luego W en dos celdas de 6 bits
--   fila 2…: bytes "WOAI" + versión + longitud (3 bytes) + payload + adler32,
--            empaquetados en celdas de 6 bits (2 bits por canal R, G, B)
local ADDON, ns = ...
local Core = ns.Core
ns.Uplink = {}
local U = ns.Uplink

local CELL = 6          -- píxeles físicos por celda
local MAGIC = "WOAI"
local VERSION = 1
local TIMEOUT = 5       -- s esperando SCREENSHOT_SUCCEEDED
local LEVEL = { 0, 85 / 255, 170 / 255, 1 }

local function say(msg) print("|cff8fd3ffWoAI|r: " .. msg) end

-- ---------------------------------------------------------------- codificación (pura)

local function adler32(s)
  local a, b = 1, 0
  for i = 1, #s do
    a = (a + s:byte(i)) % 65521
    b = (b + a) % 65521
  end
  return b * 65536 + a
end

local function be(n, bytes)
  local out = {}
  for i = bytes, 1, -1 do
    out[i] = string.char(n % 256)
    n = math.floor(n / 256)
  end
  return table.concat(out)
end

-- Payload: campos separados por \n; el prompt va al final y puede tener \n.
function U.Payload(job)
  return table.concat({
    job.id or "",
    job.agent or "",
    job.sessionId or "",
    job.cwd or "",
    tostring(job.createdAt or 0),
    job.prompt or "",
  }, "\n")
end

function U.Frame(payload)
  return MAGIC .. string.char(VERSION) .. be(#payload, 3) .. payload .. be(adler32(payload), 4)
end

-- Bytes → valores de 6 bits.
function U.Sixes(bytes)
  local out, acc, nbits = {}, 0, 0
  for i = 1, #bytes do
    acc = acc * 256 + bytes:byte(i)
    nbits = nbits + 8
    while nbits >= 6 do
      nbits = nbits - 6
      local p = 2 ^ nbits
      out[#out + 1] = math.floor(acc / p)
      acc = acc % p
    end
  end
  if nbits > 0 then out[#out + 1] = acc * 2 ^ (6 - nbits) end
  return out
end

-- Cuadrícula completa: rows[r][c] = valor de 6 bits (0..63), con W columnas.
function U.Grid(bytes, W)
  local rows = { {}, {} }
  for c = 1, W do rows[1][c] = (c % 2 == 1) and 0 or 63 end -- negro, blanco, …
  local cal = rows[2]
  for k = 0, 3 do cal[k + 1] = k * 21 end                      -- gris nivel k (r=g=b=k)
  cal[5] = math.floor(W / 64)
  cal[6] = W % 64
  local sixes = U.Sixes(bytes)
  for i, v in ipairs(sixes) do
    local r = 3 + math.floor((i - 1) / W)
    rows[r] = rows[r] or {}
    rows[r][(i - 1) % W + 1] = v
  end
  return rows
end

-- ---------------------------------------------------------------- dibujo

function U:Overlay()
  if self.frame then return self.frame end
  local f = CreateFrame("Frame", nil, nil)
  f:SetFrameStrata("TOOLTIP")
  f:SetFrameLevel(9000)
  f:SetScale(1)
  f:Hide()
  self.frame, self.pool = f, {}
  return f
end

function U:Draw(rows, W)
  local f = self:Overlay()
  local physW, physH = GetPhysicalScreenSize()
  local px = 768 / physH / f:GetEffectiveScale()
  local unit = CELL * px
  f:ClearAllPoints()
  f:SetPoint("TOPLEFT", WorldFrame, "TOPLEFT", 0, 0)
  f:SetSize(W * unit, #rows * unit)
  local n = 0
  for r, row in ipairs(rows) do
    local c = 1
    while row[c] do
      local v, len = row[c], 1
      while row[c + len] == v do len = len + 1 end
      n = n + 1
      local t = self.pool[n]
      if not t then
        t = f:CreateTexture(nil, "OVERLAY")
        if t.SetSnapToPixelGrid then t:SetSnapToPixelGrid(false) end
        if t.SetTexelSnappingBias then t:SetTexelSnappingBias(0) end
        self.pool[n] = t
      end
      t:ClearAllPoints()
      t:SetPoint("TOPLEFT", f, "TOPLEFT", (c - 1) * unit, -(r - 1) * unit)
      t:SetSize(len * unit, unit)
      t:SetColorTexture(LEVEL[math.floor(v / 16) + 1], LEVEL[math.floor(v / 4) % 4 + 1], LEVEL[v % 4 + 1], 1)
      t:Show()
      c = c + len
    end
  end
  for i = n + 1, #self.pool do self.pool[i]:Hide() end
  f:Show()
end

-- ---------------------------------------------------------------- envío

function U:Init()
  self.queue = {}
  self.events = CreateFrame("Frame")
  self.events:RegisterEvent("SCREENSHOT_SUCCEEDED")
  self.events:RegisterEvent("SCREENSHOT_FAILED")
  self.events:SetScript("OnEvent", function(_, event) U:Done(event == "SCREENSHOT_SUCCEEDED") end)
end

-- Envía un job ya encolado en la outbox. Devuelve false si no cabe en pantalla.
function U:Send(job)
  if self:Busy(job) then return true end
  local physW, physH = GetPhysicalScreenSize()
  local W = math.min(math.floor(physW / CELL), 4095)
  local bytes = U.Frame(U.Payload(job))
  local rows = U.Grid(bytes, W)
  if #rows * CELL > physH then
    say("el prompt es demasiado largo para enviarlo sin /reload; saldrá con el próximo /reload.")
    return false
  end
  table.insert(self.queue, { job = job, rows = rows, W = W })
  self:Next()
  return true
end

function U:Busy(job)
  if self.current and self.current.job == job then return true end
  for _, item in ipairs(self.queue) do
    if item.job == job then return true end
  end
  return false
end

function U:Next()
  if self.current or #self.queue == 0 then return end
  local item = table.remove(self.queue, 1)
  self.current = item
  self.saved = { format = GetCVar("screenshotFormat"), quality = GetCVar("screenshotQuality") }
  pcall(SetCVar, "screenshotFormat", "png")
  pcall(SetCVar, "screenshotQuality", "10")
  self:Draw(item.rows, item.W)
  -- Espera dos frames para que la cuadrícula ya esté pintada.
  local frames = 0
  self.events:SetScript("OnUpdate", function(ev)
    frames = frames + 1
    if frames == 2 then
      item.started = GetTime()
      Screenshot()
    elseif frames > 2 and GetTime() - item.started > TIMEOUT then
      U:Done(false)
    end
  end)
end

function U:Done(ok)
  local item = self.current
  if not item then return end
  self.current = nil
  self.events:SetScript("OnUpdate", nil)
  self.frame:Hide()
  if self.saved then
    if self.saved.format then pcall(SetCVar, "screenshotFormat", self.saved.format) end
    if self.saved.quality then pcall(SetCVar, "screenshotQuality", self.saved.quality) end
  end
  -- Oculta el aviso "Captura guardada".
  C_Timer.After(0, function() if ActionStatus then ActionStatus:Hide() end end)
  if ok then
    item.job.sent = true
    item.job.via = "screenshot"
  else
    say("no se pudo hacer la captura; el prompt saldrá con el próximo /reload.")
  end
  if ns.UI then ns.UI:Refresh() end
  if ns.Tracker then ns.Tracker:Refresh() end
  self:Next()
end

-- Reenvía los prompts de la outbox que aún no salieron (/woai enviar).
function U:Flush()
  local n = 0
  for _, job in ipairs(WoAI_DB.outbox or {}) do
    if not job.sent and self:Send(job) then n = n + 1 end
  end
  return n
end
