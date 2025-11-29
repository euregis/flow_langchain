``` mermaid
flowchart TD
    setup(setup<br/><small>fixed</small>)
    ask_user[/ask_user<br/><small>input</small>/]
    get_pokemon[[get_pokemon<br/><small>api</small>]]
    check_weight{check_weight<br/><small>if-else</small>}
    joke_node((joke_node<br/><small>llm</small>))
    simple_print(simple_print<br/><small>fixed</small>)
    end_node(((end_node)))

    setup --> ask_user
    ask_user --> get_pokemon
    get_pokemon --> check_weight
    check_weight -->|True| joke_node
    check_weight -->|False| simple_print
    joke_node --> end_node
    simple_print --> end_node

    classDef default fill:#f9f9f9,stroke:#333,stroke-width:2px;
    classDef ifStyle fill:#ffd700,stroke:#333,stroke-width:2px,stroke-dasharray: 5 5;
    classDef apiStyle fill:#61dafb,stroke:#333,stroke-width:2px;
    classDef llmStyle fill:#ff9a9e,stroke:#333,stroke-width:2px;
    classDef inputStyle fill:#90ee90,stroke:#333,stroke-width:2px;
    classDef endStyle fill:#333,stroke:#333,stroke-width:2px,color:#fff;
    class ask_user inputStyle;
    class get_pokemon apiStyle;
    class check_weight ifStyle;
    class joke_node llmStyle;
    class end_node endStyle;
```