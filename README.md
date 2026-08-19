# Mistella — The Intelligent AI

Mistella is an agentic, multimodal AI workspace built as a practical Generative AI engineering project. It combines conversational AI, LangGraph workflows, document intelligence, hybrid RAG, web research, image understanding, and persistent conversations behind a dedicated web interface.

## What it can do

- **Chat** — normal LLM-powered conversations with persistent threads.
- **Research** — research-oriented workflows with web search and LLM synthesis.
- **Documents** — upload PDFs and ask questions over indexed content.
- **Hybrid RAG** — combines semantic/vector retrieval with lexical retrieval before reranking.
- **Multimodal input** — upload images for visual understanding.
- **Conversation history** — reopen and delete previous chats.
- **Streaming responses** — responses are streamed to the UI instead of waiting for the complete answer.

## Architecture

```text
React Frontend
      │
      ▼
FastAPI API
      │
      ▼
LangGraph Workflow
   ┌──┼───────────────┐
   │  │               │
 Chat RAG          Research
   │  │               │
   │  ├─ FAISS        └─ Web Search
   │  ├─ BM25             │
   │  └─ Reranking        ▼
   │                 LLM synthesis
   └────────┬───────────────┘
            ▼
      Persistent threads
```

## Tech stack

**Backend:** Python, FastAPI, LangChain, LangGraph  
**Generative AI:** Gemini / Groq (configured through environment variables)  
**RAG:** FAISS, BM25, reranking  
**Research:** Tavily  
**Frontend:** Vite-based web frontend  
**Storage:** SQLite / LangGraph checkpointing

## Local setup

### 1. Configure environment

Copy `.env.example` to `.env` and add your own API keys. **Never commit `.env`.**

### 2. Start the backend

```bash
uv venv
uv pip install -r requirements.txt
uv run python -m uvicorn backend.main:app --reload --port 8000
```

### 3. Start the frontend

```bash
cd frontend
npm install
npm run dev
```

Then open the local Vite URL shown in the terminal.

## Environment

The repository intentionally contains only `.env.example`. API keys stay local and are excluded by `.gitignore`.

## Project status

Mistella is being developed incrementally as an AI-engineering project. The repository history reflects the progression from the API layer to the integrated workspace, with further improvements planned around provider abstraction, retrieval evaluation, agent tooling, and production deployment.
