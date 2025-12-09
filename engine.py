import json
import re
# Importar httpx no lugar de requests
import httpx 
from typing import Dict, Any, List, TypedDict, Literal
# Importar AsyncNodes e AsyncStateGraph
from langgraph.graph import StateGraph, END, START 
from langgraph.graph.state import StateGraph, END
from langchain_openai import ChatOpenAI
from langchain_core.messages import HumanMessage
from langgraph.checkpoint.memory import MemorySaver
from langgraph.types import interrupt
from pydantic import BaseModel

from storage import ContextStore
from templates import render_data
from py_expression_eval import Parser

# Definição do Estado do Grafo
class FlowState(TypedDict):
    context: Dict[str, Any]
    current_node: str
    status: Literal["running", "waiting_input", "completed"]
class Message(BaseModel):
    type: str
    content: Dict[str, Any]
class FlowEngine:
    # Agora recebemos llm, http_client e parser prontos
    def __init__(self, flow_config: dict, user_id: str,  memory: MemorySaver, #store: ContextStore,
            llm: ChatOpenAI, http_client: httpx.AsyncClient, parser: Parser):
        
        self.config = flow_config
        # self.store = store
        self.memory = memory
        self.user_id = user_id
        # Mapeamento é rápido, pode ficar aqui (é O(N) simples)
        self.nodes_map = {node["id"]: node for node in flow_config["nodes"]}
        
        # Referências aos objetos globais (Leve, apenas ponteiros)
        self.expression_parser = parser
        self.llm = llm 
        self.http_client = http_client

    # Lembre-se: Não feche o http_client aqui dentro se ele for compartilhado!

    # --- Funções Auxiliares (Não precisam ser assíncronas, exceto se usarem chamadas bloqueantes) ---

    def _update_context(self, current_context: dict, updates: dict, remove_keys: list = None):
        """Atualiza e limpa o contexto."""
        # ... (Mantém a implementação atual)
        rendered_updates = render_data(updates, current_context)
        current_context.update(rendered_updates)
        
        if remove_keys:
            for key in remove_keys:
                current_context.pop(key, None)
        # self.store.save_context(self.user_id, current_context)  # Salva o contexto atualizado
        return current_context

    
    # Torna a função de execução de nó assíncrona
    async def _execute_node(self, state: FlowState):
        context = state["context"]
        # context = self.store.get_context(self.user_id)
        node_id = context.get("current_node",state["current_node"])
        node_config = self.nodes_map[node_id]
        # context = state["context"]
        next_node_id = None
        status = "running"

        print(f"\n--- Executando Nó: {node_id} ({node_config['type']}) ---")

        # 1. Pre-Update Context
        if "pre_update" in node_config:
            context = self._update_context(context, node_config.get("pre_update", {}), node_config.get("pre_remove", []))

        # 2. Execução da Ação
        action_result = {}
        node_type = node_config["type"]
        
        # Renderizar configurações da ação
        action_config = render_data(node_config.get("action_config", {}), context)

        if node_type == "api":
            method = action_config.get("method", "get").lower()
            url = action_config["url"]
            headers = action_config.get("headers", {})
            body = action_config.get("body", None)
            
            # Determine if we should send as JSON or content
            json_body = None
            content_body = None
            
            if isinstance(body, (dict, list)):
                json_body = body
            elif isinstance(body, str):
                try: 
                    json_body = json.loads(body)
                except:
                    content_body = body
            else:
                json_body = body

            # !!! SUBSTITUIÇÃO CHAVE: Usar httpx.AsyncClient para chamadas assíncronas !!!
            # O `aclose()` garante que a conexão seja fechada.
            client = self.http_client
            try:
                # Usa await para esperar a requisição assíncrona
                if json_body is not None:
                    response = await client.request(method, url, headers=headers, json=json_body, timeout=60.0)
                else:
                    response = await client.request(method, url, headers=headers, content=content_body, timeout=60.0)
                
                response.raise_for_status() # Lança exceção para status 4xx/5xx

                try:
                    action_result = {"status": response.status_code, "data": response.json()}
                except:
                    action_result = {"status": response.status_code, "text": response.text}
            except httpx.HTTPStatusError as e:
                print(f"Erro HTTP: {e}")
                action_result = {"error": f"HTTP Error: {e.response.status_code}", "status": e.response.status_code}
            except httpx.RequestError as e:
                print(f"Erro de Requisição: {e}")
                action_result = {"error": f"Request Error: {e}"}

        elif node_type == "llm":
            prompt = action_config["prompt"]
            # A chamada para self.llm.invoke é síncrona, mas a LangChain oferece
            # 'ainvoke' para uso assíncrono.
            msg = await self.llm.ainvoke([HumanMessage(content=prompt)]) 
            # Garantir que o conteúdo seja corretamente decodificado como UTF-8
            response_content = msg.content
            if isinstance(response_content, bytes):
                response_content = response_content.decode('utf-8')
            action_result = {"response": response_content}

        # elif node_type == "input":
            # prompt_text = action_config.get("message", "Insira um valor:")
            
            # # Tenta obter o input do contexto (injetado pela API)
            # user_inputs = context.get("user_inputs", {})
            # if user_inputs:
            #    messages: List[Message] = [Message(**item) for item in user_inputs]
            
            # # action_result = {"value": user_input}

            # status = "waiting_input"
        elif node_type == "output":
            prompt_text = action_config.get("message", "Insira um valor:")
            
            # Tenta obter o input do contexto (injetado pela API)
            user_inputs = context.get("user_inputs", {})
            if node_id in user_inputs:
                user_input = user_inputs[node_id]
                print(f">> Input para '{node_id}' recebido via contexto: {user_input}")
            else:
                context["user_inputs"] = interrupt(prompt_text)
                # Fallback para input interativo (apenas para testes locais)
                # user_input = input(f">> {prompt_text} ")
            
            # action_result = {"value": user_input}

            # status = "waiting_input"

        elif node_type == "fixed":
            action_result = action_config.get("data", {})
        
        elif node_type == "if-else":
            action_result = render_data(node_config["action_config"]["condition"], context)
            next_node_id = (node_config["action_config"]["true_node"] if eval(action_result) 
                            else node_config["action_config"]["false_node"])

        # 3. Post-Update Context (Injetar resultado da ação no contexto)
        temp_context_for_mapping = {**context, "result": action_result}
        
        if "post_update" in node_config:
            updates = render_data(node_config["post_update"], temp_context_for_mapping)
            context.update(updates)
            
        if "post_remove" in node_config:
            for key in node_config["post_remove"]:
                context.pop(key, None)

        # 4. Determinar a Transição
        next_node_id = next_node_id or node_config.get("next")
        state["current_node"] = next_node_id
        
        state["context"] = context
        state["status"] = status
        
        # self.store.save_state(self.user_id, state)  #
        return state

    # --- Função de Callback do END ---

    async def _print_final_message(self, state: FlowState):
        """Callback executado ao atingir o END: Imprime a final_message do contexto."""
        final_message = state["context"].get("final_message", "Fluxo finalizado sem 'final_message' definida no contexto.")
        
        # O print assíncrono não existe, mas a função em si é um `async def` para ser 
        # aceita pelo `langgraph` como um executor do END.
        print("\n" + "="*50)
        print(">>> FIM DO FLUXO: MENSAGEM FINAL (Contexto) <<<")
        print(f"Mensagem: {final_message}")
        print("="*50 + "\n")
        
        # É importante retornar o estado para que o histórico seja mantido
        return state

    # --- Roteador e Build do Grafo ---

    def _router(self, state: FlowState) -> str:
        """Decide o próximo nó baseado em lógica condicional ou fluxo simples."""
        # Se 'current_node' for None/vazio, o fluxo acabou, o LangGraph usa END.
        return state["current_node"] or END
        
    async def build_graph(self):
        workflow = StateGraph(FlowState) 

        # 1. Adicionar o nó de finalização
        # É preciso dar um ID para a função de callback e adicioná-la como um nó.
        FINAL_NODE_ID = "flow_end_callback"
        workflow.add_node(FINAL_NODE_ID, self._print_final_message)
        
        # Adicionar nós normais ao grafo
        for node in self.config["nodes"]:
            workflow.add_node(node["id"], self._execute_node)

        # Definir ponto de entrada
        start_node_id = self.config["nodes"][0]["id"]
        workflow.set_entry_point(start_node_id)

        # Adicionar arestas
        for node in self.config["nodes"]:
            if node["type"] in ["switch-case", "if-else"]:
                workflow.add_conditional_edges(
                    node["id"],
                    self._router,
                )
            else:
                # Aresta normal
                if "next" in node:
                    workflow.add_edge(node["id"], node["next"])
                else:
                    # CORREÇÃO CHAVE: Usar o ID do nó de callback recém-criado
                    workflow.add_edge(node["id"], FINAL_NODE_ID)

        # 2. Conectar o nó de callback ao END do fluxo
        # Após a mensagem final ser impressa, o fluxo realmente termina.
        workflow.add_edge(FINAL_NODE_ID, END)

        # Compilar e retornar o *Runnable*
        return workflow.compile(checkpointer=self.memory)