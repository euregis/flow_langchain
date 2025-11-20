# 🛠️ Documentação Técnica do Flow Engine

Esta documentação detalha a arquitetura, as regras e a função de cada componente do `Flow Engine`, visando facilitar a manutenção e a evolução por outros engenheiros ou modelos de linguagem (LLMs).

## I. Arquitetura e Fluxo de Execução

O sistema é construído sobre **LangGraph**, uma extensão do LangChain que permite a criação de grafos de estado complexos (DAGs com ciclos).

### 1. Componentes Principais

| Componente | Linguagem | Função |
| :--- | :--- | :--- |
| **FlowState (LangGraph)** | Python (TypedDict) | Armazena o estado global do fluxo: `context` (dados do usuário) e `current_node` (nó atual). |
| **Contexto (`context`)** | Python (Dict) | Variável central que armazena todos os dados de execução e variáveis geradas. |
| **Nós (`Node`)** | JSON/Python | Representa uma única ação (API, LLM, Lógica). Executa uma ação e retorna o novo `FlowState`. |
| **Arestas (`Edge`)** | JSON/Python | Define a transição entre nós (simples ou condicional). |

### 2. Ciclo de Vida de um Nó

Cada nó segue um ciclo de execução rigoroso no método `_execute_node` em `engine.py`:

1.  **Carregar Contexto:** Recebe o `FlowState` atual.
2.  **Pré-Processamento (Jinja2):**
    * Valores em `pre_update` são renderizados usando o `context` atual.
    * O `context` é atualizado e chaves em `pre_remove` são removidas.
3.  **Execução da Ação:**
    * As configurações da ação (`action_config`) são **primeiro renderizadas** via Jinja2 (para usar variáveis atualizadas).
    * A ação (API, LLM, etc.) é executada, gerando um dicionário `action_result`.
4.  **Pós-Processamento (Jinja2):**
    * Um **Contexto Temporário** é criado (`{**context, "result": action_result}`).
    * Valores em `post_update` são renderizados usando o **Contexto Temporário** (permitindo `{{ result.data.alguma_chave }}`).
    * O `context` é atualizado e chaves em `post_remove` são removidas.
5.  **Retorno:** O novo `FlowState` (com o `context` atualizado) é retornado ao LangGraph.

---

## II. Regras do Contexto e Templating (Jinja2)

### 1. Acesso ao Contexto

Todas as operações de templating Jinja2 (em `templates.py`) recebem o dicionário de contexto (o `context` principal do `FlowState`) como uma única variável chamada `context`.

**Regra de Sintaxe:** O acesso às variáveis deve ser sempre prefixado: `{{ context.minha_variavel }}`.

### 2. Regras de Atualização

| Fase | Variável Jinja2 Adicional | Função |
| :--- | :--- | :--- |
| **`pre_update`** | Nenhuma (somente `context`) | Prepara o ambiente para a ação. Bom para montar URLs ou calcular valores de entrada. |
| **`post_update`** | `result` (Resultado da Ação) | Mapeia a saída da ação para o contexto principal. **Exemplo:** `"pedido_id": "{{ result.data.id }}"`. |

### 3. Remoção de Variáveis

Os campos `pre_remove` e `post_remove` aceitam uma lista de strings. As chaves correspondentes são removidas do dicionário `context` para manter o estado limpo.

---

## III. Implementação e Extensibilidade dos Nós

O arquivo `engine.py` contém a lógica de execução. Para adicionar um novo tipo de nó, basta estender o método `_execute_node`.

### 1. Tipos de Nós Implementados

| Tipo (`"type"`) | Descrição | Config. Essencial (`action_config`) | Lógica de Transição |
| :--- | :--- | :--- | :--- |
| `"api"` | Chamada HTTP usando `requests`. | `url`, `method` (`GET`/`POST`/etc.), `body`, `headers`. | Simples (`"next"`) |
| `"llm"` | Chamada a um modelo de linguagem (LangChain). | `prompt` (String com Jinja2). | Simples (`"next"`) |
| `"fixed"` | Não executa ação externa. Usado para inicializar ou manipular o contexto. | `data` (Qualquer dict/lista a ser injetada no `action_result`). | Simples (`"next"`) |
| `"input"` | Solicita input ao usuário (simulado via `input()` no `main.py`). | `message` (Prompt para o usuário). | Simples (`"next"`) |
| `"if-else"` | Roteamento condicional. | `condition` (String avaliável com Jinja2, ex: `"{{ context.valor > 10 }}"`), `true_node`, `false_node`. | Condicional (via `_router`) |
| `"switch-case"` | Roteamento baseado no valor de uma variável. | `variable` (String/Jinja2 para obter o valor), `cases` (Dict mapeando valor -> nó), `default`. | Condicional (via `_router`) |

### 2. Roteamento Condicional (`_router`)

Localizado em `engine.py`, este método é a função de roteamento do LangGraph.

* **Para `"if-else"`:** O `condition` é renderizado e, em seguida, avaliado (usando `eval()`). **Nota de Segurança:** Em produção, a função `eval` deve ser substituída por uma biblioteca de avaliação segura de expressões (ex: `ast.literal_eval` ou uma biblioteca de regras de negócios).
* **Para `"switch-case"`:** O `variable` é renderizado e seu valor é usado para pesquisar o nome do próximo nó no dicionário `cases`.

---

## IV. Abstração de Persistência (`storage.py`)

A classe abstrata `ContextStore` garante que a lógica do motor de fluxo seja independente do mecanismo de armazenamento.

### Interface Obrigatória

| Método | Argumentos | Retorno | Descrição |
| :--- | :--- | :--- | :--- |
| `get_context` | `session_id: str` | `Dict[str, Any]` | Recupera o contexto de uma sessão. |
| `save_context` | `session_id: str`, `context: Dict` | `None` | Persiste o contexto de uma sessão. |

### Implementação Futura (Redis)

A classe `RedisStore` é um *placeholder*. A implementação correta deve:
1.  Serializar o dicionário de contexto para uma string JSON (ex: `json.dumps`).
2.  Usar o `session_id` como chave para armazenar no Redis.
3.  Des-serializar o valor do Redis (`json.loads`) em `get_context`.