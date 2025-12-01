import json
import os
import time
import aiofiles
from contextlib import asynccontextmanager
from async_lru import alru_cache # Versão async do lru_cache
from typing import Dict, Any, List, Optional
from fastapi import FastAPI, HTTPException, Header, Body
from fastapi.responses import JSONResponse
import httpx
from langchain_openai import ChatOpenAI
from pydantic import BaseModel
from dotenv import load_dotenv
from py_expression_eval import Parser
from engine import FlowEngine
from storage import InMemoryStore

# Load environment variables
load_dotenv()



@asynccontextmanager
async def lifespan(app: FastAPI):
    # --- INICIALIZAÇÃO (Roda 1 vez no boot) ---
    global global_llm, global_http_client, global_parser
    
    print("Criando recursos compartilhados...")
    global_llm = ChatOpenAI(model="gpt-4o-mini", temperature=0)
    global_http_client = httpx.AsyncClient() # Cria o pool de conexão
    global_parser = Parser()
    
    yield # A aplicação roda aqui
    
    # --- LIMPEZA (Roda ao desligar) ---
    print("Fechando recursos...")
    await global_http_client.aclose()

app = FastAPI(title="Flow Execution API", lifespan=lifespan)
store = InMemoryStore() 

# Variáveis globais ou Estado da Aplicação
global_llm = None
global_http_client = None
global_parser = None
class Message(BaseModel):
    type: str
    content: Dict[str, Any]
    
# Request model for flow execution
class FlowExecutionRequest(BaseModel):
    messages: Optional[List[Message]] = {}

# CONFIGURAÇÃO DO CACHE
# maxsize=32: Guarda os últimos 32 arquivos na memória.
# ttl=60: (Opcional no async-lru) Se quiser que o cache expire a cada 60s para pegar atualizações.
@alru_cache(maxsize=32)
async def get_flow_definition(flow_name_input: str):
    # 1. Normalização do nome
    filename = flow_name_input if flow_name_input.endswith(".json") else f"{flow_name_input}.json"
    
    # 2. Estratégia EAFP (Tenta abrir direto, trata erro se falhar)
    try:
        # Leitura não bloqueante (libera a CPU para outras requests enquanto lê o disco)
        async with aiofiles.open(filename, mode='r') as f:
            content = await f.read()
            # O parse do JSON ainda é CPU-bound, mas para arquivos < 1MB é irrelevante
            return json.loads(content)
            
    except FileNotFoundError:
        # Cacheia o erro? Depende. Aqui optei por lançar direto, 
        # mas cuidado: se o arquivo for criado depois, o cache pode lembrar que "não existe".
        # Para evitar cachear erros, limpamos o cache dessa entrada específica (avançado).
        raise HTTPException(status_code=404, detail=f"Flow definition '{filename}' not found.")
        
    except json.JSONDecodeError:
        raise HTTPException(status_code=500, detail=f"Invalid JSON format in '{filename}'.")
        
    except Exception as e:
        raise HTTPException(status_code=500, detail=f"Unexpected error: {str(e)}")



@app.post("/execute/{flow_name}")
async def execute_flow(
    flow_name: str,
    request: FlowExecutionRequest,
    x_user_id: str = Header(..., description="Unique User ID for context isolation")
):
    """
    Executes a flow defined in a JSON file.
    
    - **flow_name**: The name of the flow file (e.g., flow_definition.json)
    - **inputs**: Optional dictionary of inputs to pass to the flow (mapped by node ID)
    - **x-user-id**: Header to identify the user/session
    """
    # --- No seu endpoint/bloco principal ---
    inicio = time.perf_counter()

    # Na primeira vez: lê do disco (lento). 
    # Nas próximas: lê da RAM (instantâneo, < 0.00001s).
    flow_config = await get_flow_definition(flow_name) 

    fim = time.perf_counter()

    tempo_execucao = fim - inicio
    print(f"O código levou {tempo_execucao:.5f} segundos para carregar json.")
    
    # 2. Initialize Engine with Context Isolation (using User ID)
    # Note: In a real persistent store, we would use x_user_id to fetch/save state.
    # For InMemoryStore, we create a fresh instance per request or could map it.
    # Given the requirement "separate context of concurrent calls", a fresh store per request 
    # or a store keyed by user_id is needed. Here we instantiate a fresh engine/store for the run.
    
    # Initialize Engine
    inicio = time.perf_counter()
    engine = FlowEngine(
        flow_config=flow_config, 
        user_id=x_user_id, 
        store=store,
        llm=global_llm,              # Já está pronto na memória
        http_client=global_http_client, # Pool de conexão aberto
        parser=global_parser
    )
    
    fim = time.perf_counter()
    tempo_execucao = fim - inicio
    print(f"O código levou {tempo_execucao:.5f} segundos para inicializar o engine.")
    
    # 3. Build the Graph
    try:
        inicio = time.perf_counter()
        flow_app = await engine.build_graph()
        fim = time.perf_counter()
        tempo_execucao = fim - inicio
        print(f"O código levou {tempo_execucao:.5f} segundos para construir o grafo.")
    except Exception as e:
        raise HTTPException(status_code=500, detail=f"Error building flow graph: {str(e)}")
     
    # Defensive checks: assegura que build_graph retornou um objeto utilizável
    if flow_app is None:
        raise HTTPException(status_code=500, detail="Flow engine returned None when building the graph.")
    if not hasattr(flow_app, "astream") or not callable(getattr(flow_app, "astream")):
        raise HTTPException(status_code=500, detail="Built flow app does not expose an async 'astream' method.")
    
    # 4. Prepare Initial State
    initial_state = {
        "context": {
            "user_id": x_user_id # Inject user_id into context if needed by nodes
        },
        "current_node": flow_config["nodes"][0]["id"]
    }
    state = store.get_state(x_user_id) or initial_state
    # Ensure context dict exists and inject inputs into context
    state.setdefault("context", {})
    state["context"]["user_inputs"] = request.messages
    print(f"[{x_user_id}] Starting flow '{flow_name}' with inputs: {request.messages}")

    # 5. Execute Flow
    try:
        # We use ainvoke to run until completion and get the final state
        # final_state = await flow_app.ainvoke(initial_state)
        status = "running"
        final_context = {}
        final_message = None

        async for output in flow_app.astream(state):
            print(f"[{x_user_id}] Flow step output: {output}, flow app: {flow_app}")

            # Normalize output shape. Some nodes emit: {"node_id": { ... }}
            # while others may emit the inner dict directly.
            inner = None
            if isinstance(output, dict) and len(output) == 1:
                key = next(iter(output))
                val = output[key]
                if isinstance(val, dict):
                    inner = val
                    inner["_node_id"] = key

            if inner is None:
                inner = output if isinstance(output, dict) else {}

            store.save_state(x_user_id, inner)
            # Extract fields with fallbacks to previous values
            status = inner.get("status", status)
            final_context = inner.get("context", final_context)
            final_message = final_context.get("final_message", final_message)

            # Some flows put status inside the context dict (e.g., context['status'])
            if isinstance(final_context, dict) and final_context.get("status"):
                status = final_context.get("status", status)

            # If the flow is waiting for input, return current state to caller
            if status == "waiting_input":
                return JSONResponse(
                    content={
                        "status": status,
                        "message": final_message,
                    },
                    media_type="application/json; charset=utf-8"
                )
    
        # Extract relevant results
        
        return JSONResponse(
            content={
                "status": status,
                "message": final_message,
            },
            media_type="application/json; charset=utf-8"
        )
        
    except Exception as e:
        print(f"[{x_user_id}] Error executing flow: {e}")
        raise HTTPException(status_code=500, detail=f"Error executing flow: {str(e)}")

if __name__ == "__main__":
    import uvicorn
    uvicorn.run(app, host="0.0.0.0", port=8000)
