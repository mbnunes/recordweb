// find_rrweb_node.js
// Usage:
//   node find_rrweb_node.js <rrweb_record.json> <node-id-or-token>
//
// Example:
//   node find_rrweb_node.js recordings/rrweb_record.json 292
//   node find_rrweb_node.js recordings/rrweb_record.json "0cAFcWeA7..."

const fs = require('fs');
const path = require('path');

if (process.argv.length < 4) {
  console.error('Uso: node find_rrweb_node.js <rrweb_record.json> <node-id-ou-token>');
  process.exit(1);
}

const file = process.argv[2];
const queryRaw = process.argv[3];
const isNumber = !isNaN(Number(queryRaw));
const queryId = isNumber ? Number(queryRaw) : null;
const queryToken = isNumber ? null : queryRaw;

if (!fs.existsSync(file)) {
  console.error('Arquivo não encontrado:', file);
  process.exit(1);
}

let events;
try {
  const raw = fs.readFileSync(file, 'utf8');
  events = JSON.parse(raw);
} catch (e) {
  console.error('Erro ao ler/parsear o arquivo:', e.message || e);
  process.exit(1);
}

// Build maps from snapshots and incremental adds
const nodesMap = new Map(); // id -> node
const parentMap = new Map(); // id -> parentId

function registerNode(node, parentId = null) {
  if (!node || typeof node.id === 'undefined') return;
  nodesMap.set(node.id, node);
  if (parentId !== null) parentMap.set(node.id, parentId);
  // childNodes may contain nodes; handle typical rrweb structures
  if (Array.isArray(node.childNodes)) {
    for (const ch of node.childNodes) {
      registerNode(ch, node.id);
    }
  }
  // some rrweb versions store children differently; best-effort only
}

// iterate through events to populate maps
for (let i = 0; i < events.length; i++) {
  const ev = events[i];
  try {
    // full snapshot types may be 0 or 2 depending on rrweb version
    if ((ev.type === 0 || ev.type === 2) && ev.data && ev.data.node) {
      registerNode(ev.data.node, null);
    } else if (ev.type === 1 && ev.data) {
      // incremental: adds (new nodes) often in ev.data.adds — structure: { parentId, nextId, node }
      if (Array.isArray(ev.data.adds)) {
        for (const add of ev.data.adds) {
          if (add && add.node) {
            const pId = typeof add.parentId !== 'undefined' ? add.parentId : null;
            registerNode(add.node, pId);
          }
        }
      }
      // some rrweb payloads include texts/inputs with ids but not full nodes; ignore here
    }
  } catch (e) {
    // ignore malformed event
  }
}

console.log('Nós mapeados:', nodesMap.size);

// find events matching token or id
const matchedEventIndices = [];
for (let i = 0; i < events.length; i++) {
  const ev = events[i];
  try {
    // direct id match in event.data.id
    if (queryId !== null && ev && ev.data && typeof ev.data.id !== 'undefined' && Number(ev.data.id) === queryId) {
      matchedEventIndices.push(i); continue;
    }
    // search for token substring inside serialized event (safe for quick find)
    if (queryToken !== null) {
      const s = JSON.stringify(ev);
      if (s.includes(queryToken)) matchedEventIndices.push(i);
    }
  } catch (e) {}
}

if (matchedEventIndices.length === 0) {
  console.log('Nenhum evento encontrado contendo esse token ou id.');
  // still, if user passed an id, try inspect node map directly
  if (queryId !== null && nodesMap.has(queryId)) {
    console.log('Mas o node id existe no mapa de snapshots.');
  } else {
    process.exit(0);
  }
}

// Show summary of matched events
console.log('Eventos correspondentes (índices):', matchedEventIndices.join(', '));

// We'll focus on the first match for detailed inspection
const idx = matchedEventIndices[0];
const matchedEvent = events[idx];

console.log('\n== Evento encontrado (index ' + idx + '):');
console.log(JSON.stringify(matchedEvent, null, 2));

// Determine the target node id if possible
let targetId = queryId;
if (targetId === null) {
  // try common places to extract id from event structures
  const ev = matchedEvent;
  if (ev && ev.data) {
    if (typeof ev.data.id !== 'undefined') targetId = Number(ev.data.id);
    // texts array: ev.data.texts = [{id, text}, ...]
    if (targetId === null && Array.isArray(ev.data.texts)) {
      for (const t of ev.data.texts) {
        if (t && typeof t.text !== 'undefined' && String(t.text).includes(queryToken)) {
          targetId = Number(t.id); break;
        }
      }
    }
    // inputs array: ev.data.inputs = [{id, value}, ...]
    if (targetId === null && Array.isArray(ev.data.inputs)) {
      for (const it of ev.data.inputs) {
        if (it && typeof it.value !== 'undefined' && String(it.value).includes(queryToken)) {
          targetId = Number(it.id); break;
        }
      }
    }
    // fallback: ev.data.node? (rare)
    if (targetId === null && ev.data.node && typeof ev.data.node.id !== 'undefined') {
      targetId = Number(ev.data.node.id);
    }
  }
}

if (targetId === null) {
  console.warn('Não foi possível extrair um node id do evento automaticamente.');
  process.exit(0);
}

console.log('\nNode id alvo a inspecionar:', targetId);

// helper: build DOM path showing tag[id][name] for each ancestor
function buildDomPathForId(id) {
  if (!nodesMap.has(id)) return null;
  const parts = [];
  let cur = id;
  const visited = new Set();
  while (cur != null && nodesMap.has(cur) && !visited.has(cur)) {
    visited.add(cur);
    const node = nodesMap.get(cur);
    let tag = (node.tagName || node.nodeName || (node.type === 3 ? '#text' : 'node')).toString();
    tag = tag.toLowerCase();
    // prefer attributes stored as 'attributes' or 'attrs' or 'attr'
    const attrs = node.attributes || node.attrs || node.attr || null;
    let suffix = `[${node.id}]`;
    if (attrs) {
      // attrs may be object { id: '...', name: '...' } or array ['attr','val',...]
      let htmlId = null;
      let htmlName = null;
      if (!Array.isArray(attrs) && typeof attrs === 'object') {
        if (attrs.id) htmlId = attrs.id;
        if (attrs.name) htmlName = attrs.name;
      } else if (Array.isArray(attrs)) {
        for (let i = 0; i < attrs.length; i += 2) {
          const k = attrs[i], v = attrs[i + 1];
          if (k === 'id') htmlId = v;
          if (k === 'name') htmlName = v;
        }
      }
      // show id and name (if any)
      if (htmlId) suffix = `#${htmlId}[${node.id}]`;
      if (htmlName) suffix += `[name="${htmlName}"]`;
    }
    const label = `${tag}${suffix}`;
    parts.unshift(label);
    cur = parentMap.has(cur) ? parentMap.get(cur) : null;
  }
  return parts.join(' > ');
}

// function to pretty print a node summary
function summarizeNode(node) {
  const id = node.id;
  const tag = node.tagName || node.nodeName || (node.type === 3 ? '#text' : 'node');
  const attrs = node.attributes || node.attrs || node.attr || null;
  let htmlId = null;
  let htmlName = null;
  if (attrs) {
    if (!Array.isArray(attrs) && typeof attrs === 'object') {
      if (attrs.id) htmlId = attrs.id;
      if (attrs.name) htmlName = attrs.name;
    } else if (Array.isArray(attrs)) {
      for (let i = 0; i < attrs.length; i += 2) {
        const k = attrs[i], v = attrs[i + 1];
        if (k === 'id') htmlId = v;
        if (k === 'name') htmlName = v;
      }
    }
  }
  const text = node.textContent || node.text || (node.value ? String(node.value).slice(0, 80) : '');
  const summary = `[${id}] ${tag}${htmlId ? ' id="'+htmlId+'"' : ''}${htmlName ? ' name="'+htmlName+'"' : ''}${text ? ' -> "'+String(text).slice(0,80)+'"' : ''}`;
  return summary;
}

// Inspect target node
const targetNode = nodesMap.get(targetId);
if (!targetNode) {
  console.warn('ID', targetId, 'não encontrado no mapa de snapshots. Pode ter sido criado depois do último full snapshot.');
  process.exit(0);
}

console.log('\n=== Nó alvo ===');
console.log(summarizeNode(targetNode));

// show DOM path
const pathStr = buildDomPathForId(targetId);
console.log('\nCaminho DOM sugerido:');
console.log(pathStr || '(não foi possível construir caminho)');

// list ancestor chain with id and name (instead of class)
console.log('\n=== Cadeia de ancestrais (do root até o nó) ===');
(function printChain(id) {
  const chain = [];
  let cur = id;
  while (cur != null && nodesMap.has(cur)) {
    chain.unshift(cur);
    cur = parentMap.has(cur) ? parentMap.get(cur) : null;
  }
  for (const cid of chain) {
    const n = nodesMap.get(cid);
    console.log(' - ' + summarizeNode(n));
  }
})(targetId);

// list direct children if any
if (Array.isArray(targetNode.childNodes) && targetNode.childNodes.length > 0) {
  console.log('\n=== Filhos diretos do nó alvo ===');
  for (const ch of targetNode.childNodes) {
    try {
      console.log(' - ' + summarizeNode(ch));
    } catch (e) {}
  }
}

console.log('\nPróximo passo sugerido: copie o seletor gerado acima e teste no DOM real (inspecionar elemento).');
