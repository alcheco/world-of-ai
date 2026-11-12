-- WoAI: Markdown → bloques renderizables en WoW.
-- Parse() es Lua puro (se prueba fuera del juego); Render() usa la API de frames.
local _, ns = ...
local MD = {}
if ns then ns.Markdown = MD end

-- Colores (AARRGGBB).
local C = {
  heading = "ffffd100",
  bold = "ffffffff",
  italic = "ffb9c9dc",
  code = "ffe8a87c",
  link = "ff6fb8ff",
  quote = "ff9a9a9a",
  bullet = "ffffd100",
  strike = "ff808080",
}
MD.COLORS = C

local function color(c, s) return "|c" .. c .. s .. "|r" end

-- ---------------------------------------------------------------- inline

-- Formato en línea: `código`, **negrita**, *cursiva*, ~~tachado~~, [enlace](url).
function MD.Inline(s)
  local codes = {}
  s = s:gsub("`([^`]+)`", function(c)
    codes[#codes + 1] = c
    return "\001" .. #codes .. "\002"
  end)
  s = s:gsub("|", "||")
  s = s:gsub("%[([^%]]+)%]%(([^%)]*)%)", function(text) return color(C.link, text) end)
  s = s:gsub("%*%*(.-)%*%*", function(t) return color(C.bold, t) end)
  s = s:gsub("%*([^%*%s][^%*]-)%*", function(t) return color(C.italic, t) end)
  s = s:gsub("~~(.-)~~", function(t) return color(C.strike, t) end)
  s = s:gsub("\001(%d+)\002", function(n)
    return color(C.code, (codes[tonumber(n)]:gsub("|", "||")))
  end)
  return s
end

-- ---------------------------------------------------------------- bloques

local function trim(s) return (s:gsub("^%s+", ""):gsub("%s+$", "")) end

local function splitRow(line)
  line = trim(line):gsub("^|", ""):gsub("|$", "")
  local cells = {}
  for cell in (line .. "|"):gmatch("(.-)|") do cells[#cells + 1] = MD.Inline(trim(cell)) end
  return cells
end

local function isTableSep(line)
  return line and line:find("^%s*|?%s*:?%-%-+:?%s*|") ~= nil
end

local function isRow(line)
  return line and line:find("^%s*|") ~= nil
end

local function isHr(line)
  local t = line:gsub("%s", "")
  return #t >= 3 and (t:find("^%-+$") or t:find("^%*+$") or t:find("^_+$")) ~= nil
end

--- Convierte texto markdown en una lista de bloques:
--- { kind = "para"|"heading"|"code"|"table"|"hr", ... }
function MD.Parse(text)
  local lines = {}
  for line in ((text or "") .. "\n"):gmatch("(.-)\r?\n") do lines[#lines + 1] = line end

  local blocks, para = {}, nil
  local function flush()
    if para then
      blocks[#blocks + 1] = { kind = "para", text = table.concat(para, "\n") }
      para = nil
    end
  end
  local function addLine(s)
    para = para or {}
    para[#para + 1] = s
  end

  local i = 1
  while i <= #lines do
    local line = lines[i]
    local fence = line:match("^%s*```+%s*([%w%+%-_#%.]*)")
    if fence then
      flush()
      local code = {}
      i = i + 1
      while i <= #lines and not lines[i]:find("^%s*```") do
        code[#code + 1] = lines[i]
        i = i + 1
      end
      blocks[#blocks + 1] = { kind = "code", lang = fence ~= "" and fence or nil, text = (table.concat(code, "\n"):gsub("|", "||")) }
    elseif isRow(line) and isTableSep(lines[i + 1]) then
      flush()
      local tbl = { kind = "table", header = splitRow(line), rows = {} }
      i = i + 2
      while i <= #lines and isRow(lines[i]) do
        tbl.rows[#tbl.rows + 1] = splitRow(lines[i])
        i = i + 1
      end
      i = i - 1
      local cols = #tbl.header
      for _, r in ipairs(tbl.rows) do if #r > cols then cols = #r end end
      tbl.cols = cols
      blocks[#blocks + 1] = tbl
    elseif line:find("^%s*#+%s") then
      flush()
      local hashes, rest = line:match("^%s*(#+)%s+(.-)%s*#*%s*$")
      blocks[#blocks + 1] = { kind = "heading", level = #hashes, text = MD.Inline(rest) }
    elseif isHr(line) and line:find("%S") then
      flush()
      blocks[#blocks + 1] = { kind = "hr" }
    elseif not line:find("%S") then
      flush()
    else
      local indent, marker, rest = line:match("^(%s*)([%-%*%+])%s+(.*)$")
      local num
      if not marker then indent, num, rest = line:match("^(%s*)(%d+)[%.%)]%s+(.*)$") end
      local quote = line:match("^%s*>%s?(.*)$")
      if marker or num then
        local pad = string.rep("    ", math.floor(#indent / 2))
        local box = nil
        local check = rest:match("^%[([ xX])%]%s+")
        if check then
          rest = rest:gsub("^%[[ xX]%]%s+", "")
          box = check == " " and color(C.quote, "[ ]") or color("ff33ff99", "[x]")
        end
        local bullet = num and color(C.bullet, num .. ".") or color(C.bullet, (#indent >= 2) and "-" or "•")
        addLine(pad .. bullet .. " " .. (box and (box .. " ") or "") .. MD.Inline(rest))
      elseif quote then
        addLine(color(C.quote, "  " .. MD.Inline(quote):gsub("|r", "|r|c" .. C.quote)))
      else
        addLine(MD.Inline(trim(line)))
      end
    end
    i = i + 1
  end
  flush()
  return blocks
end

-- ---------------------------------------------------------------- render (WoW)

local GAP = 6
local CODE_FONT = "Fonts\\ARIALN.TTF"

local function pool(holder)
  local p = holder.mdPool
  if not p then
    p = { fs = {}, boxes = {}, tex = {}, n = {} }
    holder.mdPool = p
  end
  p.n.fs, p.n.boxes, p.n.tex = 0, 0, 0
  return p
end

local function getFS(p, parent, fontObject)
  p.n.fs = p.n.fs + 1
  local fs = p.fs[p.n.fs]
  if not fs then
    fs = parent:CreateFontString(nil, "OVERLAY")
    p.fs[p.n.fs] = fs
  end
  fs:SetParent(parent)
  fs:SetFontObject(fontObject or "GameFontHighlight")
  fs:SetJustifyH("LEFT")
  fs:SetJustifyV("TOP")
  fs:SetSpacing(2)
  fs:SetWordWrap(true)
  fs:SetNonSpaceWrap(true)
  fs:SetTextColor(0.88, 0.88, 0.88)
  fs:SetDrawLayer("OVERLAY", 1)
  fs:ClearAllPoints()
  fs:Show()
  return fs
end

local function getTex(p, parent, r, g, b, a)
  p.n.tex = p.n.tex + 1
  local t = p.tex[p.n.tex]
  if not t then
    t = parent:CreateTexture(nil, "BACKGROUND")
    p.tex[p.n.tex] = t
  end
  t:SetParent(parent)
  t:SetDrawLayer("BACKGROUND", 1)
  t:SetColorTexture(r, g, b, a)
  t:ClearAllPoints()
  t:Show()
  return t
end

local HEADING_FONT = { "GameFontNormalLarge", "GameFontNormalMed3", "GameFontNormal" }

--- Dibuja `text` dentro de `holder` con ancho `width`. Devuelve la altura usada.
function MD.Render(holder, text, width)
  local p = pool(holder)
  local blocks = MD.Parse(text)
  local y = 0

  for bi, b in ipairs(blocks) do
    if bi > 1 then y = y + GAP + (b.kind == "heading" and 4 or 0) end

    if b.kind == "para" then
      local fs = getFS(p, holder)
      fs:SetWidth(width)
      fs:SetText(b.text)
      fs:SetPoint("TOPLEFT", 0, -y)
      y = y + fs:GetStringHeight()

    elseif b.kind == "heading" then
      local font = HEADING_FONT[math.min(b.level, 3)]
      if not _G[font] then font = "GameFontNormal" end
      local fs = getFS(p, holder, font)
      fs:SetTextColor(1, 0.82, 0)
      fs:SetWidth(width)
      fs:SetText(b.text)
      fs:SetPoint("TOPLEFT", 0, -y)
      y = y + fs:GetStringHeight()
      if b.level <= 2 then
        local line = getTex(p, holder, 1, 0.82, 0, 0.25)
        line:SetPoint("TOPLEFT", 0, -(y + 2))
        line:SetSize(width, 1)
        y = y + 4
      end

    elseif b.kind == "code" then
      local bg = getTex(p, holder, 0, 0, 0, 0.55)
      local fs = getFS(p, holder, "GameFontHighlightSmall")
      fs:SetFont(CODE_FONT, 13, "")
      fs:SetTextColor(0.75, 0.9, 0.75)
      fs:SetWidth(width - 16)
      fs:SetText(b.text ~= "" and b.text or " ")
      fs:SetPoint("TOPLEFT", 8, -(y + 6))
      local h = fs:GetStringHeight() + 12
      if b.lang then
        local tag = getFS(p, holder, "GameFontDisableSmall")
        tag:SetText(b.lang)
        tag:SetPoint("TOPRIGHT", holder, "TOPLEFT", width - 6, -(y + 4))
        tag:SetWidth(0)
      end
      bg:SetPoint("TOPLEFT", 0, -y)
      bg:SetSize(width, h)
      local edge = getTex(p, holder, 0.56, 0.83, 1, 0.5)
      edge:SetPoint("TOPLEFT", 0, -y)
      edge:SetSize(2, h)
      y = y + h

    elseif b.kind == "table" then
      local cols = math.max(1, b.cols)
      local colW = width / cols
      local all = { b.header }
      for _, r in ipairs(b.rows) do all[#all + 1] = r end
      for ri, row in ipairs(all) do
        local rowH, cells = 0, {}
        for c = 1, cols do
          local fs = getFS(p, holder, ri == 1 and "GameFontNormalSmall" or "GameFontHighlightSmall")
          if ri == 1 then fs:SetTextColor(1, 0.82, 0) end
          fs:SetWidth(colW - 10)
          fs:SetText(row[c] or "")
          fs:SetPoint("TOPLEFT", (c - 1) * colW + 5, -(y + 4))
          cells[c] = fs
          rowH = math.max(rowH, fs:GetStringHeight())
        end
        rowH = rowH + 8
        local bg = ri == 1 and getTex(p, holder, 1, 0.82, 0, 0.12)
          or getTex(p, holder, 1, 1, 1, ri % 2 == 0 and 0.03 or 0.07)
        bg:SetPoint("TOPLEFT", 0, -y)
        bg:SetSize(width, rowH)
        y = y + rowH
      end
      local border = getTex(p, holder, 1, 0.82, 0, 0.3)
      border:SetPoint("TOPLEFT", 0, -y)
      border:SetSize(width, 1)
      y = y + 1

    elseif b.kind == "hr" then
      local line = getTex(p, holder, 1, 1, 1, 0.15)
      line:SetPoint("TOPLEFT", 0, -(y + 2))
      line:SetSize(width, 1)
      y = y + 5
    end
  end

  for i = p.n.fs + 1, #p.fs do p.fs[i]:Hide() end
  for i = p.n.tex + 1, #p.tex do p.tex[i]:Hide() end
  return math.max(y, 1)
end

return MD
