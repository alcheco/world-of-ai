-- WoAI: núcleo. Maneja la outbox (SavedVariables) y la lectura de Data.lua.
local ADDON, ns = ...
ns.Core = {}
local Core = ns.Core

Core.AGENTS = { "claude", "codex" }
Core.AGENT_COLOR = { claude = "ffd97757", codex = "ff10a37f" }
Core.AGENT_LABEL = { claude = "Claude", codex = "Codex" }

local function now() return time() end

function Core:Data()
  return WoAI_Data or { sessions = {}, acks = {}, workspaces = {} }
end

function Core:HasData()
  return WoAI_Data ~= nil
end

-- Lo que el companion sabe de un prompt enviado.
function Core:Ack(id)
  local acks = self:Data().acks
  return acks and acks[id]
end

-- Inicializa SavedVariables y limpia de la outbox los prompts ya procesados.
function Core:Init()
  WoAI_DB = WoAI_DB or {}
  WoAI_DB.outbox = WoAI_DB.outbox or {}
  WoAI_DB.settings = WoAI_DB.settings or {}
  WoAI_DB.counter = WoAI_DB.counter or 0
  -- Lo que ya estaba en la outbox al cargar se escribió en disco con el /reload:
  -- el companion ya lo puede ver.
  for _, job in ipairs(WoAI_DB.outbox) do job.sent = true end
  self:Reconcile()
end

-- Pasa al historial los prompts que el companion ya terminó.
-- Devuelve cuántos terminaron en esta llamada.
function Core:Reconcile()
  local kept, finished = {}, 0
  for _, job in ipairs(WoAI_DB.outbox) do
    local ack = self:Ack(job.id)
    if not ack or ack.status == "queued" or ack.status == "running" then
      table.insert(kept, job)
    else
      job.result = ack.status
      job.error = ack.error
      job.finishedAt = ack.updatedAt
      job.unread = true
      job.sent = nil
      if job.sessionId == nil and ack.sessionId then job.sessionId = ack.sessionId end
      self:Remember(job)
      finished = finished + 1
    end
  end
  WoAI_DB.outbox = kept
  return finished
end

-- Prompts enviados (por captura o tras un /reload) que aún esperan respuesta.
function Core:Waiting()
  local n = 0
  for _, job in ipairs(WoAI_DB.outbox) do
    if job.sent then n = n + 1 end
  end
  return n
end

-- Mezcla una actualización recibida por un slot (WoAI_Live) en WoAI_Data.
function Core:MergeLive(live)
  WoAI_Data = WoAI_Data or { sessions = {}, acks = {}, workspaces = {} }
  local d = WoAI_Data
  d.acks = d.acks or {}
  for id, ack in pairs(live.acks or {}) do d.acks[id] = ack end
  d.sessions = d.sessions or {}
  for _, s in ipairs(live.sessions or {}) do
    local found
    for i, old in ipairs(d.sessions) do
      if old.agent == s.agent and old.id == s.id then
        d.sessions[i] = s
        found = true
        break
      end
    end
    if not found then table.insert(d.sessions, s) end
  end
  table.sort(d.sessions, function(a, b) return (a.updatedAt or 0) > (b.updatedAt or 0) end)
  if live.generatedAt and live.generatedAt > (d.generatedAt or 0) then d.generatedAt = live.generatedAt end
end

-- Historial corto de prompts ya resueltos (para avisos y errores).
function Core:Remember(job)
  WoAI_DB.history = WoAI_DB.history or {}
  table.insert(WoAI_DB.history, 1, job)
  while #WoAI_DB.history > 30 do table.remove(WoAI_DB.history) end
end

-- Resultados sin leer.
function Core:Unread()
  local out = {}
  for _, job in ipairs(WoAI_DB.history or {}) do
    if job.unread then table.insert(out, job) end
  end
  return out
end

function Core:MarkSessionRead(agent, sessionId)
  for _, job in ipairs(WoAI_DB.history or {}) do
    if job.agent == agent and job.sessionId == sessionId then job.unread = nil end
  end
end

function Core:MarkAllRead()
  for _, job in ipairs(WoAI_DB.history or {}) do job.unread = nil end
end

-- Nombre corto del proyecto de una carpeta, según lo que exportó el companion.
function Core:ProjectOfCwd(cwd)
  if not cwd then return nil end
  for _, s in ipairs(self:Data().sessions or {}) do
    if s.cwd == cwd and s.project then return s.project end
  end
  return cwd:match("([^/]+)/*$")
end

-- Sesiones agrupadas por proyecto: { {name=, sessions={...}, updatedAt=}, ... }
function Core:Groups(filter, search)
  local byName, groups = {}, {}
  for _, s in ipairs(self:Sessions(filter, search)) do
    local name = s.project or "Sin proyecto"
    local g = byName[name]
    if not g then
      g = { name = name, sessions = {}, updatedAt = 0, noProject = s.project == nil }
      byName[name] = g
      table.insert(groups, g)
    end
    table.insert(g.sessions, s)
    if (s.updatedAt or 0) > g.updatedAt then g.updatedAt = s.updatedAt end
  end
  table.sort(groups, function(a, b)
    if a.noProject ~= b.noProject then return not a.noProject end
    return a.updatedAt > b.updatedAt
  end)
  return groups
end

function Core:NewId()
  WoAI_DB.counter = WoAI_DB.counter + 1
  return string.format("%d-%d-%d", now(), WoAI_DB.counter, math.random(1000, 9999))
end

-- Encola un prompt. sessionId nil = sesión nueva en cwd.
function Core:Enqueue(agent, sessionId, cwd, prompt)
  prompt = prompt and strtrim(prompt) or ""
  if prompt == "" then return nil, "El prompt está vacío." end
  local job = {
    id = self:NewId(),
    agent = agent,
    sessionId = sessionId,
    cwd = cwd,
    prompt = prompt,
    createdAt = now(),
  }
  table.insert(WoAI_DB.outbox, job)
  return job
end

function Core:Cancel(id)
  for i, job in ipairs(WoAI_DB.outbox) do
    if job.id == id then
      table.remove(WoAI_DB.outbox, i)
      return true
    end
  end
end

-- Prompts pendientes de una sesión (o de sesiones nuevas si sessionId es nil).
function Core:PendingFor(agent, sessionId)
  local out = {}
  for _, job in ipairs(WoAI_DB.outbox) do
    if job.agent == agent and job.sessionId == sessionId then table.insert(out, job) end
  end
  return out
end

function Core:Sessions(filter, search)
  local out = {}
  search = search and search ~= "" and search:lower() or nil
  for _, s in ipairs(self:Data().sessions or {}) do
    if (not filter or filter == "all" or s.agent == filter) then
      local hay = ((s.title or "") .. " " .. (s.project or "") .. " " .. (s.worktree or "")):lower()
      if not search or hay:find(search, 1, true) then table.insert(out, s) end
    end
  end
  return out
end

function Core:FindSession(agent, id)
  for _, s in ipairs(self:Data().sessions or {}) do
    if s.agent == agent and s.id == id then return s end
  end
end

-- "hace 5 min"
function Core:Ago(ts)
  if not ts then return "?" end
  local d = now() - ts
  if d < 60 then return "hace un momento" end
  if d < 3600 then return string.format("hace %d min", math.floor(d / 60)) end
  if d < 86400 then return string.format("hace %d h", math.floor(d / 3600)) end
  return string.format("hace %d d", math.floor(d / 86400))
end

-- Escapa texto para FontStrings (el | inicia códigos de color en WoW).
function Core:Escape(text)
  return (text or ""):gsub("|", "||")
end

local f = CreateFrame("Frame")
f:RegisterEvent("ADDON_LOADED")
f:SetScript("OnEvent", function(_, event, name)
  if name ~= ADDON then return end
  f:UnregisterEvent("ADDON_LOADED")
  Core:Init()
  if ns.UI then ns.UI:Init() end
  if ns.Tracker then ns.Tracker:Init() end
  if ns.Minimap then ns.Minimap:Init() end
  if ns.Live then ns.Live:Init() end
  if ns.Uplink then ns.Uplink:Init() end
  local n = #(Core:Data().sessions or {})
  local unread = #Core:Unread()
  if Core:HasData() then
    print(string.format("|cff8fd3ffWoAI|r: %d sesiones (datos %s). Escribe /woai.", n, Core:Ago(Core:Data().generatedAt)))
    if unread > 0 then
      print(string.format("|cff8fd3ffWoAI|r: |cff33ff99%d respuesta(s) nueva(s)|r. Míralas en el bloque WoAI bajo las misiones.", unread))
      if ns.Tracker then C_Timer.After(2, function() ns.Tracker:Celebrate() end) end
    end
  else
    print("|cff8fd3ffWoAI|r: sin datos todavía. Inicia el companion y haz /reload.")
  end
end)
