from jinja2 import Template
from typing import Any

def render_data(data: Any, context: dict) -> Any:
    """
    Renderiza recursivamente strings ou dicionários usando Jinja2 e o contexto atual.
    """
    if isinstance(data, str):
        try:
            # Permite acessar variáveis como {{ context.var }}
            return Template(data).render(context=context)
        except Exception as e:
            print(f"Erro ao renderizar template: {e}")
            return data
    elif isinstance(data, dict):
        return {k: render_data(v, context) for k, v in data.items()}
    elif isinstance(data, list):
        return [render_data(item, context) for item in data]
    return data