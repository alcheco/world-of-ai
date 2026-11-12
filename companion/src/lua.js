// Parser y serializador mínimos de literales Lua.
// Suficiente para leer los SavedVariables que escribe WoW y para generar Data.lua.

/**
 * Parsea un archivo de SavedVariables (`Nombre = valor` repetido) y devuelve
 * un objeto { Nombre: valor }.
 * Las tablas con claves 1..n consecutivas se devuelven como arrays.
 */
export function parseSavedVariables(src) {
  const p = new Parser(src);
  const out = {};
  p.ws();
  while (!p.eof()) {
    const name = p.ident();
    p.ws();
    p.expect('=');
    out[name] = p.value();
    p.ws();
  }
  return out;
}

class Parser {
  constructor(src) {
    this.s = src;
    this.i = 0;
  }
  eof() {
    return this.i >= this.s.length;
  }
  peek() {
    return this.s[this.i];
  }
  err(msg) {
    throw new Error(`Lua parse error at ${this.i}: ${msg}`);
  }
  expect(ch) {
    if (this.s[this.i] !== ch) this.err(`expected '${ch}', got '${this.s[this.i]}'`);
    this.i++;
  }
  ws() {
    for (;;) {
      while (this.i < this.s.length && /\s/.test(this.s[this.i])) this.i++;
      if (this.s.startsWith('--', this.i)) {
        const lb = this.longBracketLevel(this.i + 2);
        if (lb >= 0) {
          this.i += 2;
          this.longString();
        } else {
          while (this.i < this.s.length && this.s[this.i] !== '\n') this.i++;
        }
        continue;
      }
      return;
    }
  }
  ident() {
    const m = /^[A-Za-z_][A-Za-z0-9_]*/.exec(this.s.slice(this.i, this.i + 256));
    if (!m) this.err('expected identifier');
    this.i += m[0].length;
    return m[0];
  }
  longBracketLevel(at) {
    if (this.s[at] !== '[') return -1;
    let j = at + 1;
    let lvl = 0;
    while (this.s[j] === '=') {
      lvl++;
      j++;
    }
    return this.s[j] === '[' ? lvl : -1;
  }
  longString() {
    const lvl = this.longBracketLevel(this.i);
    this.i += lvl + 2;
    if (this.s[this.i] === '\r') this.i++;
    if (this.s[this.i] === '\n') this.i++;
    const close = ']' + '='.repeat(lvl) + ']';
    const end = this.s.indexOf(close, this.i);
    if (end < 0) this.err('unterminated long string');
    const str = this.s.slice(this.i, end);
    this.i = end + close.length;
    return str;
  }
  value() {
    this.ws();
    const c = this.peek();
    if (c === '{') return this.table();
    if (c === '"' || c === "'") return this.string();
    if (c === '[' && this.longBracketLevel(this.i) >= 0) return this.longString();
    if (c === '-' || /[0-9.]/.test(c)) return this.number();
    const id = this.ident();
    if (id === 'true') return true;
    if (id === 'false') return false;
    if (id === 'nil') return null;
    this.err(`unexpected identifier '${id}'`);
  }
  number() {
    const m = /^-?(0[xX][0-9a-fA-F]+|(\d+\.?\d*|\.\d+)([eE][+-]?\d+)?|inf|nan)/.exec(
      this.s.slice(this.i, this.i + 64),
    );
    if (!m) this.err('bad number');
    this.i += m[0].length;
    return Number(m[0]);
  }
  string() {
    const q = this.s[this.i++];
    const bytes = [];
    const pushStr = (str) => bytes.push(...Buffer.from(str, 'utf8'));
    for (;;) {
      if (this.eof()) this.err('unterminated string');
      const c = this.s[this.i++];
      if (c === q) break;
      if (c !== '\\') {
        pushStr(c);
        continue;
      }
      const e = this.s[this.i++];
      const map = { n: '\n', t: '\t', r: '\r', a: '\x07', b: '\b', f: '\f', v: '\v', '\\': '\\', '"': '"', "'": "'", '\n': '\n' };
      if (e in map) pushStr(map[e]);
      else if (/[0-9]/.test(e)) {
        let d = e;
        while (d.length < 3 && /[0-9]/.test(this.s[this.i])) d += this.s[this.i++];
        bytes.push(Number(d)); // escape decimal = byte crudo
      } else if (e === 'x') {
        bytes.push(parseInt(this.s.slice(this.i, this.i + 2), 16));
        this.i += 2;
      } else pushStr(e);
    }
    return Buffer.from(bytes).toString('utf8');
  }
  table() {
    this.expect('{');
    const arr = [];
    const obj = {};
    let isArray = true;
    let nextIndex = 1;
    for (;;) {
      this.ws();
      if (this.peek() === '}') {
        this.i++;
        break;
      }
      let key;
      if (this.peek() === '[' && this.longBracketLevel(this.i) < 0) {
        this.i++;
        key = this.value();
        this.ws();
        this.expect(']');
        this.ws();
        this.expect('=');
      } else {
        const save = this.i;
        if (/[A-Za-z_]/.test(this.peek())) {
          const id = this.ident();
          this.ws();
          if (this.peek() === '=' && this.s[this.i + 1] !== '=') {
            this.i++;
            key = id;
          } else this.i = save;
        }
      }
      const val = this.value();
      if (key === undefined) key = nextIndex;
      if (typeof key === 'number' && key === nextIndex) {
        arr.push(val);
        nextIndex++;
      } else isArray = false;
      obj[key] = val;
      this.ws();
      if (this.peek() === ',' || this.peek() === ';') this.i++;
    }
    return isArray ? arr : obj;
  }
}

/** Serializa un valor JS como literal Lua (cadena). */
export function toLua(v, indent = '') {
  if (v === null || v === undefined) return 'nil';
  if (typeof v === 'boolean') return v ? 'true' : 'false';
  if (typeof v === 'number') return Number.isFinite(v) ? String(v) : '0';
  if (typeof v === 'string') return luaString(v);
  const inner = indent + '  ';
  if (Array.isArray(v)) {
    if (v.length === 0) return '{}';
    return '{\n' + v.map((x) => inner + toLua(x, inner) + ',\n').join('') + indent + '}';
  }
  const keys = Object.keys(v).filter((k) => v[k] !== undefined && v[k] !== null);
  if (keys.length === 0) return '{}';
  return (
    '{\n' +
    keys
      .map((k) => {
        const key = /^[A-Za-z_][A-Za-z0-9_]*$/.test(k) ? k : `[${luaString(k)}]`;
        return `${inner}${key} = ${toLua(v[k], inner)},\n`;
      })
      .join('') +
    indent +
    '}'
  );
}

export function luaString(s) {
  let out = '"';
  for (const ch of s) {
    const code = ch.codePointAt(0);
    if (ch === '"') out += '\\"';
    else if (ch === '\\') out += '\\\\';
    else if (ch === '\n') out += '\\n';
    else if (ch === '\r') continue;
    else if (ch === '\t') out += '    ';
    else if (code < 32 || code === 127) out += `\\${String(code).padStart(3, '0')}`;
    else out += ch;
  }
  return out + '"';
}
