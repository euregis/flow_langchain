# 🐍 Flow Engine Python

Um motor de execução de fluxos parametrizáveis definidos em JSON, utilizando o LangGraph (LangChain) para orquestração dinâmica e Jinja2 para templating avançado de contexto.

## 🚀 Funcionalidades

* **Definição de Fluxo via JSON:** Configuração de nós (API, LLM, Lógica Condicional) e transições em um arquivo JSON.
* **Gestão de Contexto:** O estado do fluxo é mantido em um dicionário de contexto, que pode ser atualizado antes e depois de cada ação.
* **Templating com Jinja2:** Todos os campos de texto (URLs, corpos de requisição, prompts LLM, condições) são renderizados dinamicamente usando o contexto.
* **Orquestração com LangGraph:** Utiliza a arquitetura de Grafo de Estado para suportar lógica complexa, incluindo condicionais (`if-else`, `switch-case`) e potenciais ciclos.
* **Abstração de Armazenamento:** Estrutura pronta para integração com Redis, embora use memória volátil por padrão.

## ⚙️ Configuração e Instalação

### Pré-requisitos

* Python 3.10+
* Chave de API OpenAI (necessária para o nó `llm`).

### Instalação

```bash
# Clone o repositório (Assumindo que este código será um repositório)
# git clone <URL_DO_REPO>
# cd flow-engine-python

pip install langgraph langchain-openai jinja2 requests python-dotenv py_expression_eval httpx
# Se for usar Redis no futuro:
# pip install redis