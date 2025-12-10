const addNodeButton = document.getElementById('add-node-btn');
const saveVersionButton = document.getElementById('save-version-btn');
const versionModal = document.getElementById('version-modal');
const versionForm = document.getElementById('version-form');
const versionModalClose = document.querySelector('.version-modal-close');


const CONFIG_SCHEMAS = {
    'api': [
        { key: 'url', label: 'URL da API', type: 'text', placeholder: 'https://api.exemplo.com/...' },
        { key: 'method', label: 'Método HTTP', type: 'select', options: ['GET', 'POST', 'PUT', 'DELETE'] },
        { key: 'headers', label: 'Headers (JSON)', type: 'textarea', placeholder: '{"Authorization": "..."}' },
        { key: 'body', label: 'Body (JSON)', type: 'textarea', placeholder: '{ "chave": "valor" }' }
    ],
    'if-else': [
        { key: 'condition', label: 'Condição (Jinja2)', type: 'text', placeholder: 'context.valor > 10' },
        { key: 'true_node', label: 'Ir para se Verdadeiro (ID)', type: 'text' },
        { key: 'false_node', label: 'Ir para se Falso (ID)', type: 'text' }
    ],
    'llm': [
        { key: 'prompt', label: 'Prompt / Instrução', type: 'textarea', rows: 5 },
        { key: 'model', label: 'Modelo (Opcional)', type: 'text', placeholder: 'gpt-4o' }
    ],
    'output': [
        { key: 'message', label: 'Mensagem de Saída', type: 'textarea', rows: 3 }
    ],
    'input': [
        { key: 'variable', label: 'Nome da Variável (Opcional)', type: 'text' }
    ],
    // 'fixed' e outros não listados usarão o modo "Raw JSON" padrão
};

// Aguarda o carregamento completo do HTML
document.addEventListener('DOMContentLoaded', () => {

    // --- ELEMENTOS DO DOM ---
    const flowContainer = document.getElementById('flow-container');
    const modal = document.getElementById('node-modal');
    const modalForm = document.getElementById('node-editor-form');
    const closeButton = document.querySelector('.close-button');
    const fileInput = document.getElementById('json-file-input');

    // --- VARIÁVEIS GLOBAIS DE ESTADO ---
    let flowMap = {}; // Armazenará os nós como Objeto { id: node } para acesso rápido
    let flowArray = []; // Mantém a referência original do array
    let startNodeId = null;

    // --- OUVINTES ---
    fileInput.addEventListener('change', handleFileSelect);

    addNodeButton.addEventListener('click', () => {
        if (Object.keys(flowMap).length === 0) {
            alert('Por favor, carregue um fluxo primeiro.');
            return;
        }
        openNodeEditor(null);
    });

    function handleFileSelect(event) {
        const file = event.target.files[0];
        if (!file) return;

        const reader = new FileReader();
        reader.onload = (e) => {
            try {
                const jsonData = JSON.parse(e.target.result);
                processAndRenderFlow(jsonData);
            } catch (error) {
                alert(`Erro ao processar JSON: ${error.message}`);
            }
        };
        reader.readAsText(file);
    }

    /**
     * Processa o JSON (seja array ou objeto) e normaliza para renderização
     */
    function processAndRenderFlow(jsonData) {
        flowContainer.innerHTML = '';
        flowMap = {};
        flowArray = [];
        startNodeId = null;

        let nodesList = [];

        // Verifica se é a estrutura nova (root tem "nodes" como Array)
        if (jsonData.nodes && Array.isArray(jsonData.nodes)) {
            nodesList = jsonData.nodes;
            // Assume que o primeiro nó da lista é o inicial
            if (nodesList.length > 0) startNodeId = nodesList[0].id;
        } else {
            alert('Formato de arquivo não reconhecido. Esperado objeto com propriedade "nodes" (Array).');
            return;
        }

        // Converte Array para Mapa para fácil acesso por ID
        nodesList.forEach(node => {
            flowMap[node.id] = node;
        });
        flowArray = nodesList; // Guarda referência

        console.log('Mapa de Fluxo gerado:', flowMap);
        initializeFlowView();
    }

    /**
     * Função auxiliar para normalizar transições do novo formato
     * Retorna array de objetos: { targetId, label }
     */
    function getTransitions(node) {
        const transitions = [];

        // Caso 1: Nó tipo "if-else" (lógica bifurcada)
        if (node.type === 'if-else' && node.action_config) {
            if (node.action_config.true_node) {
                transitions.push({
                    targetId: node.action_config.true_node,
                    label: `(TRUE) ${node.action_config.condition || ''}`
                });
            }
            if (node.action_config.false_node) {
                transitions.push({
                    targetId: node.action_config.false_node,
                    label: '(FALSE)'
                });
            }
        }
        // Caso 2: Transição direta (campo "next")
        else if (node.next) {
            transitions.push({
                targetId: node.next,
                label: ''
            });
        }

        return transitions;
    }

    function initializeFlowView() {
        flowContainer.innerHTML = '';

        if (!startNodeId || !flowMap[startNodeId]) {
            flowContainer.innerHTML = '<p>Não foi possível identificar o nó inicial.</p>';
            return;
        }

        // 1. Identificar Orfãos
        // Cria um Set de todos os nós que são "destino" de alguém
        const targetNodes = new Set();
        Object.values(flowMap).forEach(node => {
            const transitions = getTransitions(node);
            transitions.forEach(t => targetNodes.add(t.targetId));
        });

        const orphanNodeIds = new Set();
        Object.keys(flowMap).forEach(id => {
            if (!targetNodes.has(id) && id !== startNodeId) {
                orphanNodeIds.add(id);
            }
        });

        // 2. Renderizar Fluxo Principal
        const visitedNodes = new Set();
        const mainFlowContainer = document.createElement('div');
        const flowElement = createNodeElement(startNodeId, visitedNodes, orphanNodeIds);
        mainFlowContainer.appendChild(flowElement);
        flowContainer.appendChild(mainFlowContainer);

        // 3. Renderizar Orfãos
        if (orphanNodeIds.size > 0) {
            const orphanContainer = document.createElement('div');
            orphanContainer.id = 'orphan-container';
            orphanContainer.innerHTML = '<h2>Nós Desvinculados (Não atingíveis)</h2>';

            orphanNodeIds.forEach(id => {
                // Renderiza cada orfão como uma nova árvore
                const orphanElement = createNodeElement(id, new Set(), orphanNodeIds);
                orphanContainer.appendChild(orphanElement);
            });
            flowContainer.appendChild(orphanContainer);
        }
    }

    function createNodeElement(nodeId, visitedNodes, orphanNodeIds) {
        const nodeData = flowMap[nodeId];
        const nodeContainer = document.createElement('div');
        nodeContainer.className = 'node-container';

        // Caso o nó apontado não exista no mapa (link quebrado)
        if (!nodeData) {
            const errorDiv = document.createElement('div');
            errorDiv.className = 'node';
            errorDiv.style.borderColor = 'red';
            errorDiv.innerHTML = `<h3>${nodeId}</h3><p style="color:red">Não encontrado</p>`;
            nodeContainer.appendChild(errorDiv);
            return nodeContainer;
        }

        const nodeDiv = document.createElement('div');
        nodeDiv.className = 'node';
        if (orphanNodeIds.has(nodeId)) nodeDiv.classList.add('orphan-node');

        // Conteúdo visual do nó
        // Adiciona um badge para o TYPE
        let typeBadge = `<span style="background:#eee; padding:2px 5px; border-radius:3px; font-size:0.8em; margin-bottom:5px; display:inline-block;">${nodeData.type}</span>`;
        let desc = nodeData.action_config?.message || nodeData.action_config?.prompt || (nodeData.type === 'if-else' ? 'Condicional' : 'Ação Interna');

        nodeDiv.innerHTML = `
            ${typeBadge}
            <h3>${nodeId}</h3>
            <p>${desc.substring(0, 50)}${desc.length > 50 ? '...' : ''}</p>
        `;

        nodeDiv.addEventListener('click', () => openNodeEditor(nodeId));
        nodeContainer.appendChild(nodeDiv);

        // Prevenção de Loop
        if (visitedNodes.has(nodeId)) {
            nodeDiv.style.borderStyle = "double";
            nodeDiv.innerHTML += '<div style="color:orange; font-size:0.8em;">(Retorno/Loop)</div>';
            return nodeContainer;
        }
        visitedNodes.add(nodeId);

        // Renderizar Filhos
        const transitions = getTransitions(nodeData);
        if (transitions.length > 0) {
            const childrenContainer = document.createElement('div');
            childrenContainer.className = 'children-container';

            transitions.forEach(transition => {
                const transitionGroup = document.createElement('div');
                transitionGroup.className = 'transition-group';

                if (transition.label) {
                    const conditionDiv = document.createElement('div');
                    conditionDiv.className = 'transition-condition';
                    conditionDiv.textContent = transition.label;
                    transitionGroup.appendChild(conditionDiv);
                }

                // Recursão
                // Importante: Passamos uma CÓPIA de visitedNodes para cada ramo, 
                // para permitir que ramos diferentes usem os mesmos nós, mas detecte loops no próprio ramo.
                const childElement = createNodeElement(transition.targetId, new Set(visitedNodes), orphanNodeIds);
                transitionGroup.appendChild(childElement);
                childrenContainer.appendChild(transitionGroup);
            });
            nodeContainer.appendChild(childrenContainer);
        }

        return nodeContainer;
    }

    /**
 * Gera o HTML dos campos baseado no tipo selecionado
 */
    function renderConfigFields(type, currentConfig) {
        const schema = CONFIG_SCHEMAS[type];

        if (!schema) {
            const jsonString = JSON.stringify(currentConfig, null, 2);
            return `
            <div class="dynamic-field-group">
                <label>Configuração (JSON Puro)</label>
                <textarea id="config-raw-json" class="dynamic-field" data-key="raw" rows="5">${jsonString}</textarea>
                <small style="color: #666; display:block; margin-top:5px;">Este tipo não possui campos pré-definidos.</small>
            </div>
        `;
        }

        return schema.map(field => {
            const value = currentConfig[field.key] || '';
            let inputHtml = '';

            // Determina se é required ou placeholder
            const placeholder = field.placeholder || '';

            if (field.type === 'select') {
                const options = field.options.map(opt =>
                    `<option value="${opt}" ${value === opt ? 'selected' : ''}>${opt}</option>`
                ).join('');
                inputHtml = `<select id="config-${field.key}" class="dynamic-field" data-key="${field.key}">${options}</select>`;
            } else if (field.type === 'textarea') {
                let displayValue = value;
                if (typeof value === 'object') {
                    displayValue = JSON.stringify(value, null, 2);
                }
                inputHtml = `<textarea id="config-${field.key}" class="dynamic-field" data-key="${field.key}" rows="${field.rows || 3}" placeholder="${placeholder}">${displayValue}</textarea>`;
            } else {
                inputHtml = `<input type="text" id="config-${field.key}" class="dynamic-field" data-key="${field.key}" value="${value}" placeholder="${placeholder}">`;
            }

            // Retorna com a classe CSS 'dynamic-field-group'
            return `
            <div class="dynamic-field-group">
                <label for="config-${field.key}">${field.label}</label>
                ${inputHtml}
            </div>
        `;
        }).join('');
    }

    /**
     * Coleta os dados dos campos dinâmicos para salvar
     */
    function getConfigFromFields(type) {
        const schema = CONFIG_SCHEMAS[type];

        // Fallback: Se não tem schema, lê do textarea de JSON puro
        if (!schema) {
            const raw = document.getElementById('config-raw-json').value;
            try {
                return JSON.parse(raw || '{}');
            } catch (e) {
                throw new Error("Erro no JSON da Configuração: " + e.message);
            }
        }

        // Coleta dados baseados no schema
        const config = {};
        const inputs = document.querySelectorAll('.dynamic-field');

        inputs.forEach(input => {
            const key = input.dataset.key;
            let value = input.value;

            // Tenta converter campos que parecem JSON (headers, body) de volta para objeto
            // Verifica se o campo original no schema era 'textarea' e o valor parece objeto
            const fieldDef = schema.find(f => f.key === key);
            if (fieldDef && (fieldDef.key === 'headers' || fieldDef.key === 'body')) {
                if (value.trim().startsWith('{')) {
                    try { value = JSON.parse(value); } catch (e) { /* Deixa como string se falhar */ }
                }
            }

            if (value !== '') {
                config[key] = value;
            }
        });

        return config;
    }

    // --- EDITOR ---
    function openNodeEditor(nodeId) {
        const isCreating = nodeId === null;

        const defaultNode = {
            id: "",
            type: "fixed",
            action_config: {},
            pre_update: {},
            post_update: {},
            next: ""
        };

        // Clonagem simples para evitar referência direta antes de salvar
        const nodeData = JSON.parse(JSON.stringify(isCreating ? defaultNode : flowMap[nodeId]));

        // Dropdown de Tipos
        const nodeTypes = ['fixed', 'input', 'output', 'api', 'if-else', 'llm'];
        const typeOptions = nodeTypes.map(type => {
            const isSelected = (nodeData.type || 'fixed') === type ? 'selected' : '';
            return `<option value="${type}" ${isSelected}>${type}</option>`;
        }).join('');

        // JSONs auxiliares (Pre/Post Update) continuam como texto por enquanto
        const preUpdate = JSON.stringify(nodeData.pre_update || {}, null, 2);
        const postUpdate = JSON.stringify(nodeData.post_update || {}, null, 2);

        // Renderiza o Modal
        modalForm.innerHTML = `
        <div class="form-group">
            <label for="node-id">ID</label>
            <input type="text" id="node-id" value="${nodeData.id}" ${isCreating ? '' : 'disabled'}>
        </div>
        
        <div class="form-group">
            <label for="node-type">Type</label>
            <select id="node-type">
                ${typeOptions}
            </select>
        </div>

       <div class="action-config-wrapper">
            <span class="action-config-title">Action Config</span>
            <div id="action-config-container">
                </div>
        </div>
        
        <div class="form-group">
            <label for="node-next">Next (Próximo Nó)</label>
            <input type="text" id="node-next" value="${nodeData.next || ''}">
            <small style="color:#888;">Para 'if-else', use os campos específicos acima.</small>
        </div>

        <div class="form-group"><label>Pre Update (JSON)</label><textarea id="node-pre-update">${preUpdate}</textarea></div>
        <div class="form-group"><label>Post Update (JSON)</label><textarea id="node-post-update">${postUpdate}</textarea></div>

        <button type="submit">${isCreating ? 'Criar' : 'Salvar'}</button>
        `;

        // 1. Renderiza os campos iniciais baseados no tipo atual
        const configContainer = document.getElementById('action-config-container');
        const typeSelect = document.getElementById('node-type');

        // Função interna para atualizar a view
        const updateView = () => {
            const currentType = typeSelect.value;
            // Se mudou o tipo, passamos um objeto vazio para não tentar encaixar config de API em LLM, 
            // mas se for o tipo original, usamos os dados carregados.
            const configToRender = (currentType === nodeData.type) ? nodeData.action_config : {};
            configContainer.innerHTML = renderConfigFields(currentType, configToRender);
        };

        // Inicializa
        updateView();

        // 2. Adiciona Listener para mudança de tipo
        typeSelect.addEventListener('change', updateView);

        modal.classList.remove('hidden');
    }

    function closeNodeEditor() {
        modal.classList.add('hidden');
    }

    closeButton.addEventListener('click', closeNodeEditor);
    modal.addEventListener('click', (e) => { if (e.target === modal) closeNodeEditor(); });

    modalForm.addEventListener('submit', (e) => {
        e.preventDefault();
        const idInput = document.getElementById('node-id').value.trim();
        const typeInput = document.getElementById('node-type').value;
        const isCreating = !document.getElementById('node-id').disabled;

        try {
            if (!idInput) throw new Error("ID é obrigatório");

            // NOVA LÓGICA DE COLETA DA CONFIGURAÇÃO
            const actionConfig = getConfigFromFields(typeInput);

            // Monta o objeto atualizado
            const updatedNode = {
                id: idInput,
                type: typeInput,
                next: document.getElementById('node-next').value || null,
                action_config: actionConfig, // Usa o objeto coletado
                pre_update: JSON.parse(document.getElementById('node-pre-update').value),
                post_update: JSON.parse(document.getElementById('node-post-update').value)
            };

            if (!updatedNode.next) delete updatedNode.next;

            if (isCreating) {
                if (flowMap[idInput]) throw new Error("ID já existe");
                flowMap[idInput] = updatedNode;
                flowArray.push(updatedNode);
            } else {
                flowMap[idInput] = updatedNode;
                const idx = flowArray.findIndex(n => n.id === idInput);
                if (idx !== -1) flowArray[idx] = updatedNode;
            }

            closeNodeEditor();
            initializeFlowView();

        } catch (err) {
            alert("Erro ao salvar: " + err.message);
        }
    });

    // --- SALVAR ARQUIVO ---
    saveVersionButton.addEventListener('click', () => {
        if (!flowArray.length) {
            alert('Nada para salvar.');
            return;
        }
        versionModal.classList.remove('hidden');
    });

    versionModalClose.addEventListener('click', () => {
        versionModal.classList.add('hidden');
    });

    versionForm.addEventListener('submit', (e) => {
        e.preventDefault();
        const filename = document.getElementById('new-filename').value || 'flow_definition.json';

        // Reconstrói a estrutura raiz original
        const finalJson = {
            nodes: flowArray // O array atualizado
        };

        const blob = new Blob([JSON.stringify(finalJson, null, 4)], { type: 'application/json' });
        const url = URL.createObjectURL(blob);
        const link = document.createElement('a');
        link.href = url;
        link.download = filename;
        document.body.appendChild(link);
        link.click();
        document.body.removeChild(link);
        versionModal.classList.add('hidden');
    });

});