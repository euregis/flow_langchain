import json
import re
import requests
from typing import Dict, Any, TypedDict, Literal
from langgraph.graph import StateGraph, END
from langchain_openai import ChatOpenAI
from langchain_core.messages import HumanMessage

from storage import ContextStore
from templates import render_data
from py_expression_eval import Parser

# Definição do Estado do Grafo
class FlowState(TypedDict):
    context: Dict[str, Any]
    current_node: str

class FlowEngine:
    def __init__(self, flow_config: dict, store: ContextStore):
        self.config = flow_config
        self.store = store
        self.nodes_map = {node["id"]: node for node in flow_config["nodes"]}
        self.expression_parser = Parser()
        # Inicializar LLM (ajuste a API KEY conforme necessário)
        self.llm = ChatOpenAI(model="gpt-4o-mini", temperature=0) 

    def _update_context(self, current_context: dict, updates: dict, remove_keys: list = None):
        """Atualiza e limpa o contexto."""
        # Renderiza os valores antes de atualizar
        rendered_updates = render_data(updates, current_context)
        current_context.update(rendered_updates)
        
        if remove_keys:
            for key in remove_keys:
                current_context.pop(key, None)
        return current_context
    
    def _get_value_by_path(self, data: dict, path: str):
        """Acessa um valor aninhado em um dicionário usando notação de ponto."""
        keys = path.split('.')
        for key in keys:
            try:
                data = data[key]
            except (KeyError, TypeError):
                return None
        return data
    
    def _evaluate_condition(self, condition: str, context: dict) -> bool:
        """Avalia uma expressão de condição de forma segura, resolvendo caminhos aninhados."""
        if condition.lower() == 'true':
            return True
        if condition.lower() == 'false':
            return False

        # Regex para encontrar todas as variáveis com notação de ponto (ex: contexto.a.b)
        variable_paths = re.findall(r'([a-zA-Z_][a-zA-Z0-9_.]*)', condition)
        
        # Cria um dicionário plano com os valores resolvidos do contexto
        flat_variables = {}
        for path in variable_paths:
            # Evita tentar resolver operadores como 'and', 'or', e valores literais
            if path in self.expression_parser.ops1 or path in self.expression_parser.ops2 or path.lower() in ['true', 'false']:
                continue
            
            # A chave no dicionário plano é o próprio caminho
            # O valor é buscado no dicionário de contexto aninhado
            flat_variables[path] = self._get_value_by_path(context, path.replace('contexto.', '', 1))

        # Agora, a biblioteca recebe as variáveis que ela espera
        # Ex: {'contexto.internals.intencao': 'status_pedido'}
        return self.expression_parser.parse(condition).evaluate(flat_variables)
    
    
    def _execute_node(self, state: FlowState):
        node_id = state["current_node"]
        node_config = self.nodes_map[node_id]
        context = state["context"]
        next_node_id = None

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
            
            # Conversão simples de string para JSON se necessário
            if isinstance(body, str):
                try: body = json.loads(body)
                except: pass

            response = requests.request(method, url, headers=headers, json=body)
            try:
                action_result = {"status": response.status_code, "data": response.json()}
            except:
                action_result = {"status": response.status_code, "text": response.text}

        elif node_type == "llm":
            prompt = action_config["prompt"]
            msg = self.llm.invoke([HumanMessage(content=prompt)])
            action_result = {"response": msg.content}

        elif node_type == "input":
            prompt_text = action_config.get("message", "Insira um valor:")
            user_input = input(f">> {prompt_text} ")
            action_result = {"value": user_input}

        elif node_type == "fixed":
            action_result = action_config.get("data", {})
        # elif node_type == "switch-case":
        #     destinations = {v: v for v in node_config["action_config"]["cases"].values()}
        #     if "default" in node_config["action_config"]:
        #         destinations["default"] = node_config["action_config"]["default"]
        elif node_type == "if-else":
            # next_node_id = node_id
            action_result = render_data(node_config["action_config"]["condition"], context)
            next_node_id = (node_config["action_config"]["true_node"] if eval(action_result) 
                            else node_config["action_config"]["false_node"])
            # self._evaluate_condition(
            #     node_config["action_config"]["condition"], context
            # )

        # Condicionais não geram resultado de ação "externa", apenas lógica de navegação
        
        # 3. Post-Update Context (Injetar resultado da ação no contexto)
        # Criamos um contexto temporário com o resultado para permitir mapeamento
        temp_context_for_mapping = {**context, "result": action_result}
        
        if "post_update" in node_config:
            # O post_update usa o 'result' para popular o contexto principal
            updates = render_data(node_config["post_update"], temp_context_for_mapping)
            context.update(updates)
            
        if "post_remove" in node_config:
            for key in node_config["post_remove"]:
                context.pop(key, None)

        # 4. Determinar a Transição
        # Para nós não condicionais, a transição é definida por 'next' no JSON.
        # Nós condicionais usam o roteador (_router) e não precisam retornar o next aqui.
        next_node_id = next_node_id or node_config.get("next")
        state["current_node"] = next_node_id
        
        # O estado deve ser atualizado. Se for um nó condicional, o roteador irá decidir a transição.
        # Caso contrário, retornamos apenas o estado e a aresta no build_graph cuida da transição.
        state["context"] = context
        return state

    def _router(self, state: FlowState) -> str:
        """Decide o próximo nó baseado em lógica condicional ou fluxo simples."""
        return state["current_node"] or END
        
        # if node_id == END:
        #     return END
    
        # node_config = self.nodes_map[node_id]
        # context = state["context"]
        
        # node_type = node_config["type"]

        # if node_type == "switch-case":
        #     variable = render_data(node_config["action_config"]["variable"], context)
        #     cases = node_config["action_config"]["cases"]
        #     next_node = cases.get(variable, node_config["action_config"].get("default", END))
        #     return next_node

        # elif node_type == "if-else":
        #     # Renderiza a condição como string e avalia (cuidado com eval em prod)
        #     condition_str = render_data(node_config["action_config"]["condition"], context)
        #     # Exemplo simples: convertendo "True"/"False" string ou avaliando
        #     try:
        #         is_true = eval(condition_str) # Em produção, use um avaliador seguro de expressões
        #     except:
        #         is_true = False
            
        #     return node_config["action_config"]["true_node"] if is_true else node_config["action_config"]["false_node"]

        # # Fluxo padrão
        # return node_config.get("next", END)

    def build_graph(self):
        workflow = StateGraph(FlowState)

        # Adicionar nós ao grafo
        for node in self.config["nodes"]:
            # Usamos functools.partial ou lambdas se precisarmos passar args, 
            # mas aqui o node ID está no estado, então usamos uma função genérica
            workflow.add_node(node["id"], self._execute_node)

        # Definir ponto de entrada
        start_node_id = self.config["nodes"][0]["id"] # Assume o primeiro como inicial
        workflow.set_entry_point(start_node_id)

        # Adicionar arestas
        for node in self.config["nodes"]:
            if node["type"] in ["switch-case", "if-else"]:
                # Arestas condicionais
                # # Precisamos mapear todos os destinos possíveis para o LangGraph saber
                # destinations = {}
                # if node["type"] == "switch-case":
                #     destinations = {v: v for v in node["action_config"]["cases"].values()}
                #     if "default" in node["action_config"]:
                #         destinations["default"] = node["action_config"]["default"]
                # elif node["type"] == "if-else":
                #     destinations = {
                #         "true": node["action_config"]["true_node"],
                #         "false": node["action_config"]["false_node"]
                #     }
                
                # Mapeamento para o roteador
                workflow.add_conditional_edges(
                    node["id"],
                    self._router,
                    # destinations
                )
            else:
                # Aresta normal
                if "next" in node:
                    workflow.add_edge(node["id"], node["next"])
                else:
                    workflow.add_edge(node["id"], END)

        return workflow.compile()