const addNodeButton = document.getElementById('add-node-btn');
const saveVersionButton = document.getElementById('save-version-btn');
const versionModal = document.getElementById('version-modal');
const versionForm = document.getElementById('version-form');
const versionModalClose = document.querySelector('.version-modal-close');

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

    // --- EDITOR ---
    function openNodeEditor(nodeId) {
        const isCreating = nodeId === null;

        // Estrutura padrão
        const defaultNode = {
            id: "",
            type: "fixed", // Valor padrão
            action_config: {},
            pre_update: {},
            post_update: {},
            next: ""
        };

        const nodeData = isCreating ? defaultNode : flowMap[nodeId];

        // --- NOVA LÓGICA DO DROPDOWN ---
        // 1. Defina os tipos permitidos
        const nodeTypes = ['fixed', 'input', 'output', 'api', 'if-else', 'llm'];

        // 2. Gere as opções HTML dinamicamente, marcando o atual como 'selected'
        const typeOptions = nodeTypes.map(type => {
            const isSelected = (nodeData.type || 'fixed') === type ? 'selected' : '';
            return `<option value="${type}" ${isSelected}>${type}</option>`;
        }).join('');
        // -------------------------------

        const actionConfig = JSON.stringify(nodeData.action_config || {}, null, 2);
        const preUpdate = JSON.stringify(nodeData.pre_update || {}, null, 2);
        const postUpdate = JSON.stringify(nodeData.post_update || {}, null, 2);

        modalForm.innerHTML = `
        <div class="form-group">
            <label for="node-id">ID</label>
            <input type="text" id="node-id" value="${isCreating ? '' : nodeData.id}" ${isCreating ? '' : 'disabled'}>
        </div>
        
        <div class="form-group">
            <label for="node-type">Type</label>
            <select id="node-type">
                ${typeOptions}
            </select>
        </div>
        <div class="form-group">
            <label for="node-next">Next (ID do próximo nó - vazio se for if-else)</label>
            <input type="text" id="node-next" value="${nodeData.next || ''}">
        </div>

        <div class="form-group">
            <label for="node-action-config">Action Config (JSON)</label>
            <textarea id="node-action-config">${actionConfig}</textarea>
        </div>
        
        <div class="form-group">
            <label for="node-pre-update">Pre Update (JSON)</label>
            <textarea id="node-pre-update">${preUpdate}</textarea>
        </div>
        
        <div class="form-group">
            <label for="node-post-update">Post Update (JSON)</label>
            <textarea id="node-post-update">${postUpdate}</textarea>
        </div>

        <button type="submit">${isCreating ? 'Criar' : 'Salvar'}</button>
        `;

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
        const isCreating = !document.getElementById('node-id').disabled;

        try {
            if (!idInput) throw new Error("ID é obrigatório");

            // Monta o objeto atualizado
            const updatedNode = {
                id: idInput,
                type: document.getElementById('node-type').value,
                next: document.getElementById('node-next').value || null, // Se vazio, vira null ou remove
                action_config: JSON.parse(document.getElementById('node-action-config').value),
                pre_update: JSON.parse(document.getElementById('node-pre-update').value),
                post_update: JSON.parse(document.getElementById('node-post-update').value)
            };

            // Remove next se for null
            if (!updatedNode.next) delete updatedNode.next;

            if (isCreating) {
                if (flowMap[idInput]) throw new Error("ID já existe");
                flowMap[idInput] = updatedNode;
                flowArray.push(updatedNode); // Adiciona ao array original também
            } else {
                // Atualiza o mapa
                flowMap[idInput] = updatedNode;
                // Atualiza o array original (encontra o índice e substitui)
                const idx = flowArray.findIndex(n => n.id === idInput);
                if (idx !== -1) flowArray[idx] = updatedNode;
            }

            closeNodeEditor();
            initializeFlowView(); // Re-renderiza

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