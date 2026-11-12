-- WoAI: respuestas sin /reload.
--
-- El companion escribe cada actualización en un pool de addons LoadOnDemand
-- (WoAI_S001…): LoadAddOn lee su Lua del disco al cargarlo, una vez por sesión
-- de UI cada uno. Para saber cuándo cargar uno sin gastarlos, mira señales:
-- PlaySoundFile dice si sig/NNN.wav se puede reproducir (vacío = no, silencio
-- válido = sí). Sin señales (sonido apagado, etc.) se cargan slots con un
-- calendario mientras haya prompts esperando.
local ADDON, ns = ...
local Core = ns.Core
ns.Live = {}
local L = ns.Live

local ROOT = "Interface\\AddOns\\WoAI\\"
local SCHEDULE = { 10, 25, 45, 75, 120 } -- s desde el login; luego cada 120 s
local TICK = 2

local LoadAddOnFn = (C_AddOns and C_AddOns.LoadAddOn) or LoadAddOn
local IsLoadedFn = (C_AddOns and C_AddOns.IsAddOnLoaded) or IsAddOnLoaded
local EnableFn = (C_AddOns and C_AddOns.EnableAddOn) or EnableAddOn

local function say(msg) print("|cff8fd3ffWoAI|r: " .. msg) end

-- ¿Se puede reproducir? Para la reproducción al momento (es silencio de todos modos).
local function playable(path)
  local ok, willPlay, handle = pcall(PlaySoundFile, path, "Master")
  if ok and willPlay and handle and StopSound then pcall(StopSound, handle) end
  return ok and willPlay and true or false
end

local function slotName(i) return string.format("WoAI_S%03d", i) end

function L:Init()
  local cfg = (WoAI_Data and WoAI_Data.live) or {}
  self.seq = cfg.seq or 0
  self.slots = cfg.slots or 100
  self.signalCount = cfg.signals or 500
  self.nextSlot = 1
  self.loads = 0
  self.enabled = true
  -- Autotest: un vacío no debe sonar y uno válido sí. Si no, solo calendario.
  self.signals = not playable(ROOT .. "ctl\\empty.wav") and playable(ROOT .. "ctl\\valid.wav")
  self.ticker = C_Timer.NewTicker(TICK, function() L:Tick() end)
end

function L:SignalPath(seq)
  return string.format("%ssig\\%03d.wav", ROOT, ((seq - 1) % self.signalCount) + 1)
end

function L:Tick()
  if not self.enabled then return end
  if Core:Waiting() == 0 then
    self.waitStart, self.step = nil, nil
    return
  end
  local now = GetTime()
  if not self.waitStart then self.waitStart, self.step = now, 1 end
  if self.signals and playable(self:SignalPath(self.seq + 1)) then
    self:Poll(true)
    return
  end
  local due = SCHEDULE[self.step] or (SCHEDULE[#SCHEDULE] + 120 * (self.step - #SCHEDULE))
  if now - self.waitStart >= due then
    self.step = self.step + 1
    self:Poll(false)
  end
end

-- Carga el siguiente slot libre y aplica lo que trae.
function L:Poll(fromSignal)
  if not self.enabled then return false end
  for _ = 1, 3 do
    local i = self.nextSlot
    if i > self.slots then
      if not self.exhausted then
        self.exhausted = true
        say("se acabaron los slots de esta sesión. Haz /reload para recibir más respuestas.")
      end
      return false
    end
    self.nextSlot = i + 1
    local name = slotName(i)
    if not IsLoadedFn(name) then
      WoAI_Live = nil
      if EnableFn then pcall(EnableFn, name) end
      local ok, loaded, reason = pcall(LoadAddOnFn, name)
      if ok and loaded then
        self.loads = self.loads + 1
        if WoAI_Live then return self:Apply(WoAI_Live, fromSignal) end
        return false
      end
      if i == 1 and (reason == "MISSING" or reason == "CORRUPT") then
        self.enabled = false
        say("faltan los slots (" .. tostring(reason) .. "). Ejecuta `npm run install-addon` y reinicia WoW; mientras, usa /reload.")
        return false
      end
    end
  end
  return false
end

function L:Apply(live, fromSignal)
  local seq = live.seq or 0
  if fromSignal and seq <= self.seq then
    -- La señal ya estaba levantada de antes (rueda o reinicio): no fiarse.
    self.signals = false
  end
  if seq > self.seq then self.seq = seq end
  Core:MergeLive(live)
  local finished = Core:Reconcile()
  if ns.UI then ns.UI:Refresh() end
  if ns.Tracker then ns.Tracker:Refresh() end
  if ns.Minimap then ns.Minimap:Refresh() end
  if finished > 0 then
    say(string.format("|cff33ff99%d respuesta(s) nueva(s)|r.", finished))
    if ns.Tracker then ns.Tracker:Celebrate() end
  end
  return true
end

function L:Status()
  if not self.enabled then return "|cffff5555sin slots: usa /reload|r" end
  local left = math.max(0, self.slots - self.nextSlot + 1)
  return string.format("en vivo%s · %d slots", self.signals and "" or " (sin señales)", left)
end

-- /woai poll | /woai estado. Devuelve true si consumió el comando.
function L:Slash(msg)
  msg = (msg or ""):lower():match("^%s*(%S*)")
  if msg == "poll" then
    if not self:Poll(false) then say("nada nuevo.") end
    return true
  elseif msg == "estado" or msg == "status" then
    say(string.format("%s · señal esperada %d · %d slots cargados · %d prompt(s) esperando.",
      self:Status(), self.seq + 1, self.loads, Core:Waiting()))
    return true
  end
  return false
end
