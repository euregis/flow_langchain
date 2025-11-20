import json
from dotenv import load_dotenv # Importar a função
from engine import FlowEngine
from storage import InMemoryStore

# =======================================================
# NOVO PASSO: CARREGAR VARIÁVEIS DO .ENV
# Isso deve ser feito ANTES de qualquer código que use variáveis de ambiente,
# garantindo que OPENAI_API_KEY esteja disponível para o FlowEngine.
load_dotenv()
# =======================================================

# Exemplo de Configuração JSON (Mantido para Contexto)
flow_json = {
    # ... (Seu JSON de fluxo aqui) ...
    "nodes": [
        {
            "id": "setup",
            "type": "fixed",
            "action_config": {},
            "pre_update": {
                "initial": {
                    "api_base": "https://pokeapi.co/api/v2/pokemon"
                }
            },
            "next": "ask_user"
        },
        {
            "id": "ask_user",
            "type": "input",
            "action_config": {
                "message": "Digite o nome ou ID de um Pokemon (ex: pikachu, 1, 25):"
            },
            "post_update": {
                "pokemon_id": "{{ context.result.value }}"
            },
            "next": "get_pokemon"
        },
        {
            "id": "get_pokemon",
            "type": "api",
            "action_config": {
                "url": "{{ context.initial.api_base }}/{{ context.pokemon_id }}",
                "method": "GET"
            },
            "post_update": {
                "poke_data": {
                    "name": "{{ context.result.data.name }}",
                    "weight": "{{ context.result.data.weight }}"
                }
            },
            "next": "check_weight"
        },
        {
            "id": "check_weight",
            "type": "if-else",
            "action_config": {
                "condition": "{{ context.poke_data.weight | int > 100 }}",
                "true_node": "joke_node",
                "false_node": "simple_print"
            }
        },
        {
            "id": "joke_node",
            "type": "llm",
            "action_config": {
                "prompt": "Faça uma piada curta sobre um Pokémon gordo chamado {{ context.poke_data.name }} que pesa {{ context.poke_data.weight }}."
            },
            "post_update": {
                "final_message": "{{ context.result.response }}"
            },
            "next": "end_node"
        },
        {
            "id": "simple_print",
            "type": "fixed",
            "action_config": {},
            "post_update": {
                "final_message": "O Pokémon {{ context.poke_data.name }} é levinho."
            },
            "next": "end_node"
        },
        {
            "id": "end_node",
            "type": "fixed",
            "action_config": {},
            "pre_update": {
                "status": "completed"
            }
            # Sem 'next', encerra o fluxo
        }
    ]
}


def main():
    store = InMemoryStore()
    # O FlowEngine agora encontrará a chave de API automaticamente
    engine = FlowEngine(flow_json, store) 
    app = engine.build_graph()

    initial_state = {
        "context": {},
        "current_node": "setup" 
    }

    print(">>> Iniciando Fluxo <<<")
    
    for output in app.stream(initial_state):
        pass 
    
    print("\n>>> Fluxo Finalizado. Contexto Final: <<<")


if __name__ == "__main__":
    main()  