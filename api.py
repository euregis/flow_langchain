import json
import os
from typing import Dict, Any, List, Optional
from fastapi import FastAPI, HTTPException, Header, Body
from fastapi.responses import JSONResponse
from pydantic import BaseModel
from dotenv import load_dotenv
from engine import FlowEngine
from storage import InMemoryStore

# Load environment variables
load_dotenv()

app = FastAPI(title="Flow Execution API")
store = InMemoryStore() 
class Message(BaseModel):
    type: str
    content: Dict[str, Any]
    
# Request model for flow execution
class FlowExecutionRequest(BaseModel):
    messages: Optional[List[Message]] = {}

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
    
    # 1. Validate and Load Flow Definition
    if not flow_name.endswith(".json"):
        flow_name += ".json"
    
    if not os.path.exists(flow_name):
        raise HTTPException(status_code=404, detail=f"Flow definition '{flow_name}' not found.")
    
    try:
        with open(flow_name, "r") as f:
            flow_config = json.load(f)
    except Exception as e:
        raise HTTPException(status_code=500, detail=f"Error loading flow definition: {str(e)}")

    # 2. Initialize Engine with Context Isolation (using User ID)
    # Note: In a real persistent store, we would use x_user_id to fetch/save state.
    # For InMemoryStore, we create a fresh instance per request or could map it.
    # Given the requirement "separate context of concurrent calls", a fresh store per request 
    # or a store keyed by user_id is needed. Here we instantiate a fresh engine/store for the run.
    
    
    # Initialize Engine
    engine = FlowEngine(flow_config, x_user_id, store)
    
    # 3. Build the Graph
    try:
        flow_app = await engine.build_graph()
    except Exception as e:
        raise HTTPException(status_code=500, detail=f"Error building flow graph: {str(e)}")

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
