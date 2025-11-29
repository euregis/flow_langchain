import asyncio
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
with open('flow_definition.json', 'r') as f:
    flow_json = json.load(f)

async def main():
    store = InMemoryStore()
    engine = FlowEngine(flow_json, store) 
    
    # CHAVE 1: Use 'await' para compilar o grafo assíncrono
    app = await engine.build_graph()

    initial_state = {
        "context": {},
        "current_node": "setup" 
    }

    print(">>> Iniciando Fluxo Assíncrono <<<")
    
    # CORREÇÃO CHAVE: Troque .stream() por .astream() 
    # O .astream() retorna um AsyncIterator que é compatível com o 'async for'.
    async for output in app.astream(initial_state):
        # Aqui você pode inspecionar o estado a cada passo
        # print(f"Estado Atual: {output}") 
        pass 
    
    print("\n>>> Fluxo Finalizado. Verifique a mensagem final acima. <<<")
    # final_state = await app.ainvoke(initial_state)


if __name__ == "__main__":
    asyncio.run(main())  