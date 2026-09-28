# LocalMind

Privacy-first, local AI workspace powered by **Qwen3 8B**, **Ollama**, **FastAPI**, and a modern web interface.

LocalMind combines a general-purpose local AI assistant with an integrated coding environment.

## Features

### AI Assistant
- Local AI chat powered by Qwen3 8B
- Runs through Ollama
- No cloud API required
- Conversation with a local language model

### Code Studio
- Monaco Editor
- Python syntax highlighting
- Line numbers and minimap
- Code execution directly from the editor
- Structured error display
- Error line highlighting
- Copy Error functionality
- Go to Error Line
- Code selection → Ask AI
- AI coding assistance using Qwen3 8B
- Markdown and code-block rendering
- Copy buttons for AI-generated code
- Editor themes and custom colors

## Architecture

```text
                     LocalMind
                         |
          +--------------+--------------+
          |                             |
          v                             v
   AI Assistant                  Code Studio
          |                             |
          |                       Monaco Editor
          |                             |
          +-------------+---------------+
                        |
                        v
                     FastAPI
                    /      \
                   /        \
                  v          v
             Ollama      Local Python
                |          Execution
                v
             Qwen3 8B