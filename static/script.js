// --- REFERÊNCIAS DOM ---
const flowContainer = document.getElementById('flow-container');
const fileInput = document.getElementById('json-file-input');

// Modais
const nodeModal = document.getElementById('node-modal');
const varsModal = document.getElementById('vars-modal');
const versionModal = document.getElementById('version-modal');

// Botões Principais
const addNodeBtn = document.getElementById('add-node-btn');
const varsManagerBtn = document.getElementById('vars-manager-btn');
const saveVersionBtn = document.getElementById('save-version-btn');
const saveNodeBtn = document.getElementById('save-node-btn');
const saveVarsBtn = document.getElementById('save-vars-btn');
const themeToggleBtn = document.getElementById('theme-toggle-btn');

// Fechar Modais
document.getElementById('close-node-modal').onclick = () => nodeModal.classList.add('hidden');
document.getElementById('close-vars-modal').onclick = () => varsModal.classList.add('hidden');
document.querySelector('.version-modal-close').onclick = () => versionModal.classList.add('hidden');

// --- ESTADO GLOBAL ---
let flowMap = {};
let flowArray = [];
let globalEnvironments = {};
let startNodeId = null;

// --- TEMA DARK/LIGHT ---
function initTheme() {
    const savedTheme = localStorage.getItem('theme');
    if (savedTheme === 'dark') {
        document.body.classList.add('dark-mode');
        themeToggleBtn.textContent = '☀️';
    } else {
        themeToggleBtn.textContent = '🌙';
    }
}

themeToggleBtn.addEventListener('click', () => {
    document.body.classList.toggle('dark-mode');
    const isDark = document.body.classList.contains('dark-mode');
    themeToggleBtn.textContent = isDark ? '☀️' : '🌙';
    localStorage.setItem('theme', isDark ? 'dark' : 'light');
});

// CONFIGURAÇÃO DOS CAMPOS
const CONFIG_SCHEMAS = {
    'api': [
        { key: 'url', label: 'URL', type: 'text', placeholder: 'https://...' },
        { key: 'method', label: 'Método', type: 'select', options: ['GET', 'POST', 'PUT', 'DELETE'] },
        { key: 'headers', label: 'Headers (JSON)', type: 'textarea', rows: 2 },
        { key: 'body', label: 'Body (JSON)', type: 'textarea', rows: 4 }
    ],
    'if-else': [
        { key: 'condition', label: 'Condição (Jinja2)', type: 'text', placeholder: 'context.valor > 10' },
        { key: 'true_node', label: 'Próximo se TRUE', type: 'node-select' },
        { key: 'false_node', label: 'Próximo se FALSE', type: 'node-select' }
    ],
    'llm': [
        { key: 'prompt', label: 'Prompt', type: 'textarea', rows: 6 },
        { key: 'model', label: 'Modelo', type: 'text', placeholder: 'gpt-4o' }
    ],
    'output': [{ key: 'message', label: 'Mensagem', type: 'textarea' }],
    'input': [{ key: 'variable', label: 'Salvar em Variável (opcional)', type: 'text' }],
    'fixed': []
};

// --- INICIALIZAÇÃO ---
document.addEventListener('DOMContentLoaded', () => {
    initTheme();
    fileInput.addEventListener('change', handleFileSelect);

    addNodeBtn.addEventListener('click', () => {
        openNodeEditor(null);
    });

    varsManagerBtn.addEventListener('click', openVarsManager);
    saveNodeBtn.addEventListener('click', handleSaveNode);
    saveVarsBtn.addEventListener('click', handleSaveVars);

    saveVersionBtn.addEventListener('click', () => {
        if (!flowArray.length) return alert("Nada para salvar.");
        versionModal.classList.remove('hidden');
    });

    document.getElementById('version-form').addEventListener('submit', (e) => {
        e.preventDefault();
        downloadJSON();
    });
});

// --- PROCESSAMENTO DE ARQUIVO ---
function handleFileSelect(event) {
    const file = event.target.files[0];
    if (!file) return;

    const reader = new FileReader();
    reader.onload = (e) => {
        try {
            const json = JSON.parse(e.target.result);
            loadFlowData(json);
        } catch (error) {
            alert(`Erro JSON: ${error.message}`);
        }
    };
    reader.readAsText(file);
}

function loadFlowData(json) {
    globalEnvironments = json.environments || {};
    if (json.nodes && Array.isArray(json.nodes)) {
        flowArray = json.nodes;
        flowMap = {};
        flowArray.forEach(n => flowMap[n.id] = n);
        startNodeId = flowArray.length > 0 ? flowArray[0].id : null;
    } else {
        alert("JSON inválido: falta array 'nodes'.");
        return;
    }
    renderFlow();
}

// --- RENDERIZAÇÃO DO FLUXO ---
function renderFlow() {
    flowContainer.innerHTML = '';
    if (!startNodeId && flowArray.length > 0) startNodeId = flowArray[0].id;
    if (!startNodeId) return;

    // Identificar orfãos
    const targetNodes = new Set();
    flowArray.forEach(node => {
        getTransitions(node).forEach(t => targetNodes.add(t.targetId));
    });

    const orphanIds = flowArray.map(n => n.id).filter(id => id !== startNodeId && !targetNodes.has(id));

    // Renderizar Árvore Principal
    const visited = new Set();
    const mainTree = createNodeElement(startNodeId, visited);
    flowContainer.appendChild(mainTree);

    // Renderizar Orfãos
    if (orphanIds.length > 0) {
        const orphanDiv = document.createElement('div');
        orphanDiv.id = 'orphan-container';
        orphanDiv.innerHTML = '<h3 style="margin-left:20px; color:var(--text-muted);">Nós Desconectados</h3>';
        orphanIds.forEach(id => {
            orphanDiv.appendChild(createNodeElement(id, new Set(), true));
        });
        flowContainer.appendChild(orphanDiv);
    }
}

function getTransitions(node) {
    const transitions = [];
    if (node.type === 'if-else' && node.action_config) {
        if (node.action_config.true_node) transitions.push({ targetId: node.action_config.true_node, label: 'TRUE' });
        if (node.action_config.false_node) transitions.push({ targetId: node.action_config.false_node, label: 'FALSE' });
    } else if (node.next) {
        transitions.push({ targetId: node.next, label: null });
    }
    return transitions;
}

function getNodeClass(type) {
    // Retorna a classe CSS baseada no tipo
    const map = {
        'api': 'node-api',
        'if-else': 'node-ifelse',
        'llm': 'node-llm',
        'input': 'node-input',
        'output': 'node-output',
        'fixed': 'node-fixed'
    };
    return map[type] || 'node-default';
}

function createNodeElement(nodeId, visited, isOrphan = false) {
    const nodeContainer = document.createElement('div');
    nodeContainer.className = 'node-container';

    // 1. Tratamento de Nó Não Definido (Erro)
    const nodeData = flowMap[nodeId];
    if (!nodeData) {
        nodeContainer.innerHTML = `
            <div class="node node-error" style="border-left-color: #dc3545;">
                <div style="color: #dc3545; font-weight: bold;">⚠ Erro</div>
                <h3>${nodeId}</h3>
                <p>Nó não encontrado</p>
            </div>`;
        return nodeContainer;
    }

    const nodeDiv = document.createElement('div');
    nodeDiv.className = 'node';
    // Adiciona classe específica do tipo para colorir via CSS
    nodeDiv.classList.add(getNodeClass(nodeData.type));

    if (isOrphan) nodeDiv.classList.add('orphan-node');

    let typeLabel = nodeData.type.toUpperCase();
    let detailText = nodeData.action_config?.message || '';

    // Lógica de texto
    if (nodeData.type === 'if-else') {
        typeLabel = "CONDICIONAL";
        // detailText agora apenas texto ou HTML simples, cor controlada via CSS não inline hardcoded se possível,
        // mas aqui mantemos o strong. A cor interna pode ser herdada ou usar classe.
        detailText = `<strong>${nodeData.action_config.condition || '?'}</strong>`;
    } else if (nodeData.type === 'llm') {
        detailText = (nodeData.action_config.prompt || '').substring(0, 40) + '...';
    } else if (nodeData.type === 'api') {
        detailText = `${nodeData.action_config.method || 'GET'} ${nodeData.action_config.url || ''}`;
    }

    // Header com classe para cor
    const typeHeader = `<div class="node-header">${typeLabel}</div>`;

    nodeDiv.innerHTML = `
        ${typeHeader}
        <h3>${nodeId}</h3>
        <p>${detailText}</p>
    `;
    nodeDiv.onclick = () => openNodeEditor(nodeId);
    nodeContainer.appendChild(nodeDiv);

    // 3. Tratamento de Loops (Nós já visitados na árvore)
    if (visited.has(nodeId)) {
        nodeDiv.classList.add('node-loop');
        nodeDiv.style.borderStyle = "dashed";
        nodeDiv.innerHTML += `<div style="margin-top:5px; font-size:0.8em; color:var(--text-muted);">⟳ Referência/Loop</div>`;
        return nodeContainer;
    }
    visited.add(nodeId);

    const transitions = getTransitions(nodeData);
    if (transitions.length > 0) {
        const childrenContainer = document.createElement('div');
        childrenContainer.className = 'children-container';

        transitions.forEach(t => {
            const group = document.createElement('div');
            group.className = 'transition-group';

            if (t.label) {
                const badge = document.createElement('span');
                badge.className = 'transition-condition';
                badge.innerText = t.label;

                // Classes ao invés de style inline
                if (t.label === 'TRUE') badge.classList.add('badge-true');
                if (t.label === 'FALSE') badge.classList.add('badge-false');

                group.appendChild(badge);
            }

            group.appendChild(createNodeElement(t.targetId, new Set(visited)));
            childrenContainer.appendChild(group);
        });

        nodeContainer.appendChild(childrenContainer);
    }

    return nodeContainer;
}

function generateNodeOptions(selectedId) {
    let options = `<option value="">-- Fim / Nenhum --</option>`;
    Object.keys(flowMap).forEach(key => {
        options += `<option value="${key}" ${key === selectedId ? 'selected' : ''}>${key}</option>`;
    });
    return options;
}

function openNodeEditor(nodeId) {
    const isCreating = (nodeId === null);
    const nodeData = isCreating
        ? { id: "", type: "fixed", action_config: {}, pre_update: {}, post_update: {}, next: "" }
        : JSON.parse(JSON.stringify(flowMap[nodeId]));

    const form = document.getElementById('node-editor-form');

    const nextOptions = generateNodeOptions(nodeData.next);

    form.innerHTML = `
        <div class="form-group">
            <label>ID do Nó</label>
            <input type="text" id="edit-id" value="${nodeData.id}" ${!isCreating ? 'disabled' : ''}>
        </div>
        <div class="form-group">
            <label>Tipo</label>
            <select id="edit-type">
                ${['fixed', 'input', 'output', 'api', 'if-else', 'llm'].map(t => `<option value="${t}" ${t === nodeData.type ? 'selected' : ''}>${t}</option>`).join('')}
            </select>
        </div>

        <div class="action-config-wrapper" id="config-container">
            </div>

        <div class="form-group full-width" id="next-node-wrapper">
            <label>Próximo Nó (Next)</label>
            <select id="edit-next">
                ${nextOptions}
            </select>
        </div>

        <div class="form-group">
            <label>Pre Update (Variáveis)</label>
            <table class="vars-table" id="pre-update-table">
                <thead><tr><th>Var</th><th>Valor</th><th></th></tr></thead>
                <tbody></tbody>
            </table>
            <button type="button" class="btn-add" onclick="addNodeVarRow('pre-update-table')">+</button>
        </div>

        <div class="form-group">
            <label>Post Update (Variáveis)</label>
            <table class="vars-table" id="post-update-table">
                <thead><tr><th>Var</th><th>Valor</th><th></th></tr></thead>
                <tbody></tbody>
            </table>
            <button type="button" class="btn-add" onclick="addNodeVarRow('post-update-table')">+</button>
        </div>
    `;

    const typeSelect = document.getElementById('edit-type');
    const configContainer = document.getElementById('config-container');
    const nextWrapper = document.getElementById('next-node-wrapper');

    const renderConfig = () => {
        const type = typeSelect.value;
        const schema = CONFIG_SCHEMAS[type];
        const currentConfig = (type === nodeData.type) ? nodeData.action_config : {};

        if (type === 'if-else') {
            nextWrapper.style.display = 'none';
        } else {
            nextWrapper.style.display = 'block';
        }

        if (!schema || schema.length === 0) {
            configContainer.innerHTML = '<p style="color:var(--text-muted); font-style:italic;">Sem configurações específicas.</p>';
            return;
        }

        configContainer.innerHTML = schema.map(field => {
            const val = currentConfig[field.key] || '';
            let inputHtml = '';

            if (field.type === 'select') {
                inputHtml = `<select class="dyn-field" data-key="${field.key}">
                    ${field.options.map(o => `<option ${o === val ? 'selected' : ''}>${o}</option>`).join('')}
                </select>`;
            }
            else if (field.type === 'node-select') {
                inputHtml = `<select class="dyn-field" data-key="${field.key}">
                    ${generateNodeOptions(val)}
                </select>`;
            }
            else if (field.type === 'textarea') {
                const txtVal = typeof val === 'object' ? JSON.stringify(val) : val;
                inputHtml = `<textarea class="dyn-field" data-key="${field.key}" rows="${field.rows}">${txtVal}</textarea>`;
            } else {
                inputHtml = `<input type="text" class="dyn-field" data-key="${field.key}" value="${val}" placeholder="${field.placeholder || ''}">`;
            }
            return `<div class="form-group"><label>${field.label}</label>${inputHtml}</div>`;
        }).join('');
    };

    typeSelect.onchange = renderConfig;
    renderConfig();

    renderNodeVars('pre-update-table', nodeData.pre_update);
    renderNodeVars('post-update-table', nodeData.post_update);

    nodeModal.classList.remove('hidden');
}

window.addNodeVarRow = function (tableId, key = '', value = '') {
    const tbody = document.querySelector(`#${tableId} tbody`);
    const tr = document.createElement('tr');

    const keys = Object.keys(globalEnvironments);
    let options = `<option value="">-- Selecione --</option>`;

    const allKeys = new Set([...keys, key]);
    allKeys.forEach(k => {
        if (!k) return;
        options += `<option value="${k}" ${k === key ? 'selected' : ''}>${k}</option>`;
    });

    tr.innerHTML = `
        <td><select class="var-select var-row-select">${options}</select></td>
        <td><input type="text" class="var-val-input var-row-input" value="${value}"></td>
        <td style="text-align:center"><button type="button" class="btn-icon btn-delete" onclick="this.closest('tr').remove()">x</button></td>
    `;
    tbody.appendChild(tr);
};

function renderNodeVars(tableId, dataObj) {
    if (!dataObj) return;
    Object.keys(dataObj).forEach(k => {
        let val = dataObj[k];
        if (val === null) val = "null";
        addNodeVarRow(tableId, k, val);
    });
}

function openVarsManager() {
    const tbody = document.querySelector('#global-vars-table tbody');
    tbody.innerHTML = '';
    Object.keys(globalEnvironments).forEach(key => addGlobalVarRow(key, globalEnvironments[key]));
    varsModal.classList.remove('hidden');
}

function addGlobalVarRow(key = '', value = '') {
    const tbody = document.querySelector('#global-vars-table tbody');
    const tr = document.createElement('tr');
    tr.innerHTML = `
        <td><input type="text" class="var-row-input key-input" value="${key}" placeholder="NOME_VAR"></td>
        <td><input type="text" class="var-row-input val-input" value="${value}" placeholder="Valor Inicial"></td>
        <td style="text-align:center;"><button class="btn-icon btn-delete" onclick="this.closest('tr').remove()">🗑</button></td>
    `;
    tbody.appendChild(tr);
}

document.getElementById('add-global-var-btn').onclick = () => addGlobalVarRow();

function handleSaveVars() {
    const newEnv = {};
    const rows = document.querySelectorAll('#global-vars-table tbody tr');
    rows.forEach(row => {
        const key = row.querySelector('.key-input').value.trim();
        const val = row.querySelector('.val-input').value;
        if (key) newEnv[key] = val;
    });
    globalEnvironments = newEnv;
    varsModal.classList.add('hidden');
    alert('Variáveis atualizadas!');
}

function handleSaveNode() {
    const id = document.getElementById('edit-id').value.trim();
    if (!id) return alert("ID obrigatório");

    const type = document.getElementById('edit-type').value;
    const nextSelect = document.getElementById('edit-next');
    const next = (nextSelect.offsetParent !== null) ? nextSelect.value : null;

    const actionConfig = {};
    document.querySelectorAll('#config-container .dyn-field').forEach(field => {
        let val = field.value;
        if (field.dataset.key === 'headers' || field.dataset.key === 'body') {
            try { val = JSON.parse(val); } catch (e) { }
        }
        actionConfig[field.dataset.key] = val;
    });

    const collectVars = (tableId) => {
        const result = {};
        document.querySelectorAll(`#${tableId} tbody tr`).forEach(tr => {
            const key = tr.querySelector('.var-select').value;
            let val = tr.querySelector('.var-val-input').value;
            if (key) {
                if (val === "null") val = null;
                result[key] = val;
            }
        });
        return result;
    };

    const newNode = {
        id,
        type,
        action_config: actionConfig,
        pre_update: collectVars('pre-update-table'),
        post_update: collectVars('post-update-table')
    };
    if (next) newNode.next = next;

    flowMap[id] = newNode;
    const idx = flowArray.findIndex(n => n.id === id);
    if (idx >= 0) flowArray[idx] = newNode;
    else flowArray.push(newNode);

    nodeModal.classList.add('hidden');
    renderFlow();
}

function downloadJSON() {
    const filename = document.getElementById('new-filename').value || 'flow.json';
    const finalObj = {
        environments: globalEnvironments,
        nodes: flowArray
    };
    const blob = new Blob([JSON.stringify(finalObj, null, 4)], { type: 'application/json' });
    const link = document.createElement('a');
    link.href = URL.createObjectURL(blob);
    link.download = filename;
    document.body.appendChild(link);
    link.click();
    document.body.removeChild(link);
    versionModal.classList.add('hidden');
}