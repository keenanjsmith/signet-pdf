// Decides which of your details belongs in which box.
// Pure logic with no browser code, so it can be tested on its own.
//
// A "target" is anything fillable:
//   { id, page, source: 'field'|'spot', type: 'text'|'check'|'radio'|'choice'|'sig',
//     name?, words?, tu?, label, rect:{x,y,w,h}, maxLen?, comb?, value?, readOnly?,
//     part?, parts?, group? (spots only: position within a row of boxes) }

export const PROFILE_FIELDS = [
  { key: 'firstName', label: 'First name', group: 'name', autocomplete: 'given-name' },
  { key: 'middleName', label: 'Middle name', group: 'name', autocomplete: 'additional-name' },
  { key: 'lastName', label: 'Last name', group: 'name', autocomplete: 'family-name' },
  { key: 'suffix', label: 'Suffix (Jr., III)', group: 'name', autocomplete: 'honorific-suffix' },
  { key: 'email', label: 'Email', group: 'contact', type: 'email', autocomplete: 'email' },
  { key: 'phone', label: 'Phone', group: 'contact', type: 'tel', autocomplete: 'tel' },
  { key: 'street', label: 'Street address', group: 'address', autocomplete: 'address-line1' },
  { key: 'unit', label: 'Apt / unit', group: 'address', autocomplete: 'address-line2' },
  { key: 'city', label: 'City', group: 'address', autocomplete: 'address-level2' },
  { key: 'state', label: 'State (2 letters)', group: 'address', autocomplete: 'address-level1' },
  { key: 'zip', label: 'ZIP code', group: 'address', autocomplete: 'postal-code' },
  { key: 'country', label: 'Country', group: 'address', autocomplete: 'country-name' },
  { key: 'dob', label: 'Date of birth', group: 'private', type: 'date', private: true },
  { key: 'ssn', label: 'Social Security number', group: 'private', private: true },
  { key: 'vaFile', label: 'VA file number', group: 'private', private: true },
  { key: 'serviceNumber', label: 'Service number / DoD ID', group: 'private', private: true },
];
export const PRIVATE_KEYS = new Set(PROFILE_FIELDS.filter((f) => f.private).map((f) => f.key));

/* ------------------------------------------------------------------ */
/* Reading what a box is for                                           */
/* ------------------------------------------------------------------ */

const lc = (s) => String(s || '').toLowerCase().replace(/[’']/g, "'").replace(/\s+/g, ' ').trim();
const GENERIC_WORDS = new Set(['text', 'txt', 'field', 'fill', 'in', 'untitled', 'undefined', 'textfield', 'box', 'tf', 'cb', 'check', 'checkbox', 'group', 'form', 'topmostsubform', 'input', 'entry', 'line', 'row', 'data', 'value']);
const GENERIC = { test: (name) => String(name).split(/\s+/).filter(Boolean).every((w) => GENERIC_WORDS.has(w) || /^\d+$/.test(w) || /^[a-z]\d*$/.test(w)) };

/** The words that describe a target, best sources first. */
export function hintOf(t) {
  if (t.source === 'spot') return lc(t.label);
  const name = lc(t.words);
  const parts = [];
  if (name && !GENERIC.test(name)) parts.push(name);
  if (t.tu) parts.push(lc(t.tu));
  // The printed label is the fallback; for well-named fields it can describe a neighbor instead.
  if (!parts.length || parts.join(' ').split(' ').length < 2) parts.push(lc(t.label));
  return parts.join(' | ');
}

// Words that mean the box is about someone or something other than you.
const OTHER_PERSON = /\b(spouse|spouse's|husband|wife|child|child's|children|son|daughter|dependents?|dependants?|beneficiar\w*|emergency|point of contact|contact person|employer|company|business|mother|father|parents?|guardian|witness\w*|physician|doctor|provider|hospital|facility|clinic|representative|poa|attorney|agent|alternate signer|school|institution|landlord|previous|former|prior|forwarding|new address|reference|co-?signers?|co-?applicants?|co-?borrower|joint|financial institution|bank|of unit|unit name|organization|preparer|notary|examiner|officer|supervisor|manager|nurse|insurance|insured|subscriber|caregiver|relatives?|friend|other person|other than|other names?|alias|aliases|maiden|nickname|served under|also known as|aka)\b/;
// Words that mean the box isn't one of yours, without saying anything about the boxes around it.
const NOT_YOURS = /\b(international|fax|stamp|official use|for va use|office use|do not write)\b/;

/** About someone else? ("Veteran / beneficiary" means you.) */
function isOther(h) {
  return OTHER_PERSON.test(h.replace(/\b(veteran|claimant|applicant)s?('s)?\s*(\/|or)?\s*beneficiar(y|ies)('s)?/g, '$1'));
}

function sectionKey(t) {
  const m = /^\s*(\d+[a-z]?)\s*\.?\s*(?:([a-z])\s*\.)?/i.exec((t.source === 'spot' ? t.section : t.tu) || '');
  return m ? `${t.page}:${m[1].toLowerCase()}${m[2] ? '.' + m[2].toLowerCase() : ''}` : null;
}

/**
 * What a single target is for.
 * @returns {{ key: string|null, part: string|number|null, other: boolean, role: 'signature'|'initials'|'dateSigned'|null }}
 */
export function classify(t) {
  const h = hintOf(t);
  const out = { key: null, part: null, other: isOther(t.source === 'spot' ? `${h} ${lc(t.section)}` : h), role: null, hint: h };
  const skip = NOT_YOURS.test(h);
  // Which piece of a split answer: the box's own name says it best, then the tooltip's last sentence.
  const own = [lc(t.words), lc(String(t.tu || '').split(/\.\s+/).filter(Boolean).pop()), h];
  // For signature boxes, judge whose they are by the short description only;
  // long legal text around them mentions all sorts of people.
  const shortHint = lc([t.words, String(t.tu || '').slice(0, 90), t.source === 'spot' ? `${t.label} ${t.section || ''}` : ''].join(' '));
  if (t.type === 'sig') { out.role = 'signature'; out.other = isOther(shortHint); return out; }
  const bare = h.replace(/[^a-z ]/g, ' ').replace(/\s+/g, ' ').trim();
  if (/\b(date signed|signature date|date of signature|date of signing|today'?s date)\b/.test(h) || bare === 'date' || bare === 'dated') { out.role = 'dateSigned'; out.key = 'today'; }
  else if (/\b(signature|sign here|signed by|signer)\b/.test(h) && !/\b(date|printed|print|typed)\b/.test(h)) { out.role = 'signature'; out.other = isOther(shortHint); return out; }
  else if (/\binitials?\b/.test(h) && !/\bmiddle initials?\b/.test(h) && !/\bname\b/.test(h)) { out.role = 'initials'; return out; }
  if (t.type !== 'text' && t.type !== 'spot' && t.source !== 'spot') return out;
  if (out.role === 'dateSigned') { out.part = firstOf(own, datePart); return out; }
  if (skip) return out;

  // The box's own name is the most specific description; long tooltips often
  // list every part of an address or name, so they come second.
  const name = lc(t.words);
  const tuAll = lc(t.tu);
  const tuLast = lc(String(t.tu || '').split(/\.\s+/).filter(Boolean).pop());
  const sources = t.source === 'spot' ? [h] : [name && !GENERIC.test(name) ? name : '', tuLast, tuAll, lc(t.label)];
  for (const src of sources) {
    if (!src) continue;
    const key = keyOf(src);
    if (!key) continue;
    out.key = key;
    if (key === 'ssn') out.part = firstOf(own, ssnPart);
    else if (key === 'dob') out.part = firstOf(own, datePart);
    else if (key === 'phone') out.part = firstOf(own, phonePart);
    else if (key === 'email') out.part = /\bline 2\b/.test(h) ? 1 : 0;
    else if (key === 'zip') out.part = firstOf(own, zipPart);
    else if (key === 'nameList') out.part = nameList(src);
    else if (key === 'skip') out.key = null;
    return out;
  }
  return out;
}

/** What kind of answer a description asks for. */
function keyOf(h) {
  if (/\b(ssn|social security|soc\.? sec)\b/.test(h)) return 'ssn';
  if (/\b(va file|c-?file|claim (number|no)|file (number|no))\b/.test(h)) return 'vaFile';
  if (/\b(service (number|no)|dod id|edipi)\b/.test(h)) return 'serviceNumber';
  if (/\b(date of birth|birth ?date|dob|born)\b/.test(h)) return 'dob';
  if (/\be-?mail\b/.test(h)) return 'email';
  if (/\b(tele)?phone\b|\btel\b|\bmobile\b|\bcell\b/.test(h)) return 'phone';
  if (/\b(zip|postal code|post code|zip code)\b/.test(h)) return 'zip';
  if (/\bcountry\b/.test(h) && !/\bcounty\b/.test(h)) return 'country';
  if (/\b(state|province)\b/.test(h) && !/\b(united states|statement)\b/.test(h)) return 'state';
  if (/\b(city|town)\b/.test(h)) return 'city';
  if (/\b(apartment|apt|suite|unit (number|no|#)|address line 2|address 2)\b/.test(h)) return 'unit';
  if (/\b(street|address line 1|address 1|mailing address|home address|residential address|number and street|no\.? & street|address)\b/.test(h)) return 'street';
  const nameish = /\bname\b/.test(h) || /\b(first|last|middle|given|family|sur)name\b/.test(h);
  if (nameish && nameList(h)) return 'nameList';
  if (/\b(middle initial|m\.?i\.?)\b/.test(h) && nameish) return 'middleInitial';
  if (/\bsuffix\b/.test(h)) return 'suffix';
  if (!nameish) return null;
  if (nameList(h)) return 'nameList';
  if (/\b(first( name)?|given name|forename|fname|firstname)\b/.test(h) && !/\bfirst (three|five|two|four)\b/.test(h)) return 'firstName';
  if (/\b(last( name)?|surname|family name|lname|lastname)\b/.test(h) && !/\blast (four|two|three)\b/.test(h)) return 'lastName';
  if (/\bmiddle( name)?\b/.test(h)) return 'middleName';
  if (/\b(name of|names of)\b/.test(h) && !/\b(your|applicant|veteran|claimant|patient|employee|member)\b/.test(h)) return 'skip';
  return 'fullName';
}

function zipPart(h) {
  if (/\b(last four|last 4|plus ?4|\+4|extension)\b/.test(h)) return 1;
  if (/\b(first five|first 5)\b/.test(h)) return 0;
  return null;
}

function firstOf(sources, fn) {
  for (const src of sources) { if (!src) continue; const v = fn(src); if (v != null) return v; }
  return null;
}

/** Order of the pieces in a written date format like "(MM-DD-YYYY)". */
function dateOrder(h) {
  const m = /\b(mm|dd|yyyy|yy)\s*[-/.]\s*(mm|dd|yyyy|yy)\s*[-/.]\s*(mm|dd|yyyy|yy)\b/.exec(h);
  return m ? [m[1], m[2], m[3]].map((x) => x[0] === 'y' ? 'y' : x[0]) : null;
}

function datePart(h) {
  if (dateOrder(h)) return null; // a whole format, not one piece
  if (/\bmonth\b|\bmm\b(?![-/ ]?dd)/.test(h) && !/\b(day|year)\b/.test(h)) return 'm';
  if (/\bday\b/.test(h) && !/\b(month|year)\b/.test(h)) return 'd';
  if (/\byear\b|\byyyy\b(?![-/])/.test(h) && !/\b(month|day)\b/.test(h)) return 'y';
  return null;
}
function ssnPart(h) {
  if (/\b(first three|first 3)\b/.test(h)) return 0;
  if (/\b(middle two|second two|middle 2|second 2)\b/.test(h)) return 1;
  if (/\b(last four|last 4)\b/.test(h)) return 2;
  return null;
}
function phonePart(h) {
  if (/\barea code\b/.test(h) && !/\binclude area code\b/.test(h)) return 0;
  if (/\b(middle three|middle 3|second three|second 3|prefix|exchange)\b/.test(h)) return 1;
  if (/\b(last four|last 4|line number)\b/.test(h)) return 2;
  return null;
}
/** "(First, Middle Initial, Last)" style lists, in order. */
function nameList(h) {
  const m = /\(([^)]*\b(first|last)\b[^)]*)\)/.exec(h);
  if (!m) return null;
  const order = [];
  for (const piece of m[1].split(/[,/]| and /)) {
    const p = piece.trim();
    if (/middle initial|\bmi\b/.test(p)) order.push('middleInitial');
    else if (/middle/.test(p)) order.push('middleName');
    else if (/first|given/.test(p)) order.push('firstName');
    else if (/last|sur|family/.test(p)) order.push('lastName');
    else if (/suffix/.test(p)) order.push('suffix');
  }
  return order.length >= 2 ? order : null;
}

/* ------------------------------------------------------------------ */
/* Formatting a value to fit a box                                     */
/* ------------------------------------------------------------------ */

const digits = (s) => String(s || '').replace(/\D/g, '');
const STATES = { AL: 'Alabama', AK: 'Alaska', AZ: 'Arizona', AR: 'Arkansas', CA: 'California', CO: 'Colorado', CT: 'Connecticut', DE: 'Delaware', DC: 'District of Columbia', FL: 'Florida', GA: 'Georgia', HI: 'Hawaii', ID: 'Idaho', IL: 'Illinois', IN: 'Indiana', IA: 'Iowa', KS: 'Kansas', KY: 'Kentucky', LA: 'Louisiana', ME: 'Maine', MD: 'Maryland', MA: 'Massachusetts', MI: 'Michigan', MN: 'Minnesota', MS: 'Mississippi', MO: 'Missouri', MT: 'Montana', NE: 'Nebraska', NV: 'Nevada', NH: 'New Hampshire', NJ: 'New Jersey', NM: 'New Mexico', NY: 'New York', NC: 'North Carolina', ND: 'North Dakota', OH: 'Ohio', OK: 'Oklahoma', OR: 'Oregon', PA: 'Pennsylvania', RI: 'Rhode Island', SC: 'South Carolina', SD: 'South Dakota', TN: 'Tennessee', TX: 'Texas', UT: 'Utah', VT: 'Vermont', VA: 'Virginia', WA: 'Washington', WV: 'West Virginia', WI: 'Wisconsin', WY: 'Wyoming', PR: 'Puerto Rico', GU: 'Guam', VI: 'U.S. Virgin Islands', AS: 'American Samoa', MP: 'Northern Mariana Islands', AA: 'Armed Forces Americas', AE: 'Armed Forces Europe', AP: 'Armed Forces Pacific' };
export function stateCode(s) {
  const v = String(s || '').trim();
  if (/^[a-z]{2}$/i.test(v)) return v.toUpperCase();
  const hit = Object.entries(STATES).find(([, name]) => name.toLowerCase() === v.toLowerCase());
  return hit ? hit[0] : v;
}
const isUS = (c) => !c || /^(us|usa|u\.s\.a?\.?|united states( of america)?|america)$/i.test(String(c).trim());

/** Split a stored date (YYYY-MM-DD) into pieces. */
function dateBits(iso) {
  const m = /^(\d{4})-(\d{2})-(\d{2})$/.exec(iso || '');
  return m ? { y: m[1], m: m[2], d: m[3] } : null;
}

/** Date written the way the box asks for it. */
function formatDate(bits, t, hint) {
  if (!bits) return '';
  const max = t.maxLen || 0;
  if (max === 8 && (t.comb || !/[-/]/.test(hint))) return bits.m + bits.d + bits.y;
  if (max === 6) return bits.m + bits.d + bits.y.slice(2);
  const sep = /mm-dd|dd-mm|-yyyy|mm - dd/.test(hint) ? '-' : '/';
  if (/\bdd[-/ ]mm\b/.test(hint)) return [bits.d, bits.m, bits.y].join(sep);
  if (/\byyyy[-/ ]mm\b/.test(hint)) return [bits.y, bits.m, bits.d].join(sep);
  return [bits.m, bits.d, bits.y].join(sep);
}

function fit(value, t) {
  let v = String(value ?? '');
  if (t.maxLen && v.length > t.maxLen) v = v.slice(0, t.maxLen);
  return v;
}

export function fullName(p) {
  return [p.firstName, p.middleName, p.lastName, p.suffix].map((s) => String(s || '').trim()).filter(Boolean).join(' ');
}

/** Today's date as a box wants it. */
export function todayFor(t, now = new Date()) {
  const bits = { y: String(now.getFullYear()), m: String(now.getMonth() + 1).padStart(2, '0'), d: String(now.getDate()).padStart(2, '0') };
  const c = classify(t);
  const part = c.part ?? (t.parts === 3 ? (dateOrder(c.hint) || ['m', 'd', 'y'])[t.part] : null);
  if (part === 'm') return bits.m;
  if (part === 'd') return bits.d;
  if (part === 'y') return t.maxLen === 2 ? bits.y.slice(2) : bits.y;
  return formatDate(bits, t, c.hint);
}

/**
 * Value for one target, or '' if your info doesn't cover it.
 * `part` may come from the box's own wording or from its position in a row.
 */
export function valueFor(key, part, t, p, hint = '') {
  const single = !t.parts || t.parts === 1;
  switch (key) {
    case 'firstName': return fit(p.firstName, t);
    case 'lastName': return fit(p.lastName, t);
    case 'middleName': return fit(p.middleName, t);
    case 'middleInitial': return (p.middleName || '').trim().charAt(0).toUpperCase();
    case 'suffix': return fit(p.suffix, t);
    case 'fullName': return fit(fullName(p), t);
    case 'email': {
      const e = String(p.email || '');
      if (part === 1) return t.maxLen ? e.slice(t.maxLen) : '';
      return fit(e, t);
    }
    case 'phone': {
      let d = digits(p.phone);
      if (d.length === 11 && d[0] === '1') d = d.slice(1);
      if (d.length !== 10) return part == null ? fit(p.phone, t) : '';
      if (part === 0) return d.slice(0, 3);
      if (part === 1) return d.slice(3, 6);
      if (part === 2) return d.slice(6);
      if (part === 'rest') return d.slice(3);
      if (t.comb || (t.maxLen >= 10 && t.maxLen <= 11)) return d;
      return `(${d.slice(0, 3)}) ${d.slice(3, 6)}-${d.slice(6)}`;
    }
    case 'ssn': {
      const d = digits(p.ssn);
      if (d.length !== 9) return '';
      if (part === 0) return d.slice(0, 3);
      if (part === 1) return d.slice(3, 5);
      if (part === 2) return d.slice(5);
      if (t.comb || t.maxLen === 9) return d;
      return `${d.slice(0, 3)}-${d.slice(3, 5)}-${d.slice(5)}`;
    }
    case 'zip': {
      const d = digits(p.zip);
      if (part === 1) return d.length === 9 ? d.slice(5) : '';
      if (part === 0 || t.maxLen === 5 || (single && d.length === 5)) return d.slice(0, 5);
      if (d.length === 9 && (!t.maxLen || t.maxLen >= 10)) return `${d.slice(0, 5)}-${d.slice(5)}`;
      return fit(d.slice(0, 5), t);
    }
    case 'state': {
      const code = stateCode(p.state);
      if (t.maxLen === 2 || t.comb || /^[A-Z]{2}$/.test(code) && (!t.rect || t.rect.w < 90)) return fit(code, t);
      return STATES[code] || p.state || '';
    }
    case 'country': {
      if (!p.country && !p.city) return '';
      if (isUS(p.country)) return t.maxLen === 2 ? 'US' : t.maxLen === 3 ? 'USA' : (t.rect && t.rect.w < 60 ? 'US' : 'United States');
      return fit(p.country, t);
    }
    case 'street': return fit(p.street, t);
    case 'unit': return fit(p.unit, t);
    case 'city': return fit(p.city, t);
    case 'dob': {
      const b = dateBits(p.dob);
      if (!b) return '';
      if (part === 'm') return b.m;
      if (part === 'd') return b.d;
      if (part === 'y') return t.maxLen === 2 ? b.y.slice(2) : b.y;
      return fit(formatDate(b, t, hint), t);
    }
    case 'vaFile': return fit(t.comb || t.maxLen ? digits(p.vaFile) || p.vaFile : p.vaFile, t);
    case 'serviceNumber': return fit(p.serviceNumber, t);
    default: return '';
  }
}

/* ------------------------------------------------------------------ */
/* Planning a whole document                                           */
/* ------------------------------------------------------------------ */

const ORDERED_PARTS = { ssn: [0, 1, 2], phone: [0, 1, 2], dob: ['m', 'd', 'y'], zip: [0, 1], email: [0, 1] };

/**
 * Work out what to put where.
 * @param {Array} targets
 * @param {object} profile  your details (private ones only if unlocked)
 * @returns {{ fills: Array<{target, key, value}>, lockedCount: number, roles: Map<id, {role, other}> }}
 */
export function plan(targets, profile, { unlocked = false } = {}) {
  const info = targets.map((t) => ({ t, c: classify(t) }));

  // Anything in a section that is about someone else is skipped as a whole
  // (e.g. "14. F. Point of contact telephone" and the boxes that follow it).
  const otherSections = new Set(info.filter((x) => x.c.other && sectionKey(x.t)).map((x) => sectionKey(x.t)));
  for (const x of info) { const s = sectionKey(x.t); if (s && otherSections.has(s)) x.c.other = true; }

  // Rows of boxes (flat PDFs): share the first box's meaning, then split by position.
  const groups = new Map();
  for (const x of info) if (x.t.group != null && x.t.parts > 1) { const k = `${x.t.page}:${x.t.group}`; if (!groups.has(k)) groups.set(k, []); groups.get(k).push(x); }
  for (const members of groups.values()) {
    members.sort((a, b) => a.t.part - b.t.part);
    const lead = { ...members[0].c };
    for (const x of members) {
      x.c.key = lead.key; x.c.other = lead.other; x.c.role = lead.role;
      if (lead.key === 'nameList') x.c.part = lead.part[x.t.part] || null;
      else if (lead.key === 'phone' && members.length === 2) x.c.part = x.t.part === 0 ? 0 : 'rest';
      else if (lead.key === 'dob' && members.length === 3) x.c.part = (dateOrder(lead.hint) || ['m', 'd', 'y'])[x.t.part];
      else if (ORDERED_PARTS[lead.key] && members.length === ORDERED_PARTS[lead.key].length) x.c.part = ORDERED_PARTS[lead.key][x.t.part];
      else if (lead.role === 'dateSigned' && members.length === 3) x.c.part = (dateOrder(lead.hint) || ['m', 'd', 'y'])[x.t.part];
      else if (members.length > 1 && ORDERED_PARTS[lead.key]) x.c.key = null; // unknown split: leave for you
    }
  }

  // Real form boxes split into pieces without saying which piece is which:
  // use left-to-right order within the same row and section.
  const byRow = new Map();
  for (const x of info) {
    if (x.t.source !== 'field' || !ORDERED_PARTS[x.c.key] || x.c.key === 'email' || x.c.other) continue;
    const k = `${x.t.page}:${x.c.key}:${Math.round(x.t.rect.y / 6)}:${sectionKey(x.t) || ''}`;
    if (!byRow.has(k)) byRow.set(k, []);
    byRow.get(k).push(x);
  }
  for (const row of byRow.values()) {
    if (row.length < 2) continue;
    row.sort((a, b) => a.t.rect.x - b.t.rect.x);
    const order = ORDERED_PARTS[row[0].c.key];
    // A full row of pieces: left-to-right order is the most reliable guide.
    if (row.length === order.length && row.every((x, i) => !x.t.maxLen || !x.c.part || x.c.part === order[i] || true)) row.forEach((x, i) => { x.c.part = order[i]; });
    else row.forEach((x) => { if (x.c.part == null) x.c.key = null; });
  }

  // On flat pages, the same answer twice in one section is almost always a
  // second line or a different question with a short label; fill the first only.
  const seen = new Set();
  for (const x of info) {
    if (x.t.source !== 'spot' || !x.c.key || x.t.parts > 1) continue;
    const k = `${x.t.page}:${x.c.key}:${sectionKey(x.t) || x.t.section || ''}`;
    if (seen.has(k)) x.c.key = null; else seen.add(k);
  }

  const fills = [];
  let lockedCount = 0;
  const roles = new Map();
  for (const { t, c } of info) {
    if (c.role) roles.set(t.id, { role: c.role, other: c.other, part: c.part });
    if (c.role === 'signature' || c.role === 'initials' || c.role === 'dateSigned') continue;
    if (!c.key || c.other || t.readOnly) continue;
    if (t.source === 'field' && (t.type !== 'text' || String(t.value || '').trim())) continue;
    if (PRIVATE_KEYS.has(c.key) && !unlocked) { if (hasPrivate(profile, c.key)) lockedCount++; continue; }
    let key = c.key, part = c.part;
    if (key === 'nameList') { key = Array.isArray(part) ? null : part; part = null; } // a single box asking for a whole list is left to you
    const value = key ? valueFor(key, part, t, profile, c.hint) : '';
    if (!value) continue;
    if (part == null && ORDERED_PARTS[key] && key !== 'email' && t.maxLen && t.maxLen < fullLength(key, profile)) continue; // a piece we can't identify
    fills.push({ target: t, key, value });
  }
  return { fills, lockedCount, roles };
}

function fullLength(key, p) {
  if (key === 'phone') return 10;
  if (key === 'ssn') return 9;
  if (key === 'zip') return 5;
  if (key === 'dob') return 8;
  return 0;
}

function hasPrivate(profile, key) {
  return !!profile?.privateKeys?.includes(key);
}
